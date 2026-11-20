'use strict';
const { createHash } = require('node:crypto');
const { safeLectureId } = require('./lecture-session');
// Every read that fences a correction participates in the same transaction as
// its mark, revision, audit and receipt. A lost response replays the receipt.
module.exports = ({ db, HttpsError, Timestamp, authorisedSubject, studentExistsInSubject, auditPayload }) => async request => {
  const context = await authorisedSubject(request, 'attendanceEdit', { edit: true });
  const data = request.data || {}, date = safeLectureId(data.date), studentId = String(data.studentId || '').trim();
  const validRevision = value => value === null || typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value);
  const fail = (code, message) => { throw new HttpsError(code, message); };
  if (!date || !studentId || studentId.includes('/') || !['setTime', 'unmark', 'setExcuse'].includes(data.action)) fail('invalid-argument', 'Invalid correction.');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(data.operationId || '') || !validRevision(data.expectedRevision) || !validRevision(data.expectedLifecycleRevision) ||
      !(data.expectedTime === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(data.expectedTime || ''))) {
    fail('failed-precondition', 'Update this client and reload the attendance record before correcting it.');
  }
  if (data.action === 'setExcuse' && (typeof data.excused !== 'boolean' || typeof data.expectedExcused !== 'boolean')) fail('invalid-argument', 'Invalid excuse state.');
  const fingerprint = createHash('sha256').update(JSON.stringify([date, studentId, data.action, data.time ?? null, data.excused ?? null,
    data.expectedRevision, data.expectedLifecycleRevision, data.expectedTime, data.expectedExcused ?? null])).digest('hex');
  const lectureRef = context.subjectRef.collection('lectures').doc(date), markRef = lectureRef.collection('marks').doc(studentId), excuseRef = lectureRef.collection('excuses').doc(studentId);
  const receiptRef = context.subjectRef.collection('correctionReceipts').doc(data.operationId);
  const auditRef = db.collection('attendanceWorkspaces').doc(context.workspaceId).collection('auditEvents').doc('correction_' + data.operationId);
  // Resolve old document-ID aliases through the existing compatibility reader.
  const student = await studentExistsInSubject(context.workspaceId, context.subject, studentId);
  return db.runTransaction(async tx => {
    const [subjectSnap, lectureSnap, markSnap, excuseSnap, receiptSnap] = await tx.getAll(context.subjectRef, lectureRef, markRef, excuseRef, receiptRef);
    if (receiptSnap.exists) {
      if (receiptSnap.data().fingerprint !== fingerprint) fail('already-exists', 'Correction identifier was already used for another request.');
      return receiptSnap.data().result;
    }
    const subject = subjectSnap.data() || {}, lecture = lectureSnap.data() || {}, mark = markSnap.exists ? markSnap.data() : null;
    if (!subjectSnap.exists || subject.rosterOperationId || subject.attendanceClearInProgress ||
        (subject.lastRosterResetId || '') !== (context.subject.lastRosterResetId || '') ||
        (subject.rosterCohortId || '') !== (context.subject.rosterCohortId || '') ||
        Number(subject.attendanceClearedAt?.toMillis?.() || 0) !== Number(context.subject.attendanceClearedAt?.toMillis?.() || 0)) fail('failed-precondition', 'Subject changed; reload before correction.');
    if (!student || String(student.id || studentId) !== studentId) fail('not-found', 'The student is not enrolled in this cohort.');
    if (!lectureSnap.exists || lecture.restorationInProgress || ['cancelled', 'voided'].includes(lecture.status)) fail('failed-precondition', 'Lecture is unavailable for correction.');
    if ((lecture.lifecycleRevision || null) !== data.expectedLifecycleRevision || (lecture.markRevisions?.[studentId] || null) !== data.expectedRevision ||
        (mark?.time || null) !== data.expectedTime || data.action === 'setExcuse' && excuseSnap.exists !== data.expectedExcused) fail('failed-precondition', 'Attendance changed on another device; reload and review.');
    const now = Timestamp.now(), before = { mark, excuse: excuseSnap.exists ? excuseSnap.data() : null };
    let after;
    if (data.action === 'setTime') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(lecture.startTime || '')) fail('invalid-argument', 'Invalid attendance time.');
      const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      const duration = Number(lecture.durationMinutes || Number(lecture.durationHours || subject.lectureDurationHours || 2) * 60);
      const elapsed = minutes(data.time) - minutes(lecture.startTime);
      if (!Number.isFinite(duration) || duration <= 0 || elapsed < 0 || elapsed >= duration) fail('failed-precondition', 'Attendance outside lecture duration.');
      const record = { ...(mark || {}), studentId, studentName: student.name, time: data.time, attendedMinutes: Math.max(0, Math.round(duration - elapsed)),
        markedAt: mark?.markedAt || now, markedBy: mark?.markedBy || request.auth.uid, method: 'manual', correctedAt: now, correctedBy: request.auth.uid, source: 'official-correction-v2' };
      tx.set(markRef, record); tx.delete(excuseRef); after = { mark: record };
    } else if (data.action === 'unmark') { tx.delete(markRef); after = { mark: null }; }
    else {
      if (data.excused) { tx.set(excuseRef, { studentId, date, excusedBy: request.auth.uid, excusedAt: now, source: 'official-correction-v2' }); tx.delete(markRef); }
      else tx.delete(excuseRef);
      after = { excused: data.excused };
    }
    tx.set(lectureRef, { markRevisions: { ...(lecture.markRevisions || {}), [studentId]: data.operationId }, updatedAt: now,
      ...(lecture.status === 'completed' ? { summaryState: 'rebuild-pending' } : {}) }, { merge: true });
    tx.set(context.subjectRef, { summaryState: 'pending' }, { merge: true });
    tx.create(auditRef, auditPayload({ workspaceId: context.workspaceId, subjectId: context.subjectId, lectureDate: date, studentId,
      actorUid: request.auth.uid, action: 'attendance.' + data.action, before, after, source: 'official-correction-v2' }));
    const result = { date, studentId, action: data.action, revision: data.operationId, summaryQueued: true };
    tx.create(receiptRef, { fingerprint, result, actor: request.auth.uid, acceptedAt: now });
    return result;
  });
};
