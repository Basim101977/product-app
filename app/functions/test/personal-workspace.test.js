"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { OWNER_UID, OWNER_EMAIL, DEPARTMENT_PREFIXES, LEGACY_DEPARTMENT_PREFIXES, resolveDepartmentPrefix, isPlatformOwner, registrationName, importNames, validateCohort,
  cohortIdForSubject, createPersonalService } = require("../personal-workspace");

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const clone = value => value == null ? value : structuredClone(value);
function fakeFirestore(seed = {}) {
  const records = new Map(Object.entries(seed).map(([key, value]) => [key, clone(value)]));
  const snapshot = ref => ({ id: ref.id, ref, exists: records.has(ref.path), data: () => clone(records.get(ref.path)) });
  const doc = path => ({ path, id: path.split("/").at(-1), collection: name => collection(path + "/" + name), get: async () => snapshot(doc(path)) });
  const collection = (path, filters = []) => ({ path, doc: id => doc(path + "/" + id), orderBy() { return this; }, limit() { return this; },
    where(field, operator, value) { assert.equal(operator, "=="); return collection(path, [...filters, [field, value]]); },
    get: async () => { const docs = [...records.keys()].filter(key => key.startsWith(path + "/") && key.split("/").length === path.split("/").length + 1 &&
      filters.every(([field, value]) => records.get(key)[field] === value)).map(key => snapshot(doc(key))); return { docs, empty: !docs.length }; } });
  let tail = Promise.resolve();
  const db = { collection, records, async runTransaction(callback) {
    const run = tail.then(async () => {
      const writes = [];
      const tx = { get: async ref => { assert.equal(writes.length, 0, "transaction reads must precede writes"); return ref.get(); },
        create: (ref, data) => writes.push({ kind: "create", ref, data }), update: (ref, data) => writes.push({ kind: "update", ref, data }),
        set: (ref, data, options) => writes.push({ kind: options?.merge ? "update" : "set", ref, data }) };
      const result = await callback(tx);
      for (const { kind, ref } of writes) if (kind === "create") assert.equal(records.has(ref.path), false, "create cannot overwrite a reserved identifier");
      for (const { kind, ref, data } of writes) records.set(ref.path, clone(kind === "update" ? { ...records.get(ref.path), ...data } : data));
      return result;
    });
    tail = run.catch(() => {}); return run;
  } };
  return db;
}
const profile = { firstName: "عبد الرحمن", fatherName: "علي", grandfatherName: "حسن" };

test('account response confirms only an approved matching active workspace pointer', async()=>{
  for(const pointer of [{workspaceId:'teacher_a',active:true},{workspaceId:'teacher_b',active:true},{workspaceId:'teacher_a',active:false},null]){
    const f=fixture();if(pointer)f.db.records.set('attendanceUserWorkspaces/teacher_a',pointer);
    const state=await f.service.getPersonalAccountStatus(f.request());
    assert.equal(state.workspaceReady,!!pointer&&pointer.workspaceId==='teacher_a'&&pointer.active!==false);
  }
});
test('unverified or pending account never reads a private pointer for startup optimization',async()=>{
  for(const options of [{verified:false},{approved:false}]){
    const f=fixture(options),collection=f.db.collection;
    f.db.collection=name=>{assert.notEqual(name,'attendanceUserWorkspaces');return collection(name);};
    assert.equal((await f.service.getPersonalAccountStatus(f.request())).workspaceReady,false);
  }
});
const uid = "teacher_a";
const subject = { id: "subject_a", ownerUserId: uid, departmentId: "medical_devices", stageId: "stage_2",
  academicYearStart: 2026, stageNumber: 2, departmentPrefix: "MD" };
const subjectPath = (id = "subject_a", user = uid) => `attendanceWorkspaces/${user}/subjects/${id}`;
function fixture({ verified = true, approved = true } = {}) {
  const users = new Map([
    [uid, { uid, email: "teacher@example.test", emailVerified: verified, disabled: false }],
    ["teacher_b", { uid: "teacher_b", email: "second@example.test", emailVerified: true }],
    [OWNER_UID, { uid: OWNER_UID, email: OWNER_EMAIL, emailVerified: true }]
  ]);
  const db = fakeFirestore({
    [`attendanceIndividualRequests/${uid}`]: { uid, email: users.get(uid).email, ...registrationName(profile), status: approved ? "approved" : "pending" },
    [`attendanceWorkspaces/${uid}`]: { ownerUid: uid, primaryOwnerUid: uid },
    [`attendanceWorkspaces/${uid}/members/${uid}`]: { uid, active: true, role: "teacher", permissions: {} },
    [`attendanceWorkspaces/${uid}/departments/medical_devices`]: { id: "medical_devices", codePrefix: "MD" },
    [`attendanceWorkspaces/${uid}/stages/stage_2`]: { departmentId: "medical_devices", sort: 2 },
    [subjectPath()]: subject,
    [subjectPath("subject_b")]: { ...subject, id: "subject_b" }
  });
  const auth = { deleteUser:async id=>{users.delete(id);}, getUser: async id => { if (!users.has(id)) throw Object.assign(new Error("User missing"),{code:"auth/user-not-found"}); return clone(users.get(id)); } };
  const service = createPersonalService({ db, auth, HttpsError, FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } });
  const request = (data = {}, user = uid, tokenVerified = users.get(user)?.emailVerified) => ({ auth: { uid: user, token: { email: users.get(user)?.email?.toLowerCase(), email_verified: tokenVerified } }, data });
  const runImport = (names, operationId = "operation_123456789", extra = {}) => service.importPersonalStudents(request({ workspaceId: uid, subjectId: "subject_a", names, operationId, ...extra }));
  return { db, users, auth, service, request, runImport };
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test('700 name import uses retry-safe 300/300/100 batches and rejects an oversized planned roster before writing',async()=>{
 const f=fixture(),names=Array.from({length:700},(_,i)=>'طالب تجريبي '+(i+2));
 f.db.records.set(subjectPath(),{...subject,rosterNaming:'name'});
 const before=structuredClone([...f.db.records]);
 await rejectsCode(f.runImport(names.slice(0,300),'operation_large_bad',{nameOnly:true,plannedNamesCount:701}),'resource-exhausted');assert.deepEqual([...f.db.records],before);
 for(let i=0;i<700;i+=300)await f.runImport(names.slice(i,i+300),'operation_large_'+i,{nameOnly:true,plannedNamesCount:700-i});
 const saved=structuredClone([...f.db.records]);
 await f.runImport(names.slice(0,300),'operation_large_0',{nameOnly:true,plannedNamesCount:700});assert.deepEqual([...f.db.records],saved);
 await rejectsCode(f.runImport(['اسم اضافي جديد'],'operation_large_extra',{nameOnly:true}),'resource-exhausted');assert.deepEqual([...f.db.records],saved);
 assert.equal(f.db.records.get(subjectPath()).studentCount,700);
});

test('Name-based imports need no year, allocate numbered names and replay receipts without duplicates',async()=>{
  const f=fixture(),root=`attendanceWorkspaces/${uid}`;
  const saved={id:'subject_a',ownerUserId:uid,departmentId:'medical_devices',stageId:'stage_2',rosterNaming:'name'};
  f.db.records.set(subjectPath(),saved);
  const result=await f.runImport(['أحمد علي','أحمد علي','احمد علي'],undefined,{nameOnly:true});
  assert.deepEqual(result.students.map(s=>s.name),['أحمد علي','أحمد علي 2','احمد علي 3']);
  assert.deepEqual(result.students.map(s=>s.id),['أحمدعلي','أحمدعلي2','احمدعلي3']);
  assert.equal((await f.runImport(['أحمد علي','أحمد علي','احمد علي'],undefined,{nameOnly:true})).replayed,true);
  assert(![...f.db.records.keys()].some(key=>key.includes('/personalStudentSequences/')));
  assert.equal(f.db.records.get(subjectPath()).academicYearStart,undefined);
  const Q=require('../../netlify_site/name-qr.js');
  for(const student of result.students)assert.equal(Q.match(Q.encode(student.name),result.students.map(student=>({subject:saved,student}))).student.id,student.id);
  assert(result.cohortId.startsWith('cohort_names_'));
});
test('A later name import numbers a duplicate and never reuses a deleted name key',async()=>{
  const f=fixture();
  const first=await f.runImport(['أحمد علي'],undefined,{nameOnly:true});
  f.db.records.delete(`attendanceWorkspaces/${uid}/cohorts/${first.cohortId}/students/${first.students[0].id}`);
  const second=await f.runImport(['أحمد علي'],'another_import_123456',{nameOnly:true});
  assert.equal(second.students[0].name,'أحمد علي 2');
});
test('Name imports preserve existing shared, embedded and subcollection storage and old attendance',async()=>{
  for(const storage of ['shared','embedded','subcollection']){
    const f=fixture(),legacy={id:'subject_a',ownerUserId:uid,departmentId:'medical_devices',stageId:'stage_2'};
    const old={id:'OLD-7',name:'أحمد علي'},oldLecture=subjectPath()+'/lectures/2026-09-01';
    f.db.records.set(subjectPath(),{...legacy,...(storage==='embedded'?{students:[old]}:{})});
    const root=`attendanceWorkspaces/${uid}/cohorts/${cohortIdForSubject(legacy)}`;
    if(storage==='shared'){f.db.records.set(root,{rosterVersion:1});f.db.records.set(root+'/students/OLD-7',old);}
    if(storage==='subcollection')f.db.records.set(subjectPath()+'/students/old_doc',old);
    f.db.records.set(oldLecture,{status:'completed',attendance:{'OLD-7':true}});
    const result=await f.runImport(['أحمد علي'],undefined,{nameOnly:true});
    assert.equal(result.students[0].name,'أحمد علي 2');
    assert.equal(f.db.records.get(subjectPath()).academicYearStart,undefined);
    assert.deepEqual(f.db.records.get(oldLecture),{status:'completed',attendance:{'OLD-7':true}});
    if(storage==='embedded')assert.deepEqual(f.db.records.get(subjectPath()).students[0],old);
    if(storage==='subcollection'){assert.deepEqual(f.db.records.get(subjectPath()+'/students/old_doc'),old);assert(!f.db.records.has(root));}
  }
});
test('Concurrent name imports reserve separate names; foreign workspace and reused mismatching receipts fail',async()=>{
  const f=fixture();
  const results=await Promise.all([f.runImport(['أحمد علي'],'concurrent_name_1234',{nameOnly:true}),f.runImport(['أحمد علي'],'concurrent_name_5678',{nameOnly:true})]);
  assert.equal(new Set(results.flatMap(r=>r.students.map(s=>s.id))).size,2);
  await rejectsCode(f.runImport(['اسم مختلف'],'concurrent_name_1234',{nameOnly:true}),'already-exists');
  await rejectsCode(f.runImport(['أحمد علي'],'foreign_name_123456',{nameOnly:true,workspaceId:'teacher_b'}),'permission-denied');
});
test('Name-based cohorts share only department, stage and section within each private workspace',()=>{
  const a={departmentId:'d',stageId:'s',rosterNaming:'name'};
  assert.equal(cohortIdForSubject(a),cohortIdForSubject({...a,id:'another'}));
  assert.notEqual(cohortIdForSubject(a),cohortIdForSubject({...a,section:'B'}));
  assert.notEqual(cohortIdForSubject(a),cohortIdForSubject({...a,stageId:'other'}));
  assert.equal(cohortIdForSubject({...a,rosterCohortId:'personal_saved_2026'}),'personal_saved_2026');
});

test("three name fields support compound names, reject titles, punctuation, digits and missing parts", () => {
  assert.equal(registrationName(profile).fullName, "عبد الرحمن علي حسن");
  for (const firstName of ["دكتور أحمد", "Dr Ahmed", "Ahmad1", "أحمد!", "", "1محمد"]) assert.throws(() => registrationName({ ...profile, firstName }));
  assert.throws(() => registrationName({ firstName: "علي", fatherName: "حسن" }));
});
test("owner authority requires matching UID plus email plus verification", () => {
  assert.equal(isPlatformOwner({ uid: OWNER_UID, email: OWNER_EMAIL, emailVerified: true }), true);
  for (const user of [{ uid, email: OWNER_EMAIL, emailVerified: true }, { uid: OWNER_UID, email: "wrong@example.test", emailVerified: true }, { uid: OWNER_UID, email: OWNER_EMAIL, emailVerified: false }]) assert.equal(isPlatformOwner(user), false);
});
test("names-only import validation rejects codes and confirms duplicate names", () => {
  assert.deepEqual(importNames(["  أحمد   علي "], false), ["أحمد علي"]);
  assert.throws(() => importNames(["أحمد علي,MD20250001"], false));
  assert.throws(() => importNames(["أحمد علي", "أحمد علي"], false));
  assert.equal(importNames(["أحمد علي", "أحمد علي"], true).length, 2);
});
test("cohort and entry year derive from saved department, stage and academic year", () => {
  const scope = validateCohort(subject, { codePrefix: "MD" }, { departmentId: "medical_devices", sort: 2 });
  assert.equal(scope.entryYear, 2025); assert.equal(scope.cohortId, "personal_2026_medical_devices_2"); assert.equal(scope.departmentPrefix, "MI");
  assert.notEqual(cohortIdForSubject(subject), cohortIdForSubject({ ...subject, academicYearStart: 2027 }));
  assert.throws(() => validateCohort({ ...subject, stageNumber: 1 }, { codePrefix: "MD" }, { departmentId: "medical_devices", sort: 2 }));
  assert.throws(() => validateCohort({ ...subject, departmentPrefix: "XX" }, { codePrefix: "MD" }, { departmentId: "medical_devices", sort: 2 }));
});

test("all fifteen built-in departments resolve to the exact canonical prefixes", () => {
  const expected = { medical_labs: "MLT", community_health: "CHT", nursing: "NT", pharmacy: "PT", forensic_evidence: "FET",
    accounting: "AT", materials_management: "MMT", legal_administration: "LAT", computer_networks_software: "CNS",
    electronic_techniques: "ELC", power_mechanics: "PMT", civil_techniques: "CT", mechanical_techniques: "MT",
    surveying_techniques: "ST", medical_devices: "MI" };
  assert.deepEqual(DEPARTMENT_PREFIXES, expected);
  for (const [departmentId, canonical] of Object.entries(expected)) {
    assert.equal(resolveDepartmentPrefix(departmentId, {}), canonical);
    assert.equal(resolveDepartmentPrefix(departmentId, { codePrefix: LEGACY_DEPARTMENT_PREFIXES[departmentId] }), canonical);
    assert.equal(resolveDepartmentPrefix(departmentId, { codePrefix: LEGACY_DEPARTMENT_PREFIXES[departmentId], codePrefixLocked: true }), LEGACY_DEPARTMENT_PREFIXES[departmentId]);
    const oldSubject = { ...subject, departmentId, departmentPrefix: LEGACY_DEPARTMENT_PREFIXES[departmentId] };
    assert.equal(validateCohort(oldSubject, { codePrefix: LEGACY_DEPARTMENT_PREFIXES[departmentId] }, { departmentId, sort: 2 }).departmentPrefix, canonical);
  }
});

test("locked and evidence-backed legacy prefixes remain fixed; custom prefixes retain exact-match validation", () => {
  const stage = { departmentId: "medical_devices", sort: 2 };
  assert.equal(validateCohort(subject, { codePrefix: "MD", codePrefixLocked: true }, stage).departmentPrefix, "MD");
  assert.equal(validateCohort(subject, { codePrefix: "MD" }, stage, ["MD"]).departmentPrefix, "MD");
  assert.equal(resolveDepartmentPrefix("medical_devices", { codePrefix: "MI" }, { ...subject, personalScopeLocked: true }), "MD");
  assert.throws(() => validateCohort({ ...subject, departmentPrefix: "MI" }, { codePrefix: "MD", codePrefixLocked: true }, stage));
  assert.throws(() => resolveDepartmentPrefix("medical_devices", { codePrefix: "MI", codePrefixLocked: true }, {}, ["MD"]));
  assert.throws(() => resolveDepartmentPrefix("medical_devices", {}, {}, [""]));
  assert.equal(resolveDepartmentPrefix("custom_department", { codePrefix: "XYZ" }), "XYZ");
  assert.throws(() => validateCohort({ ...subject, departmentId: "custom_department", departmentPrefix: "ABC" }, { codePrefix: "XYZ" }, { departmentId: "custom_department", sort: 2 }));
});
test("unverified, stale verification token, unapproved and cross-workspace requests cannot access data", async () => {
  for (const options of [{ verified: false }, { approved: false }]) { const f = fixture(options); await rejectsCode(f.runImport(["أحمد علي"]), "permission-denied"); }
  const f = fixture();
  await rejectsCode(f.service.activeMember(f.request({}, uid, false), uid), "permission-denied");
  await rejectsCode(f.service.activeMember(f.request({}, "teacher_b"), uid), "permission-denied");
  await rejectsCode(f.service.activeMember(f.request({}, OWNER_UID), uid), "permission-denied");
  f.users.get(uid).email = "changed@example.test";
  await rejectsCode(f.runImport(["أحمد علي"]), "permission-denied");
});
test("registration is pending, idempotent and never self-approves", async () => {
  const f = fixture({ verified: false }); f.db.records.delete(`attendanceIndividualRequests/${uid}`);
  const a = await f.service.submitPersonalRegistration(f.request({ ...profile, status: "approved" }));
  assert.equal(a.status, "pending");
  const b = await f.service.submitPersonalRegistration(f.request({ ...profile, firstName: "مصطفى" }));
  assert.equal(a.fullName, b.fullName); assert.equal(b.status, "pending");
  await rejectsCode(f.service.openIndividualWorkspace(f.request()), "permission-denied");
});
test("owner approves only verified registered email; teacher cannot approve", async () => {
  const f = fixture({ verified: false, approved: false });
  await rejectsCode(f.service.approvePersonalAccount(f.request({ uid, status: "approved" }, OWNER_UID)), "failed-precondition");
  f.users.get(uid).emailVerified = true;
  await rejectsCode(f.service.approvePersonalAccount(f.request({ uid, status: "approved" })), "permission-denied");
  assert.equal((await f.service.approvePersonalAccount(f.request({ uid, status: "approved" }, OWNER_UID))).status, "approved");
  assert.equal((await f.service.getPersonalAccountStatus(f.request())).status, "approved");
});
test("workspace open is fixed to UID, preserves data, and personal owner rights ignore old granular roles", async () => {
  const f = fixture();
  await f.service.openIndividualWorkspace(f.request({ workspaceId: "teacher_b" }));
  assert.deepEqual(f.db.records.get(subjectPath()), subject);
  assert.equal((await f.service.activeMember(f.request(), uid)).role, "owner");
  assert.equal(f.db.records.has("attendanceWorkspaces/teacher_b"), false);
});
test("import reserves sequential codes once and binds operation IDs to payloads", async () => {
  const f = fixture(); const a = await f.runImport(["أحمد علي", "حسن محمد"]);
  assert.deepEqual(a.students.map(row => row.id), ["MI20250001", "MI20250002"]);
  assert.equal(a.departmentPrefix, "MI"); assert.equal(f.db.records.get(subjectPath()).departmentPrefix, "MI");
  const b = await f.runImport(["أحمد علي", "حسن محمد"]);
  assert.equal(b.replayed, true); assert.deepEqual(a.students, b.students);
  await rejectsCode(f.runImport(["محمود حسن"]), "already-exists");
  assert.equal(f.db.records.get(`attendanceWorkspaces/${uid}/personalStudentSequences/MI2025`).lastSequence, 2);
  assert.equal(f.db.records.get(`attendanceWorkspaces/${uid}/departments/medical_devices`).codePrefixLocked, true);
});
test("parallel imports are disjoint and the same names reuse codes across subjects", async () => {
  const f = fixture();
  const results = await Promise.all([f.runImport(["أحمد علي"], "operation_parallel_a"), f.runImport(["حسن محمد"], "operation_parallel_b")]);
  assert.equal(new Set(results.flatMap(result => result.students.map(row => row.id))).size, 2);
  const other = await f.runImport(["أحمد علي"], "operation_subject_b", { subjectId: "subject_b" });
  assert.equal(other.students[0].id, results[0].students[0].id); assert.equal(other.added, 0);
  assert.equal(other.departmentPrefix, "MI"); assert.equal(f.db.records.get(subjectPath("subject_b")).departmentPrefix, "MI");
});

test("legacy locked import preserves issued IDs, counters, lecture marks and old receipt replay", async () => {
  const f = fixture(), root = `attendanceWorkspaces/${uid}`, cohortId = cohortIdForSubject(subject);
  f.db.records.get(root + "/departments/medical_devices").codePrefixLocked = true;
  f.db.records.get(subjectPath()).personalScopeLocked = true;
  const existing = { id: "MD20250007", name: "أحمد علي", departmentPrefix: "MD", entryYear: 2025, sequence: 7 };
  f.db.records.set(`${root}/cohorts/${cohortId}`, { departmentPrefix: "MD", studentCount: 1, rosterVersion: 1 });
  f.db.records.set(`${root}/cohorts/${cohortId}/students/${existing.id}`, existing);
  f.db.records.set(root + "/personalStudentSequences/MD2025", { departmentId: "medical_devices", entryYear: 2025, lastSequence: 7 });
  const markPath = subjectPath() + "/lectures/2026-09-22/marks/MD20250007";
  f.db.records.set(markPath, { studentId: existing.id, attendedMinutes: 120 });
  const beforeStudent = clone(existing), beforeMark = clone(f.db.records.get(markPath));
  const result = await f.runImport(["أحمد علي", "حسن محمد"]);
  assert.deepEqual(result.students.map(row => row.id), ["MD20250007", "MD20250008"]);
  assert.equal(result.departmentPrefix, "MD"); assert.equal(f.db.records.has(root + "/personalStudentSequences/MI2025"), false);
  assert.deepEqual(f.db.records.get(`${root}/cohorts/${cohortId}/students/${existing.id}`), beforeStudent);
  assert.deepEqual(f.db.records.get(markPath), beforeMark);
  const receipt = f.db.records.get(root + "/personalImportReceipts/operation_123456789");
  delete receipt.result.departmentPrefix; // A receipt created before this release.
  const replay = await f.runImport(["أحمد علي", "حسن محمد"]);
  assert.equal(replay.replayed, true); assert.equal(replay.departmentPrefix, undefined); assert.deepEqual(replay.students, result.students);
});

test("allocation evidence protects a legacy namespace even when department and subject locks are missing", async () => {
  const f = fixture(), root = `attendanceWorkspaces/${uid}`;
  // Another entry year still fixes the department namespace, even with no
  // current cohort students (including after a roster was deleted).
  f.db.records.set(root + "/personalStudentSequences/MD2024", { departmentId: "medical_devices", entryYear: 2024, lastSequence: 12 });
  const result = await f.runImport(["أحمد علي"]);
  assert.equal(result.students[0].id, "MD20250001"); assert.equal(result.departmentPrefix, "MD");
  assert.equal(f.db.records.get(root + "/departments/medical_devices").codePrefix, "MD");
  assert.equal(f.db.records.get(root + "/personalStudentSequences/MD2024").lastSequence, 12);
  const unsafe = fixture();
  unsafe.db.records.set(root + "/personalStudentSequences/MD2024", { departmentId: "medical_devices", lastSequence: 2 });
  unsafe.db.records.set(root + "/personalStudentSequences/MI2025", { departmentId: "medical_devices", lastSequence: 1 });
  const before = clone([...unsafe.db.records]);
  await rejectsCode(unsafe.runImport(["أحمد علي"]), "failed-precondition");
  assert.deepEqual([...unsafe.db.records], before);
});

test("restored cohort student IDs also preserve their legacy namespace without prefix metadata or lock flags", async () => {
  const f = fixture(), root = `attendanceWorkspaces/${uid}`, cohortId = "private_" + "b".repeat(40);
  f.db.records.get(subjectPath()).rosterCohortId = cohortId;
  f.db.records.set(`${root}/cohorts/${cohortId}`, { rosterVersion: 1, studentCount: 1 });
  f.db.records.set(`${root}/cohorts/${cohortId}/students/MD20250004`, { id: "MD20250004", name: "أحمد علي" });
  f.db.records.set(root + "/personalStudentSequences/MD2025", { departmentId: "medical_devices", entryYear: 2025, lastSequence: 4 });
  const result = await f.runImport(["أحمد علي", "حسن محمد"]);
  assert.deepEqual(result.students.map(row => row.id), ["MD20250004", "MD20250005"]);
  assert.equal(result.departmentPrefix, "MD"); assert.equal(result.cohortId, cohortId);
});

test("canonical imports cannot take another department's prefix counter or reuse unowned reservations", async () => {
  const root = `attendanceWorkspaces/${uid}`;
  for (const reserved of [
    { departmentId: "custom_department", entryYear: 2025, lastSequence: 12 },
    { departmentId: "custom_department", entryYear: 2025, lastSequence: 0 },
    { entryYear: 2025, lastSequence: 12 }
  ]) {
    const f = fixture();
    f.db.records.set(root + "/personalStudentSequences/MI2025", reserved);
    const before = clone([...f.db.records]);
    await rejectsCode(f.runImport(["أحمد علي"]), "failed-precondition");
    assert.deepEqual([...f.db.records], before);
  }
});

test("missing counters never restart an issued namespace from zero", async () => {
  const f = fixture();
  await f.runImport(["أحمد علي"]);
  f.db.records.delete(`attendanceWorkspaces/${uid}/personalStudentSequences/MI2025`);
  const before = clone([...f.db.records]);
  await rejectsCode(f.runImport(["حسن محمد"], "operation_counter_missing"), "failed-precondition");
  assert.deepEqual([...f.db.records], before);
});
test("explicit duplicate names receive distinct codes; retries preserve both", async () => {
  const f = fixture(); const result = await f.runImport(["أحمد علي", "أحمد علي"], "operation_duplicates", { allowDuplicateNames: true });
  assert.equal(new Set(result.students.map(row => row.id)).size, 2);
  const second = await f.runImport(["أحمد علي", "أحمد علي"], "operation_second_copy", { allowDuplicateNames: true, subjectId: "subject_b" });
  assert.deepEqual(result.students, second.students);
});
test("student deletion never reuses sequence codes and exhausted counter aborts atomically", async () => {
  const f = fixture(); const result = await f.runImport(["أحمد علي"]);
  f.db.records.delete(`attendanceWorkspaces/${uid}/cohorts/${result.cohortId}/students/MI20250001`);
  const next = await f.runImport(["أحمد علي"], "operation_after_delete"); assert.equal(next.students[0].id, "MI20250002");
  f.db.records.set(`attendanceWorkspaces/${uid}/personalStudentSequences/MI2025`, { departmentId: "medical_devices", entryYear: 2025, lastSequence: 9999 });
  const count = f.db.records.size;
  await rejectsCode(f.runImport(["مصطفى حسن"], "operation_exhausted"), "resource-exhausted"); assert.equal(f.db.records.size, count);
});
test("academic status accepts crossing, preserves legacy values and remains independent per subject", async () => {
  const f = fixture(), result = await f.runImport(["أحمد علي"]), studentId = result.students[0].id;
  const set = (id, status) => f.service.setPersonalAcademicStatus(f.request({ workspaceId: uid, subjectId: id, studentId, status }));
  await set("subject_a", "عبور"); assert.equal(f.db.records.get(subjectPath()).academicStatuses[studentId], "عبور");
  await set("subject_a", "مستوفي"); await set("subject_b", "محمل");
  assert.equal(f.db.records.get(subjectPath()).academicStatuses[studentId], "مستوفي");
  assert.equal(f.db.records.get(subjectPath("subject_b")).academicStatuses[studentId], "محمل");
  await rejectsCode(set("subject_a", "unapproved"), "invalid-argument");
  await set("subject_a", ""); assert.deepEqual(f.db.records.get(subjectPath()).academicStatuses, {});
  assert.equal(f.db.records.get(subjectPath("subject_b")).academicStatuses[studentId], "محمل");
});
test("private reset cohorts remain isolated and import/read/status honor reset locks", async () => {
  const f = fixture(); const reset = "private_" + "a".repeat(40);
  f.db.records.set(subjectPath(), { ...subject, rosterCohortId: reset });
  // clearSubjectRoster intentionally creates an empty private cohort without
  // departmentPrefix; that is not evidence of an unknown issued namespace.
  f.db.records.set(`attendanceWorkspaces/${uid}/cohorts/${reset}`, { rosterVersion: 1, studentCount: 0 });
  const result = await f.runImport(["أحمد علي"]); assert.equal(result.cohortId, reset);
  await rejectsCode(f.service.setPersonalAcademicStatus(f.request({ workspaceId: uid, subjectId: "subject_b", studentId: result.students[0].id, status: "محمل" })), "not-found");
  f.db.records.get(subjectPath()).rosterOperationId = "pending-reset";
  await rejectsCode(f.runImport(["حسن محمد"], "operation_reset_locked"), "failed-precondition");
});

function grandfather(f, id = uid, overrides = {}) {
  f.db.records.set(`attendanceLegacyAccess/${id}`, { uid: id, email: f.users.get(id).email.toLowerCase(), approvedAtCutover: true,
    cutoverAt: "2026-09-22T00:00:00Z", ...overrides });
}
function legacySubjectFixture(f, extras = {}) {
  const value = { id: "subject_a", ownerUserId: uid, departmentId: "medical_devices", stageId: "stage_2", ...extras };
  f.db.records.set(subjectPath(), value); return value;
}

test("frozen approved legacy users retain access without changing honest email verification", async () => {
  const f = fixture({ verified: false }); grandfather(f);
  const beforeUser = clone(f.users.get(uid));
  const state = await f.service.getPersonalAccountStatus(f.request());
  assert.equal(state.emailVerified, false); assert.equal(state.emailVerificationRequired, false); assert.equal(state.status, "approved");
  assert.equal(state.isPlatformOwner, false);
  await f.service.openIndividualWorkspace(f.request());
  assert.equal((await f.service.activeMember(f.request(), uid)).uid, uid);
  assert.deepEqual(f.users.get(uid), beforeUser);
});

test("legacy exemption requires exact frozen UID/email marker and current approved matching registration", async () => {
  for (const mutate of [
    f => f.db.records.delete(`attendanceLegacyAccess/${uid}`),
    f => { f.db.records.get(`attendanceLegacyAccess/${uid}`).uid = "teacher_b"; },
    f => { f.db.records.get(`attendanceLegacyAccess/${uid}`).email = "changed@example.test"; },
    f => { f.db.records.get(`attendanceLegacyAccess/${uid}`).approvedAtCutover = false; },
    f => { f.db.records.get(`attendanceLegacyAccess/${uid}`).platformOwner = true; },
    f => { f.db.records.get(`attendanceIndividualRequests/${uid}`).status = "rejected"; },
    f => { f.db.records.get(`attendanceIndividualRequests/${uid}`).email = "changed@example.test"; },
    f => { f.users.get(uid).email = "changed@example.test"; },
    f => { f.users.get(uid).disabled = true; }
  ]) {
    const f = fixture({ verified: false }); grandfather(f); mutate(f);
    await rejectsCode(f.service.openIndividualWorkspace(f.request()), "permission-denied");
  }
  const f = fixture({ verified: false }); grandfather(f);
  const stale = f.request(); stale.auth.token.email = "stale@example.test";
  await rejectsCode(f.service.activeMember(stale, uid), "permission-denied");
});

test("new, unlisted approved and listed-but-pending accounts still require verification", async () => {
  for (const options of [{ verified: false }, { verified: false, approved: false }]) {
    const f = fixture(options); if (!options.approved) grandfather(f);
    if (options.approved !== false) f.db.records.delete(`attendanceLegacyAccess/${uid}`);
    const state = await f.service.getPersonalAccountStatus(f.request());
    assert.equal(state.emailVerificationRequired, true);
    await rejectsCode(f.service.activeMember(f.request(), uid), "permission-denied");
  }
});

test("existing unverified pinned owner requires explicit frozen owner evidence, never email-only authority", async () => {
  const f = fixture(); f.users.get(OWNER_UID).emailVerified = false;
  await rejectsCode(f.service.listPersonalRegistrations(f.request({}, OWNER_UID)), "permission-denied");
  grandfather(f, OWNER_UID);
  await rejectsCode(f.service.listPersonalRegistrations(f.request({}, OWNER_UID)), "permission-denied");
  grandfather(f, OWNER_UID, { platformOwner: true });
  const state = await f.service.getPersonalAccountStatus(f.request({}, OWNER_UID));
  assert.equal(state.isPlatformOwner, true); assert.equal(state.emailVerified, false); assert.equal(state.emailVerificationRequired, false);
  assert.equal(state.status, "approved"); await f.service.listPersonalRegistrations(f.request({}, OWNER_UID));
  f.users.get(uid).email = OWNER_EMAIL; grandfather(f, uid, { platformOwner: true });
  assert.equal((await f.service.getPersonalAccountStatus(f.request())).isPlatformOwner, false);
  await rejectsCode(f.service.listPersonalRegistrations(f.request()), "permission-denied");
  f.users.get(OWNER_UID).disabled = true;
  await rejectsCode(f.service.listPersonalRegistrations(f.request({}, OWNER_UID)), "permission-denied");
});

test("missing or conflicting workspace ownership is never silently repaired", async () => {
  for (const patch of [{ primaryOwnerUid: undefined }, { ownerUid: "other" }, { primaryOwnerUid: "other" }]) {
    const f = fixture({ verified: false }); grandfather(f);
    Object.assign(f.db.records.get(`attendanceWorkspaces/${uid}`), patch);
    const before = clone([...f.db.records]);
    await rejectsCode(f.service.openIndividualWorkspace(f.request()), "failed-precondition");
    assert.deepEqual([...f.db.records], before);
  }
});

test("legacy cohort locations remain separate by saved stage and section without invented years", () => {
  const old = { departmentId: "medical_devices", stageId: "stage_2" };
  assert.equal(cohortIdForSubject(old), "cohort_medical_devices__stage_2");
  assert.equal(cohortIdForSubject({ ...old, section: "B" }), "cohort_medical_devices__stage_2__B");
  assert.notEqual(cohortIdForSubject(old), cohortIdForSubject({ ...old, stageId: "stage_1" }));
  assert.equal(cohortIdForSubject({ ...subject, rosterSchemaVersion: 1 }), "cohort_medical_devices__stage_2");
  for (const rosterCohortId of ["cohort_preserved__old", "personal_2025_preserved_1", "private_" + "a".repeat(40)]) {
    assert.equal(cohortIdForSubject({ ...old, rosterCohortId }), rosterCohortId);
  }
  assert.throws(() => cohortIdForSubject({ ...old, academicYearStart: 2026 }), /Incomplete/);
});

test("legacy import without reviewed scope fails without changing IDs, roster, history or counters", async () => {
  const f = fixture(); legacySubjectFixture(f, { students: [{ id: "OLD-7", name: "أحمد علي" }], attendance: { "2026-09-20": { "OLD-7": { at: 100 } } } });
  const before = clone([...f.db.records]);
  await rejectsCode(f.runImport(["حسن محمد"]), "failed-precondition");
  assert.deepEqual([...f.db.records], before);
});

test("academic status resolves authoritative old cohort, old subcollection and embedded roster without migration", async () => {
  for (const source of ["cohort", "subcollection", "embedded"]) {
    const f = fixture(); legacySubjectFixture(f, { attendanceClearedAt: "prior-attendance-only-clear" });
    const row = { id: "OLD-7", name: "أحمد علي" };
    if (source === "cohort") f.db.records.set(`attendanceWorkspaces/${uid}/cohorts/cohort_medical_devices__stage_2/students/legacy_doc`, row);
    if (source === "subcollection") f.db.records.set(subjectPath() + "/students/legacy_doc", row);
    if (source === "embedded") f.db.records.get(subjectPath()).students = [row];
    await f.service.setPersonalAcademicStatus(f.request({ workspaceId: uid, subjectId: "subject_a", studentId: "OLD-7", status: "محمل" }));
    assert.equal(f.db.records.get(subjectPath()).academicStatuses["OLD-7"], "محمل");
    assert.equal([...f.db.records.keys()].some(path => path.includes("personal_2026")), false);
  }
});

test("empty authoritative cohort or reset pointer never resurrects embedded students", async () => {
  for (const reset of [false, true]) {
    const f = fixture(); legacySubjectFixture(f, { students: [{ id: "OLD-7", name: "أحمد علي" }], ...(reset ? { lastRosterResetId: "reset" } : {}) });
    if (!reset) f.db.records.set(`attendanceWorkspaces/${uid}/cohorts/cohort_medical_devices__stage_2`, { rosterVersion: 1 });
    await rejectsCode(f.service.setPersonalAcademicStatus(f.request({ workspaceId: uid, subjectId: "subject_a", studentId: "OLD-7", status: "محمل" })), "not-found");
  }
});

test("embedded legacy edits preserve stored IDs, untouched fields, history, unrelated students and attendance clear", async () => {
  const f = fixture(), vector = Array(128).fill(0.1);
  const saved = legacySubjectFixture(f, { students: [{ id: "OLD-7", name: "أحمد علي", original: true }, { studentId: "OLD-8", name: "حسن محمد", nested: { keep: true } }, { id: "OLD-9", name: "مصطفى حسن" }], attendanceClearedAt: "prior-clear", lectureMeta: { date: { status: "completed" } } });
  await f.service.updateLegacyEmbeddedRoster(f.request({ workspaceId: uid, subjectId: "subject_a", updates: [{ studentId: "OLD-7", name: "أحمد حسن", faceDescriptor: vector, faceDescriptors: [vector], faceDescriptorMap: { template_01: vector } }], removedIds: ["OLD-9"] }));
  const result = f.db.records.get(subjectPath());
  assert.equal(result.students.length, 2); assert.equal(result.students[0].id, "OLD-7"); assert.equal(result.students[0].original, true);
  assert.equal(result.students[0].name, "أحمد حسن"); assert.equal(result.students[0].faceDescriptorMap.template_01.length, 128);
  assert.equal(result.students[0].faceDescriptors, undefined); assert.deepEqual(result.students[1], saved.students[1]);
  assert.deepEqual(result.lectureMeta, saved.lectureMeta); assert.equal(result.attendanceClearedAt, "prior-clear");
});

test("embedded legacy edits cannot add or renumber students, bypass reset, or overwrite authoritative roster", async () => {
  for (const mutation of ["missing", "duplicate", "id", "central", "subcollection", "version", "reset"]) {
    const f = fixture(); legacySubjectFixture(f, { students: [{ id: "OLD-7", name: "أحمد علي" }] });
    const update = { studentId: "OLD-7", name: "أحمد حسن" };
    if (mutation === "missing") update.studentId = "NEW-9";
    if (mutation === "id") update.id = "NEW-9";
    if (mutation === "central") f.db.records.set(`attendanceWorkspaces/${uid}/cohorts/cohort_medical_devices__stage_2/students/OLD-8`, { id: "OLD-8", name: "حسن محمد" });
    if (mutation === "subcollection") f.db.records.set(subjectPath() + "/students/OLD-8", { id: "OLD-8", name: "حسن محمد" });
    if (mutation === "version") f.db.records.set(`attendanceWorkspaces/${uid}/cohorts/cohort_medical_devices__stage_2`, { rosterVersion: 1 });
    if (mutation === "reset") f.db.records.get(subjectPath()).lastRosterResetId = "reset";
    const before = clone([...f.db.records]);
    await assert.rejects(f.service.updateLegacyEmbeddedRoster(f.request({ workspaceId: uid, subjectId: "subject_a", updates: mutation === "duplicate" ? [update, update] : [update] })));
    assert.deepEqual([...f.db.records], before);
  }
});

test("explicit legacy setup pins the same old cohort, preserves rows/history and enables names-only allocation", async () => {
  const f = fixture({ verified: false }); grandfather(f);
  const cohortPath = `attendanceWorkspaces/${uid}/cohorts/cohort_medical_devices__stage_2`;
  const original = { id: "OLD-7", name: "أحمد علي", faceDescriptor: Array(128).fill(0.1), original: true };
  legacySubjectFixture(f, { lectureMeta: { old: { status: "completed" } }, attendanceLocked: true });
  f.db.records.set(cohortPath, { rosterVersion: 1, studentCount: 1, existingMetadata: true });
  f.db.records.set(cohortPath + "/students/OLD-7", original);
  const setup = { workspaceId: uid, subjectId: "subject_a", academicYearStart: 2026, stageNumber: 2 };
  const result = await f.service.configureLegacySubjectScope(f.request(setup));
  assert.equal(result.cohortId, "cohort_medical_devices__stage_2"); assert.equal(result.departmentPrefix, "MI");
  assert.equal(result.entryYear, 2025); assert.equal(result.configured, true);
  assert.deepEqual(f.db.records.get(cohortPath + "/students/OLD-7"), original);
  assert.equal(f.db.records.get(subjectPath()).rosterSchemaVersion, 1);
  assert.equal(f.db.records.get(cohortPath).existingMetadata, true);
  assert.equal(f.db.records.get(subjectPath()).lectureMeta.old.status, "completed");
  assert.equal(cohortIdForSubject(f.db.records.get(subjectPath())), "cohort_medical_devices__stage_2");
  const imported = await f.runImport(["أحمد علي", "حسن محمد"]);
  assert.deepEqual(imported.students.map(row => row.id), ["OLD-7", "MI20250001"]);
  assert.deepEqual(f.db.records.get(cohortPath + "/students/OLD-7"), original);
  assert.equal((await f.service.configureLegacySubjectScope(f.request(setup))).configured, true);
  const replay = await f.runImport(["أحمد علي", "حسن محمد"]);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.students, imported.students);
});

test("legacy setup is explicit, immutable, source-preserving and cannot recreate deleted subjects", async () => {
  for (const scenario of ["year-missing", "wrong-stage", "wrong-prefix", "subcollection", "embedded", "deleted", "locked", "occupied-namespace", "archived-namespace"]) {
    const f = fixture(); legacySubjectFixture(f);
    const data = { workspaceId: uid, subjectId: "subject_a", academicYearStart: 2026, stageNumber: 2 };
    const cohort = `attendanceWorkspaces/${uid}/cohorts/cohort_medical_devices__stage_2`;
    if (scenario === "year-missing") delete data.academicYearStart;
    if (scenario === "wrong-stage") data.stageNumber = 1;
    if (scenario === "wrong-prefix") data.departmentPrefix = "ZZ";
    if (scenario === "subcollection") f.db.records.set(subjectPath() + "/students/OLD-7", { id: "OLD-7", name: "أحمد علي" });
    if (scenario === "embedded") f.db.records.get(subjectPath()).students = [{ id: "OLD-7", name: "أحمد علي" }];
    if (scenario === "deleted") f.db.records.delete(subjectPath());
    if (scenario === "locked") f.db.records.get(subjectPath()).rosterOperationId = "reset";
    if (scenario === "occupied-namespace") f.db.records.set(cohort + "/students/MI20250009", { id: "MI20250009", name: "أحمد علي" });
    if (scenario === "archived-namespace") f.db.records.get(subjectPath()).archivedStudents = [{ id: "MI20250009", name: "أحمد علي" }];
    const before = clone([...f.db.records]);
    await assert.rejects(f.service.configureLegacySubjectScope(f.request(data)));
    assert.deepEqual([...f.db.records], before, scenario);
  }
  const f = fixture(); legacySubjectFixture(f);
  const data = { workspaceId: uid, subjectId: "subject_a", academicYearStart: 2026, stageNumber: 2 };
  await f.service.configureLegacySubjectScope(f.request(data));
  const before = clone([...f.db.records]);
  await rejectsCode(f.service.configureLegacySubjectScope(f.request({ ...data, academicYearStart: 2027 })), "failed-precondition");
  assert.deepEqual([...f.db.records], before);
  f.db.records.set(subjectPath("subject_b"), { id: "subject_b", ownerUserId: uid, departmentId: "medical_devices", stageId: "stage_2" });
  await rejectsCode(f.service.configureLegacySubjectScope(f.request({ ...data, subjectId: "subject_b", academicYearStart: 2027 })), "failed-precondition");
});

test("retired endpoint names retain current private authorization and explicitly refuse role or ID mutation", async () => {
  const f = fixture({ verified: false }); grandfather(f);
  const api = require("../retired-compatibility")({ onCall: (options, callback) => {
    assert.equal(options.region, "us-central1"); assert.equal(options.invoker, "public"); return callback;
  }, HttpsError, authorisedWorkspaceOwner: async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    return f.service.activeMember(request, request.data?.workspaceId);
  } });
  assert.deepEqual(Object.keys(api).sort(), ["provisionAttendanceMember", "renameOfficialStudentIdentifier", "revokeAttendanceMember", "updateAttendanceMemberProfile"].sort());
  for (const callable of Object.values(api)) {
    const before = clone([...f.db.records]);
    await rejectsCode(callable({ data: { workspaceId: uid } }), "unauthenticated");
    await rejectsCode(callable(f.request({ workspaceId: "teacher_b" })), "permission-denied");
    await assert.rejects(callable(f.request({ workspaceId: uid, targetUid: "teacher_b", previousId: "OLD-7", nextId: "CHANGED" })), error => error.code === "failed-precondition" && /Refresh the application/.test(error.message));
    assert.deepEqual([...f.db.records], before);
  }
  f.users.get(uid).disabled = true;
  await rejectsCode(api.renameOfficialStudentIdentifier(f.request({ workspaceId: uid })), "permission-denied");
});

const legacyCohortPath = `attendanceWorkspaces/${uid}/cohorts/cohort_medical_devices__stage_2`;
const legacyCounterPath = `attendanceWorkspaces/${uid}/personalStudentSequences/MI2025`;
const legacySetup = { workspaceId: uid, subjectId: "subject_a", academicYearStart: 2026, stageNumber: 2 };
function occupiedLegacyNamespace(f, source) {
  const row = { id: "MI20250002", name: "أحمد علي" };
  if (source === "active") f.db.records.set(legacyCohortPath + "/students/MI20250002", row);
  if (source === "arbitrary-document") f.db.records.set(legacyCohortPath + "/students/original_legacy_doc", row);
  if (source === "document-only") f.db.records.set(legacyCohortPath + "/students/MI20250002", { name: row.name });
  if (source === "document-path") f.db.records.set(legacyCohortPath + "/students/MI20250002", { id: "DIFFERENT-OLD-ID", name: row.name });
  if (source === "archived") f.db.records.get(subjectPath()).archivedStudents = [row];
  if (source === "archived-student-id") f.db.records.get(subjectPath()).archivedStudents = [{ studentId: row.id, name: row.name }];
  if (source === "lowercase") f.db.records.set(legacyCohortPath + "/students/old_document", { id: "mi20250002", name: row.name });
}

test("legacy scope setup rejects missing and low counters for active, document-path and archived IDs without writes", async () => {
  for (const source of ["active", "arbitrary-document", "document-only", "document-path", "archived", "archived-student-id", "lowercase"]) {
    for (const lastSequence of [undefined, 0, 1]) {
      const f = fixture(); legacySubjectFixture(f); occupiedLegacyNamespace(f, source);
      if (lastSequence !== undefined) f.db.records.set(legacyCounterPath, { departmentId: "medical_devices", entryYear: 2025, lastSequence });
      const before = clone([...f.db.records]);
      await rejectsCode(f.service.configureLegacySubjectScope(f.request(legacySetup)), "failed-precondition");
      assert.deepEqual([...f.db.records], before, `${source}/${lastSequence}`);
    }
  }
});

test("import rechecks low or deleted counter reservations after explicit setup rather than duplicate or reuse IDs", async () => {
  for (const source of ["active", "arbitrary-document", "document-only", "document-path", "archived", "archived-student-id", "lowercase"]) {
    for (const lastSequence of [undefined, 0, 1]) {
      const f = fixture(); legacySubjectFixture(f);
      await f.service.configureLegacySubjectScope(f.request(legacySetup));
      occupiedLegacyNamespace(f, source);
      if (lastSequence !== undefined) f.db.records.set(legacyCounterPath, { departmentId: "medical_devices", entryYear: 2025, lastSequence });
      const before = clone([...f.db.records]);
      await rejectsCode(f.runImport(["حسن محمد"]), "failed-precondition");
      assert.deepEqual([...f.db.records], before, `${source}/${lastSequence}`);
    }
  }
});

test("counter at the authoritative observed maximum allocates above current and archived IDs without changing old rows", async () => {
  for (const source of ["active", "arbitrary-document", "document-only", "document-path", "archived", "archived-student-id", "lowercase"]) {
    const f = fixture(); legacySubjectFixture(f); occupiedLegacyNamespace(f, source);
    f.db.records.set(legacyCounterPath, { departmentId: "medical_devices", entryYear: 2025, lastSequence: 2 });
    const oldRows = clone([...f.db.records].filter(([key]) => key.includes("/students/")));
    const oldArchive = clone(f.db.records.get(subjectPath()).archivedStudents);
    await f.service.configureLegacySubjectScope(f.request(legacySetup));
    const result = await f.runImport(["حسن محمد"]);
    assert.equal(result.students[0].id, "MI20250003", source);
    for (const [key, data] of oldRows) assert.deepEqual(f.db.records.get(key), data);
    assert.deepEqual(f.db.records.get(subjectPath()).archivedStudents, oldArchive);
  }
});

test("legacy doc-only student IDs are reused in imports and receipts without backfilling or renumbering the stored row", async () => {
  const f = fixture(); legacySubjectFixture(f);
  const original = { name: "أحمد علي", other: { preserve: true } };
  f.db.records.set(legacyCohortPath + "/students/OLD-7", original);
  await f.service.configureLegacySubjectScope(f.request(legacySetup));
  const result = await f.runImport(["أحمد علي", "حسن محمد"]);
  assert.deepEqual(result.students.map(row => row.id), ["OLD-7", "MI20250001"]);
  assert.deepEqual(f.db.records.get(legacyCohortPath + "/students/OLD-7"), original);
  assert.deepEqual(f.db.records.get(`attendanceWorkspaces/${uid}/personalImportReceipts/operation_123456789`).result.students, result.students);
  assert.deepEqual((await f.runImport(["أحمد علي", "حسن محمد"])).students, result.students);
});

test("invalid counters and duplicate normalized roster identities fail closed before allocation", async () => {
  for (const lastSequence of [-1, 0.5, "2", NaN, 10000, undefined]) {
    const f = fixture(); legacySubjectFixture(f);
    f.db.records.set(legacyCounterPath, { departmentId: "medical_devices", entryYear: 2025, lastSequence });
    const before = clone([...f.db.records]);
    await rejectsCode(f.service.configureLegacySubjectScope(f.request(legacySetup)), "failed-precondition");
    assert.deepEqual([...f.db.records], before);
  }
  const f = fixture(); legacySubjectFixture(f); await f.service.configureLegacySubjectScope(f.request(legacySetup));
  f.db.records.set(legacyCohortPath + "/students/one", { id: "OLD-7", name: "أحمد علي" });
  f.db.records.set(legacyCohortPath + "/students/two", { id: "old-7", name: "حسن محمد" });
  const before = clone([...f.db.records]);
  await rejectsCode(f.runImport(["مصطفى حسن"]), "failed-precondition");
  assert.deepEqual([...f.db.records], before);
});

function sharedFixture(){
 const f=fixture(),ownerRoot=`attendanceWorkspaces/${OWNER_UID}`,teacherRoot=`attendanceWorkspaces/${uid}`;
 f.db.records.set(ownerRoot,{ownerUid:OWNER_UID,primaryOwnerUid:OWNER_UID});
 f.db.records.set(ownerRoot+'/members/'+OWNER_UID,{uid:OWNER_UID,active:true});
 f.db.records.set(ownerRoot+'/departments/medical_devices',{nameAr:'تقنيات الأجهزة الطبية'});
 f.db.records.set(ownerRoot+'/stages/owner_stage_2',{departmentId:'medical_devices',sort:2,nameAr:'الثانية'});
 const os={id:'published_course',departmentId:'medical_devices',stageId:'owner_stage_2',rosterNaming:'name'};
 f.db.records.set(ownerRoot+'/subjects/published_course',os);
 const ownerCohort=ownerRoot+'/cohorts/'+cohortIdForSubject(os);
 f.db.records.set(ownerCohort,{rosterVersion:1});
 f.db.records.set(ownerCohort+'/students/a',{id:'a',name:'أحمد علي حسن',academicStatus:'محمل',faceDescriptors:[[1,2]],attendance:{private:true}});
 f.db.records.set(ownerCohort+'/students/b',{id:'b',name:'فاطمة محمد سالم'});
 f.db.records.set(subjectPath(),{...subject,rosterNaming:'name'});
 const teacherCohort=teacherRoot+'/cohorts/'+cohortIdForSubject({...subject,rosterNaming:'name'});
 const run=(action,extra={},who=uid)=>f.service.sharedStudentRoster(f.request({action,workspaceId:who,subjectId:who===OWNER_UID?'published_course':'subject_a',...extra},who));
 const publish=async()=>{const p=await run('previewPublish',{},OWNER_UID);return run('publish',{revision:p.revision,token:p.token},OWNER_UID);};
 const apply=async()=>{const p=await run('preview');return run('apply',{revision:p.revision,token:p.token});};
 return {...f,run,publish,apply,ownerRoot,ownerCohort,teacherRoot,teacherCohort};
}

const deviceRoster=()=>({subject:{departmentId:'medical_devices',stageId:'device_stage_2'},department:{nameAr:'تقنيات الأجهزة الطبية'},stage:{departmentId:'medical_devices',sort:2,nameAr:'الثانية'},rows:[],subscription:null});
test('Shared names can be applied to a device-only subject without writing its legacy workspace',async()=>{
 const f=sharedFixture();await f.publish();const localRoster=deviceRoster(),before=JSON.stringify([...f.db.records]);
 const preview=await f.run('preview',{subjectId:'device_only',localRoster});
 const result=await f.run('apply',{subjectId:'device_only',localRoster,revision:preview.revision,token:preview.token});
 assert.equal(result.localChanges.adds.length,2);assert.equal(JSON.stringify([...f.db.records]),before);
 localRoster.rows=result.localChanges.adds.slice(1);localRoster.subscription=result.localChanges.subscription;
 const next=await f.run('preview',{subjectId:'device_only',localRoster});assert.equal(next.added,0);assert(next.changes.some(change=>change.kind==='deletedLocally'));
});
test('Local shared-list publication still requires the pinned owner and strips private fields',async()=>{
 const f=sharedFixture(),localRoster=deviceRoster();localRoster.rows=[{id:'LOCAL01',name:'طالب اختبار محلي',faceDescriptors:[[1,2,3]],attendance:{private:true}}];
 await rejectsCode(f.run('previewPublish',{localRoster}),'permission-denied');
 const preview=await f.run('previewPublish',{localRoster},OWNER_UID);
 await f.run('publish',{localRoster,revision:preview.revision,token:preview.token},OWNER_UID);
 const published=[...f.db.records.entries()].find(([key])=>key.startsWith('attendanceSharedRosters/'))[1];
 assert.equal(published.count,1);assert.deepEqual(Object.keys(published.entries[0]).sort(),['id','name']);
});
test('Malformed local shared roster and stale local preview are rejected without writes',async()=>{
 const f=sharedFixture();await f.publish();const localRoster=deviceRoster();
 await rejectsCode(f.run('preview',{localRoster:{...localRoster,rows:'invalid'}}),'invalid-argument');
 const preview=await f.run('preview',{localRoster});localRoster.rows=[{id:'LOCAL01',name:'اسم أضيف لاحقا'}];
 await rejectsCode(f.run('apply',{localRoster,revision:preview.revision,token:preview.token}),'failed-precondition');
});
test('Shared publication requires pinned admin, never implicit import; different stage IDs match by stage number',async()=>{
 const f=sharedFixture();assert.equal((await f.run('check')).available,false);
 await rejectsCode(f.run('previewPublish'),'permission-denied');
 await f.publish();const check=await f.run('check');assert.equal(check.count,2);assert.equal(check.updateAvailable,true);
 assert.equal((await f.run('preview')).added,2);
 const publicData=[...f.db.records.entries()].find(([k])=>k.startsWith('attendanceSharedRosters/'))[1];
 assert.deepEqual(Object.keys(publicData.entries[0]).sort(),['id','name']);assert(!JSON.stringify(publicData).includes('faceDescriptors'));assert(!JSON.stringify(publicData).includes('محمل'));
});
test('Shared access rejects foreign workspace and pending/unverified users',async()=>{
 const f=sharedFixture();await f.publish();
 await rejectsCode(f.run('check',{workspaceId:OWNER_UID}),'permission-denied');
 f.db.records.get(`attendanceIndividualRequests/${uid}`).status='pending';await rejectsCode(f.run('check'),'permission-denied');
});
test('Private draft edits do not change publication and stage mismatch returns no shared list',async()=>{
 const f=sharedFixture();await f.publish();f.db.records.get(f.ownerCohort+'/students/a').name='أحمد علي جديد';
 assert((await f.run('preview')).changes.some(x=>x.name==='أحمد علي حسن'));
 f.db.records.get(f.teacherRoot+'/stages/stage_2').sort=3;assert.equal((await f.run('check')).available,false);
});
test('Shared apply adds names once, preserves status/attendance/face and acknowledges sibling courses',async()=>{
 const f=sharedFixture();const row={id:'private_id',name:'أحمد علي حسن',academicStatus:'مستوفي',faceDescriptors:[[.2]]};
 f.db.records.set(f.teacherCohort,{rosterVersion:1});f.db.records.set(f.teacherCohort+'/students/private_id',row);
 f.db.records.set(subjectPath()+'/lectures/day',{attendance:{private_id:true}});await f.publish();
 const result=await f.apply();assert.equal(result.added,1);assert.deepEqual(f.db.records.get(f.teacherCohort+'/students/private_id'),row);
 assert.deepEqual(f.db.records.get(subjectPath()+'/lectures/day'),{attendance:{private_id:true}});
 assert.equal((await f.run('check')).updateAvailable,false);assert.equal((await f.apply()).added,0);
 f.db.records.set(subjectPath('subject_b'),{...subject,id:'subject_b',rosterNaming:'name'});
 assert.equal((await f.run('check',{subjectId:'subject_b'})).updateAvailable,false);
});
test('Local renamed and deleted students survive future publications without resurrection',async()=>{
 const f=sharedFixture();await f.publish();await f.apply();
 f.db.records.get(f.teacherCohort+'/students/أحمدعليحسن').name='أحمد تعديل خاص';f.db.records.delete(f.teacherCohort+'/students/فاطمةمحمدسالم');
 f.db.records.get(f.ownerCohort+'/students/a').name='أحمد تغيير الإدارة';
 f.db.records.set(f.ownerCohort+'/students/c',{id:'c',name:'علي طالب جديد'});await f.publish();
 const p=await f.run('preview');assert(p.changes.some(x=>x.kind==='editedLocally'));assert(p.changes.some(x=>x.kind==='deletedLocally'));
 await f.apply();assert.equal(f.db.records.get(f.teacherCohort+'/students/أحمدعليحسن').name,'أحمد تعديل خاص');assert(!f.db.records.has(f.teacherCohort+'/students/فاطمةمحمدسالم'));assert(f.db.records.has(f.teacherCohort+'/students/عليطالبجديد'));
});
test('Admin rename updates an untouched private name without changing its ID; admin removal never deletes private row',async()=>{
 const f=sharedFixture();await f.publish();await f.apply();f.db.records.get(f.ownerCohort+'/students/a').name='أحمد علي حسين';f.db.records.delete(f.ownerCohort+'/students/b');await f.publish();
 const p=await f.run('preview');assert.equal(p.renamed,1);assert(p.changes.some(x=>x.kind==='removedFromPublication'));await f.apply();
 assert.equal(f.db.records.get(f.teacherCohort+'/students/أحمدعليحسن').name,'أحمد علي حسين');assert(f.db.records.has(f.teacherCohort+'/students/فاطمةمحمدسالم'));
});
test('Stale previews reject both admin and teacher changes without partial writes',async()=>{
 const f=sharedFixture();const p=await f.run('previewPublish',{},OWNER_UID);f.db.records.get(f.ownerCohort+'/students/a').name='أحمد علي حسين';
 await rejectsCode(f.run('publish',{revision:p.revision,token:p.token},OWNER_UID),'failed-precondition');await f.publish();
 const q=await f.run('preview');f.db.records.set(f.teacherCohort,{rosterVersion:1});f.db.records.set(f.teacherCohort+'/students/x',{id:'x',name:'طالب محلي جديد'});
 await rejectsCode(f.run('apply',{revision:q.revision,token:q.token}),'failed-precondition');assert(!f.db.records.has(f.teacherCohort+'/students/أحمدعليحسين'));
});
test('Course clear forks subscription and does not resurrect previously accepted names',async()=>{
 const f=sharedFixture();await f.publish();await f.apply();
 const privateId='private_'+'a'.repeat(40);f.db.records.get(subjectPath()).rosterCohortId=privateId;f.db.records.get(subjectPath()).lastRosterResetId='reset';f.db.records.set(f.teacherRoot+'/cohorts/'+privateId,{rosterVersion:1});
 f.db.records.set(f.ownerCohort+'/students/c',{id:'c',name:'علي طالب جديد'});await f.publish();const p=await f.run('preview');assert.equal(p.added,1);assert.equal(p.changes.filter(x=>x.kind==='deletedLocally').length,2);await f.apply();
 assert(f.db.records.has(f.teacherCohort+'/students/أحمدعليحسن'));assert(!f.db.records.has(f.teacherRoot+'/cohorts/'+privateId+'/students/أحمدعليحسن'));
});
test('Shared merge preserves embedded and legacy document IDs without migrating attendance',async()=>{
 for(const embedded of [true,false]){const f=sharedFixture(),s={...subject,students:embedded?[{id:'old',name:'أحمد علي حسن',academicStatus:'محمل'}]:[]};f.db.records.set(subjectPath(),s);
 if(!embedded)f.db.records.set(subjectPath()+'/students/document_key',{id:'old',name:'أحمد علي حسن',academicStatus:'محمل'});
 await f.publish();await f.apply();if(embedded){const rows=f.db.records.get(subjectPath()).students;assert.equal(rows.length,2);assert.equal(rows[0].academicStatus,'محمل');}else assert.equal(f.db.records.get(subjectPath()+'/students/document_key').id,'old');}
});

 test('Publishing the same snapshot is idempotent and competing publication invalidates an old preview',async()=>{
 const f=sharedFixture();const a=await f.publish();assert.equal(a.revision,1);assert.equal((await f.publish()).revision,1);
 const p=await f.run('previewPublish',{},OWNER_UID);f.db.records.set(f.ownerCohort+'/students/c',{id:'c',name:'علي طالب جديد'});await f.publish();await rejectsCode(f.run('publish',{revision:p.revision,token:p.token},OWNER_UID),'failed-precondition');
 });
 test('Shared publication rejects ambiguous equivalent names without exposing private records',async()=>{
 const f=sharedFixture();f.db.records.set(f.ownerCohort+'/students/c',{id:'c',name:'احمد علي حسن'});await rejectsCode(f.publish(),'failed-precondition');assert.equal((await f.run('check')).available,false);
 });

test('administrative approval grants own access honestly and rejection revokes it',async()=>{
 const f=fixture({verified:false,approved:false});
 await f.service.approvePersonalAccount(f.request({uid,status:'approved',allowUnverified:true},OWNER_UID));
 const state=await f.service.getPersonalAccountStatus(f.request());
 assert.equal(state.emailVerified,false);assert.equal(state.emailVerificationRequired,false);
 await f.service.openIndividualWorkspace(f.request());
 await rejectsCode(f.service.activeMember(f.request(),'teacher_b'),'permission-denied');
 await f.service.approvePersonalAccount(f.request({uid,status:'rejected'},OWNER_UID));
 await rejectsCode(f.service.openIndividualWorkspace(f.request()),'permission-denied');
});
test('teacher cannot grant administrative approval or delete an account',async()=>{
 const f=fixture();for(const status of ['approved','deleted'])await rejectsCode(f.service.approvePersonalAccount(f.request({uid:'teacher_b',status,allowUnverified:true,confirmEmail:'second@example.test'})),'permission-denied');
 assert(f.users.has('teacher_b'));
});
test('account deletion confirms email, protects owner, retains workspace and retries safely',async()=>{
 const f=fixture();
 await rejectsCode(f.service.approvePersonalAccount(f.request({uid:OWNER_UID,status:'deleted',confirmEmail:OWNER_EMAIL},OWNER_UID)),'invalid-argument');
 await rejectsCode(f.service.approvePersonalAccount(f.request({uid,status:'deleted',confirmEmail:'wrong@example.test'},OWNER_UID)),'failed-precondition');
 const data={uid,status:'deleted',confirmEmail:'teacher@example.test'};
 await f.service.approvePersonalAccount(f.request(data,OWNER_UID));
 assert.equal(f.users.has(uid),false);assert(f.db.records.has(subjectPath()));
 assert.equal(f.db.records.get('attendanceIndividualRequests/'+uid).status,'deleted');
 await f.service.approvePersonalAccount(f.request(data,OWNER_UID));
});
test('administrative approval marker requires current matching approval and pinned reviewer',async()=>{
 for(const change of [{reviewedBy:'teacher_b'},{email:'changed@example.test'},{status:'rejected'}]){
 const f=fixture({verified:false});Object.assign(f.db.records.get('attendanceIndividualRequests/'+uid),{adminEmailApproved:true,reviewedBy:OWNER_UID},change);
 await rejectsCode(f.service.openIndividualWorkspace(f.request()),'permission-denied');
 }
});

test('failed Auth deletion leaves access blocked and can be retried',async()=>{
 const f=fixture(),remove=f.auth.deleteUser;f.auth.deleteUser=async()=>{throw Error('temporary Auth failure');};
 const data={uid,status:'deleted',confirmEmail:'teacher@example.test'};
 await assert.rejects(f.service.approvePersonalAccount(f.request(data,OWNER_UID)),/temporary/);
 assert.equal(f.db.records.get('attendanceIndividualRequests/'+uid).status,'deleting');
 await rejectsCode(f.service.openIndividualWorkspace(f.request()),'permission-denied');
 await rejectsCode(f.service.approvePersonalAccount(f.request({uid,status:'approved'},OWNER_UID)),'failed-precondition');
 f.auth.deleteUser=remove;await f.service.approvePersonalAccount(f.request(data,OWNER_UID));assert.equal(f.users.has(uid),false);
});

test('Morning publication keeps its legacy identity; evening lists never fall back to morning',async()=>{
 const f=sharedFixture();await f.publish();const morning=deviceRoster(),evening={...deviceRoster(),subject:{...deviceRoster().subject,studyPeriod:'evening'}};
 const legacy=await f.run('preview',{localRoster:morning});morning.subject.studyPeriod='morning';const explicit=await f.run('preview',{localRoster:morning});assert.equal(legacy.token,explicit.token);assert.equal(explicit.scope.studyPeriod,'morning');
 assert.equal((await f.run('check',{localRoster:evening})).available,false);await rejectsCode(f.run('preview',{localRoster:evening}),'not-found');
 evening.rows=[{id:'eve1',name:'طالب الدراسة المسائية'}];const p=await f.run('previewPublish',{localRoster:evening},OWNER_UID);await f.run('publish',{localRoster:evening,revision:p.revision,token:p.token},OWNER_UID);
 evening.rows=[];const e=await f.run('preview',{localRoster:evening});assert.equal(e.scope.studyPeriod,'evening');assert.equal(e.added,1);assert.equal(e.changes[0].name,'طالب الدراسة المسائية');const m=await f.run('preview',{localRoster:morning});assert.equal(m.added,2);assert(!m.changes.some(x=>x.name==='طالب الدراسة المسائية'));
 await rejectsCode(f.run('apply',{localRoster:evening,revision:m.revision,token:m.token}),'failed-precondition');
 await rejectsCode(f.run('previewPublish',{localRoster:evening}),'permission-denied');
});
test('Study period separates roster cohorts without relocating legacy morning pointers',()=>{
 const s={departmentId:'medical_devices',stageId:'stage2',rosterNaming:'name'};assert.equal(cohortIdForSubject(s),cohortIdForSubject({...s,studyPeriod:'morning'}));assert.notEqual(cohortIdForSubject(s),cohortIdForSubject({...s,studyPeriod:'evening'}));assert.equal(cohortIdForSubject({...s,rosterCohortId:'cohort_saved'}),'cohort_saved');
});
test('An older client omitting study period uses the persisted evening identity instead of morning publication',async()=>{
 const f=sharedFixture();await f.publish();const id=require('node:crypto').createHash('sha256').update(JSON.stringify(['subject','subject_a'])).digest('hex');f.db.records.set('attendanceDeviceSync/'+uid+'/records/'+id,{valueJson:JSON.stringify({studyPeriod:'evening'})});
 const r=await f.run('check',{localRoster:deviceRoster()});assert.equal(r.scope.studyPeriod,'evening');assert.equal(r.available,false);
});
