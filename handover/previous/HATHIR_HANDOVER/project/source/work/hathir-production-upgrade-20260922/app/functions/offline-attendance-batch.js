"use strict";
const { safeLectureId, calendarDate } = require("./lecture-session");

// Keep the original single-operation callable for already-open/older clients.
// This endpoint is colocated with Firestore and commits a bounded, ordered prefix.
module.exports = ({ onCall, HttpsError, db, Timestamp, authorisedSubject, cohortIdForSubject, acceptAlreadyClosed = false }) => ({
  syncOfflineAttendanceBatch: onCall({ region: "asia-south1", invoker: "public", timeoutSeconds: 120, memory: "512MiB" }, async request => {
    const operations = request.data.operations;
    const invalid = message => { throw new HttpsError("invalid-argument", message); };
    if (!Array.isArray(operations) || !operations.length || operations.length > 25) invalid("Send 1–25 operations.");
    const ctx = await authorisedSubject(request, "attendanceMark", {
      edit: operations.some(op => ["setTime", "unmark", "cancel"].includes(op?.kind))
    });
    const revisionValid = value => value === null || /^[a-zA-Z0-9-]{16,80}$/.test(value || "");
    const ids = new Set();
    for (const op of operations) {
      if (!op || !/^[a-zA-Z0-9-]{16,80}$/.test(op.id || "") || ids.has(op.id) ||
          !safeLectureId(op.date) || !["mark", "close", "cancel", "setTime", "unmark"].includes(op.kind) ||
          ![undefined, 1, 2, 3].includes(op.protocolVersion)) invalid("Invalid operation.");
      ids.add(op.id);
      if (op.uid !== request.auth.uid || op.workspaceId !== ctx.workspaceId || op.subjectId !== ctx.subjectId) {
        throw new HttpsError("permission-denied", "Account mismatch.");
      }
      if (!["close", "cancel"].includes(op.kind) && (typeof op.studentId !== "string" || !op.studentId || op.studentId.includes("/") ||
          [".", ".."].includes(op.studentId) || Buffer.byteLength(op.studentId) > 1500)) invalid("Invalid student identifier.");
      if (["setTime", "unmark"].includes(op.kind) && ![2,3].includes(op.protocolVersion)) invalid("Corrections require a versioned protocol.");
      if (op.kind === "cancel" && op.protocolVersion !== 3) invalid("Lecture cancellation requires protocol version 3.");
      if (op.protocolVersion === 3 && (!revisionValid(op.expectedLifecycleRevision) ||
          (["close", "cancel"].includes(op.kind) && !["active", "completed"].includes(op.expectedLifecycleStatus)))) invalid("Invalid lecture base version.");
      if ([2,3].includes(op.protocolVersion) && !["close", "cancel"].includes(op.kind)) {
        if (!revisionValid(op.expectedRevision) || (op.kind === "mark" ? op.expectedTime !== null :
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(op.expectedTime || ""))) invalid("Invalid attendance base version.");
        if (op.expectedMarkedAtMillis != null && (!Number.isFinite(op.expectedMarkedAtMillis) || op.expectedMarkedAtMillis < 0)) invalid("Invalid attendance timestamp.");
      }
    }

    const receiptRefs = operations.map(op => ctx.subjectRef.collection("offlineReceipts").doc(op.id));
    const prior = await db.getAll(...receiptRefs);
    // A lost acknowledgement must remain replayable after a roster edit/reset.
    const pending = operations.filter((_, i) => !prior[i].exists);
    const studentIds = [...new Set(pending.filter(op => !["close", "cancel"].includes(op.kind)).map(op => op.studentId))];
    const studentRefs = new Map();
    let embeddedRoster = false;
    if (studentIds.length) {
      const cohort = db.collection("attendanceWorkspaces").doc(ctx.workspaceId)
        .collection("cohorts").doc(cohortIdForSubject(ctx.subject));
      let collection = cohort.collection("students");
      if (!ctx.subject.rosterCohortId && !ctx.subject.lastRosterResetId) {
        // Match the legacy roster's precedence without downloading a whole class.
        const [cohortDoc, first] = await Promise.all([cohort.get(), collection.limit(1).get()]);
        if (!(Number(cohortDoc.data()?.rosterVersion) >= 1) && first.empty) {
          collection = ctx.subjectRef.collection("students");
          embeddedRoster = (await collection.limit(1).get()).empty;
        }
      }
      if (!embeddedRoster) {
        const direct = await db.getAll(...studentIds.map(id => collection.doc(id)));
        const missing = [];
        direct.forEach((snap, i) => {
          if (snap.exists && String(snap.data().id || snap.id) === studentIds[i]) studentRefs.set(studentIds[i], snap.ref);
          else missing.push(studentIds[i]);
        });
        // Narrow compatibility query for early auto-ID student documents.
        await Promise.all(Array.from({ length: Math.ceil(missing.length / 10) }, async (_, i) => {
          const snapshot = await collection.where("id", "in", missing.slice(i * 10, i * 10 + 10)).get();
          snapshot.docs.forEach(snap => studentRefs.set(String(snap.data().id), snap.ref));
        }));
      }
    }

    const result = await db.runTransaction(async tx => {
      const refs = new Map();
      const add = ref => { refs.set(ref.path, ref); return ref; };
      add(ctx.subjectRef); receiptRefs.forEach(add); studentRefs.forEach(add);
      operations.forEach(op => {
        const lecture = add(ctx.subjectRef.collection("lectures").doc(op.date));
        if (!["close", "cancel"].includes(op.kind)) add(lecture.collection("marks").doc(op.studentId));
      });
      // All reads precede writes, including marks repeated within this batch.
      const snapshots = await tx.getAll(...refs.values());
      const state = new Map(snapshots.map(snap => [snap.ref.path, snap.exists ? snap.data() : null]));
      const originallyPresent = new Set(snapshots.filter(snap => snap.exists).map(snap => snap.ref.path));
      const freshSubject = state.get(ctx.subjectRef.path);
      const writes = new Map(), acceptedOperationIds = [];
      let failure = null;
      const stage = (ref, data, create = false) => {
        state.set(ref.path, data);
        // Final mode is based on the original snapshot, not an earlier staged mutation.
        writes.set(ref.path, { ref, data, create: create && !originallyPresent.has(ref.path) });
      };
      const remove = ref => {
        state.set(ref.path, null);
        if (originallyPresent.has(ref.path)) writes.set(ref.path, { ref, remove: true });
        else writes.delete(ref.path);
      };
      const reject = (code, message) => { throw new HttpsError(code, message); };
      for (const op of operations) {
        const receipt = ctx.subjectRef.collection("offlineReceipts").doc(op.id);
        if (state.get(receipt.path)) { acceptedOperationIds.push(op.id); continue; }
        try {
          if (!Number.isFinite(op.createdAt) || op.createdAt > Date.now() + 300000) invalid("Invalid device clock or lecture date.");
          const meta = op.meta || {}, duration = Number(meta.durationHours);
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(meta.startTime || "") || !Number.isFinite(duration) || duration <= 0 || duration > 24) invalid("Invalid lecture.");
          if (!freshSubject || freshSubject.rosterOperationId || (freshSubject.lastRosterResetId || "") !== (op.rosterResetId || "") ||
              (freshSubject.rosterCohortId || "") !== (ctx.subject.rosterCohortId || "")) reject("failed-precondition", "Subject or roster changed; review required.");
          if (freshSubject.attendanceClearInProgress || Number(freshSubject.attendanceClearedAt?.toMillis?.() || 0) > Number(op.preparedAt || 0)) reject("failed-precondition", "Attendance was cleared after offline preparation; review required.");
          const lectureRef = ctx.subjectRef.collection("lectures").doc(op.date);
          const lecture = state.get(lectureRef.path) || {};
          if (["setTime", "unmark", "cancel"].includes(op.kind) && !state.get(lectureRef.path)) reject("failed-precondition", "The lecture no longer exists.");
          if (["cancelled", "voided"].includes(lecture.status)) reject("failed-precondition", "Lecture was cancelled.");
          // Preview reconciliation acknowledges an already fulfilled CLOSE only.
          // It never changes the authoritative cutoff, marks, revisions, or cancellation.
          if (acceptAlreadyClosed && op.protocolVersion === 3 && op.kind === 'close' && op.expectedLifecycleStatus === 'active' &&
              lecture.status === 'completed' && lecture.startTime === meta.startTime && Number(lecture.durationHours) === duration) {
            const startAt = Date.parse(calendarDate(op.date) + 'T' + meta.startTime + ':00+03:00');
            const reason = meta.closeReason || 'elapsed';
            const cutoff = Number(meta.closedAtMillis || (reason === 'elapsed' ? startAt + duration*3600000 : op.createdAt));
            if (!['manual','elapsed'].includes(reason) || !Number.isFinite(cutoff) || cutoff < startAt || cutoff > op.createdAt + 300000) invalid('Invalid lecture closure time.');
            stage(receipt, {operationId:op.id,kind:op.kind,actor:request.auth.uid,acceptedAt:Timestamp.now(),resolution:'already-closed',
              requestedClosedAtMillis:cutoff,retainedLifecycleRevision:lecture.lifecycleRevision||null,retainedClosedAtMillis:lecture.closedAtMillis||null}, true);
            acceptedOperationIds.push(op.id); continue;
          }
          const lifecycleRevision = lecture.lifecycleRevision || null;
          const lifecycleOperation = ["close", "cancel"].includes(op.kind);
          // An equivalence set is created only by this endpoint's exact elapsed
          // close. It is invalid as soon as any explicit lifecycle revision or
          // cutoff changes; legacy closures without this evidence stay fenced.
          const savedEquivalence = lecture.elapsedCloseEquivalence;
          const equivalence = lecture.status === "completed" && lecture.closeReason === "elapsed" &&
            savedEquivalence?.revision === lifecycleRevision &&
            savedEquivalence.closedAtMillis === lecture.closedAtMillis &&
            Array.isArray(savedEquivalence.operationIds) ? savedEquivalence : null;
          const equivalentRevision = equivalence && equivalence.operationIds.includes(op.expectedLifecycleRevision);
          // Older clients send zero for a scheduled closure. Use the same
          // planned-end fallback used when committing it, before comparing
          // duplicate closures; retain all revision/reset/time fences.
          const elapsedClosedAt = Number(meta.closedAtMillis ||
            (Date.parse(calendarDate(op.date) + "T" + meta.startTime + ":00+03:00") + duration * 3600000));
          const duplicateElapsedClose = op.protocolVersion === 3 && op.kind === "close" && equivalence &&
            op.expectedLifecycleRevision === equivalence.baseRevision && op.expectedLifecycleStatus === "active" &&
            meta.closeReason === "elapsed" && elapsedClosedAt === equivalence.closedAtMillis &&
            equivalence.operationIds.length < 32;
          if (op.protocolVersion === 3 ? lifecycleRevision !== op.expectedLifecycleRevision && !equivalentRevision && !duplicateElapsedClose : lifecycleRevision !== null) reject("failed-precondition", "Lecture state changed on another device; review required.");
          if (op.protocolVersion === 3 && lifecycleOperation) {
            const status = lecture.status || "active";
            // An automatic scheduled close is not a contradictory teacher
            // decision. Explicit changes are fenced by status and revision.
            const elapsedClose = status === "completed" && lecture.closeReason === "elapsed" && op.expectedLifecycleStatus === "active";
            if (status !== op.expectedLifecycleStatus && !elapsedClose) reject("failed-precondition", "Lecture status changed; review required.");
            if (op.kind === "close" && op.expectedLifecycleStatus !== "active") reject("failed-precondition", "Only an open lecture can be closed.");
          }
          if (lecture.startTime && lecture.startTime !== meta.startTime) reject("failed-precondition", "Another device recorded a different lecture time.");
          if (Number(lecture.durationHours || duration) !== duration) reject("failed-precondition", "Lecture duration changed.");
          let newMark, removedMark, nextRevision;
          if (!lifecycleOperation) {
            const studentRef = studentRefs.get(op.studentId);
            const student = studentRef ? state.get(studentRef.path) : embeddedRoster ? (freshSubject.students || []).find(s => String(s.id || s.studentId || "").trim() === op.studentId) : null;
            if (!student || String(student.id || studentRef?.id || student.studentId || "").trim() !== op.studentId ||
                String(student.name || student.studentName || "").trim() !== op.studentName) reject("failed-precondition", "Student list changed; attendance needs review.");
            const markRef = lectureRef.collection("marks").doc(op.studentId), mark = state.get(markRef.path);
            const revision = Object.prototype.hasOwnProperty.call(lecture.markRevisions || {}, op.studentId)
              ? lecture.markRevisions[op.studentId] : null;
            if ([2,3].includes(op.protocolVersion)) {
              // Null is a real base version, not permission to overwrite a
              // newer revision. The legacy time-only fallback is allowed only
              // while the server has no version for this student either.
              if (revision !== op.expectedRevision) reject("failed-precondition", "Attendance changed on another device; review required.");
              if (op.kind === "mark" ? Boolean(mark) : !mark || mark.time !== op.expectedTime) reject("failed-precondition", "Attendance changed on another device; review required.");
              if (op.kind !== "mark" && op.expectedMarkedAtMillis > 0 && Number(mark.markedAt?.toMillis?.() || 0) !== op.expectedMarkedAtMillis) reject("failed-precondition", "Attendance timestamp changed on another device; review required.");
            } else if (!mark && revision !== null) {
              // Physical deletion retains a tombstone in the lecture so an
              // old queued mark cannot recreate attendance on reconnect.
              reject("failed-precondition", "Attendance was removed on another device; review required.");
            }
            nextRevision = op.id;
            if (op.kind === "unmark") {
              removedMark = markRef;
            } else {
              const record = op.record || {};
              if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(record.time || "")) invalid("Invalid attendance time.");
              const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
              const elapsed = minutes(record.time) - minutes(meta.startTime);
              if (elapsed < 0 || elapsed >= duration * 60) reject("failed-precondition", "Attendance outside lecture duration.");
              if (op.kind === "mark" && mark && mark.time !== record.time) reject("already-exists", "Attendance exists at another time; review required.");
              if (!mark || op.kind === "setTime") newMark = { ref: markRef, data: {
                ...(mark || {}), studentId: op.studentId, studentName: op.studentName, time: record.time,
                method: ["qr", "face", "manual", "scan", "image", "rfid", "nfc"].includes(record.method) ? record.method : "manual",
                attendedMinutes: Math.max(0, Math.round(duration * 60 - elapsed)), markedBy: request.auth.uid,
                markedAt: Timestamp.now(), offlineRecordedAt: op.createdAt,
                source: op.protocolVersion === 3 ? "offline-outbox-v3" : op.protocolVersion === 2 ? "offline-outbox-v2" : "offline-outbox-v1"
              } };
            }
          }
          const lifecycleFields = {};
          if (op.protocolVersion === 3 && lifecycleOperation) {
            lifecycleFields.lifecycleRevision = duplicateElapsedClose ? lifecycleRevision : op.id;
            lifecycleFields.elapsedCloseEquivalence = null;
            if (op.kind === "close") {
              const startAt = Date.parse(calendarDate(op.date) + "T" + meta.startTime + ":00+03:00");
              const plannedEnd = startAt + duration * 3600000;
              const reason = meta.closeReason || "elapsed";
              if (!["manual", "elapsed"].includes(reason)) invalid("Invalid lecture closure reason.");
              const closedAt = Number(meta.closedAtMillis || (reason === "elapsed" ? plannedEnd : op.createdAt));
              if (!Number.isFinite(closedAt) || closedAt < startAt || closedAt > op.createdAt + 300000) invalid("Invalid lecture closure time.");
              lifecycleFields.closedAtMillis = closedAt;
              lifecycleFields.closeReason = reason;
              // Only the identical planned cutoff qualifies, never an early or
              // manual close. Keep the canonical revision stable so operations
              // dependent on either acknowledged close can still be validated.
              if (reason === "elapsed" && closedAt === plannedEnd) {
                lifecycleFields.elapsedCloseEquivalence = duplicateElapsedClose
                  ? { ...equivalence, operationIds: [...equivalence.operationIds, op.id] }
                  : { revision: op.id, baseRevision: op.expectedLifecycleRevision, closedAtMillis: closedAt, operationIds: [op.id] };
              }
            } else lifecycleFields.cancelledAtMillis = op.createdAt;
          }
          // No staged writes until the entire operation has passed validation.
          if (newMark) stage(newMark.ref, newMark.data, true);
          if (removedMark) remove(removedMark);
          const status = op.kind === "cancel" ? "cancelled" : lecture.status === "completed" || op.kind === "close" ? "completed" : "active";
          stage(lectureRef, { ...lecture, date: op.date, calendarDate: calendarDate(op.date), startTime: meta.startTime, durationHours: duration, status, updatedAt: Timestamp.now(),
            ...(op.kind === "unmark" ? { hideWhenEmpty: true } : {}),
            ...lifecycleFields,
            ...(nextRevision ? { markRevisions: { ...lecture.markRevisions, [op.studentId]: nextRevision } } : {}),
            ...(status === "completed" ? { completedAt: lecture.completedAt || Timestamp.now(), summaryState: "rebuild-pending" } : {}),
            ...(status === "cancelled" ? { cancelledAt: Timestamp.now(), summaryState: "not-required" } : {}) });
          if (op.kind === "cancel") {
            // Cancelled sessions are excluded from calculation sources. Do not
            // leave them permanently occupying the bounded lecture work queue;
            // invalidate the parent instead, in this same accepted transaction.
            stage(ctx.subjectRef, { ...state.get(ctx.subjectRef.path), summaryState: "pending" });
          }
          stage(receipt, { operationId: op.id, kind: op.kind, actor: request.auth.uid, acceptedAt: Timestamp.now() }, true);
          acceptedOperationIds.push(op.id);
        } catch (error) {
          if (!(error instanceof HttpsError)) throw error;
          failure = { operationId: op.id, code: error.code, message: error.message };
          break;
        }
      }
      for (const { ref, data, create, remove: deleted } of writes.values()) {
        if (deleted) tx.delete(ref); else if (create) tx.create(ref, data); else tx.set(ref, data, { merge: true });
      }
      return { acceptedOperationIds, failure };
    });
    if (result.failure) {
      const op = operations.find(operation => operation.id === result.failure.operationId);
      // Log only the committed outcome, never a retried transaction attempt.
      // No names, student IDs, attendance values, accounts, or raw payloads.
      console.warn("offline-attendance-validation", { code: result.failure.code, kind: op.kind, date: calendarDate(op.date), protocolVersion: op.protocolVersion || 1, operationId: op.id });
    }
    return result;
  })
});
