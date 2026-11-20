"use strict";

const { createHash, randomUUID } = require("crypto");
const { safeLectureId, calendarDate } = require("./lecture-session");
const { latestWeeklyCutoff, lectureAssessmentEndMillis } = require("./weekly-approval");
const MODEL = "max-cumulative-attendee-weekly-v1";
const SCHEMA = 4;
const number = value => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;

function logicalLectureStartMillis(lecture) {
  const date = calendarDate(lecture.id), match = /^(\d{1,2}):(\d{2})$/.exec(String(lecture.startTime || ""));
  const minutes = match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : 0;
  return Date.parse(date + "T00:00:00+03:00") + minutes * 60000;
}

function calculateSummaries(roster, lectures, policy, absenceStatus, review = latestWeeklyCutoff()) {
  const ordered = lectures.filter(lecture => !["cancelled", "voided"].includes(lecture.status)).map(lecture => ({
    ...lecture, durationMinutes: number(lecture.durationMinutes), logicalStart: logicalLectureStartMillis(lecture),
    marksById: new Map((lecture.marks || []).map(mark => [mark.id, mark]))
  })).sort((a, b) => a.logicalStart - b.logicalStart || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // An active document whose logical end precedes the cutoff is already due
  // for automatic closure, even if the minute worker has not run yet.
  const approved = ordered.filter(lecture => lectureAssessmentEndMillis(lecture) <= review.reviewCutoffMillis);
  const approvedIds = new Set(approved.map(lecture => lecture.id));
  const remaining = ordered.filter(lecture => !approvedIds.has(lecture.id));
  const running = new Map(roster.map(student => [student.id, { attendedMinutes: 0, excusedMinutes: 0 }]));
  const addLecture = lecture => {
    const excuses = new Set(lecture.excuses || []);
    for (const student of roster) {
      const item = running.get(student.id), mark = lecture.marksById.get(student.id);
      const attended = mark ? Math.min(lecture.durationMinutes, number(mark.attendedMinutes)) : 0;
      item.attendedMinutes += attended;
      if (excuses.has(student.id)) item.excusedMinutes += Math.max(0, lecture.durationMinutes - attended);
    }
  };
  const maximum = () => Math.max(0, ...Array.from(running.values(), row => row.attendedMinutes));
  for (const lecture of approved) addLecture(lecture);
  const weeklyReferenceMinutes = maximum(), eligibleLectureCount = approved.length, pendingLectureCount = remaining.length;
  const reviewPending = eligibleLectureCount === 0;
  const applied = approved.map(lecture => lecture.id);
  let assessedSessionMinutesTotal = approved.reduce((sum, lecture) => sum + lecture.durationMinutes, 0);
  const state = new Map(roster.map(student => [student.id, {
    studentId: student.id, studentName: student.name,
    assessedAttendedMinutes: running.get(student.id).attendedMinutes, excusedMinutes: running.get(student.id).excusedMinutes,
    referenceMinutes: weeklyReferenceMinutes, weeklyReferenceMinutes, assessedAppliedLectureIds: [...applied],
    assessedSessionMinutesTotal, reviewPending, assessmentSource: "weekly", assessmentLectureId: "", assessmentAt: review.reviewCutoffAt
  }]));
  // Every session contributes once to the running enrolled-student maximum.
  // Only its own attendees receive this newer assessment. Attending an earlier
  // session is NOT permission to keep reassessing that student when another
  // group has its later session; their last assessment remains until they
  // attend again or the common weekly cutoff advances.
  for (const lecture of remaining) {
    addLecture(lecture);
    applied.push(lecture.id); assessedSessionMinutesTotal += lecture.durationMinutes;
    const referenceMinutes = maximum();
    for (const student of roster) {
      if (!lecture.marksById.has(student.id)) continue;
      const item = running.get(student.id), row = state.get(student.id);
      Object.assign(row, { assessedAttendedMinutes: item.attendedMinutes, excusedMinutes: item.excusedMinutes,
        referenceMinutes, assessedAppliedLectureIds: [...applied], assessedSessionMinutesTotal,
        reviewPending: false, assessmentSource: "attendance", assessmentLectureId: lecture.id,
        assessmentAt: new Date(lecture.logicalStart).toISOString() });
    }
  }
  const liveReferenceMinutes = maximum(), sessionMinutesTotal = ordered.reduce((sum, lecture) => sum + lecture.durationMinutes, 0);
  const totalMinutes = Math.max(1, Math.round(Number(policy.totalHours) * 60));
  const rows = Array.from(state.values(), row => {
    const absentMinutes = Math.max(0, row.referenceMinutes - row.assessedAttendedMinutes);
    const excusedMinutes = Math.min(absentMinutes, row.excusedMinutes), unexcusedMinutes = absentMinutes - excusedMinutes;
    const absencePercent = absentMinutes / totalMinutes * 100, unexcusedAbsencePercent = unexcusedMinutes / totalMinutes * 100;
    return { ...row, attendedMinutes: running.get(row.studentId).attendedMinutes, appliedLectureIds: ordered.map(lecture => lecture.id),
      deliveredMinutes: row.referenceMinutes, sessionMinutesTotal, absentMinutes, excusedMinutes, unexcusedMinutes,
      totalMinutes, absencePercent, unexcusedAbsencePercent, ...review, eligibleLectureCount, pendingLectureCount,
      status: row.reviewPending ? "pendingReview" : absenceStatus(absencePercent, unexcusedAbsencePercent, policy),
      policyVersion: policy.version, calculationModel: MODEL, schemaVersion: SCHEMA };
  });
  return { rows, referenceMinutes: weeklyReferenceMinutes, weeklyReferenceMinutes, liveReferenceMinutes,
    ...review, reviewPending, eligibleLectureCount, pendingLectureCount };
}

function createRebuilder({ db, Timestamp, HttpsError, cohortIdForSubject, policyForSubject, absenceStatus, attendanceMinutes, baghdadParts, now = () => Date.now() }) {
  // read may be a normal read or a Firestore transaction read. The final
  // publication re-reads the entire calculation input under transaction locks.
  async function readInput(subjectRef, read) {
    const subjectSnapshot = await read(subjectRef);
    if (!subjectSnapshot.exists) throw new HttpsError("not-found", "The subject no longer exists.");
    const subject = { ...subjectSnapshot.data(), id: subjectSnapshot.id };
    if (subject.rosterOperationId || subject.attendanceClearInProgress) return { skipped: true };
    const cohortRef = subjectRef.parent.parent.collection("cohorts").doc(cohortIdForSubject(subject));
    const cohort = await read(cohortRef);
    let students = (await read(cohortRef.collection("students"))).docs;
    const legacyFallback = !students.length && !(Number(cohort.data()?.rosterVersion) >= 1) && !subject.rosterCohortId && !subject.lastRosterResetId;
    if (legacyFallback) students = (await read(subjectRef.collection("students"))).docs;
    let roster = students.map(doc => ({ id: String(doc.data().id || doc.id), name: String(doc.data().name || "") }));
    if (!roster.length && legacyFallback && Array.isArray(subject.students)) {
      roster = subject.students.map(row => ({ id: String(row.id || row.studentId || "").trim(), name: String(row.name || row.studentName || "").trim() }));
    }
    roster = Array.from(new Map(roster.filter(row => row.id && row.name).map(row => [row.id, row])).values()).sort((a, b) => a.id.localeCompare(b.id));
    const allLectures = await read(subjectRef.collection("lectures"));
    const review = latestWeeklyCutoff(now()), today = baghdadParts().date, lectures = [], sources = [];
    const orderedSnapshots = allLectures.docs.sort((a, b) => a.id.localeCompare(b.id));
    // Bound concurrent history reads without changing the final transactional
    // fingerprint fence or the chronological calculation order.
    for (let offset = 0; offset < orderedSnapshots.length; offset += 4) {
      await Promise.all(orderedSnapshots.slice(offset, offset + 4).map(async snapshot => {
      const data = snapshot.data() || {}, id = safeLectureId(snapshot.id);
      if (!id || data.restorationInProgress || !(data.status === "active" || data.status === "completed" || (!data.status && calendarDate(id) < today))) return;
      const durationMinutes = number(data.durationMinutes || Number(data.durationHours || subject.lectureDurationHours || 2) * 60);
      const [marks, excuses] = await Promise.all([read(snapshot.ref.collection("marks")), read(snapshot.ref.collection("excuses"))]);
      lectures.push({ id, status: data.status || "completed", durationMinutes, startTime: data.startTime || "", endAt: data.endAt || null,
        closeReason: data.closeReason || "", closedAtMillis: Number(data.closedAtMillis) || 0, marks: marks.docs.map(doc => {
        const mark = doc.data() || {};
        const storedMinutes = mark.attendedMinutes;
        return { id: doc.id, attendedMinutes: storedMinutes === null || storedMinutes === undefined || !Number.isFinite(Number(storedMinutes))
          ? attendanceMinutes(data.startTime, mark.time, durationMinutes) : number(storedMinutes) };
      }).sort((a, b) => a.id.localeCompare(b.id)), excuses: excuses.docs.map(doc => doc.id).sort() });
      sources.push(snapshot);
      }));
    }
    lectures.sort((a, b) => a.id.localeCompare(b.id));
    sources.sort((a, b) => a.id.localeCompare(b.id));
    const policy = policyForSubject(subject);
    const fingerprint = createHash("sha256").update(JSON.stringify({ roster, lectures, policy, review })).digest("hex");
    return { roster, lectures, policy, review, fingerprint, sources, subject };
  }

  return async function rebuild(workspaceId, subjectId) {
    const subjectRef = db.collection("attendanceWorkspaces").doc(workspaceId).collection("subjects").doc(subjectId);
    const generation = randomUUID();
    const started = await db.runTransaction(async tx => {
      const doc = await tx.get(subjectRef);
      if (!doc.exists) throw new HttpsError("not-found", "The subject no longer exists.");
      if (doc.data().rosterOperationId || doc.data().attendanceClearInProgress) return false;
      tx.set(subjectRef, { summaryGeneration: generation, summaryState: "building", summaryBuildStartedAt: Timestamp.now() }, { merge: true });
      return true;
    });
    if (!started) return { skipped: true };
    const input = await readInput(subjectRef, ref => ref.get());
    if (input.skipped) return { skipped: true };
    const result = calculateSummaries(input.roster, input.lectures, input.policy, absenceStatus, input.review);
    for (let index = 0; index < result.rows.length; index += 350) {
      const written = await db.runTransaction(async tx => {
        const current = await tx.get(subjectRef);
        if (!current.exists || current.data().summaryGeneration !== generation || current.data().rosterOperationId || current.data().attendanceClearInProgress) return false;
        for (const row of result.rows.slice(index, index + 350)) {
          tx.set(subjectRef.collection("attendanceSummaries").doc(row.studentId), {
            ...row, summaryGeneration: generation, updatedAt: Timestamp.now(), rebuiltAt: Timestamp.now()
          }, { merge: true });
        }
        return true;
      });
      if (!written) return { superseded: true };
    }
    const published = await db.runTransaction(async tx => {
      const current = await tx.get(subjectRef);
      if (!current.exists || current.data().summaryGeneration !== generation) return false;
      const fresh = await readInput(subjectRef, ref => tx.get(ref));
      if (fresh.skipped || fresh.fingerprint !== input.fingerprint) {
        tx.set(subjectRef, { summaryState: "pending" }, { merge: true });
        return false;
      }
      tx.set(subjectRef, { summarySchemaVersion: SCHEMA, summaryCalculationModel: MODEL, summaryState: "ready",
        summaryReferenceMinutes: result.referenceMinutes, summarySourceFingerprint: input.fingerprint,
        summaryLiveReferenceMinutes: result.liveReferenceMinutes,
        summaryReviewCutoffMillis: result.reviewCutoffMillis, summaryReviewCutoffAt: result.reviewCutoffAt,
        summaryNextReviewAt: result.nextReviewAt, summaryReviewPending: result.reviewPending,
        summaryEligibleLectureCount: result.eligibleLectureCount,
        policySnapshot: input.policy, attendanceLocked: input.lectures.length > 0,
        lastSummaryRebuildAt: Timestamp.now() }, { merge: true });
      return true;
    });
    if (!published) return { queued: true };
    // Mark only the exact lecture versions we read as applied. A newer offline
    // correction's pending flag must never be cleared by an older rebuild.
    for (let index = 0; index < input.sources.length; index += 300) {
      const sources = input.sources.slice(index, index + 300);
      await db.runTransaction(async tx => {
        const current = await tx.get(subjectRef);
        const fresh = await tx.getAll(...sources.map(doc => doc.ref));
        if (!current.exists || current.data().summaryGeneration !== generation || current.data().summaryState !== "ready") return;
        fresh.forEach((doc, i) => {
          if (doc.exists && doc.updateTime?.isEqual(sources[i].updateTime)) tx.set(doc.ref, {
            summaryState: "applied", summarySchemaVersion: SCHEMA, summaryCalculationModel: MODEL,
            summaryAppliedAt: Timestamp.now()
          }, { merge: true });
        });
      });
    }
    return { applied: true, students: result.rows.length, lectures: input.lectures.length,
      referenceMinutes: result.referenceMinutes, liveReferenceMinutes: result.liveReferenceMinutes,
      reviewCutoffAt: result.reviewCutoffAt, reviewPending: result.reviewPending,
      calculationModel: MODEL, summaryGeneration: generation };
  };
}

module.exports = { MODEL, SCHEMA, calculateSummaries, createRebuilder };
