"use strict";

const { randomUUID } = require("crypto");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated, onDocumentWritten, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

if (!getApps().length) initializeApp();

const auth = getAuth();
const db = getFirestore();
// This isolated personal project has no always-warm instances. Bound per-service
// scale while preserving the existing attendance timers and offline processing.
setGlobalOptions({ maxInstances: 2, minInstances: 0,
  serviceAccount: process.env.HATHIR_RUNTIME_SERVICE_ACCOUNT || "687554777181-compute@developer.gserviceaccount.com" });
const personal = require("./personal-workspace").createPersonalService({ db, auth, HttpsError, FieldValue });

exports.correctSubjectAnnualHours = onCall({region:"us-central1",invoker:"public",timeoutSeconds:540,memory:"1GiB"}, async request=>{
  const {workspaceId,subjectId,subjectRef} = await authorisedSubject(request,"classesEdit",{edit:true});
  const hours=Number(request.data.totalHours);
  if (!Number.isFinite(hours) || hours<=0) throw new HttpsError("invalid-argument","Annual hours must be positive.");
  const duration=request.data.lectureDurationHours === undefined ? null : Number(request.data.lectureDurationHours);
  const absenceSettings=request.data.absenceSettings === undefined ? undefined : validateAbsenceSettings(request.data.absenceSettings);
  if (duration!==null && (!Number.isFinite(duration) || duration<=0 || duration>24)) throw new HttpsError("invalid-argument","Lecture duration must be between 0 and 24 hours.");
  const auditRef=subjectRef.collection("settingsAudit").doc();
  const annualChanged = await db.runTransaction(async tx=>{
    const snapshot=await tx.get(subjectRef);
    if(!snapshot.exists)throw new HttpsError("not-found","Subject not found.");
    const previous=snapshot.data();
    const oldDuration=positiveNumber(previous.lectureDurationHours,2);
    const durationChanged=duration!==null && duration!==oldDuration;
    let pinnedMeta = null;
    if(durationChanged) {
      // Pin legacy lectures before changing the default. The query is part of
      // the transaction so a concurrent lecture creation causes a retry.
      const lectures=await tx.get(subjectRef.collection("lectures"));
      const missing=(lectures.docs || []).filter(doc=>!(Number(doc.data().durationHours)>0));
      if(missing.length>450)throw new HttpsError("failed-precondition","Historical duration migration requires a separate batch before this change.");
      for(const doc of missing)tx.update(doc.ref,{durationHours:oldDuration});
      pinnedMeta={...(previous.lectureMeta || {})};
      for(const date of previous.lectures || []) pinnedMeta[date]={...(pinnedMeta[date] || {}),durationHours:positiveNumber(pinnedMeta[date]?.durationHours,oldDuration)};
      for(const date of Object.keys(pinnedMeta))pinnedMeta[date]={...pinnedMeta[date],durationHours:positiveNumber(pinnedMeta[date].durationHours,oldDuration)};
    }
    tx.create(auditRef,{action:"update-subject-hours",previousHours:previous.totalHours || null,totalHours:hours,previousLectureDurationHours:oldDuration,lectureDurationHours:duration===null?oldDuration:duration,...(absenceSettings===undefined?{}:{previousAbsenceSettings:previous.absenceSettings || null,absenceSettings}),actor:request.auth.uid,createdAt:FieldValue.serverTimestamp()});
    tx.update(subjectRef,{totalHours:hours,...(absenceSettings===undefined?{}:{absenceSettings}),...(duration===null ? {} : {lectureDurationHours:duration}),...(pinnedMeta ? {lectureMeta:pinnedMeta}:{}),policySnapshot:{...policyForSubject({...previous,...(absenceSettings===undefined?{}:{absenceSettings})}),totalHours:hours},updatedAt:FieldValue.serverTimestamp()});
    return Number(previous.totalHours)!==hours || absenceSettings !== undefined;
  });
  const result=annualChanged ? await rebuildSubjectAttendanceSummaries(workspaceId,subjectId) : {};
  return {totalHours:hours,...result};
});


async function archiveDeletedPersonalRecord(event, kind) {
  if (!event.data) return;
  const { workspaceId } = event.params;
  const snapshotId = require("crypto").createHash("sha256").update(event.id).digest("hex");
  const ref = db.collection("attendanceWorkspaces").doc(workspaceId).collection("deletedRecords").doc(snapshotId);
  const value = event.data.data();
  const relativePath = event.data.ref.path.split("/").slice(2).join("/");
  await db.runTransaction(async transaction => {
    if ((await transaction.get(ref)).exists) return;
    transaction.create(ref, { kind, relativePath, record: value,
      label: String(value.name || value.titleAr || value.titleEn || event.data.id),
      deletedAt: Timestamp.fromDate(new Date(event.time)), restored: false });
  });
}

exports.archiveDeletedPersonalSubject = onDocumentDeleted({
  document: "attendanceWorkspaces/{workspaceId}/subjects/{subjectId}", region: "us-central1", retry: true
}, event => archiveDeletedPersonalRecord(event, "subject"));

exports.archiveDeletedPersonalStudent = onDocumentDeleted({
  document: "attendanceWorkspaces/{workspaceId}/{container}/{containerId}/{records}/{studentId}", region: "us-central1", retry: true
}, event => {
  if (!["cohorts", "subjects"].includes(event.params.container) || !["students", "faceTemplates"].includes(event.params.records)) return;
  return archiveDeletedPersonalRecord(event, event.params.records === "students" ? "student" : "face");
});

exports.listDeletedPersonalRecords = onCall({ region: "us-central1", invoker: "public" }, async request => {
  const context = await authorisedWorkspaceOwner(request);
  const docs = await context.workspaceRef.collection("deletedRecords").orderBy("deletedAt", "desc").limit(200).get();
  return { records: docs.docs.filter(doc => !doc.data().restored).map(doc => ({
    id: doc.id, kind: doc.data().kind, label: doc.data().label,
    deletedAt: asMillis(doc.data().deletedAt)
  })) };
});

exports.restoreDeletedPersonalRecord = onCall({ region: "us-central1", invoker: "public" }, async request => {
  const context = await authorisedWorkspaceOwner(request);
  const id = String(request.data?.id || "");
  if (!/^[a-f0-9]{64}$/.test(id) || request.data?.confirmation !== "RESTORE_DELETED") throw new HttpsError("invalid-argument", "Explicit confirmation is required.");
  const backupRef = context.workspaceRef.collection("deletedRecords").doc(id);
  await db.runTransaction(async transaction => {
    const backup = await transaction.get(backupRef);
    if (!backup.exists) throw new HttpsError("not-found", "Backup not found.");
    const { relativePath, record } = backup.data();
    if (!/^(subjects\/[^/]+|(subjects|cohorts)\/[^/]+\/(students|faceTemplates)\/[^/]+)$/.test(relativePath)) throw new HttpsError("failed-precondition", "Invalid backup path.");
    const target = db.doc(context.workspaceRef.path + "/" + relativePath);
    const current = await transaction.get(target);
    if (current.exists) throw new HttpsError("already-exists", "A record already exists. It will not be overwritten.");
    transaction.create(target, record);
    transaction.update(backupRef, { restored: true, restoredAt: FieldValue.serverTimestamp(), restoredBy: request.auth.uid });
  });
  return { restored: true };
});

/*
 * Attendance is deliberately written only by the functions below.  The web
 * application never gets to decide the official time, close a lecture based
 * on its own clock, or mutate an already-issued warning silently.  This file
 * is also the single place where the legal absence thresholds are calculated.
 */
const BAGHDAD_TIME_ZONE = "Asia/Baghdad";
const POLICY_VERSION = "iraq-exam-regulation-134-2000-v1";
const ATTENDANCE_METHODS = new Set(["qr", "face", "manual", "image"]);
const DEFAULT_POLICY = Object.freeze({
  version: POLICY_VERSION,
  totalHours: 60,
  thresholds: {
    notice: 3,
    initialWarning: 5,
    finalWarning: 7,
    failUnexcused: 10,
    failExcused: 15
  }
});

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || "").trim())
    .filter(Boolean))];
}

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function integer(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
}

function safeDateId(value) {
  return require("./lecture-session").safeLectureId(value);
}

function baghdadParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BAGHDAD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function minutesFromTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function attendanceMinutes(startTime, markedTime, durationMinutes) {
  const start = minutesFromTime(startTime);
  const marked = minutesFromTime(markedTime);
  if (start === null || marked === null) return durationMinutes;
  return Math.max(0, Math.min(durationMinutes, durationMinutes - Math.max(0, marked - start)));
}

function validateAbsenceSettings(value) {
  if (!value || !["bologna","traditional-annual","traditional-semester"].includes(value.system)) throw new HttpsError("invalid-argument","Invalid teaching system.");
  const result={system:value.system,notice:null,warning:null,fail:null};
  let previous=0;
  for(const key of ["notice","warning","fail"]) {
    const raw=value[key];
    if(raw===null || raw===undefined || raw==="") continue;
    if(typeof raw!=="number" || !Number.isInteger(raw) || raw<=previous || raw>100) throw new HttpsError("invalid-argument","Thresholds must be increasing whole percentages from 1 to 100.");
    result[key]=raw; previous=raw;
  }
  return result;
}

function policyForSubject(subject = {}) {
  const supplied = subject.policySnapshot && typeof subject.policySnapshot === "object"
    ? subject.policySnapshot
    : (subject.attendancePolicy && typeof subject.attendancePolicy === "object" ? subject.attendancePolicy : {});
  const thresholds = { ...DEFAULT_POLICY.thresholds, ...(supplied.thresholds || {}) };
  return {
    version: supplied.version || POLICY_VERSION,
    totalHours: positiveNumber(supplied.totalHours, positiveNumber(subject.totalHours, DEFAULT_POLICY.totalHours)),
    absenceSettings: subject.absenceSettings || null,
    thresholds: {
      notice: positiveNumber(thresholds.notice, DEFAULT_POLICY.thresholds.notice),
      initialWarning: positiveNumber(thresholds.initialWarning, DEFAULT_POLICY.thresholds.initialWarning),
      finalWarning: positiveNumber(thresholds.finalWarning, DEFAULT_POLICY.thresholds.finalWarning),
      failUnexcused: positiveNumber(thresholds.failUnexcused, DEFAULT_POLICY.thresholds.failUnexcused),
      failExcused: positiveNumber(thresholds.failExcused, DEFAULT_POLICY.thresholds.failExcused)
    }
  };
}

function absenceStatus(absencePercent, unexcusedAbsencePercent, policy) {
  const settings=policy.absenceSettings;
  if (!settings || !["notice","warning","fail"].some(k=>Number(settings[k])>0)) return "unconfigured";
  for (const [field,status] of [["fail","absenceFailure"],["warning","finalWarning"],["notice","notice"]]) {
    if(Number(settings[field])>0 && absencePercent>=Number(settings[field])) return status;
  }
  return "clear";
}

function asMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}

function memberHasPermission(member, key) {
  return member.role === "owner" || member.role === "admin" || Boolean(member.permissions && member.permissions[key]);
}

function isGlobalMember(member) {
  return member.role === "owner" || member.role === "admin";
}

function memberCanAccessSubject(member, subject) {
  if (!member || member.active === false || !subject) return false;
  if (isGlobalMember(member)) return true;
  const subjectId = String(subject.id || "");
  const departmentId = String(subject.departmentId || "");
  if (member.role === "teacher") return uniqueStrings(member.subjectIds).includes(subjectId);
  if (uniqueStrings(member.subjectIds).includes(subjectId)) return true;
  return memberHasPermission(member, "allClasses") && uniqueStrings(member.departmentIds).includes(departmentId);
}

async function activeMember(workspaceId, request) {
  return personal.activeMember(request, workspaceId);
}

/*
 * Recovery is intentionally owner-only.  A backup restore can change an
 * official attendance record and must never be available merely because a
 * member has normal attendance-edit permission.  We check both the member
 * role and (when it is present) the workspace owner pointer to avoid a stale
 * role document granting access after an ownership transfer.
 */
async function authorisedWorkspaceOwner(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const workspaceId = String(request.data && request.data.workspaceId || "").trim();
  if (!workspaceId) throw new HttpsError("invalid-argument", "workspaceId is required.");
  const workspaceRef = db.collection("attendanceWorkspaces").doc(workspaceId);
  const [member, workspaceSnapshot] = await Promise.all([
    activeMember(workspaceId, request),
    workspaceRef.get()
  ]);
  if (member.role !== "owner" || (workspaceSnapshot.exists && workspaceSnapshot.data().ownerUid && workspaceSnapshot.data().ownerUid !== request.auth.uid)) {
    throw new HttpsError("permission-denied", "Only the active workspace owner can manage recovery.");
  }
  return { workspaceId, member, workspaceRef };
}

async function authorisedSubject(request, permissionKey, { edit = false } = {}) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const workspaceId = String(request.data && request.data.workspaceId || "").trim();
  const subjectId = String(request.data && request.data.subjectId || "").trim();
  if (!workspaceId || !subjectId) throw new HttpsError("invalid-argument", "workspaceId and subjectId are required.");
  const [member, subjectSnapshot] = await Promise.all([
    activeMember(workspaceId, request),
    db.collection("attendanceWorkspaces").doc(workspaceId).collection("subjects").doc(subjectId).get()
  ]);
  if (!subjectSnapshot.exists) throw new HttpsError("not-found", "The subject no longer exists.");
  const subject = { id: subjectSnapshot.id, ...subjectSnapshot.data() };
  if (subject.rosterOperationId) throw new HttpsError("failed-precondition", "توجد عملية مسح أو استعادة لقائمة المادة؛ انتظر اكتمالها.");
  if (!memberCanAccessSubject(member, subject) || !memberHasPermission(member, permissionKey)) {
    throw new HttpsError("permission-denied", "The account cannot access this subject.");
  }
  if (edit && !memberHasPermission(member, "attendanceEdit")) {
    throw new HttpsError("permission-denied", "Attendance editing permission is required.");
  }
  return {
    workspaceId,
    subjectId,
    member,
    subject,
    subjectRef: db.collection("attendanceWorkspaces").doc(workspaceId).collection("subjects").doc(subjectId)
  };
}

function cohortIdForSubject(subject) {
  return require("./personal-workspace").cohortIdForSubject(subject);
}

async function rosterForSubject(workspaceId, subject) {
  const workspace = db.collection("attendanceWorkspaces").doc(workspaceId);
  const cohortRef = workspace.collection("cohorts").doc(cohortIdForSubject(subject));
  const [cohortSnapshot, snapshots] = await Promise.all([cohortRef.get(), cohortRef.collection("students").get()]);
  let students = snapshots.docs.map(doc => ({ id: String((doc.data() || {}).id || doc.id), name: String((doc.data() || {}).name || "") }));
  const legacyFallback = !students.length && !(Number(cohortSnapshot.data()?.rosterVersion) >= 1) && !subject.rosterCohortId && !subject.lastRosterResetId;
  if (legacyFallback) {
    const snapshots = await workspace.collection("subjects").doc(subject.id).collection("students").get();
    students = snapshots.docs.map(doc => ({ id: String((doc.data() || {}).id || doc.id), name: String((doc.data() || {}).name || "") }));
  }
  // Compatibility with the first app schema, where the roster was kept as an
  // array in the subject document itself.  This is only a fallback; current
  // workspaces use the central cohort collection above.
  if (!students.length && legacyFallback && Array.isArray(subject.students)) {
    students = subject.students.map(student => ({
      id: String(student && (student.id || student.studentId) || "").trim(),
      name: String(student && (student.name || student.studentName) || "").trim()
    }));
  }
  return students.filter(student => student.id && student.name);
}

async function studentExistsInSubject(workspaceId, subject, studentId) {
  // Attendance must not read an entire class list for every QR/face scan.
  // Student document IDs are the official identifiers, so this is a constant
  // number of reads even when a cohort eventually contains thousands of rows.
  const workspace = db.collection("attendanceWorkspaces").doc(workspaceId);
  const requestedId = String(studentId || "").trim();
  const normalizedId = requestedId.toUpperCase();
  const candidates = [...new Set([requestedId, normalizedId, requestedId.toLowerCase()].filter(Boolean))];
  const studentFromSnapshot = snapshot => {
    if (!snapshot || !snapshot.exists) return null;
    const data = snapshot.data() || {};
    const id = String(data.id || snapshot.id || "").trim();
    const name = String(data.name || "").trim();
    return id && name && id.toUpperCase() === normalizedId ? { id, name } : null;
  };
  const findInCollection = async collectionRef => {
    for (const candidate of candidates) {
      const matched = studentFromSnapshot(await collectionRef.doc(candidate).get());
      if (matched) return matched;
    }
    // Compatibility for early records that stored an auto-generated document
    // ID while the actual student code lived in the `id` field.
    for (const candidate of candidates) {
      const snapshot = await collectionRef.where("id", "==", candidate).limit(1).get();
      if (!snapshot.empty) {
        const matched = studentFromSnapshot(snapshot.docs[0]);
        if (matched) return matched;
      }
    }
    return null;
  };

  const cohortRef = workspace.collection("cohorts").doc(cohortIdForSubject(subject));
  const centralStudent = await findInCollection(cohortRef.collection("students"));
  if (centralStudent) return centralStudent;
  if (subject.rosterCohortId || subject.lastRosterResetId) return null;
  // Only a missing match pays these bounded reads. An empty versioned cohort
  // still authoritatively removed its old rows; do not revive a stale fallback.
  const [cohort, firstCentral] = await Promise.all([cohortRef.get(), cohortRef.collection("students").limit(1).get()]);
  if (Number(cohort.data()?.rosterVersion) >= 1 || !firstCentral.empty) return null;

  // Older workspaces can still have the compatible per-subject roster until
  // its central cohort is first created. Retain that narrow fallback without
  // making current scans pay for a full-roster query.
  const legacyRef = workspace.collection("subjects").doc(subject.id).collection("students");
  const legacyStudent = await findInCollection(legacyRef);
  if (legacyStudent) return legacyStudent;
  if (!(await legacyRef.limit(1).get()).empty) return null;

  // The original attendance data used an embedded array on the subject.
  // Retaining this read-only compatibility check prevents a valid student
  // being rejected during a gradual migration to cohort documents.
  const embedded = Array.isArray(subject.students) ? subject.students.find(student =>
    String(student && (student.id || student.studentId) || "").trim().toUpperCase() === normalizedId
  ) : null;
  if (!embedded) return null;
  return {
    id: String(embedded.id || embedded.studentId || "").trim(),
    name: String(embedded.name || embedded.studentName || "").trim()
  };
}

/*
 * Returns one lightweight cohort total for the classroom header.  The count
 * aggregation runs in the trusted backend and is cached onto the subject, so
 * teachers never need to download thousands of student profiles merely to see
 * a number in the dashboard.
 */
exports.getSubjectRosterCount = onCall({ region: "us-central1", timeoutSeconds: 30 }, async request => {
  const context = await authorisedSubject(request, "classesRead");
  const cohortRef = db.collection("attendanceWorkspaces").doc(context.workspaceId)
    .collection("cohorts").doc(cohortIdForSubject(context.subject));
  // Another subject can import into this private cohort, and student deletion
  // need not grant the browser access to the authoritative counters.
  const result = await cohortRef.collection("students").count().get();
  const count = Math.max(0, Number(result.data().count || 0));
  await context.subjectRef.update({ studentCount: count, updatedAt: FieldValue.serverTimestamp() });
  return { count, cached: false };
});

function auditReference(workspaceId, auditId = "") {
  const events = db.collection("attendanceWorkspaces").doc(workspaceId).collection("auditEvents");
  return auditId ? events.doc(auditId) : events.doc();
}

// This is an ephemeral classroom signal, not an audit record. It is read by
// the other open scanners so a phone reading is immediately visible on the
// teacher's computer, even when the reading is rejected or already recorded.
async function publishLiveScanEvent(lectureRef, event) {
  try {
    await lectureRef.collection("scanEvents").doc().set({
      ...event,
      eventAtMillis: Number(event.eventAtMillis) || Date.now(),
      createdAt: Timestamp.now(),
      schemaVersion: 1
    });
  } catch (error) {
    // A temporary presentation-sync failure must never invalidate an official
    // attendance mark that was already committed inside its transaction.
    logger.warn("Could not publish live attendance scan event", { code: error && error.code });
  }
}

function auditPayload({ workspaceId, subjectId, lectureDate = "", studentId = "", actorUid = "", action, before = null, after = null, source = "" }) {
  return {
    workspaceId,
    subjectId,
    lectureDate,
    studentId,
    actorUid,
    action,
    before,
    after,
    source,
    recordedAt: Timestamp.now(),
    schemaVersion: 1
  };
}

function safeMarkForAudit(mark) {
  if (!mark || typeof mark !== "object") return null;
  return {
    studentId: String(mark.studentId || ""),
    studentName: String(mark.studentName || ""),
    time: String(mark.time || ""),
    attendedMinutes: integer(mark.attendedMinutes),
    markedBy: String(mark.markedBy || ""),
    method: String(mark.method || ""),
    source: String(mark.source || "")
  };
}

/*
 * A closed lecture receives an immutable, server-owned recovery copy.  Marks
 * and excuses remain separate documents so a very large cohort cannot exceed
 * Firestore's 1 MiB document limit.  This is deliberately independent from
 * the browser and from the daily UI cache.
 */
async function createLectureRecoverySnapshot(workspaceId, subjectId, lectureDate, lecture = {}, reason = "lecture-closed", captured = null) {
  const subjectRef = db.collection("attendanceWorkspaces").doc(workspaceId).collection("subjects").doc(subjectId);
  const lectureRef = subjectRef.collection("lectures").doc(lectureDate);
  const [marks, excuses] = captured || await Promise.all([
    lectureRef.collection("marks").get(),
    lectureRef.collection("excuses").get()
  ]);
  const completedAtMillis = asMillis(lecture.completedAt) || Date.now();
  const snapshotId = `${subjectId}__${lectureDate}__${completedAtMillis}`;
  const snapshotRef = db.collection("attendanceWorkspaces").doc(workspaceId)
    .collection("lectureSnapshots").doc(snapshotId);
  await snapshotRef.set({
    workspaceId,
    subjectId,
    lectureDate,
    calendarDate: lectureDate.slice(0, 10),
    status: String(lecture.status || "completed"),
    startTime: String(lecture.startTime || ""),
    durationHours: positiveNumber(lecture.durationHours, 2),
    durationMinutes: integer(lecture.durationMinutes, Math.round(positiveNumber(lecture.durationHours, 2) * 60)),
    policySnapshot: lecture.policySnapshot || null,
    completedAt: lecture.completedAt || Timestamp.now(),
    completedBy: String(lecture.completedBy || ""),
    closedAtMillis: Number(lecture.closedAtMillis) || 0,
    closeReason: String(lecture.closeReason || ""),
    reason,
    markCount: marks.size,
    excuseCount: excuses.size,
    snapshotAt: Timestamp.now(),
    schemaVersion: 1
  }, { merge: false });

  const copyDocuments = async (documents, name) => {
    for (let index = 0; index < documents.length; index += 350) {
      const batch = db.batch();
      documents.slice(index, index + 350).forEach(doc => {
        const data = doc.data() || {};
        // Face templates never belong to attendance recovery data.
        delete data.faceDescriptor;
        delete data.faceDescriptors;
        delete data.faceDescriptorMap;
        batch.set(snapshotRef.collection(name).doc(doc.id), {
          ...data,
          originalId: doc.id,
          copiedAt: Timestamp.now()
        }, { merge: false });
      });
      await batch.commit();
    }
  };
  await copyDocuments(marks.docs, "marks");
  await copyDocuments(excuses.docs, "excuses");
  return { snapshotId, marks: marks.size, excuses: excuses.size };
}

async function applyCompletedLectureToSummaries(workspaceId, subjectId, lectureDate) {
  const subjectRef = db.collection("attendanceWorkspaces").doc(workspaceId).collection("subjects").doc(subjectId);
  const snapshot = await subjectRef.collection("lectures").doc(lectureDate).get();
  if (!snapshot.exists || snapshot.data().status !== "completed") return { applied: false, reason: "not-completed" };
  return rebuildSubjectAttendanceSummaries(workspaceId, subjectId);
}

async function rebuildSubjectAttendanceSummaries(workspaceId, subjectId) {
  return require("./cumulative-attendance").createRebuilder({ db, Timestamp, HttpsError,
    cohortIdForSubject, policyForSubject, absenceStatus, attendanceMinutes, baghdadParts })(workspaceId, subjectId);
}

async function queueSubjectSummary(subjectRef) {
  await db.runTransaction(async tx => {
    const subject = await tx.get(subjectRef);
    if (subject.exists && !subject.data().rosterOperationId && !subject.data().attendanceClearInProgress) {
      tx.set(subjectRef, { summaryState: "pending" }, { merge: true });
    }
  });
}

// A removed maximum-attendance student can lower the reference for everybody;
// a roster change therefore invalidates the subject aggregate, not one row.
exports.invalidateSummaryOnRosterChange = onDocumentWritten({
  document: "attendanceWorkspaces/{workspaceId}/{container}/{containerId}/students/{studentId}", region: "us-central1", retry: true
}, async event => {
  const { workspaceId, container, containerId } = event.params;
  const workspace = db.collection("attendanceWorkspaces").doc(workspaceId);
  if (container === "subjects") return queueSubjectSummary(workspace.collection("subjects").doc(containerId));
  if (container !== "cohorts") return null;
  const subjects = await workspace.collection("subjects").get();
  await Promise.all(subjects.docs.filter(doc => cohortIdForSubject(doc.data()) === containerId).map(doc => queueSubjectSummary(doc.ref)));
  return null;
});

exports.invalidateSummaryOnSubjectChange = onDocumentWritten({
  document: "attendanceWorkspaces/{workspaceId}/subjects/{subjectId}", region: "us-central1", retry: true
}, async event => {
  if (!event.data?.after.exists) return null;
  if (!event.data.before.exists) {
    const restored = event.data.after.data() || {};
    if (restored.summarySchemaVersion || restored.attendanceLocked || restored.lectures?.length) await queueSubjectSummary(event.data.after.ref);
    return null;
  }
  const relevant = data => JSON.stringify({ totalHours: data.totalHours, absenceSettings: data.absenceSettings,
    attendancePolicy: data.attendancePolicy, rosterCohortId: data.rosterCohortId, departmentId: data.departmentId,
    stageId: data.stageId, section: data.section, students: data.students });
  if (relevant(event.data.before.data()) !== relevant(event.data.after.data())) await queueSubjectSummary(event.data.after.ref);
  return null;
});

exports.invalidateSummaryOnExcuseChange = onDocumentWritten({
  document: "attendanceWorkspaces/{workspaceId}/subjects/{subjectId}/lectures/{lectureDate}/excuses/{studentId}", region: "us-central1", retry: true
}, async event => {
  const { workspaceId, subjectId } = event.params;
  await queueSubjectSummary(db.collection("attendanceWorkspaces").doc(workspaceId).collection("subjects").doc(subjectId));
  return null;
});

/*
 * The fast classroom client writes a small mark document directly.  These
 * background handlers make that fast path auditable and resilient without
 * adding a network round trip to QR or face scanning.
 */
exports.auditBrowserAttendanceMark = onDocumentWritten({
  document: "attendanceWorkspaces/{workspaceId}/subjects/{subjectId}/lectures/{lectureDate}/marks/{studentId}",
  region: "us-central1", retry: true
}, async event => {
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() || {} : null;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() || {} : null;
  // Official callables already emit a stronger in-transaction audit entry.
  const alreadyAudited = (after && String(after.source || "").startsWith("official-")) || (!after && before && String(before.source || "").startsWith("official-"));
  const { workspaceId, subjectId, lectureDate, studentId } = event.params;
  const action = !before ? "attendance.marked" : (!after ? "attendance.unmarked" : "attendance.mark-corrected");
  const actorUid = String((after || before || {}).markedBy || "browser-direct");
  if (!alreadyAudited) {
    const auditId = event.id ? "mark_event_" + require("crypto").createHash("sha256")
      .update(JSON.stringify([String(event.id), workspaceId, subjectId, lectureDate, studentId])).digest("hex") : "";
    try {
      await auditReference(workspaceId, auditId).create(auditPayload({
        workspaceId, subjectId, lectureDate, studentId, actorUid, action,
        before: safeMarkForAudit(before), after: safeMarkForAudit(after), source: "browser-direct-trigger-v1"
      }));
    } catch (error) {
      // A retried event may already have its immutable audit entry. Continue
      // to the summary queue in that case; transient errors must be retried.
      if (![6, "already-exists", "ALREADY_EXISTS"].includes(error?.code)) throw error;
    }
  }

  // Active-session attendees also receive their current personal assessment.
  // Queue the subject; the worker coalesces scans/corrections rather than
  // making a complete roster/history rebuild part of the teacher's tap.
  const lectureRef = event.data && event.data.after && event.data.after.ref
    ? event.data.after.ref.parent.parent
    : event.data.before.ref.parent.parent;
  await db.runTransaction(async tx => {
    const [lectureSnapshot, subjectSnapshot] = await Promise.all([tx.get(lectureRef), tx.get(lectureRef.parent.parent)]);
    if (!subjectSnapshot.exists || subjectSnapshot.data().rosterOperationId || subjectSnapshot.data().attendanceClearInProgress) return;
    if (lectureSnapshot.exists && ["active", "completed"].includes((lectureSnapshot.data() || {}).status)) {
      if (lectureSnapshot.data().status === "completed") tx.set(lectureRef, { summaryState: "rebuild-pending", updatedAt: Timestamp.now() }, { merge: true });
      tx.set(lectureRef.parent.parent, { summaryState: "pending" }, { merge: true });
    }
  });
  return null;
});

exports.normaliseBrowserLecture = onDocumentWritten({
  document: "attendanceWorkspaces/{workspaceId}/subjects/{subjectId}/lectures/{lectureDate}",
  region: "us-central1", timeoutSeconds: 540, memory: "1GiB"
}, async event => {
  if (!event.data) return null;
  if (!event.data.after.exists) {
    if (event.data.before.exists) await queueSubjectSummary(event.data.before.ref.parent.parent);
    return null;
  }
  const lecture = event.data.after.data() || {};
  const { workspaceId, subjectId, lectureDate } = event.params;
  const before = event.data.before.exists ? event.data.before.data() || {} : null;
  if (before?.status === "completed" && lecture.status !== "completed") {
    await queueSubjectSummary(event.data.after.ref.parent.parent);
  }
  if (["cancelled", "voided"].includes(lecture.status) && ["pending", "rebuild-pending"].includes(lecture.summaryState)) {
    // Cancelled sessions have no row contribution. Their SUBJECT is queued,
    // not the cancelled lecture, otherwise they can occupy the worker's
    // limited pending-lecture page forever.
    await db.runTransaction(async tx => {
      const lectureRef = event.data.after.ref, subjectRef = lectureRef.parent.parent;
      const [current, subject] = await Promise.all([tx.get(lectureRef), tx.get(subjectRef)]);
      if (!current.exists || !subject.exists || subject.data().rosterOperationId || subject.data().attendanceClearInProgress) return;
      if (!["cancelled", "voided"].includes(current.data().status) || !["pending", "rebuild-pending"].includes(current.data().summaryState)) return;
      tx.set(lectureRef, { summaryState: "not-required" }, { merge: true });
      tx.set(subjectRef, { summaryState: "pending" }, { merge: true });
    });
    return null;
  }
  // Offline uploads may create an already-completed lecture. The older
  // onUpdated close handler cannot see that creation. Never expose a partial
  // recovery copy while its mark documents are still being restored.
  if (lecture.status === "completed" && !lecture.restorationInProgress &&
      (!before || before.restorationInProgress || before.durationHours !== lecture.durationHours || before.durationMinutes !== lecture.durationMinutes ||
        before.startTime !== lecture.startTime || before.closedAtMillis !== lecture.closedAtMillis || before.closeReason !== lecture.closeReason)) {
    await Promise.all([
      !before ? createLectureRecoverySnapshot(workspaceId, subjectId, lectureDate, lecture) : Promise.resolve(),
      rebuildSubjectAttendanceSummaries(workspaceId, subjectId)
    ]);
    return null;
  }
  if (lecture.status !== "active" || lecture.endAt) return null;
  const subjectRef = db.collection("attendanceWorkspaces").doc(workspaceId).collection("subjects").doc(subjectId);
  // The trigger's event may be older than a teacher's cancel/reset. Lock both
  // live documents so stale normalization cannot recreate a removed lecture
  // or re-lock a subject whose attendance was just cleared.
  await db.runTransaction(async tx => {
    const [subjectSnapshot, currentSnapshot] = await Promise.all([tx.get(subjectRef), tx.get(event.data.after.ref)]);
    if (!subjectSnapshot.exists || !currentSnapshot.exists) return;
    const subject = subjectSnapshot.data() || {}, current = currentSnapshot.data() || {};
    if (subject.rosterOperationId || subject.attendanceClearInProgress || current.status !== "active" || current.endAt) return;
    const durationMinutes = Math.round(positiveNumber(current.durationHours, positiveNumber(subject.lectureDurationHours, 2)) * 60);
    const logicalStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(current.startTime || "")
      ? Date.parse(lectureDate.slice(0, 10) + "T" + current.startTime + ":00+03:00") : 0;
    const startAt = asMillis(current.startAt) > 0 ? current.startAt : logicalStart > 0 ? Timestamp.fromMillis(logicalStart) : Timestamp.now();
    tx.set(subjectRef, { attendanceLocked: true, policySnapshot: policyForSubject(subject),
      policyVersion: POLICY_VERSION, updatedAt: Timestamp.now() }, { merge: true });
    tx.set(event.data.after.ref, { date: safeDateId(current.date || lectureDate) || lectureDate,
      calendarDate: lectureDate.slice(0, 10), startAt,
      endAt: Timestamp.fromMillis(asMillis(startAt) + durationMinutes * 60 * 1000), durationMinutes,
      timeZone: BAGHDAD_TIME_ZONE, summaryState: current.summaryState || "not-required", updatedAt: Timestamp.now() }, { merge: true });
  });
  return null;
});

exports.snapshotAndSummariseClosedLecture = onDocumentUpdated({
  document: "attendanceWorkspaces/{workspaceId}/subjects/{subjectId}/lectures/{lectureDate}",
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "1GiB"
}, async event => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  if (before.status === "completed" || after.status !== "completed" || after.restorationInProgress) return null;
  const { workspaceId, subjectId, lectureDate } = event.params;
  const [snapshot, summary] = await Promise.all([
    createLectureRecoverySnapshot(workspaceId, subjectId, lectureDate, after),
    applyCompletedLectureToSummaries(workspaceId, subjectId, lectureDate)
  ]);
  await auditReference(workspaceId).create(auditPayload({
    workspaceId, subjectId, lectureDate,
    actorUid: String(after.completedBy || "browser-direct"),
    action: "lecture.completed",
    before: { status: before.status || "draft" },
    after: { status: "completed", snapshotId: snapshot.snapshotId, summaryApplied: Boolean(summary.applied) },
    source: "lecture-lifecycle-trigger-v1"
  }));
  return null;
});

/*
 * Moves legacy inline face templates out of high-traffic roster rows.  It is
 * a one-time, idempotent migration: QR can open using IDs/names immediately,
 * while face templates are fetched only after face recognition is requested.
 */
exports.migrateCohortFaceTemplates = onCall({ region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async request => {
  const context = await authorisedSubject(request, "studentsManage");
  if (!memberHasPermission(context.member, "studentsManage")) {
    throw new HttpsError("permission-denied", "Student-management permission is required.");
  }
  const subject = context.subject;
  const cohortId = cohortIdForSubject(subject);
  const cohortRef = db.collection("attendanceWorkspaces").doc(context.workspaceId).collection("cohorts").doc(cohortId);
  const students = await cohortRef.collection("students").get();
  let migrated = 0;
  let batch = db.batch();
  let batchSize = 0;
  const flush = async () => {
    if (!batchSize) return;
    await batch.commit();
    batch = db.batch();
    batchSize = 0;
  };
  for (const studentDoc of students.docs) {
    const data = studentDoc.data() || {};
    const descriptorMap = data.faceDescriptorMap && typeof data.faceDescriptorMap === "object" ? data.faceDescriptorMap : {};
    const descriptorList = Array.isArray(data.faceDescriptors) ? data.faceDescriptors : [];
    const descriptor = data.faceDescriptor || null;
    const hasTemplate = Boolean(descriptor || descriptorList.length || Object.keys(descriptorMap).length);
    if (!hasTemplate) continue;
    batch.set(cohortRef.collection("faceTemplates").doc(studentDoc.id), {
      studentId: String(data.id || studentDoc.id),
      faceDescriptor: descriptor,
      faceDescriptorMap: descriptorMap,
      faceDescriptors: descriptorList,
      faceTemplateCount: Number(data.faceTemplateCount || descriptorList.length || Object.keys(descriptorMap).length || (descriptor ? 1 : 0)),
      migratedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    }, { merge: true });
    batch.set(studentDoc.ref, {
      faceDescriptor: FieldValue.delete(),
      faceDescriptorMap: FieldValue.delete(),
      faceDescriptors: FieldValue.delete(),
      faceTemplateCount: FieldValue.delete(),
      updatedAt: Timestamp.now()
    }, { merge: true });
    migrated += 1;
    batchSize += 2;
    if (batchSize >= 400) await flush();
  }
  await flush();
  await cohortRef.set({
    faceTemplatesSchemaVersion: 1,
    faceTemplatesMigratedAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  }, { merge: true });
  await auditReference(context.workspaceId).create(auditPayload({
    workspaceId: context.workspaceId,
    subjectId: context.subjectId,
    actorUid: context.member.uid,
    action: "cohort.face-templates-migrated",
    after: { cohortId, migrated },
    source: "official-callable-v1"
  }));
  return { cohortId, migrated };
});



/*
 * Official attendance command.  The server timestamp is the authority for
 * both QR and face recognition; the browser only supplies the verified student
 * identifier and the method used to obtain it.
 */
// The scan path is the only classroom-time callable. Give it a little more
// execution memory so QR/face confirmations do not compete for the smallest
// Cloud Run allocation, without paying for an always-warm instance.
exports.recordOfficialAttendance = onCall({ region: "us-central1", memory: "512MiB", timeoutSeconds: 30 }, async request => {
  const context = await authorisedSubject(request, "attendanceMark");
  if (context.subject.attendanceClearInProgress === true) {
    throw new HttpsError("failed-precondition", "Attendance is being cleared for this subject. Try again shortly.");
  }
  const requestedStudentId = String(request.data && request.data.studentId || "").trim();
  const requestedMethod = String(request.data && request.data.method || "qr").trim().toLowerCase();
  const method = requestedMethod === "scan" ? "qr" : requestedMethod;
  if (!requestedStudentId || !ATTENDANCE_METHODS.has(method)) {
    throw new HttpsError("invalid-argument", "A valid student and attendance method are required.");
  }
  const now = Timestamp.now();
  const local = baghdadParts(now.toDate());
  const requestedLectureId = request.data && request.data.date;
  const lectureDate = requestedLectureId === undefined ? local.date : safeDateId(requestedLectureId);
  if (!lectureDate || lectureDate.slice(0, 10) !== local.date) throw new HttpsError("invalid-argument", "Live attendance requires a valid lecture for today.");
  const lectureRef = context.subjectRef.collection("lectures").doc(lectureDate);
  const student = await studentExistsInSubject(context.workspaceId, context.subject, requestedStudentId);
  if (!student) {
    await publishLiveScanEvent(lectureRef, {
      status: "rejected",
      reason: "student-not-found",
      studentId: requestedStudentId,
      method,
      time: local.time,
      eventAtMillis: now.toMillis()
    });
    throw new HttpsError("not-found", "The student is not enrolled in this cohort.");
  }
  const studentId = String(student.id || requestedStudentId).trim();

  const markRef = lectureRef.collection("marks").doc(studentId);
  const scanEventRef = lectureRef.collection("scanEvents").doc();
  const auditRef = auditReference(context.workspaceId);
  const policy = policyForSubject(context.subject);
  const defaultDurationMinutes = Math.round(positiveNumber(context.subject.lectureDurationHours, 2) * 60);
  const result = await db.runTransaction(async transaction => {
    const [lectureSnapshot, markSnapshot] = await Promise.all([
      transaction.get(lectureRef),
      transaction.get(markRef)
    ]);
    const lecture = lectureSnapshot.exists ? lectureSnapshot.data() || {} : {};
    const durationMinutes = positiveNumber(lecture.durationMinutes, positiveNumber(lecture.durationHours, defaultDurationMinutes / 60) * 60);
    if (lectureSnapshot.exists && ["completed", "cancelled", "voided"].includes(lecture.status)) {
      transaction.create(scanEventRef, {
        status: "rejected",
        reason: "lecture-closed",
        studentId,
        studentName: student.name,
        method,
        time: local.time,
        eventAtMillis: now.toMillis(),
        createdAt: now,
        schemaVersion: 1
      });
      return {
        rejected: true,
        reason: "lecture-closed",
        date: lectureDate,
        time: local.time
      };
    }
    if (lectureSnapshot.exists && asMillis(lecture.endAt) && asMillis(lecture.endAt) <= now.toMillis()) {
      transaction.create(scanEventRef, {
        status: "rejected",
        reason: "lecture-ended",
        studentId,
        studentName: student.name,
        method,
        time: local.time,
        eventAtMillis: now.toMillis(),
        createdAt: now,
        schemaVersion: 1
      });
      return {
        rejected: true,
        reason: "lecture-ended",
        date: lectureDate,
        time: local.time
      };
    }
    if (markSnapshot.exists) {
      const existing = markSnapshot.data() || {};
      transaction.create(scanEventRef, {
        status: "duplicate",
        studentId,
        studentName: student.name,
        method,
        time: existing.time || local.time,
        eventAtMillis: now.toMillis(),
        createdAt: now,
        schemaVersion: 1
      });
      return {
        alreadyPresent: true,
        date: lectureDate,
        time: existing.time || local.time,
        startTime: lecture.startTime || existing.time || local.time,
        status: lecture.status || "active",
        endAtMillis: asMillis(lecture.endAt)
      };
    }
    const startAt = lecture.startAt || now;
    const startTime = lecture.startTime || local.time;
    const endAt = lecture.endAt || Timestamp.fromMillis(asMillis(startAt) + durationMinutes * 60 * 1000);
    const attendedMinutes = attendanceMinutes(startTime, local.time, durationMinutes);
    transaction.set(context.subjectRef, {
      attendanceLocked: true,
      policySnapshot: policy,
      policyVersion: policy.version,
      updatedAt: now
    }, { merge: true });
    transaction.set(lectureRef, {
      date: lectureDate,
      calendarDate: lectureDate.slice(0, 10),
      status: "active",
      startAt,
      startTime,
      endAt,
      durationMinutes,
      durationHours: durationMinutes / 60,
      timeZone: BAGHDAD_TIME_ZONE,
      policySnapshot: policy,
      summaryState: lecture.summaryState || "not-required",
      createdAt: lecture.createdAt || now,
      updatedAt: now
    }, { merge: true });
    const record = {
      studentId,
      studentName: student.name,
      time: local.time,
      attendedMinutes,
      markedAt: now,
      markedBy: context.member.uid,
      method,
      source: "official-callable-v1"
    };
    transaction.create(markRef, record);
    transaction.create(auditRef, auditPayload({
      workspaceId: context.workspaceId,
      subjectId: context.subjectId,
      lectureDate,
      studentId,
      actorUid: context.member.uid,
      action: "attendance.marked",
      after: { time: local.time, attendedMinutes, method },
      source: method
    }));
    transaction.create(scanEventRef, {
      status: "accepted",
      studentId,
      studentName: student.name,
      method,
      time: local.time,
      eventAtMillis: now.toMillis(),
      createdAt: now,
      schemaVersion: 1
    });
    return {
      alreadyPresent: false,
      date: lectureDate,
      time: local.time,
      startTime,
      status: "active",
      attendedMinutes,
      endAtMillis: endAt.toMillis()
    };
  });
  if (result.rejected) {
    throw new HttpsError("failed-precondition", result.reason === "lecture-ended"
      ? "This lecture reached its scheduled end time and is being closed."
      : "This lecture is already closed.");
  }
  return result;
});

async function setLectureStatusOfficial(request, requestedStatus) {
  const context = await authorisedSubject(request, "attendanceEdit", { edit: true });
  if (request.data?.date !== undefined && !safeDateId(request.data.date)) throw new HttpsError("invalid-argument", "Invalid lecture identifier.");
  const date = safeDateId(request.data && request.data.date) || baghdadParts().date;
  const status = requestedStatus === "cancelled" ? "cancelled" : "completed";
  const lectureRef = context.subjectRef.collection("lectures").doc(date);
  const now = Timestamp.now();
  const lifecycleRevision = randomUUID(), auditRef = auditReference(context.workspaceId);
  const result = await db.runTransaction(async tx => {
    const [subjectSnapshot, lectureSnapshot] = await Promise.all([tx.get(context.subjectRef), tx.get(lectureRef)]);
    if (!subjectSnapshot.exists || subjectSnapshot.data().rosterOperationId || subjectSnapshot.data().attendanceClearInProgress) throw new HttpsError("failed-precondition", "Subject attendance is being changed; try again shortly.");
    if (!lectureSnapshot.exists) throw new HttpsError("failed-precondition", "The selected lecture no longer exists.");
    const lecture = lectureSnapshot.data() || {};
    if (Object.prototype.hasOwnProperty.call(request.data || {}, "expectedLifecycleRevision") &&
        (request.data.expectedLifecycleRevision || null) !== (lecture.lifecycleRevision || null)) throw new HttpsError("failed-precondition", "Lecture state changed on another device; review required.");
    if (lecture.status === status) return { changed: false, status, date, lifecycleRevision: lecture.lifecycleRevision || null };
    const allowed = status === "completed" ? ["active"] : ["active", "completed"];
    if (!allowed.includes(lecture.status)) throw new HttpsError("failed-precondition", "This lecture cannot make the requested transition.");
    const update = { status, lifecycleRevision, summaryState: status === "cancelled" ? "not-required" : "rebuild-pending", updatedAt: now };
    if (status === "completed") Object.assign(update, { completedAt: now, completedBy: context.member.uid, closedAtMillis: now.toMillis(), closeReason: "manual" });
    else Object.assign(update, { cancelledAt: now, cancelledBy: context.member.uid, cancelledAtMillis: now.toMillis() });
    tx.set(lectureRef, update, { merge: true });
    tx.set(context.subjectRef, { summaryState: "pending" }, { merge: true });
    tx.create(auditRef, auditPayload({ workspaceId: context.workspaceId, subjectId: context.subjectId,
      lectureDate: date, actorUid: context.member.uid, action: "lecture." + status,
      before: { status: lecture.status }, after: { status, lifecycleRevision }, source: "official-callable-v1" }));
    return { changed: true, status, date, lifecycleRevision };
  });
  if (!result.changed) return result;
  let summary = null;
  summary = await rebuildSubjectAttendanceSummaries(context.workspaceId, context.subjectId);
  return { ...result, summary };
}

exports.finalizeOfficialLecture = onCall({ region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async request => {
  return setLectureStatusOfficial(request, "completed");
});

exports.cancelOfficialLecture = onCall({ region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async request => {
  return setLectureStatusOfficial(request, "cancelled");
});

/*
 * A course-wide reset is intentionally more restricted than correcting a
 * single mark. It never removes students, departments, subjects or audit
 * entries, and it requires both a dedicated permission and a recorded reason.
 */
exports.clearOfficialSubjectAttendance = onCall({ region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async request => {
  const context = await authorisedSubject(request, "attendanceEdit", { edit: true });
  if (!isGlobalMember(context.member) && !memberHasPermission(context.member, "attendanceClear")) {
    throw new HttpsError("permission-denied", "A dedicated attendance-clear permission is required.");
  }
  const data = request.data || {};
  const reason = String(data.reason || "").trim();
  if (String(data.confirmation || "") !== "CLEAR_ATTENDANCE" || reason.length < 3) {
    throw new HttpsError("invalid-argument", "Confirmation and a clear reason are required.");
  }

  const subjectRef = context.subjectRef;
  const now = Timestamp.now();
  await subjectRef.set({
    attendanceClearInProgress: true,
    attendanceClearStartedAt: now,
    attendanceClearStartedBy: context.member.uid,
    updatedAt: now
  }, { merge: true });

  let batch = db.batch();
  let batchSize = 0;
  const counts = { lectures: 0, marks: 0, excuses: 0, scanEvents: 0, summaries: 0, recoverySnapshots: 0 };
  const queueDelete = async (ref, kind) => {
    batch.delete(ref);
    batchSize += 1;
    if (kind) counts[kind] += 1;
    if (batchSize >= 400) {
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    }
  };
  const flush = async () => {
    if (!batchSize) return;
    await batch.commit();
    batch = db.batch();
    batchSize = 0;
  };

  try {
    const lectureSnapshot = await subjectRef.collection("lectures").get();
    for (const lectureDoc of lectureSnapshot.docs) {
      // Never delete a lecture before the server has stored a recovery copy.
      // This makes a deliberate reset reversible through the protected
      // snapshot ledger and through Firestore's own backup/PITR facilities.
      const [marks, excuses, scanEvents] = await Promise.all([
        lectureDoc.ref.collection("marks").get(),
        lectureDoc.ref.collection("excuses").get(),
        lectureDoc.ref.collection("scanEvents").get()
      ]);
      await createLectureRecoverySnapshot(
        context.workspaceId,
        context.subjectId,
        safeDateId((lectureDoc.data() || {}).date || lectureDoc.id) || lectureDoc.id,
        lectureDoc.data() || {},
        `subject-clear:${reason}`,
        [marks, excuses]
      );
      counts.recoverySnapshots += 1;
      for (const mark of marks.docs) await queueDelete(mark.ref, "marks");
      for (const excuse of excuses.docs) await queueDelete(excuse.ref, "excuses");
      for (const scanEvent of scanEvents.docs) await queueDelete(scanEvent.ref, "scanEvents");
      await queueDelete(lectureDoc.ref, "lectures");
    }

    const summarySnapshot = await subjectRef.collection("attendanceSummaries").get();
    for (const summary of summarySnapshot.docs) await queueDelete(summary.ref, "summaries");
    await flush();

    await subjectRef.set({
      attendanceLocked: false,
      // Remove compatible fields written by pre-normalisation versions too.
      // Otherwise a cleared subject can still look like it has a closed
      // lecture after a browser reload, despite its lecture docs being gone.
      lectures: FieldValue.delete(),
      lectureMeta: FieldValue.delete(),
      attendance: FieldValue.delete(),
      excuses: FieldValue.delete(),
      policySnapshot: FieldValue.delete(),
      policyVersion: FieldValue.delete(),
      summarySchemaVersion: FieldValue.delete(),
      summaryCalculationModel: FieldValue.delete(),
      summaryGeneration: FieldValue.delete(),
      summaryState: FieldValue.delete(),
      summaryReferenceMinutes: FieldValue.delete(),
      summaryLiveReferenceMinutes: FieldValue.delete(),
      summarySourceFingerprint: FieldValue.delete(),
      summaryReviewCutoffMillis: FieldValue.delete(),
      summaryReviewCutoffAt: FieldValue.delete(),
      summaryNextReviewAt: FieldValue.delete(),
      summaryReviewPending: FieldValue.delete(),
      summaryEligibleLectureCount: FieldValue.delete(),
      summaryBuildStartedAt: FieldValue.delete(),
      lastSummaryRebuildAt: FieldValue.delete(),
      attendanceClearInProgress: FieldValue.delete(),
      attendanceClearStartedAt: FieldValue.delete(),
      attendanceClearStartedBy: FieldValue.delete(),
      attendanceClearedAt: Timestamp.now(),
      attendanceClearedBy: context.member.uid,
      updatedAt: Timestamp.now()
    }, { merge: true });
    await auditReference(context.workspaceId).create(auditPayload({
      workspaceId: context.workspaceId,
      subjectId: context.subjectId,
      actorUid: context.member.uid,
      action: "attendance.subject-cleared",
      before: counts,
      after: { reason, studentsRetained: true, attendanceLocked: false },
      source: "official-callable-v1"
    }));
    logger.info("Official subject attendance cleared", { workspaceId: context.workspaceId, subjectId: context.subjectId, actorUid: context.member.uid, ...counts });
    return { ...counts, studentsRetained: true };
  } catch (error) {
    await subjectRef.set({
      attendanceClearInProgress: FieldValue.delete(),
      attendanceClearFailedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    }, { merge: true }).catch(() => {});
    logger.error("Official subject attendance clear failed", { workspaceId: context.workspaceId, subjectId: context.subjectId, actorUid: context.member.uid, code: error && error.code });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Could not clear the official attendance record.");
  }
});

/*
 * The recovery centre intentionally restores one immutable lecture snapshot
 * at a time.  It never overwrites a current lecture and it never switches the
 * live Firestore database.  This makes the common case (a cleared subject or
 * an accidentally deleted lecture) reversible from the product while keeping
 * full-database PITR and daily-backup restoration a separate, reviewed Cloud
 * operation.
 */
exports.listAttendanceRecoverySnapshots = onCall({ region: "us-central1" }, async request => {
  const context = await authorisedWorkspaceOwner(request);
  const requestedSubjectId = String(request.data && request.data.subjectId || "").trim();
  const maximum = Math.min(200, Math.max(1, integer(request.data && request.data.limit, 100)));
  const snapshot = await context.workspaceRef.collection("lectureSnapshots")
    .orderBy("snapshotAt", "desc")
    .limit(200)
    .get();

  const snapshots = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    // The in-app restoration path only supports closed, official lectures.
    // Keep snapshots of other lifecycle states in the protected ledger, but
    // never present an action that would restore an ambiguous live session.
    .filter(item => String(item.status || "") === "completed")
    .filter(item => !requestedSubjectId || item.subjectId === requestedSubjectId)
    .slice(0, maximum)
    .map(item => ({
      id: String(item.id),
      subjectId: String(item.subjectId || ""),
      lectureDate: safeDateId(item.lectureDate) || "",
      calendarDate: String(item.lectureDate || "").slice(0, 10),
      status: String(item.status || ""),
      startTime: String(item.startTime || ""),
      durationHours: positiveNumber(item.durationHours, 2),
      markCount: integer(item.markCount),
      excuseCount: integer(item.excuseCount),
      reason: String(item.reason || ""),
      snapshotAtMillis: asMillis(item.snapshotAt),
      completedAtMillis: asMillis(item.completedAt)
    }));

  return { snapshots };
});

exports.restoreAttendanceRecoverySnapshot = onCall({ region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async request => {
  const context = await authorisedWorkspaceOwner(request);
  const data = request.data || {};
  const snapshotId = String(data.snapshotId || "").trim();
  const reason = String(data.reason || "").trim();
  if (!snapshotId || snapshotId.includes("/") || String(data.confirmation || "") !== "RESTORE_SNAPSHOT" || reason.length < 3) {
    throw new HttpsError("invalid-argument", "A snapshot, explicit confirmation, and a clear reason are required.");
  }

  const snapshotRef = context.workspaceRef.collection("lectureSnapshots").doc(snapshotId);
  const snapshotDoc = await snapshotRef.get();
  if (!snapshotDoc.exists) throw new HttpsError("not-found", "The recovery snapshot no longer exists.");
  const recovery = snapshotDoc.data() || {};
  const subjectId = String(recovery.subjectId || "").trim();
  const lectureDate = safeDateId(recovery.lectureDate);
  if (!subjectId || !lectureDate || recovery.workspaceId !== context.workspaceId) {
    throw new HttpsError("failed-precondition", "The recovery snapshot is not valid for this workspace.");
  }

  const subjectRef = context.workspaceRef.collection("subjects").doc(subjectId);
  const lectureRef = subjectRef.collection("lectures").doc(lectureDate);
  const [subjectDoc, existingLecture, marks, excuses] = await Promise.all([
    subjectRef.get(),
    lectureRef.get(),
    snapshotRef.collection("marks").get(),
    snapshotRef.collection("excuses").get()
  ]);
  if (!subjectDoc.exists) throw new HttpsError("not-found", "The original subject no longer exists.");
  if (existingLecture.exists) {
    throw new HttpsError("failed-precondition", "A lecture already exists on this date. Recovery will not overwrite current data.");
  }

  // Snapshots created at the close of a lecture are complete.  Other states
  // are also retained for audit purposes, but restoring them as active would
  // create an ambiguous, clock-less session, so only a completed record is
  // accepted for direct in-app recovery.
  if (String(recovery.status || "") !== "completed") {
    throw new HttpsError("failed-precondition", "Only a completed lecture snapshot can be restored from the application.");
  }

  const now = Timestamp.now();
  await lectureRef.create({
    date: lectureDate,
    calendarDate: lectureDate.slice(0, 10),
    restorationInProgress: true,
    status: "completed",
    startTime: String(recovery.startTime || ""),
    durationHours: positiveNumber(recovery.durationHours, 2),
    durationMinutes: integer(recovery.durationMinutes, Math.round(positiveNumber(recovery.durationHours, 2) * 60)),
    policySnapshot: recovery.policySnapshot || policyForSubject({ id: subjectDoc.id, ...subjectDoc.data() }),
    completedAt: recovery.completedAt || now,
    completedBy: String(recovery.completedBy || ""),
    closedAtMillis: Number(recovery.closedAtMillis) || 0,
    closeReason: String(recovery.closeReason || ""),
    restoredAt: now,
    restoredBy: context.member.uid,
    restoredFromSnapshotId: snapshotId,
    restoreReason: reason,
    summaryState: "pending",
    updatedAt: now
  });

  const copySnapshotDocuments = async (documents, collectionName) => {
    for (let index = 0; index < documents.length; index += 350) {
      const batch = db.batch();
      documents.slice(index, index + 350).forEach(doc => {
        const item = { ...(doc.data() || {}) };
        // These are recovery-copy metadata, not part of the official record.
        delete item.originalId;
        delete item.copiedAt;
        batch.set(lectureRef.collection(collectionName).doc(doc.id), {
          ...item,
          restoredAt: now,
          restoredBy: context.member.uid,
          restoredFromSnapshotId: snapshotId
        }, { merge: false });
      });
      await batch.commit();
    }
  };
  await copySnapshotDocuments(marks.docs, "marks");
  await copySnapshotDocuments(excuses.docs, "excuses");
  await lectureRef.set({ restorationInProgress: false, summaryState: "rebuild-pending" }, { merge: true });

  const rebuilt = await rebuildSubjectAttendanceSummaries(context.workspaceId, subjectId);
  await auditReference(context.workspaceId).create(auditPayload({
    workspaceId: context.workspaceId,
    subjectId,
    lectureDate,
    actorUid: context.member.uid,
    action: "attendance.snapshot-restored",
    before: { lectureExisted: false },
    after: {
      snapshotId,
      marks: marks.size,
      excuses: excuses.size,
      reason,
      rebuilt
    },
    source: "recovery-centre-v1"
  }));
  logger.info("Attendance recovery snapshot restored", {
    workspaceId: context.workspaceId,
    subjectId,
    lectureDate,
    snapshotId,
    actorUid: context.member.uid,
    marks: marks.size,
    excuses: excuses.size
  });
  return { snapshotId, subjectId, lectureDate, marks: marks.size, excuses: excuses.size, rebuilt };
});

/*
 * Corrections are deliberately separate from normal scanning.  Every change
 * includes its before/after value in the immutable workspace audit stream and
 * rebuilds the affected subject's official summary when a completed lecture is
 * corrected.
 */
exports.correctOfficialAttendance = onCall({ region: "us-central1", timeoutSeconds: 540, memory: "1GiB" },
  require("./official-correction")({ db, HttpsError, Timestamp, authorisedSubject, studentExistsInSubject, auditPayload }));
exports.rebuildOfficialAttendanceSummaries = onCall({ region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async request => {
  const context = await authorisedSubject(request, "attendanceEdit", { edit: true });
  if (!isGlobalMember(context.member) && !memberHasPermission(context.member, "classesEdit")) {
    throw new HttpsError("permission-denied", "Only an authorised academic manager can rebuild official summaries.");
  }
  const result = await rebuildSubjectAttendanceSummaries(context.workspaceId, context.subjectId);
  await auditReference(context.workspaceId).create(auditPayload({
    workspaceId: context.workspaceId,
    subjectId: context.subjectId,
    actorUid: context.member.uid,
    action: "attendance.summary-rebuilt",
    after: result,
    source: "official-callable-v1"
  }));
  return result;
});

/*
 * Runs independently from phones and browsers.  It is intentionally a small,
 * idempotent job: a retry is safe because a completed lecture is ignored and
 * every student summary records the applied lecture ID.
 */
async function closeDueAttendanceLecture(lectureRef, now) {
  const subjectRef = lectureRef.parent?.parent, workspaceRef = subjectRef?.parent?.parent;
  if (!subjectRef || workspaceRef?.parent?.id !== "attendanceWorkspaces") return false;
  const auditRef = auditReference(workspaceRef.id);
  return db.runTransaction(async tx => {
    const [snapshot, subjectSnapshot] = await Promise.all([tx.get(lectureRef), tx.get(subjectRef)]);
    if (!snapshot.exists || !subjectSnapshot.exists) return false;
    const lecture = snapshot.data() || {}, subject = subjectSnapshot.data() || {};
    const endAtMillis = asMillis(lecture.endAt);
    if (lecture.status !== "active" || !endAtMillis || endAtMillis > now.toMillis() ||
        subject.rosterOperationId || subject.attendanceClearInProgress) return false;
    const date = safeDateId(lecture.date || lectureRef.id);
    if (!date) return false;
    tx.set(lectureRef, { status: "completed", completedAt: now, completedBy: "system:auto-close",
      closedAtMillis: endAtMillis, closeReason: "elapsed", summaryState: "pending", updatedAt: now }, { merge: true });
    tx.set(subjectRef, { summaryState: "pending" }, { merge: true });
    tx.create(auditRef, auditPayload({ workspaceId: workspaceRef.id, subjectId: subjectRef.id,
      lectureDate: date, actorUid: "system:auto-close", action: "lecture.auto-completed",
      before: { status: "active" }, after: { status: "completed" }, source: "scheduler" }));
    return true;
  });
}

exports.approveWeeklyAttendanceStatuses = onSchedule({ schedule: "0 0 * * 5", timeZone: BAGHDAD_TIME_ZONE,
  region: "us-central1", timeoutSeconds: 540, memory: "512MiB", retryCount: 3, minBackoffSeconds: 60, maxBackoffSeconds: 300 }, async () => {
  const result = await require("./weekly-approval").queueWeeklyReviews({ db, queueSubjectSummary });
  logger.info("Weekly attendance review queued for end of Thursday / Friday 00:00 Baghdad", result);
  return result;
});

exports.closeDueAttendanceLectures = onSchedule({ schedule: "* * * * *", timeZone: BAGHDAD_TIME_ZONE, region: "us-central1", timeoutSeconds: 540, memory: "1GiB" }, async () => {
  const now = Timestamp.now();
  const dirtySubjects = new Map();
  const queue = subjectRef => dirtySubjects.set(subjectRef.path, subjectRef);
  const due = await db.collectionGroup("lectures")
    .where("status", "==", "active")
    .where("endAt", "<=", now)
    .limit(300)
    .get();
  let closed = 0;
  for (const lectureSnapshot of due.docs) {
    const subjectRef = lectureSnapshot.ref.parent.parent;
    if (!await closeDueAttendanceLecture(lectureSnapshot.ref, now)) continue;
    queue(subjectRef);
    closed += 1;
  }
  // A process can fail after changing the lecture state but before updating all
  // student summaries.  Pending summaries are independently retried and the
  // per-student appliedLectureIds field makes that retry idempotent.
  const pending = await db.collectionGroup("lectures")
    .where("summaryState", "==", "pending")
    .limit(100)
    .get();
  let repaired = 0;
  for (const lectureSnapshot of pending.docs) {
    const lecture = lectureSnapshot.data() || {};
    const subjectRef = lectureSnapshot.ref.parent.parent;
    const workspaceRef = subjectRef && subjectRef.parent && subjectRef.parent.parent;
    if (!subjectRef || workspaceRef?.parent?.id !== "attendanceWorkspaces" || lecture.status !== "completed") continue;
    const date = safeDateId(lecture.date || lectureSnapshot.id) || lectureSnapshot.id;
    queue(subjectRef);
    repaired += 1;
  }
  // Direct browser edits of a closed lecture are deliberately fast. Their
  // aggregate is rebuilt here, outside the classroom interaction, so several
  // corrections are coalesced into one reliable summary rebuild.
  const rebuildPending = await db.collectionGroup("lectures")
    .where("summaryState", "==", "rebuild-pending")
    .limit(100)
    .get();
  let rebuilt = 0;
  for (const lectureSnapshot of rebuildPending.docs) {
    const lecture = lectureSnapshot.data() || {};
    const subjectRef = lectureSnapshot.ref.parent.parent;
    const workspaceRef = subjectRef && subjectRef.parent && subjectRef.parent.parent;
    if (!subjectRef || workspaceRef?.parent?.id !== "attendanceWorkspaces" || lecture.status !== "completed") continue;
    queue(subjectRef);
    // The rebuild marks only the exact versions it read as applied. Do not
    // erase a newer correction's pending marker here.
    rebuilt += 1;
  }
  // Roster/policy edits and a rebuild whose input changed during publication
  // also need retries, even when no individual lecture is pending.
  const pendingSubjects = await db.collectionGroup("subjects").where("summaryState", "==", "pending").limit(25).get();
  for (const subject of pendingSubjects.docs) {
    const workspace = subject.ref.parent.parent;
    if (workspace?.parent?.id === "attendanceWorkspaces") queue(subject.ref);
  }
  const interruptedBuilds = await db.collectionGroup("subjects").where("summaryState", "==", "building").limit(25).get();
  for (const subject of interruptedBuilds.docs) {
    const workspace = subject.ref.parent.parent;
    if (workspace?.parent?.id === "attendanceWorkspaces" &&
        now.toMillis() - asMillis(subject.data().summaryBuildStartedAt) > 15 * 60 * 1000) {
      queue(subject.ref);
    }
  }
  for (const subjectRef of dirtySubjects.values()) {
    await rebuildSubjectAttendanceSummaries(subjectRef.parent.parent.id, subjectRef.id);
  }
  // Scanner events are presentation signals, not academic records. Keep them
  // briefly for reconnecting screens, then remove them so daily scans do not
  // become an ever-growing data collection.
  let clearedScanEvents = 0;
  try {
    const staleEvents = await db.collectionGroup("scanEvents")
      .where("eventAtMillis", "<=", now.toMillis() - 24 * 60 * 60 * 1000)
      .limit(400)
      .get();
    if (!staleEvents.empty) {
      const batch = db.batch();
      staleEvents.docs.forEach(snapshot => batch.delete(snapshot.ref));
      await batch.commit();
      clearedScanEvents = staleEvents.size;
    }
  } catch (error) {
    logger.warn("Live scan-event cleanup skipped", { code: error && error.code });
  }
  logger.info("Attendance lecture closure sweep completed", { due: due.size, closed, pending: pending.size, repaired, rebuildPending: rebuildPending.size, rebuilt, clearedScanEvents });
  return null;
});





Object.assign(exports, require("./subject-roster-reset")({db,onCall,HttpsError,FieldValue,Timestamp,authorisedSubject,authorisedWorkspaceOwner,cohortIdForSubject}));
Object.assign(exports, require("./offline-attendance")({db,onCall,HttpsError,Timestamp,authorisedSubject,rosterForSubject}));
Object.assign(exports, require("./offline-attendance-batch")({db,onCall,HttpsError,Timestamp,authorisedSubject,cohortIdForSubject}));
Object.assign(exports, require("./retired-compatibility")({onCall,HttpsError,authorisedWorkspaceOwner}));

for (const name of ["accountPresence", "submitPersonalRegistration", "getPersonalAccountStatus", "listPersonalRegistrations",
  "approvePersonalAccount", "openIndividualWorkspace", "importPersonalStudents", "setPersonalAcademicStatus", "updateLegacyEmbeddedRoster", "configureLegacySubjectScope"]) {
  exports[name] = onCall({ region: "us-central1", invoker: "public", timeoutSeconds: 120, memory: "512MiB" }, personal[name]);
}

// Separate callable: production clients retain their existing behavior.
exports.syncOfflineAttendancePreview = require('./offline-attendance-batch')({db,onCall,HttpsError,Timestamp,authorisedSubject,cohortIdForSubject,acceptAlreadyClosed:true}).syncOfflineAttendanceBatch;

exports.closedLectureWorkspace = require('./closed-lecture-workspace')({db,onCall,HttpsError,authorisedWorkspaceOwner}).closedLectureWorkspace;
exports.deviceLiveSync = require('./device-live-sync')({db,onCall,HttpsError,authorisedWorkspaceOwner}).deviceLiveSync;

exports.privateRosterShare = onCall({region:"us-central1",invoker:"public",timeoutSeconds:120,memory:"512MiB"}, require("./private-roster-share")({db,auth,approvedIdentity:personal.approvedIdentity,fail:(code,message)=>{throw new HttpsError(code,message);}}));
exports.supportChat = onCall({region:'us-central1',invoker:'public',timeoutSeconds:60,memory:'256MiB'},require('./support-chat')({db,approvedIdentity:personal.approvedIdentity,fail:(code,message)=>{throw new HttpsError(code,message);}}));
exports.sharedStudentRoster = onCall({region:"us-central1",invoker:"public",timeoutSeconds:120,memory:"512MiB"}, require("./retired-shared-roster")({approvedIdentity:personal.approvedIdentity,fail:(code,message)=>{throw new HttpsError(code,message);}}));
Object.assign(exports,require('./push-notifications')({db,auth,approvedIdentity:personal.approvedIdentity,HttpsError,FieldValue,onCall}));

const supportBroadcastService=require('./support-broadcast')({db,approvedIdentity:personal.approvedIdentity,fail:(code,message)=>{throw new HttpsError(code,message);}});
exports.supportBroadcast=onCall({region:'us-central1',invoker:'public',timeoutSeconds:60},supportBroadcastService.manage);
exports.deliverSupportBroadcast=require('firebase-functions/v2/firestore').onDocumentCreated({document:'attendanceSupportBroadcastJobs/{jobId}',region:'us-central1',retry:true,timeoutSeconds:300},event=>supportBroadcastService.process(event.params.jobId));
