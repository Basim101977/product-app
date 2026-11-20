"use strict";

const { createHash } = require("crypto");
// Production must pin the existing owner UID; never reuse the isolated test UID.
const OWNER_UID = process.env.HATHIR_OWNER_UID || "HATHIR_OWNER_UID_REQUIRED";
const OWNER_EMAIL = (process.env.HATHIR_OWNER_EMAIL || "redacted@example.invalid").toLowerCase();
const ACADEMIC_STATUSES = new Set(["", "مستوفي", "عبور", "غير مستوفي", "محمل"]);
// Internal application abbreviations, not institution-issued identifiers.
const DEPARTMENT_PREFIXES = Object.freeze({ medical_labs: "MLT", community_health: "CHT", nursing: "NT", pharmacy: "PT",
  forensic_evidence: "FET", accounting: "AT", materials_management: "MMT", legal_administration: "LAT",
  computer_networks_software: "CNS", electronic_techniques: "ELC", power_mechanics: "PMT", civil_techniques: "CT",
  mechanical_techniques: "MT", surveying_techniques: "ST", medical_devices: "MI" });
// Issued IDs retain their original namespace. These values identify stale,
// unallocated defaults; they are not aliases that rewrite existing student IDs.
const LEGACY_DEPARTMENT_PREFIXES = Object.freeze({ medical_labs: "ML", community_health: "CH", nursing: "NU", pharmacy: "PH",
  forensic_evidence: "FE", accounting: "AC", materials_management: "MM", legal_administration: "LA",
  computer_networks_software: "CNS", electronic_techniques: "ET", power_mechanics: "PM", civil_techniques: "CT",
  mechanical_techniques: "MT", surveying_techniques: "ST", medical_devices: "MD" });
const sha = value => createHash("sha256").update(value).digest("hex");
const normalizeName = value => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/gu, " ") : "";
const safeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const safeStudentId = value => typeof value === "string" && value.length > 0 && ![".", ".."].includes(value) && !value.includes("/") && Buffer.byteLength(value) <= 1500;
const isPinnedOwner = user => user?.uid === OWNER_UID && user.email?.toLowerCase() === OWNER_EMAIL && user.disabled !== true;
const isPlatformOwner = user => isPinnedOwner(user) && user.emailVerified === true;

function registrationName(data) {
  const fields = ["firstName", "fatherName", "grandfatherName"];
  const out = {};
  for (const key of fields) {
    const name = normalizeName(data?.[key]);
    if (name.length < 2 || name.length > 50 || !/^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*$/u.test(name) ||
        /(?:^| )(د|دكتور|دكتورة|الدكتور|الدكتورة|أستاذ|استاذ|استاذة|أستاذة|الأستاذ|الاستاذ|الأستاذة|الاستاذة|مهندس|مهندسة|المهندس|المهندسة|م|السيد|السيدة|dr|doctor|prof|professor|mr|mrs|ms|eng|engineer)(?: |$)/iu.test(name.replace(/\p{M}/gu, ""))) {
      throw new Error("Enter three name fields using letters only, without titles, numbers or punctuation. Compound names are allowed.");
    }
    out[key] = name;
  }
  return { ...out, fullName: fields.map(key => out[key]).join(" ") };
}

function isLegacySubject(subject) {
  return subject.rosterSchemaVersion === 1 || (subject.rosterSchemaVersion === undefined &&
    subject.academicYearStart === undefined && subject.stageNumber === undefined);
}

function cohortIdForSubject(subject) {
  if (/^private_[a-f0-9]{40}$/.test(subject.rosterCohortId || "")) return subject.rosterCohortId;
  // Pointers are server-controlled. Preserve existing locations, never move a
  // roster merely because a newer UI adds academic-year presentation fields.
  if (/^(?:cohort_|personal_)[A-Za-z0-9_-]+$/.test(subject.rosterCohortId || "")) return subject.rosterCohortId;
  const section = (/^[ABCD]$/.test(subject.section || "") ? "__" + subject.section : "") + (subject.studyPeriod=== "evening" ? "__evening" : "");
  if(subject.rosterNaming==='name')return `cohort_names_${subject.departmentId}__${subject.stageId}${section}`;
  if (isLegacySubject(subject)) return `cohort_${String(subject.departmentId || "")}__${String(subject.stageId || "")}${section}`.replace(/\//g, "_");
  if (!Number.isInteger(subject.academicYearStart) || !Number.isInteger(subject.stageNumber)) {
    throw new Error("Incomplete personal roster identity; the saved roster was not changed.");
  }
  return `personal_${subject.academicYearStart}_${subject.departmentId}_${subject.stageNumber}${section}`;
}

function resolveDepartmentPrefix(departmentId, department, subject = {}, allocationPrefixes = []) {
  const saved = String(department?.codePrefix || department?.prefix || "").toUpperCase();
  const preserved = [...allocationPrefixes];
  if (department?.codePrefixLocked === true) preserved.push(saved);
  if (subject.personalScopeLocked === true) preserved.push(subject.departmentPrefix);
  if (preserved.length) {
    if (preserved.some(prefix => typeof prefix !== "string" || !/^[A-Z]{2,6}$/.test(prefix)) || new Set(preserved).size !== 1) {
      throw new Error("Existing student-code namespaces conflict or are incomplete; review the saved allocation records before importing.");
    }
    return preserved[0];
  }
  return DEPARTMENT_PREFIXES[departmentId] || saved;
}

function validateCohort(subject, department, stage, allocationPrefixes = []) {
  const year = subject.academicYearStart, number = subject.stageNumber;
  const prefix = resolveDepartmentPrefix(subject.departmentId, department, subject, allocationPrefixes);
  const recognizedDefault = DEPARTMENT_PREFIXES[subject.departmentId] &&
    [DEPARTMENT_PREFIXES[subject.departmentId], LEGACY_DEPARTMENT_PREFIXES[subject.departmentId]].includes(subject.departmentPrefix);
  // A sibling subject may retain the old seeded default after the department's
  // first canonical import. Its unlocked scope can catch up to that canonical
  // namespace; a department locked to a legacy namespace never changes.
  const prefixMatches = subject.departmentPrefix === prefix || (subject.personalScopeLocked !== true && recognizedDefault &&
    prefix === DEPARTMENT_PREFIXES[subject.departmentId]);
  if (!safeId(subject.departmentId) || !safeId(subject.stageId) || !Number.isInteger(year) || year < 2000 || year > 2100 ||
      !Number.isInteger(number) || number < 1 || number > 6 || Number(stage?.sort) !== number ||
      stage?.departmentId !== subject.departmentId || !/^[A-Z]{2,6}$/.test(prefix) || !prefixMatches) {
    throw new Error("Choose a valid department, stage and academic year before importing students.");
  }
  return { departmentId: subject.departmentId, stageId: subject.stageId, stageNumber: number,
    academicYearStart: year, entryYear: year - number + 1, departmentPrefix: prefix, cohortId: cohortIdForSubject(subject) };
}

function importNames(values, allowDuplicateNames) {
  if (!Array.isArray(values) || !values.length || values.length > 300) throw new Error("Import between 1 and 300 names per operation.");
  const names = values.map(normalizeName);
  if (names.some(name => name.length < 3 || name.length > 150 || !/^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*$/u.test(name))) {
    throw new Error("Student names must contain letters and spaces only; do not include student codes.");
  }
  if (!allowDuplicateNames && new Set(names).size !== names.length) throw new Error("Duplicate names require explicit confirmation.");
  return names;
}

function createPersonalService({ db, auth, HttpsError, FieldValue }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const checked = fn => { try { return fn(); } catch (error) { fail("invalid-argument", error.message); } };
  const stamp = () => FieldValue.serverTimestamp();
  const approvalRef = uid => db.collection("attendanceIndividualRequests").doc(uid);
  function checkNamespaceReservation(counter, scope, roster, archived) {
    const namespace = new RegExp(`^${scope.departmentPrefix}${scope.entryYear}(\\d{4})$`);
    const identifiers = roster.docs.flatMap(doc => [doc.id, doc.data()?.id, doc.data()?.studentId]);
    for (const row of Array.isArray(archived) ? archived : []) identifiers.push(row?.id, row?.studentId);
    let maximum = 0, occupied = false;
    for (const value of identifiers) {
      const matched = namespace.exec(String(value || "").trim().toUpperCase());
      if (matched) { occupied = true; maximum = Math.max(maximum, Number(matched[1])); }
    }
    if (!counter.exists && occupied) {
      fail("failed-precondition", "Existing student identifiers occupy this allocation namespace but its durable counter is missing. Review reservations before importing; no identifiers were changed.");
    }
    if (counter.exists) {
      const reserved = counter.data()?.lastSequence;
      if (!Number.isInteger(reserved) || reserved < 0 || reserved > 9999 || reserved < maximum) {
        fail("failed-precondition", "The durable counter does not cover the existing or archived student identifiers. Review reservations before importing; no identifiers were changed.");
      }
    }
  }
  async function legacyApproved(user, approval) {
    const owner = isPinnedOwner(user);
    if (!owner && (!approval || approval.status !== "approved" || approval.email !== user.email.toLowerCase())) return false;
    if (!owner && approval.adminEmailApproved === true && approval.reviewedBy === OWNER_UID) return true;
    const snap = await db.collection("attendanceLegacyAccess").doc(user.uid).get();
    const row = snap.exists ? snap.data() : null;
    return row?.uid === user.uid && row.email === user.email.toLowerCase() && row.approvedAtCutover === true &&
      (owner ? row.platformOwner === true : row.platformOwner !== true);
  }
  async function identity(request, verified = true) {
    if (!request.auth?.uid) fail("unauthenticated", "Sign in first.");
    const user = await auth.getUser(request.auth.uid);
    if (user.disabled || !user.email) fail("permission-denied", "This account cannot access the application.");
    if (request.auth.token?.email?.toLowerCase() !== user.email.toLowerCase()) fail("permission-denied", "The signed-in email changed; refresh your session first.");
    if (verified && (user.emailVerified !== true || request.auth.token?.email_verified !== true)) fail("permission-denied", "Verify your email and refresh your session first.");
    return user;
  }
  async function approvedIdentity(request, workspaceId = request.auth?.uid) {
    if (!request.auth?.uid || workspaceId !== request.auth.uid) fail("permission-denied", "This private workspace belongs to another account.");
    const user = await identity(request, false);
    const approval = await approvalRef(user.uid).get();
    const grandfathered = await legacyApproved(user, approval.exists ? approval.data() : null);
    if (!grandfathered && (user.emailVerified !== true || request.auth.token?.email_verified !== true)) {
      fail("permission-denied", "Verify your email and refresh your session first.");
    }
    if (!(isPinnedOwner(user) && (isPlatformOwner(user) || grandfathered)) && (!approval.exists || approval.data().status !== "approved" || approval.data().email !== user.email.toLowerCase())) {
      fail("permission-denied", "Platform owner approval is required for this verified email.");
    }
    return { user, approval: approval.exists ? approval.data() : null, grandfathered };
  }
  async function ownerIdentity(request) {
    const user = await identity(request, false);
    if (!isPinnedOwner(user) || (!(user.emailVerified === true && request.auth.token?.email_verified === true) && !(await legacyApproved(user, null)))) {
      fail("permission-denied", "Only the platform owner can approve accounts.");
    }
    return user;
  }
  async function submitPersonalRegistration(request) {
    const user = await identity(request, false);
    const profile = checked(() => registrationName(request.data));
    const ref = approvalRef(user.uid), email = user.email.toLowerCase();
    return db.runTransaction(async tx => {
      const prior = await tx.get(ref);
      if (prior.exists) {
        if (prior.data().email !== email) fail("failed-precondition", "The registered email changed; contact support.");
        return { status: prior.data().status, fullName: prior.data().fullName };
      }
      tx.create(ref, { uid: user.uid, email, ...profile, status: "pending", createdAt: stamp(), updatedAt: stamp() });
      return { status: "pending", fullName: profile.fullName };
    });
  }
  async function getPersonalAccountStatus(request) {
    const user = await identity(request, false), snap = await approvalRef(user.uid).get();
    const row = snap.exists ? snap.data() : null;
    const grandfathered = await legacyApproved(user, row);
    const owner = isPinnedOwner(user) && (user.emailVerified === true || grandfathered);
    const status = owner ? "approved" : row?.email === user.email.toLowerCase() ? row.status : "unregistered";
    let workspaceReady=false;
    // Resolve the approved user's pointer beside Auth, avoiding another mobile
    // network round trip. Pending/rejected identities never read private scope.
    if(status === "approved" && (user.emailVerified === true || grandfathered)) {
      const pointer=await db.collection("attendanceUserWorkspaces").doc(user.uid).get();
      const data=pointer.exists?pointer.data():null;
      workspaceReady=Boolean(data && data.workspaceId===user.uid && data.active!==false);
    }
    return { status, workspaceReady,
      emailVerified: user.emailVerified === true, emailVerificationRequired: !grandfathered,
      isPlatformOwner: owner, workspaceId: user.uid,
      email: user.email, fullName: row?.fullName || user.displayName || "" };
  }
  const lectureCounts=new Map();
  const searchName=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\uFEFF]/g,'').replace(/\s+/g,' ').trim();
  async function listPersonalRegistrations(request) {
    await ownerIdentity(request);
    const collection = db.collection("attendanceIndividualRequests");
    if(request.data?.lectureUid!==undefined){
      const uid=request.data.lectureUid;if(!safeId(uid))fail('invalid-argument','Invalid teacher.');
      const registration=await collection.doc(uid).get();if(!registration.exists||['deleted','deleting'].includes(registration.data().status))fail('not-found','Teacher unavailable.');
      const prior=lectureCounts.get(uid);if(prior&&Date.now()-prior.at<60000)return prior.result;
      const result=await require('./owner-lecture-count').countOwnerLectures(db,uid);lectureCounts.set(uid,{at:Date.now(),result});if(lectureCounts.size>1000)lectureCounts.delete(lectureCounts.keys().next().value);return result;
    }
    if(request.data?.search!==undefined&&(typeof request.data.search!=='string'||request.data.search.length>150))fail('invalid-argument','Search is too long.');
    const search=searchName(request.data?.search||'');
    if (request.data?.countOnly === true) {
      const count = await collection.where('status', '==', 'pending').count().get();
      return { pendingCount: count.data().count };
    }
    let query = collection.orderBy("createdAt", "desc");
    if (request.data?.cursor) {
      const cursor = request.data.cursor;
      if (typeof cursor !== 'string' || cursor.length > 128 || cursor.includes('/')) fail('invalid-argument', 'Invalid page cursor.');
      const snapshot = await collection.doc(cursor).get();
      if (!snapshot.exists) fail('failed-precondition', 'Page changed; reload registration requests.');
      query = query.startAfter(snapshot);
    }
    let rows;
    if(search){
      const found=[];let scan=query;
      while(found.length<101){const batch=await scan.limit(500).get();for(const doc of batch.docs){const r=doc.data();if(r.status!=='deleted'&&(searchName(r.fullName).includes(search)||searchName(r.email).includes(search)))found.push(doc);if(found.length===101)break;}if(batch.docs.length<500||found.length>=101)break;scan=scan.startAfter(batch.docs.at(-1));}
      rows={docs:found};
    }else rows=await query.limit(101).get();
    const page = rows.docs.slice(0, 100), requests = [];
    for (let offset = 0; offset < page.length; offset += 10) requests.push(...await Promise.all(page.slice(offset, offset + 10).map(async doc => {
      const row = doc.data();
      let user; try { user = await auth.getUser(doc.id); } catch { user = null; }
      return { uid: doc.id, email: row.email, fullName: row.fullName, status: row.status,
        adminEmailApproved: row.status === "approved" && row.adminEmailApproved === true && row.reviewedBy === OWNER_UID,
        emailVerified: user?.emailVerified === true && user?.email?.toLowerCase() === row.email && !user?.disabled,
        createdAt: row.createdAt?.toMillis?.() || 0 };
    })));
    return { requests: requests.filter(row=>row.status!=="deleted"), nextCursor: rows.docs.length > 100 ? page.at(-1).id : null };
  }
  async function approvePersonalAccount(request) {
    await ownerIdentity(request);
    const { uid, status, confirmEmail, allowUnverified } = request.data || {};
    if (!safeId(uid) || !["approved", "rejected", "deleted"].includes(status) || uid === OWNER_UID) fail("invalid-argument", "Choose a teacher account and an action.");
    let target;
    try { target = await auth.getUser(uid); } catch(error) { if(status!=="deleted" || error.code!=="auth/user-not-found")throw error; }
    if(status === "deleted") {
      // Revoke application access first. A retained tombstone blocks stale tokens
      // and allows retry if deleting the Auth identity fails partway through.
      await db.runTransaction(async tx=>{
        const ref=approvalRef(uid),snap=await tx.get(ref);
        if(!snap.exists || typeof confirmEmail!=="string" || confirmEmail.trim().toLowerCase()!==snap.data().email || (target && target.email?.toLowerCase()!==snap.data().email))fail("failed-precondition","Confirm the current account email before deletion.");
        tx.update(ref,{status:"deleting",adminEmailApproved:false,reviewedBy:request.auth.uid,updatedAt:stamp()});
      });
      try { await auth.deleteUser(uid); } catch(error) { if(error.code!=="auth/user-not-found")throw error; }
      await db.runTransaction(async tx=>{const ref=approvalRef(uid);await tx.get(ref);tx.update(ref,{status:"deleted",deletedAt:stamp(),updatedAt:stamp()});});
      return {uid,status};
    }
    if (status === "approved" && (target.disabled || (!target.emailVerified && allowUnverified!==true))) fail("failed-precondition", "Explicit administrative approval is required for an unverified email.");
    await db.runTransaction(async tx => {
      const ref = approvalRef(uid), snap = await tx.get(ref);
      if (!snap.exists || snap.data().email !== target.email?.toLowerCase() || ["deleting","deleted"].includes(snap.data().status)) fail("failed-precondition", "Registration changed; reload the requests.");
      tx.update(ref, { status, adminEmailApproved:status==="approved" && !target.emailVerified && allowUnverified===true, reviewedBy: request.auth.uid, reviewedAt: stamp(), updatedAt: stamp() });
    });
    return { uid, status };
  }

  async function openIndividualWorkspace(request) {
    const { user, approval } = await approvedIdentity(request);
    const uid = user.uid, workspace = db.collection("attendanceWorkspaces").doc(uid);
    const memberRef = workspace.collection("members").doc(uid);
    const displayName = approval?.fullName || user.displayName || user.email;
    await db.runTransaction(async tx => {
      const [prior, member] = await Promise.all([tx.get(workspace), tx.get(memberRef)]);
      if (prior.exists && (prior.data().ownerUid !== uid || prior.data().primaryOwnerUid !== uid)) fail("failed-precondition", "Workspace ownership mismatch.");
      const profile = { uid, email: user.email.toLowerCase(), displayName, role: "owner", active: true,
        permissions: {}, departmentIds: [], stageIds: [], subjectIds: [] };
      if (!prior.exists) tx.create(workspace, { workspaceId: uid, ownerUid: uid, primaryOwnerUid: uid,
        mode: "personal", name: displayName, createdAt: stamp(), updatedAt: stamp() });
      tx.set(memberRef, { ...profile, joinedAt: member.data()?.joinedAt || stamp() });
      tx.set(db.collection("attendanceUserWorkspaces").doc(uid), { ...profile, workspaceId: uid, bootstrapVersion: 2, updatedAt: stamp() });
    });
    return { workspaceId: uid };
  }
  async function activeMember(request, workspaceId) {
    const { user } = await approvedIdentity(request, workspaceId);
    const workspace = db.collection("attendanceWorkspaces").doc(workspaceId);
    const [member, ws] = await Promise.all([workspace.collection("members").doc(user.uid).get(), workspace.get()]);
    if (!ws.exists || ws.data().ownerUid !== user.uid || ws.data().primaryOwnerUid !== user.uid ||
        !member.exists || member.data().active !== true || member.data().uid !== user.uid) fail("permission-denied", "Open your private workspace first.");
    // Personal rights derive from approved ownership, never a client-controlled role/permissions map.
    return { ...member.data(), uid: user.uid, role: "owner", active: true };
  }
  async function configureLegacySubjectScope(request) {
    const { workspaceId, subjectId, academicYearStart, stageNumber, departmentPrefix } = request.data || {};
    await activeMember(request, workspaceId);
    if (!safeId(subjectId) || !Number.isInteger(academicYearStart) || academicYearStart < 2000 || academicYearStart > 2100 ||
        !Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > 6) {
      fail("invalid-argument", "Explicitly choose a valid academic starting year and stage number. Existing years are never guessed.");
    }
    const workspace = db.collection("attendanceWorkspaces").doc(workspaceId), subjectRef = workspace.collection("subjects").doc(subjectId);
    return db.runTransaction(async tx => {
      const subjectSnap = await tx.get(subjectRef);
      if (!subjectSnap.exists) fail("not-found", "The subject no longer exists; it will not be recreated.");
      const subject = subjectSnap.data();
      if (subject.rosterNaming==='name' || !isLegacySubject(subject) || subject.rosterOperationId || subject.attendanceClearInProgress ||
          !safeId(subject.departmentId) || !safeId(subject.stageId)) fail("failed-precondition", "The existing subject is unavailable for legacy import setup.");
      const cohortId = cohortIdForSubject(subject), cohortRef = workspace.collection("cohorts").doc(cohortId);
      const [department, stage, cohort, roster, oldRows] = await Promise.all([
        tx.get(workspace.collection("departments").doc(subject.departmentId)), tx.get(workspace.collection("stages").doc(subject.stageId)),
        tx.get(cohortRef), tx.get(cohortRef.collection("students")), tx.get(subjectRef.collection("students").limit(1))
      ]);
      if (!department.exists || !stage.exists || stage.data().departmentId !== subject.departmentId || Number(stage.data().sort) !== stageNumber) {
        fail("failed-precondition", "The explicitly selected stage must match the existing saved department and stage.");
      }
      if (cohort.data()?.rosterOperationId) fail("failed-precondition", "Roster recovery is in progress.");
      const central = Boolean(subject.rosterCohortId || Number(cohort.data()?.rosterVersion) >= 1 || roster.docs.length);
      if (!central && (oldRows.docs.length || (Array.isArray(subject.students) && subject.students.length))) {
        fail("failed-precondition", "This roster uses legacy subject storage. Import setup requires a separately reviewed preservation plan; no rows were moved.");
      }
      const prefix = checked(() => resolveDepartmentPrefix(subject.departmentId, department.data(), subject));
      if (!/^[A-Z]{2,6}$/.test(prefix || "") || (departmentPrefix !== undefined && departmentPrefix !== prefix)) {
        fail("invalid-argument", "The requested prefix must match the saved department allocation namespace.");
      }
      const scope = { academicYearStart, stageNumber, departmentPrefix: prefix, entryYear: academicYearStart - stageNumber + 1 };
      const sameScope = other => other && Object.keys(scope).every(key => other[key] === scope[key]);
      if (subject.legacyImportConfigured === true && !sameScope({ ...subject, entryYear: subject.academicYearStart - subject.stageNumber + 1 })) {
        fail("failed-precondition", "This existing cohort's import year is fixed. Create a separate year-specific subject for a different year.");
      }
      if (cohort.data()?.legacyImportScope && !sameScope(cohort.data().legacyImportScope)) {
        fail("failed-precondition", "Another subject already configured this shared legacy cohort with a different import scope.");
      }
      const sequenceRef = workspace.collection("personalStudentSequences").doc(prefix + scope.entryYear);
      const counter = await tx.get(sequenceRef);
      if (counter.exists && counter.data().departmentId !== subject.departmentId) fail("failed-precondition", "This namespace is reserved by another or unknown department.");
      checkNamespaceReservation(counter, scope, roster, subject.archivedStudents);
      tx.set(cohortRef, { legacyImportScope: scope, ...(cohort.exists ? {} : { id: cohortId, rosterVersion: 1, studentCount: roster.docs.length }), updatedAt: stamp() }, { merge: true });
      tx.update(subjectRef, { academicYearStart, stageNumber, departmentPrefix: prefix,
        rosterCohortId: cohortId, rosterSchemaVersion: 1, legacyImportConfigured: true,
        legacyScopeConfiguredBy: request.auth.uid, legacyScopeConfiguredAt: stamp(), updatedAt: stamp() });
      return { ...scope, cohortId, configured: true };
    });
  }
  async function importPersonalStudents(request) {
    const data = request.data || {}, { workspaceId, subjectId, operationId } = data;
    await activeMember(request, workspaceId);
    if (!safeId(subjectId) || !/^[A-Za-z0-9_-]{16,100}$/.test(operationId || "")) fail("invalid-argument", "Valid subject and stable operation ID are required.");
    if (data.nameOnly === true) return importStudentsByName(request);
    const names = checked(() => importNames(data.names, data.allowDuplicateNames === true));
    const fingerprint = sha(JSON.stringify({ subjectId, names, allowDuplicateNames: data.allowDuplicateNames === true }));
    const workspace = db.collection("attendanceWorkspaces").doc(workspaceId);
    const subjectRef = workspace.collection("subjects").doc(subjectId);
    const receiptRef = workspace.collection("personalImportReceipts").doc(operationId);
    return db.runTransaction(async tx => {
      const [subjectSnap, receipt] = await Promise.all([tx.get(subjectRef), tx.get(receiptRef)]);
      if (receipt.exists) {
        if (receipt.data().fingerprint !== fingerprint) fail("already-exists", "This operation ID was already used for a different import.");
        return { ...receipt.data().result, replayed: true };
      }
      if (!subjectSnap.exists) fail("not-found", "Subject not found.");
      const subject = subjectSnap.data();
      if (subject.rosterOperationId) fail("failed-precondition", "Roster recovery is in progress.");
      const legacyAllocation = isLegacySubject(subject);
      if (legacyAllocation && subject.legacyImportConfigured !== true) fail("failed-precondition", "This existing roster has no confirmed academic-year allocation scope. Its students and attendance are preserved. Complete the explicit legacy import setup before adding names.");
      if (!safeId(subject.departmentId) || !safeId(subject.stageId)) fail("failed-precondition", "Invalid subject department or stage.");
      const [department, stage] = await Promise.all([tx.get(workspace.collection("departments").doc(subject.departmentId)), tx.get(workspace.collection("stages").doc(subject.stageId))]);
      if (!department.exists || !stage.exists) fail("failed-precondition", "Save the selected department and stage before importing.");
      let scope = checked(() => validateCohort(subject, department.data(), stage.data()));
      const cohort = workspace.collection("cohorts").doc(scope.cohortId);
      const initialSequenceRef = workspace.collection("personalStudentSequences").doc(scope.departmentPrefix + scope.entryYear);
      const [meta, roster, departmentSequences, initialCounter] = await Promise.all([tx.get(cohort), tx.get(cohort.collection("students")),
        department.data().codePrefixLocked === true ? Promise.resolve({ docs: [] }) :
          tx.get(workspace.collection("personalStudentSequences").where("departmentId", "==", scope.departmentId)), tx.get(initialSequenceRef)]);
      if (meta.data()?.rosterOperationId) fail("failed-precondition", "Roster recovery is in progress.");
      // Locks are authoritative, but historical reservations and roster records
      // also prevent namespace changes if a legacy record has lost its lock.
      // Counters survive student deletion and protect allocations in other years.
      const allocationPrefixes = [];
      for (const doc of departmentSequences.docs) {
        if (Number(doc.data().lastSequence) > 0) allocationPrefixes.push(/^([A-Z]{2,6})\d{4}$/.exec(doc.id)?.[1] || "");
      }
      if (meta.data()?.departmentPrefix) allocationPrefixes.push(meta.data().departmentPrefix);
      else if (Number(meta.data()?.studentCount) > 0 && !roster.docs.length) allocationPrefixes.push("");
      for (const doc of roster.docs) {
        const row = doc.data();
        // Legacy rows keep their original arbitrary identifiers. Only codes
        // generated by the new allocator participate in its prefix evidence.
        if (legacyAllocation && row.sequence === undefined && row.entryYear === undefined && !row.departmentPrefix) continue;
        if (row.departmentPrefix) allocationPrefixes.push(row.departmentPrefix);
        allocationPrefixes.push(/^([A-Z]{2,6})\d{8}$/.exec(row.id || doc.id)?.[1] || "");
      }
      try { scope = validateCohort(subject, department.data(), stage.data(), allocationPrefixes); }
      catch (error) { fail("failed-precondition", error.message); }
      const sequenceRef = workspace.collection("personalStudentSequences").doc(scope.departmentPrefix + scope.entryYear);
      const counter = sequenceRef.path === initialSequenceRef.path ? initialCounter : await tx.get(sequenceRef);
      if (counter.exists && ((counter.data().departmentId && counter.data().departmentId !== scope.departmentId) ||
          (!counter.data().departmentId && Number(counter.data().lastSequence) > 0))) {
        fail("failed-precondition", "This student-code namespace is reserved by another or unknown department; choose a non-conflicting department prefix.");
      }
      if (!counter.exists && (subject.personalScopeLocked === true || (!legacyAllocation && roster.docs.length > 0) ||
          (meta.data()?.departmentPrefix && meta.data()?.entryYear === scope.entryYear))) {
        fail("failed-precondition", "An issued student-code namespace is missing its sequence reservation; restore the counter before importing.");
      }
      if (legacyAllocation) {
        const configured = meta.data()?.legacyImportScope;
        if (!configured || ["academicYearStart", "stageNumber", "departmentPrefix", "entryYear"].some(key => configured[key] !== scope[key])) {
          fail("failed-precondition", "The saved legacy allocation scope does not match this subject; review its explicit setup.");
        }
      }
      checkNamespaceReservation(counter, scope, roster, subject.archivedStudents);
      const byName = new Map(), rosterIds = new Set();
      for (const doc of roster.docs) {
        const saved = doc.data(), id = String(saved.id || saved.studentId || doc.id).trim();
        if (!safeStudentId(id) || rosterIds.has(id.toUpperCase())) fail("failed-precondition", "Ambiguous saved student identifiers require review before importing.");
        rosterIds.add(id.toUpperCase());
        const row = { ...saved, id }, key = normalizeName(row.name);
        if (!byName.has(key)) byName.set(key, []); byName.get(key).push(row);
      }
      for (const rows of byName.values()) rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      let sequence = Number(counter.data()?.lastSequence || 0), added = 0;
      const seen = new Map(), students = [];
      for (const name of names) {
        const occurrence = seen.get(name) || 0; seen.set(name, occurrence + 1);
        const existing = byName.get(name)?.[occurrence];
        if (existing) { students.push({ id: existing.id, name: existing.name }); continue; }
        sequence += 1;
        if (sequence > 9999) fail("resource-exhausted", "This department and entry year reached its 4-digit code limit.");
        const id = `${scope.departmentPrefix}${scope.entryYear}${String(sequence).padStart(4, "0")}`;
        const student = { id, name, entryYear: scope.entryYear, sequence, departmentPrefix: scope.departmentPrefix,
          createdAt: stamp(), createdBy: request.auth.uid, updatedAt: stamp() };
        tx.create(cohort.collection("students").doc(id), student);
        students.push({ id, name }); added += 1;
      }
      const studentCount = roster.docs.length + added;
      if(studentCount>700)fail('resource-exhausted','القائمة الناتجة تتجاوز 700 طالب.');
      tx.update(department.ref, { codePrefix: scope.departmentPrefix, codePrefixLocked: true });
      tx.update(stage.ref, { personalScopeLocked: true });
      tx.set(sequenceRef, { lastSequence: sequence, departmentId: scope.departmentId, entryYear: scope.entryYear, updatedAt: stamp() }, { merge: true });
      tx.set(cohort, { ...scope, id: scope.cohortId, rosterVersion: 1, studentCount, updatedAt: stamp() }, { merge: true });
      tx.update(subjectRef, { studentCount, departmentPrefix: scope.departmentPrefix, personalScopeLocked: true, updatedAt: stamp() });
      const result = { students, cohortId: scope.cohortId, departmentPrefix: scope.departmentPrefix, added, studentCount };
      tx.create(receiptRef, { fingerprint, result, subjectId, createdAt: stamp() });
      return result;
    });
  }
  async function importStudentsByName(request) {
    const {workspaceId,subjectId,operationId}=request.data;
    const names=Array.isArray(request.data.names)?request.data.names.map(normalizeName):[];
    const validName=/^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*(?: (?:[2-9]|[1-9][0-9]+))?$/u;
    if(!names.length||names.length>300||names.some(name=>name.length>140||name.length<3||!validName.test(name)))fail('invalid-argument','Enter up to 300 student names; only a trailing duplicate number is allowed.');
    const workspace=db.collection('attendanceWorkspaces').doc(workspaceId),ref=workspace.collection('subjects').doc(subjectId);
    const receiptRef=workspace.collection('personalImportReceipts').doc(operationId);
    const fingerprint=sha(JSON.stringify({subjectId,names,nameOnly:true}));
    // Match the name QR equivalences so visually equivalent names cannot produce ambiguous cards.
    const nameKey=name=>normalizeName(name).replace(/\u0640/gu,'').replace(/\p{M}/gu,m=>/\p{Script_Extensions=Arabic}/u.test(m)?'':m).replace(/[\u0622\u0623\u0625\u0671]/gu,'ا').replace(/ة/gu,'ه').replace(/ /g,'').toLowerCase();
    const storageName=name=>normalizeName(name).replace(/\s+/gu,'').toUpperCase();
    return db.runTransaction(async tx=>{
      const [snap,receipt]=await Promise.all([tx.get(ref),tx.get(receiptRef)]);
      if(receipt.exists){if(receipt.data().fingerprint!==fingerprint)fail('already-exists','Import receipt belongs to another request.');return {...receipt.data().result,replayed:true};}
      if(!snap.exists)fail('not-found','Subject not found.');
      const subject=snap.data();
      if(subject.rosterOperationId||subject.attendanceClearInProgress)fail('failed-precondition','Roster recovery is in progress.');
      if(!safeId(subject.departmentId)||!safeId(subject.stageId))fail('failed-precondition','Choose a department and stage.');
      const cohortId=checked(()=>cohortIdForSubject(subject)),cohort=workspace.collection('cohorts').doc(cohortId);
      const [meta,central,local,department,stage]=await Promise.all([tx.get(cohort),tx.get(cohort.collection('students')),tx.get(ref.collection('students')),tx.get(workspace.collection('departments').doc(subject.departmentId)),tx.get(workspace.collection('stages').doc(subject.stageId))]);
      if(!department.exists||!stage.exists||stage.data().departmentId!==subject.departmentId)fail('failed-precondition','Department and stage must match.');
      if(meta.data()?.rosterOperationId)fail('failed-precondition','Roster recovery is in progress.');
      const centralSource=Boolean(subject.rosterCohortId||Number(meta.data()?.rosterVersion)>=1||central.docs.length||subject.lastRosterResetId);
      const embedded=!centralSource&&!local.docs.length&&Array.isArray(subject.students)&&subject.students.length>0;
      const source=centralSource||(!local.docs.length&&!embedded)?cohort:ref;
      const rows=source===cohort?central.docs.map(d=>({...d.data(),id:d.data().id||d.id})):embedded?subject.students:local.docs.map(d=>({...d.data(),id:d.data().id||d.id}));
      const registryRef=source.collection('nameReservations').doc('allocated');
      const registry=await tx.get(registryRef);
      const reserved=new Set(registry.data()?.names||[]),usedNames=new Set();
      for(const row of [...rows,...(subject.archivedStudents||[])]){if(row.id)reserved.add(storageName(row.id));if(row.name)usedNames.add(nameKey(row.name));}
      if(rows.length+(Number.isInteger(request.data.plannedNamesCount)?Math.max(names.length,request.data.plannedNamesCount):names.length)>700)fail('resource-exhausted','القائمة الناتجة تتجاوز 700 طالب.');
      const students=[];
      for(const supplied of names){
        const base=supplied.replace(/ (?:[2-9]|[1-9][0-9]+)$/u,'');
        let name=supplied,number=2;
        while(usedNames.has(nameKey(name))||reserved.has(storageName(name)))name=base+' '+number++;
        if(name.length>150)fail('invalid-argument','Student name is too long.');
        const id=storageName(name);
        if(!safeStudentId(id))fail('invalid-argument','Invalid student name.');
        reserved.add(id);usedNames.add(nameKey(name));students.push({id,name});
      }
      if(rows.length+students.length>700)fail('resource-exhausted','القائمة الناتجة تتجاوز 700 طالب.');
      if(Buffer.byteLength(JSON.stringify([...reserved]))>750000)fail('resource-exhausted','This roster has reached its name reservation capacity.');
      for(const student of students)if(!embedded)tx.create(source.collection('students').doc(student.id),{...student,createdAt:stamp(),createdBy:request.auth.uid,updatedAt:stamp()});
      tx.set(registryRef,{names:[...reserved],updatedAt:stamp()});
      const studentCount=rows.length+students.length;
      if(source===cohort)tx.set(cohort,{id:cohortId,rosterVersion:1,studentCount,updatedAt:stamp()},{merge:true});
      tx.update(ref,{studentCount,...(embedded?{students:[...rows,...students]}:{}),updatedAt:stamp()});
      const result={students,added:students.length,studentCount,...(source===cohort?{cohortId}:{})};
      tx.create(receiptRef,{fingerprint,result,subjectId,createdAt:stamp()});
      return result;
    });
  }
  async function setPersonalAcademicStatus(request) {
    const { workspaceId, subjectId, studentId, status } = request.data || {};
    await activeMember(request, workspaceId);
    if (!safeId(subjectId) || !safeStudentId(studentId) || !ACADEMIC_STATUSES.has(status)) fail("invalid-argument", "Invalid subject, student or academic status.");
    const workspace = db.collection("attendanceWorkspaces").doc(workspaceId), subjectRef = workspace.collection("subjects").doc(subjectId);
    await db.runTransaction(async tx => {
      const subject = await tx.get(subjectRef);
      if (!subject.exists || subject.data().rosterOperationId) fail("failed-precondition", "Subject is unavailable.");
      const saved = subject.data(), cohortRef = workspace.collection("cohorts").doc(cohortIdForSubject(saved));
      const [cohort, roster] = await Promise.all([tx.get(cohortRef), tx.get(cohortRef.collection("students"))]);
      if (cohort.data()?.rosterOperationId) fail("failed-precondition", "Roster recovery is in progress.");
      const idOf = row => String(row.id || row.studentId || "").trim();
      let exists = roster.docs.some(doc => idOf({ id: doc.id, ...doc.data() }) === studentId);
      // An authoritative cohort (even empty) and reset fences prevent stale
      // fallback. Attendance-only clearing does not remove the saved roster.
      if (!exists && !roster.docs.length && !(Number(cohort.data()?.rosterVersion) >= 1) && !saved.rosterCohortId && !saved.lastRosterResetId) {
        const oldRoster = await tx.get(subjectRef.collection("students"));
        exists = oldRoster.docs.length ? oldRoster.docs.some(doc => idOf({ id: doc.id, ...doc.data() }) === studentId)
          : Array.isArray(saved.students) && saved.students.some(row => idOf(row) === studentId);
      }
      if (!exists) fail("not-found", "Student is not in this subject's roster.");
      const statuses = { ...(subject.data().academicStatuses || {}) };
      if (status) statuses[studentId] = status; else delete statuses[studentId];
      tx.update(subjectRef, { academicStatuses: statuses, updatedAt: stamp() });
    });
    return { studentId, status };
  }
  async function updateLegacyEmbeddedRoster(request) {
    const { workspaceId, subjectId, updates = [], removedIds = [] } = request.data || {};
    await activeMember(request, workspaceId);
    if (!safeId(subjectId) || !Array.isArray(updates) || !Array.isArray(removedIds) ||
        updates.length + removedIds.length > 300 || updates.length + removedIds.length < 1 ||
        removedIds.some(id => !safeStudentId(id)) || new Set(removedIds).size !== removedIds.length) {
      fail("invalid-argument", "Provide between 1 and 300 existing student edits or removals.");
    }
    const patches = new Map(), removals = new Set(removedIds);
    for (const update of updates) {
      if (!update || !safeStudentId(update.studentId) || patches.has(update.studentId) || removals.has(update.studentId) ||
          Object.keys(update).some(key => !["studentId", "name", "faceDescriptor", "faceDescriptors", "faceDescriptorMap"].includes(key))) {
        fail("invalid-argument", "Invalid or repeated student edit; identifiers cannot be changed.");
      }
      const patch = {};
      if (Object.hasOwn(update, "name")) {
        const name = normalizeName(update.name);
        if (name.length < 3 || name.length > 150) fail("invalid-argument", "The student name must contain 3–150 characters.");
        patch.name = name;
      }
      if (["faceDescriptor", "faceDescriptors", "faceDescriptorMap"].some(key => Object.hasOwn(update, key))) {
        if (update.faceDescriptors != null && !Array.isArray(update.faceDescriptors)) fail("invalid-argument", "Invalid face templates.");
        if (update.faceDescriptorMap != null && (typeof update.faceDescriptorMap !== "object" || Array.isArray(update.faceDescriptorMap))) fail("invalid-argument", "Invalid face template map.");
        const values = [...(update.faceDescriptors || []), ...Object.values(update.faceDescriptorMap || {}), ...(update.faceDescriptor ? [update.faceDescriptor] : [])];
        if (values.length > 11 || values.some(vector => !Array.isArray(vector) || vector.length !== 128 || vector.some(value => typeof value !== "number" || !Number.isFinite(value)))) {
          fail("invalid-argument", "Face templates must contain finite 128-number vectors.");
        }
        const unique = [...new Map(values.map(vector => [JSON.stringify(vector), vector])).values()];
        if (unique.length > 5) fail("invalid-argument", "At most five face templates are supported.");
        patch.faceDescriptor = unique.at(-1) || null;
        patch.faceDescriptorMap = Object.fromEntries(unique.map((vector, index) => [`template_${String(index + 1).padStart(2, "0")}`, vector]));
        patch.faceTemplateCount = unique.length;
      }
      if (!Object.keys(patch).length) fail("invalid-argument", "No editable student fields were provided.");
      patches.set(update.studentId, patch);
    }
    const workspace = db.collection("attendanceWorkspaces").doc(workspaceId), subjectRef = workspace.collection("subjects").doc(subjectId);
    return db.runTransaction(async tx => {
      const subject = await tx.get(subjectRef), saved = subject.data();
      if (!subject.exists || !isLegacySubject(saved) || saved.rosterOperationId || saved.rosterCohortId || saved.lastRosterResetId) {
        fail("failed-precondition", "The saved subject does not use an editable legacy embedded roster.");
      }
      const cohortRef = workspace.collection("cohorts").doc(cohortIdForSubject(saved));
      const [cohort, central, oldRows] = await Promise.all([tx.get(cohortRef), tx.get(cohortRef.collection("students").limit(1)), tx.get(subjectRef.collection("students").limit(1))]);
      if (Number(cohort.data()?.rosterVersion) >= 1 || cohort.data()?.rosterOperationId || central.docs.length || oldRows.docs.length || !Array.isArray(saved.students)) {
        fail("failed-precondition", "The authoritative roster changed; reload it before editing.");
      }
      const known = new Set();
      for (const row of saved.students) {
        const id = String(row?.id || row?.studentId || "").trim();
        if (!safeStudentId(id) || known.has(id)) fail("failed-precondition", "Ambiguous saved student identifiers require review.");
        known.add(id);
      }
      if ([...patches.keys(), ...removals].some(id => !known.has(id))) fail("not-found", "The requested student no longer exists in this roster.");
      const students = saved.students.filter(row => !removals.has(String(row.id || row.studentId).trim())).map(row => {
        const patch = patches.get(String(row.id || row.studentId).trim());
        if (!patch) return row;
        const updated = { ...row, ...patch };
        // Firestore supports vectors in a map, not nested arrays-of-arrays.
        if (Object.hasOwn(patch, "faceDescriptorMap")) delete updated.faceDescriptors;
        return updated;
      });
      tx.update(subjectRef, { students, updatedAt: stamp() });
      return { updated: patches.size, removed: removals.size };
    });
  }
  const sharedStudentRoster=require('./shared-rosters')({db,fail,stamp,activeMember,ownerIdentity,cohortIdForSubject,departmentIds:[...Object.keys(DEPARTMENT_PREFIXES),"electronics_smartphones"]});
  const accountPresence = require("./account-presence")({db,approvedIdentity,ownerIdentity,fail});
  return { accountPresence, sharedStudentRoster, identity, approvedIdentity, activeMember, submitPersonalRegistration, getPersonalAccountStatus,
    listPersonalRegistrations, approvePersonalAccount, openIndividualWorkspace, configureLegacySubjectScope,
    importPersonalStudents, setPersonalAcademicStatus, updateLegacyEmbeddedRoster };
}

module.exports = { OWNER_UID, OWNER_EMAIL, DEPARTMENT_PREFIXES, LEGACY_DEPARTMENT_PREFIXES, ACADEMIC_STATUSES, isPlatformOwner, normalizeName,
  registrationName, importNames, resolveDepartmentPrefix, validateCohort, isLegacySubject, cohortIdForSubject, createPersonalService };
