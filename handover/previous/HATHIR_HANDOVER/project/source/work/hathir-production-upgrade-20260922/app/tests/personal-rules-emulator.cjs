'use strict';

// Actual Firestore rule evaluation against a dedicated loopback-only demo
// project. Synthetic records/unsigned emulator JWTs; no credentials or SDK login.
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { APP, REPORTS, assert, fs, path, makeReport, check, saveReport } = require('./offline-harness.cjs');
const WORKSPACE = path.resolve(APP, '../../..');
const JAVA = process.env.PERSONAL_TEST_JAVA || path.join(WORKSPACE, 'hathir-firebase-migration/test-runtime/jre/jdk-21.0.12.1+1-jre/bin/java.exe');
const JAR = process.env.PERSONAL_TEST_FIRESTORE_JAR || path.join(WORKSPACE, 'work/hathir-rebuild-20260921/audits/firestore-emulator-verified-v1.22.0.jar');
const EXPECTED_SHA = '9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c';
const PROJECT = 'demo-hathir-production-upgrade-rules';
const OWNER = 'HATHIR_OWNER_UID_REQUIRED';
const OWNER_EMAIL = 'redacted@example.invalid';
const report = makeReport('personal-real-firestore-rules-emulator');
report.limitations = ['Rules ran in a local Firestore emulator, not a deployed Firebase project.', 'No live account, email, payment, camera, or physical-device verification.'];
report.mode = 'real-local-emulator-synthetic-records';
report.project = PROJECT;
let child, output = '', ORIGIN, BASE;
if (!fs.existsSync(JAVA) || !fs.existsSync(JAR)) {
  report.skipped = true;
  report.skipReason = 'Verified local Firestore emulator runtime is not present on this computer; Hosting-only release does not change Firestore rules.';
  saveReport(report, 'personal-rules-emulator');
  process.exit(0);
}

function token({ uid = 'qa_a', email = uid + '@example.test', verified = true } = {}) {
  const now = Math.floor(Date.now() / 1000), b64 = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT,
    iat: now, exp: now + 3600, auth_time: now, sub: uid, user_id: uid, email, email_verified: verified,
    firebase: { identities: { email: [email] }, sign_in_provider: 'password' } })}.`;
}
const fields = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, val(value)]));
function val(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(val) } };
  return { mapValue: { fields: fields(value) } };
}
async function request(url, method = 'GET', body, authorization = 'owner') {
  const parsed = new URL(url);
  assert.equal(parsed.origin, ORIGIN); assert(parsed.pathname.includes(PROJECT));
  const response = await fetch(parsed, { method, headers: { 'content-type': 'application/json',
    ...(authorization ? { Authorization: 'Bearer ' + authorization } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const raw = await response.text(); let json;
  try { json = JSON.parse(raw); } catch { json = { raw }; }
  return { status: response.status, json };
}
const route = name => BASE + '/' + name.split('/').map(encodeURIComponent).join('/');
async function seed(name, data) {
  const response = await request(route(name), 'PATCH', { fields: fields(data) });
  assert.equal(response.status, 200, JSON.stringify(response));
}
async function rule(label, name, allow, options = {}) {
  await check(report, label, async () => {
    const method = options.method || 'GET';
    const data = options.data;
    const mask = method === 'PATCH' && !options.create ? '?' + Object.keys(data).map(key => 'updateMask.fieldPaths=' + encodeURIComponent(key)).join('&') : '';
    const response = await request(route(name) + mask, method, data === undefined ? undefined : { fields: fields(data) }, options.anonymous ? null : token(options));
    assert(allow ? response.status >= 200 && response.status < 300 : response.status === 403 && response.json.error?.status === 'PERMISSION_DENIED', JSON.stringify(response));
    return { expected: allow ? 'ALLOW' : 'DENY', status: response.status };
  });
}
const patch = (label, name, data, allow, options = {}) => rule(label, name, allow, { ...options, method: 'PATCH', data });

async function start() {
  assert(fs.existsSync(JAVA), 'Local Java runtime missing: ' + JAVA);
  assert(fs.existsSync(JAR), 'Previously verified Firestore JAR missing: ' + JAR);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(JAR)).digest('hex'), EXPECTED_SHA, 'Emulator JAR hash does not match the prior verified artifact');
  const portFinder = net.createServer();
  await new Promise((resolve, reject) => { portFinder.once('error', reject); portFinder.listen(0, '127.0.0.1', resolve); });
  const port = portFinder.address().port;
  await new Promise(resolve => portFinder.close(resolve));
  ORIGIN = 'http://127.0.0.1:' + port;
  BASE = `${ORIGIN}/v1/projects/${PROJECT}/databases/(default)/documents`;
  report.origin = ORIGIN; report.emulatorSha256 = EXPECTED_SHA;
  fs.mkdirSync(REPORTS, { recursive: true });
  child = spawn(JAVA, ['-jar', JAR, '--host', '127.0.0.1', '--port', String(port), '--project_id', PROJECT,
    '--single_project_mode', 'true', '--single_project_mode_error', 'true'], { windowsHide: true, cwd: REPORTS, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    const timer = setInterval(async () => {
      if (Date.now() > deadline) { clearInterval(timer); reject(Error('Emulator startup timed out: ' + output.slice(-1500))); return; }
      if (child.exitCode !== null) { clearInterval(timer); reject(Error('Emulator exited: ' + output.slice(-1500))); return; }
      try { await request(BASE); clearInterval(timer); resolve(); } catch {}
    }, 400);
    child.once('error', error => { clearInterval(timer); reject(error); });
  });
}

(async () => {
  await start();
  const source = fs.readFileSync(path.join(APP, 'firestore_attendance.rules'), 'utf8');
  report.rulesSha256 = crypto.createHash('sha256').update(source).digest('hex');
  const compiled = await request(`${ORIGIN}/emulator/v1/projects/${PROJECT}:securityRules`, 'PUT', { rules: { files: [{ name: 'firestore.rules', content: source }] } });
  assert.equal(compiled.status, 200, 'Rules failed compilation: ' + JSON.stringify(compiled));
  report.rulesCompiled = true;
  for (const uid of ['qa_a', 'qa_b', 'qa_pending', OWNER]) {
    const email = uid === OWNER ? OWNER_EMAIL : uid + '@example.test';
    if (uid !== OWNER) await seed('attendanceIndividualRequests/' + uid, { uid, email, fullName: 'اسم اختبار محلي', status: uid === 'qa_pending' ? 'pending' : 'approved' });
    await seed('attendanceWorkspaces/' + uid, { ownerUid: uid, primaryOwnerUid: uid, mode: 'personal' });
    await seed(`attendanceWorkspaces/${uid}/members/${uid}`, { uid, email, role: 'owner', active: true });
    await seed('attendanceUserWorkspaces/' + uid, { uid, workspaceId: uid, active: true });
    await seed(`attendanceWorkspaces/${uid}/subjects/qa_subject`, { id: 'qa_subject', ownerUserId: uid, titleAr: 'مادة اختبار', titleEn: 'QA',
      departmentId: 'qa_dept', stageId: 'qa_stage', academicYearStart: 2026, stageNumber: 2, departmentPrefix: 'QA',
      totalHours: 60, lectureDurationHours: 2, studentCount: 1, personalScopeLocked: true,
      academicStatuses: { QA20250001: 'محمل' }, attendanceLocked: false });
  }
  const ws = 'attendanceWorkspaces/qa_a', subject = ws + '/subjects/qa_subject', cohort = ws + '/cohorts/personal_2026_qa_dept_2';
  await seed(ws + '/departments/qa_dept', { id: 'qa_dept', codePrefix: 'QA', codePrefixLocked: true, nameAr: 'اختبار' });
  await seed(ws + '/stages/qa_stage', { id: 'qa_stage', sort: 2, departmentId: 'qa_dept', personalScopeLocked: true, nameAr: 'الثانية' });
  await seed(cohort, { id: 'personal_2026_qa_dept_2', rosterVersion: 1 });
  await seed(cohort + '/students/QA20250001', { id: 'QA20250001', name: 'طالب اختبار محلي', entryYear: 2025, sequence: 1, departmentPrefix: 'QA' });
  await seed(subject + '/lectures/2026-09-22', { date: '2026-09-22', status: 'active' });
  await seed(subject + '/lectures/2026-09-22/marks/QA20250001', { studentId: 'QA20250001', time: '09:00' });
  await seed(cohort + '/faceTemplates/QA20250001', { studentId: 'QA20250001', templateCount: 0 });
  const owner = { uid: OWNER, email: OWNER_EMAIL };
  await rule('Verified approved user reads own workspace', subject, true);
  await rule('Verified approved user lists own subjects', ws + '/subjects', true);
  await rule('Foreign workspace document denied', 'attendanceWorkspaces/qa_b/subjects/qa_subject', false);
  await rule('Foreign workspace query denied', 'attendanceWorkspaces/qa_b/subjects', false);
  await patch('Foreign workspace write denied', 'attendanceWorkspaces/qa_b/subjects/qa_subject', { titleAr: 'مرفوض' }, false);
  await rule('Anonymous private read denied', subject, false, { anonymous: true });
  await rule('Unverified approved private read denied', subject, false, { verified: false });
  await seed('attendanceIndividualRequests/qa_a',{uid:'qa_a',email:'qa_a@example.test',status:'approved',adminEmailApproved:true,reviewedBy:OWNER});
  await rule('Administrative unverified account reads own workspace',subject,true,{verified:false});
  await rule('Administrative approval preserves cross-account isolation','attendanceWorkspaces/qa_b/subjects/qa_subject',false,{verified:false});
  await patch('Teacher cannot forge administrative approval','attendanceIndividualRequests/qa_a',{adminEmailApproved:true,reviewedBy:OWNER},false,{verified:false});
  await seed('attendanceIndividualRequests/qa_a',{uid:'qa_a',email:'qa_a@example.test',status:'deleting',adminEmailApproved:true,reviewedBy:OWNER});
  await rule('Deletion blocks even verified stale tokens',subject,false);
  await seed('attendanceIndividualRequests/qa_a',{uid:'qa_a',email:'qa_a@example.test',status:'approved',adminEmailApproved:true,reviewedBy:'qa_b'});
  await rule('Non-owner reviewer cannot waive verification',subject,false,{verified:false});
  await seed('attendanceIndividualRequests/qa_a',{uid:'qa_a',email:'qa_a@example.test',status:'approved'});
  await rule('Approval for an old email cannot authorize changed email', subject, false, { email: 'changed@example.test' });
  await rule('Pending user cannot read own workspace', 'attendanceWorkspaces/qa_pending/subjects/qa_subject', false, { uid: 'qa_pending' });
  await rule('Reserved verified owner reads only own workspace', `attendanceWorkspaces/${OWNER}/subjects/qa_subject`, true, owner);
  await rule('Platform owner cannot read teacher private data', subject, false, owner);
  await rule('Matching owner email with wrong UID does not bypass approval', 'attendanceWorkspaces/qa_pending/subjects/qa_subject', false, { uid: 'qa_pending', email: OWNER_EMAIL });
  await rule('Reserved owner UID with wrong email does not bypass approval', `attendanceWorkspaces/${OWNER}/subjects/qa_subject`, false, { uid: OWNER, email: 'wrong@example.test' });
  await rule('Unverified platform owner cannot read own workspace', `attendanceWorkspaces/${OWNER}/subjects/qa_subject`, false, { ...owner, verified: false });
  await rule('User reads own registration while email verification is pending', 'attendanceIndividualRequests/qa_a', true, { verified: false });
  await rule('Teacher cannot list all registrations', 'attendanceIndividualRequests', false);
  await rule('Teacher cannot read another registration', 'attendanceIndividualRequests/qa_b', false);
  await rule('Verified platform owner lists registrations', 'attendanceIndividualRequests', true, owner);
  await rule('Unverified platform owner cannot list registrations', 'attendanceIndividualRequests', false, { ...owner, verified: false });
  await seed('attendanceLegacyAccess/qa_a', { uid: 'qa_a', email: 'qa_a@example.test', approvedAtCutover: true, cutoverAt: 'synthetic-cutover' });
  await rule('Frozen approved old user reads own data without pretending email verification', subject, true, { verified: false });
  await rule('Frozen old user retains cross-workspace isolation', 'attendanceWorkspaces/qa_b/subjects/qa_subject', false, { verified: false });
  await rule('Unlisted approved unverified user remains denied', 'attendanceWorkspaces/qa_b/subjects/qa_subject', false, { uid: 'qa_b', verified: false });
  await rule('Frozen entry cannot authorize a changed email', subject, false, { email: 'changed@example.test', verified: false });
  await rule('Frozen entry is not client-readable even by its account', 'attendanceLegacyAccess/qa_a', false, { verified: false });
  await patch('Client cannot edit frozen grandfather evidence', 'attendanceLegacyAccess/qa_a', { email: 'changed@example.test' }, false);
  await patch('Client cannot add grandfather evidence', 'attendanceLegacyAccess/qa_b', { uid: 'qa_b', email: 'qa_b@example.test', approvedAtCutover: true }, false, { uid: 'qa_b', create: true });
  await patch('Platform owner cannot write grandfather evidence through browser', 'attendanceLegacyAccess/qa_b', { uid: 'qa_b', email: 'qa_b@example.test', approvedAtCutover: true }, false, { ...owner, create: true });
  await seed('attendanceIndividualRequests/qa_a', { uid: 'qa_a', email: 'qa_a@example.test', status: 'rejected' });
  await rule('Revoked current approval overrides frozen old evidence', subject, false, { verified: false });
  await seed('attendanceIndividualRequests/qa_a', { uid: 'qa_a', email: 'qa_a@example.test', status: 'approved' });
  await seed('attendanceLegacyAccess/qa_pending', { uid: 'qa_pending', email: 'qa_pending@example.test', approvedAtCutover: true });
  await rule('Frozen entry cannot promote an unapproved account', 'attendanceWorkspaces/qa_pending/subjects/qa_subject', false, { uid: 'qa_pending', verified: false });
  await seed('attendanceLegacyAccess/qa_b', { uid: 'qa_a', email: 'qa_b@example.test', approvedAtCutover: true });
  await rule('Frozen entry must match the exact UID', 'attendanceWorkspaces/qa_b/subjects/qa_subject', false, { uid: 'qa_b', verified: false });
  await seed('attendanceLegacyAccess/qa_b', { uid: 'qa_b', email: 'qa_b@example.test', approvedAtCutover: false });
  await rule('Frozen entry requires cutover approval marker', 'attendanceWorkspaces/qa_b/subjects/qa_subject', false, { uid: 'qa_b', verified: false });
  await seed('attendanceLegacyAccess/' + OWNER, { uid: OWNER, email: OWNER_EMAIL, approvedAtCutover: true, platformOwner: true });
  await rule('Existing unverified pinned owner retains own workspace through frozen owner evidence', `attendanceWorkspaces/${OWNER}/subjects/qa_subject`, true, { ...owner, verified: false });
  await rule('Existing unverified pinned owner retains approval-list authority', 'attendanceIndividualRequests', true, { ...owner, verified: false });
  await rule('Grandfather owner cannot read another teacher workspace', subject, false, { ...owner, verified: false });
  await seed('attendanceLegacyAccess/qa_pending', { uid: 'qa_pending', email: OWNER_EMAIL, approvedAtCutover: true, platformOwner: true });
  await rule('Owner email and forged owner marker never elevate another UID', 'attendanceIndividualRequests', false, { uid: 'qa_pending', email: OWNER_EMAIL, verified: false });
  await seed('attendanceLegacyAccess/qa_b', { uid: 'qa_b', email: 'qa_b@example.test', approvedAtCutover: true, platformOwner: true });
  await rule('A nonowner cannot consume an owner-designated frozen entry', 'attendanceWorkspaces/qa_b/subjects/qa_subject', false, { uid: 'qa_b', verified: false });
  await patch('Client cannot self-approve', 'attendanceIndividualRequests/qa_pending', { status: 'approved' }, false, { uid: 'qa_pending' });
  await patch('Owner also cannot bypass callable validation for approval', 'attendanceIndividualRequests/qa_pending', { status: 'approved' }, false, owner);
  await patch('Client cannot directly create registration', 'attendanceIndividualRequests/qa_new', { uid: 'qa_new', status: 'pending' }, false, { uid: 'qa_new', create: true });
  await rule('Own workspace pointer read allowed', 'attendanceUserWorkspaces/qa_a', true);
  await rule('Foreign workspace pointer read denied', 'attendanceUserWorkspaces/qa_b', false);
  await patch('Pointer cannot redirect to another workspace', 'attendanceUserWorkspaces/qa_a', { workspaceId: 'qa_b' }, false);
  await rule('Own member identity read allowed', ws + '/members/qa_a', true);
  await rule('No workspace member listing or central-grant workflow', ws + '/members', false);
  await patch('Cannot create another member grant', ws + '/members/qa_b', { uid: 'qa_b', active: true }, false, { create: true });
  await patch('Cannot alter own role or grant permissions', ws + '/members/qa_a', { role: 'admin', permissions: { usersManage: true } }, false);
  await patch('Cannot create invitation grants', ws + '/invites/new', { role: 'owner' }, false, { create: true });
  await patch('Cannot change private workspace ownership', ws, { ownerUid: 'qa_b' }, false);
  await patch('Ordinary own subject title update allowed', subject, { titleAr: 'عنوان معدل' }, true);
  const legacy = ws + '/subjects/legacy_subject';
  await seed(legacy, { id: 'legacy_subject', ownerUserId: 'qa_a', titleAr: 'مادة قديمة', departmentId: 'qa_dept', stageId: 'qa_stage',
    totalHours: 60, lectureDurationHours: 2, students: [{ id: 'OLD-7', name: 'طالب قديم' }] });
  await patch('Legacy title edits remain valid without invented academic year', legacy, { titleAr: 'عنوان قديم معدل' }, true, { verified: false });
  await patch('Legacy duration edits preserve the old roster location', legacy, { lectureDurationHours: 3 }, true, { verified: false });
  await patch('Adding personal year metadata cannot silently redirect old roster', legacy, { academicYearStart: 2026, stageNumber: 2, departmentPrefix: 'QA' }, false);
  await patch('Changing legacy stage cannot silently redirect old roster', legacy, { stageId: 'other' }, false);
  await patch('Legacy roster version marker is server-only', legacy, { rosterSchemaVersion: 1 }, false);
  await patch('Embedded roster mutation must pass preserving server callable', legacy, { students: [{ id: 'CHANGED', name: 'طالب قديم' }] }, false);
  await seed(legacy + '/students/old_document', { id: 'OLD-7', name: 'طالب قديم', originalField: true });
  await patch('Legacy per-subject name changes retain differing stored document ID', legacy + '/students/old_document', { name: 'اسم قديم معدل' }, true);
  await patch('Legacy per-subject identifier cannot change', legacy + '/students/old_document', { id: 'CHANGED' }, false);
  await patch('Legacy inline face map can be edited without moving the student', legacy + '/students/old_document', { faceDescriptorMap: { template_01: Array(128).fill(0.1) } }, true);
  const orphanCohort = ws + '/cohorts/cohort_qa_dept__qa_stage';
  await seed(orphanCohort + '/students/old_document', { id: 'OLD-8', name: 'طالب مجموعة قديمة' });
  await patch('Existing old cohort rows remain name-editable without fabricating a missing parent', orphanCohort + '/students/old_document', { name: 'اسم مجموعة معدل' }, true);
  await patch('Old cohort student identifiers remain immutable', orphanCohort + '/students/old_document', { id: 'NEW' }, false);
  await patch('Valid new personal subject can be created', ws + '/subjects/qa_new_subject', {
    id: 'qa_new_subject', ownerUserId: 'qa_a', titleAr: 'مادة جديدة', departmentId: 'qa_dept', stageId: 'qa_stage',
    academicYearStart: 2026, stageNumber: 2, departmentPrefix: 'QA', totalHours: 60, lectureDurationHours: 2
  }, true, { create: true });
  const nameSubject=ws+'/subjects/qa_name_subject';
  await patch('Name-based subject creation requires no academic year or student code',nameSubject,{
    id:'qa_name_subject',ownerUserId:'qa_a',titleAr:'مادة بالأسماء',departmentId:'qa_dept',stageId:'qa_stage',rosterNaming:'name',totalHours:60,lectureDurationHours:2
  },true,{create:true});
  await patch('Name-based subject title remains editable',nameSubject,{titleAr:'عنوان جديد'},true);
  await patch('Name-based cohort department cannot be redirected',nameSubject,{departmentId:'other'},false);
  await patch('Existing subject cannot opt into a different roster location',subject,{rosterNaming:'name'},false);
  await patch('Browser cannot forge name reservations',cohort+'/nameReservations/allocated',{names:['FAKENAME']},false,{create:true});
  for (const [field, value] of Object.entries({ academicStatuses: {}, ownerUserId: 'qa_b', rosterCohortId: 'foreign', studentCount: 0, academicYearStart: 2027, departmentId: 'other', stageNumber: 3 }))
    await patch('Protected subject field cannot be changed: ' + field, subject, { [field]: value }, false);
  await patch('Server-generated student IDs cannot be inserted by browser', cohort + '/students/QA20250002', { id: 'QA20250002', name: 'اسم جديد' }, false, { create: true });
  await patch('Name-only change preserves generated student identity', cohort + '/students/QA20250001', { name: 'طالب باسم معدل' }, true);
  await patch('Generated student code cannot be changed', cohort + '/students/QA20250001', { id: 'ALTERED' }, false);
  await patch('Generated entry year cannot be changed', cohort + '/students/QA20250001', { entryYear: 2030 }, false);
  await patch('Department prefix is locked after allocation', ws + '/departments/qa_dept', { codePrefix: 'XX' }, false);
  await patch('Stage identity is locked after allocation', ws + '/stages/qa_stage', { sort: 3 }, false);
  await patch('Generated sequence counter is server-only', ws + '/personalStudentSequences/QA2025', { lastSequence: 0 }, false, { create: true });
  await patch('Import receipt is server-only', ws + '/personalImportReceipts/qa_receipt', { fingerprint: 'forged' }, false, { create: true });
  await rule('Own attendance history remains readable', subject + '/lectures/2026-09-22/marks/QA20250001', true);
  await patch('Browser cannot forge lecture revisions', subject + '/lectures/2026-09-22', {markRevisions:{QA20250001:'forged'}}, false);
  await patch('Browser cannot reopen a lecture outside lifecycle transaction', subject + '/lectures/2026-09-22', {status:'active'}, false);
  await patch('Browser cannot bypass attendance correction revisions', subject + '/lectures/2026-09-22/marks/QA20250001', {time:'12:00'}, false);
  await rule('Browser cannot remove attendance without a tombstone', subject + '/lectures/2026-09-22/marks/QA20250001', false, {method:'DELETE'});
  await patch('Browser cannot bypass excuse correction transaction', subject + '/lectures/2026-09-22/excuses/QA20250001', {studentId:'QA20250001'}, false, {create:true});
  await patch('Correction receipts remain server-only', subject + '/correctionReceipts/forged', {actor:'qa_a'}, false, {create:true});
  await rule('Cross-user attendance history denied', subject + '/lectures/2026-09-22/marks/QA20250001', false, { uid: 'qa_b' });
  await rule('Own biometric metadata remains readable', cohort + '/faceTemplates/QA20250001', true);
  await rule('Cross-user biometric metadata denied', cohort + '/faceTemplates/QA20250001', false, { uid: 'qa_b' });
  await rule('Central organization roster read denied', 'attendanceOrganizations/hathir/departments/qa/students/test', false);
  await patch('Central organization grant write denied even for owner', 'attendanceOrganizations/hathir/members/qa_a', { active: true }, false, { ...owner, create: true });
  await patch('Shared subscription pointer is server controlled', subject, {sharedRosterSubscriptionId:'forged'}, false);
  await patch('Shared publication cannot be forged by a browser', 'attendanceSharedRosters/test', {revision:1,entries:[]}, false, {create:true});
  await patch('Even admin publishes through the callable only', 'attendanceSharedRosters/test', {revision:1,entries:[]}, false, {...owner,create:true});
  await rule('Shared snapshots require the scoped callable', 'attendanceSharedRosters/test', false);
  await patch('Private subscription receipts cannot be forged', ws+'/sharedRosterSubscriptions/test', {revision:99}, false, {create:true});
  await seed(ws + '/members/qa_a', { uid: 'qa_a', active: false, role: 'owner' });
  await rule('Inactive member loses access even when approved', subject, false);
})().catch(error => { report.cases.push({ label: 'Emulator setup or execution', passed: false, error: error.stack }); })
  .finally(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    report.emulatorStopped = !child || child.exitCode !== null || child.signalCode !== null;
    fs.mkdirSync(REPORTS, { recursive: true });
    fs.writeFileSync(path.join(REPORTS, 'personal-rules-emulator.log'), output);
    saveReport(report, 'personal-rules-emulator');
  });
