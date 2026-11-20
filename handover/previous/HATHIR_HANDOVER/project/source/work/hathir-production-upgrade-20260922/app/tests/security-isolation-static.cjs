'use strict';

// Read-only source checks: these are guardrail regressions, not a substitute for
// deploying rules to an emulator or validating an actual Firebase environment.
const vm = require('node:vm');
const { APP, SITE, EXPECTED_PROJECT, EXPECTED_SITE, assert, fs, path, makeReport, check, saveReport } = require('./offline-harness.cjs');
const report = makeReport('personal-static-security-isolation');
report.limitations.push('Static assertions inspect source structure; they do not prove all Firestore rule semantics.');
const read = file => fs.readFileSync(path.join(APP, file), 'utf8');
const files = [];
function walk(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (['node_modules', '.git', 'tests', 'test', 'reports'].includes(entry.name)) continue;
    const name = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(name);
    else if (/\.(?:html|js|cjs|json|toml|rules|webmanifest)$/.test(name) || entry.name === '.firebaserc') files.push(name);
  }
}

(async () => {
  walk(APP);
  await check(report, 'All shipped JavaScript and inline application scripts parse', () => {
    let count = 0;
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if (/\.(?:js|cjs)$/.test(file)) { new vm.Script(source, { filename: file }); count++; }
      if (/\.html$/.test(file)) for (const script of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!/\bsrc\s*=/.test(script[1]) && !/application\/(?:ld\+)?json/.test(script[1])) { new vm.Script(script[2], { filename: file }); count++; }
      }
    }
    return { parsedScripts: count };
  });
  await check(report, 'Runtime configuration is pinned only to the original production project', () => {
    const context = { window: {} };
    vm.runInNewContext(read('netlify_site/runtime-config.js'), context);
    const config = context.window.HATHIR_RUNTIME_CONFIG;
    assert(config, 'Missing explicit personal runtime configuration');
    if (config.firebaseConfig) assert.equal(config.firebaseConfig.projectId, EXPECTED_PROJECT);
    assert.equal(config.ownerUid, 'HATHIR_OWNER_UID_REQUIRED');
    assert.equal(config.ownerEmail, 'redacted@example.invalid');
    assert.equal(config.environment, 'production');
    assert.equal(config.supportEmail, 'redacted@example.invalid');
    assert.equal(config.supportEnabled, true, 'University support mailbox explicitly requested by owner');
    assert.equal(JSON.parse(read('.firebaserc')).projects.default, EXPECTED_PROJECT, 'Default deploy target must be the explicitly authorized personal project');
    const hosting = JSON.parse(read('firebase.json')).hosting;
    assert.equal(hosting.site, EXPECTED_SITE, 'Hosting site must remain the personal-only site');
    assert.equal(hosting.public, 'netlify_site', 'Tests and reports must never be published');
    return { configured: Boolean(config.firebaseConfig), expectedProject: EXPECTED_PROJECT };
  });
  await check(report, 'No shipped project or Firebase URL points to another Firebase project', () => {
    const forbidden = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:["']?projectId["']?\s*:\s*["']|https:\/\/)([^"'\s,;{}]+)/g)) {
        const value = match[1];
        if (match[0].includes('projectId') && value !== EXPECTED_PROJECT) forbidden.push(path.relative(APP, file) + ': projectId=' + value);
        if (/\.(?:firebaseapp\.com|firebasestorage\.app|web\.app)(?:\/|$)/.test(value) && ![EXPECTED_PROJECT + '.', EXPECTED_SITE + '.'].some(prefix => value.startsWith(prefix))) forbidden.push(path.relative(APP, file) + ': ' + value);
        if (/\.cloudfunctions\.net(?:\/|$)/.test(value) && !value.includes('-' + EXPECTED_PROJECT + '.cloudfunctions.net')) forbidden.push(path.relative(APP, file) + ': ' + value);
      }
    }
    assert.deepEqual(forbidden, []);
    const html = read('netlify_site/index.html');
    assert(!/const\s+firebaseConfig\s*=\s*\{/.test(html), 'Inline legacy Firebase fallback is forbidden');
    assert(/HATHIR_RUNTIME_CONFIG/.test(html), 'App must use explicit runtime config');
  });
  await check(report, 'Private app ships no central-roster client or callable exports', () => {
    const html = read('netlify_site/index.html');
    assert(!/<script[^>]+(?:organization-client|organization-ui|account-flow)\.js/.test(html));
    assert(!fs.existsSync(path.join(SITE, 'organization-client.js')));
    const source = read('functions/index.js');
    assert(!/exports\.(?:getCentral|setCentral|mutateCentral|grantCentral|createCentral|assignCentral)/.test(source));
    assert(!/require\(["']\.\/central-roster/.test(source));
  });
  await check(report, 'Rules require verified identity, approved private owner, and forbid cross-workspace fallback', () => {
    const source = read('firestore_attendance.rules');
    assert(/request\.auth\.token\.email_verified\s*==\s*true/.test(source), 'Verified email missing from rules');
    assert(/(?:workspaceId|uid)\s*==\s*request\.auth\.uid/.test(source) && /active\(workspaceId\)/.test(source), 'Workspace must be keyed by the authenticated UID');
    assert(/data\.status\s*==\s*['"]approved['"]/.test(source), 'Approval gate missing');
    assert(source.includes('HATHIR_OWNER_UID_REQUIRED'), 'Admin identity must include reserved UID, not just email');
    assert(!/allow\s+(?:read|write|read\s*,\s*write|write\s*,\s*read)\s*:\s*if\s+true\s*;/.test(source));
    assert(!/match\s+\/(?:organizations|centralRosters|centralCourses)\//.test(source));
    const registration = source.match(/match\s+\/attendanceIndividualRequests\/\{[^}]+\}\s*\{([\s\S]*?)(?=\n\s*\})/);
    assert(registration, 'Registration rules missing');
    assert(/allow\s+(?:write|create\s*,\s*update\s*,\s*delete)\s*:\s*if\s+false\s*;/.test(registration[1]), 'Approval records must be written only by server code');
  });
  await check(report, 'Original snapshots, pending outbox, preferences and PWA identity survive the upgrade', () => {
    assert(/hathir-offline-v1/.test(read('netlify_site/offline-store.js')));
    assert(!/hathir-personal-20260922-offline-v1/.test(read('netlify_site/offline-store.js')));
    assert(read('netlify_site/service-worker.js').includes('student-attendance'));
    assert.equal(JSON.parse(read('netlify_site/manifest.webmanifest')).id, '/');
    const html = read('netlify_site/index.html');
    const expected = {STORAGE_KEY:'student_qr_attendance_admin_local_v1',LANG_KEY:'student_qr_attendance_admin_lang_v1',LOCAL_SESSION_KEY:'student_qr_attendance_admin_local_session_v1'};
    for (const [key,value] of Object.entries(expected)) assert(new RegExp('const\\s+'+key+'\\s*=\\s*["\\\']'+value).test(html), key + ' must retain the original namespace');
  });
  await check(report, 'Personal registration and workspace authorization live in dedicated server module', () => {
    const module = read('functions/personal-workspace.js');
    const entry = read('functions/index.js');
    assert(entry.includes('./personal-workspace'));
    for (const api of ['submitPersonalRegistration', 'getPersonalAccountStatus', 'listPersonalRegistrations', 'approvePersonalAccount', 'openIndividualWorkspace', 'importPersonalStudents', 'setPersonalAcademicStatus'])
      assert(entry.includes(api) || module.includes(api), 'Missing API: ' + api);
    assert(module.includes('HATHIR_OWNER_UID_REQUIRED'));
    assert(/emailVerified/.test(module), 'Server must verify the Auth record');
    assert(/workspaceId\s*!==\s*uid|workspaceId\s*!==\s*request\.auth\.uid|workspaceId\s*===\s*uid/.test(module), 'Explicit private workspace identity check missing');
  });
  saveReport(report, 'security-isolation-static');
})().catch(error => { report.cases.push({ label: 'Harness startup', passed: false, error: error.stack }); saveReport(report, 'security-isolation-static'); });

