'use strict';

// One entry point, local-only. The emulator command itself verifies the cached
// binary hash, starts an isolated demo project, and terminates its owned child.
const { spawn } = require('node:child_process');
const { APP, REPORTS, fs, path } = require('./offline-harness.cjs');
const backendFiles = fs.readdirSync(path.join(APP, 'functions/test')).filter(file => /\.test\.(?:js|cjs)$/.test(file))
  .map(file => path.join('functions/test', file));
const suites = [
  {name:'civil-defaults',args:['tests/civil-defaults.cjs'],report:'civil-defaults.json'},
  {name:'department-tools',args:['tests/department-tools.cjs'],report:'department-tools.json'},
  {name:'home-record-scroll',args:['tests/home-record-scroll.cjs'],report:'home-record-scroll.json'},
  {name:'owner-requests-sidebar',args:['tests/local-owner-requests.cjs'],report:'local-owner-requests.json'},
  {name:'consolidation',args:['tests/consolidation-ui.cjs'],report:'consolidation-ui.json'},
  {name:'admin-options',args:['tests/admin-options-ui.cjs'],report:'admin-options-ui.json'},
  {name:'roster700',args:['tests/roster700-ui.cjs'],report:'roster700-ui.json'},
  {name:'subject-tools',args:['tests/subject-tools-regression.cjs'],report:'subject-tools-local.json'},
  {name:'current-auth',args:['tests/release-current-auth.cjs'],report:'release-current-auth.json'},
  {name:'device-workspace',args:['tests/device-workspace-regression.cjs'],report:'device-workspace-regression.json'},
  {name:'device-live',args:['tests/device-live-regression.cjs'],report:'device-live-regression.json'},
  {name:'private-scope',args:['tests/private-scope-ui.cjs'],report:'private-scope-ui.json'},
  {name:'live-attendance',args:['tests/live-attendance-regression.cjs'],report:'live-attendance.json'},
  {name:'beginner-ui',args:['tests/beginner-ui-regression.cjs'],report:'beginner-ui-regression.json'},
  // Centralized roster publishing was retired in release 105. Private scope
  // acceptance/distribution is exercised by the mandatory private-scope suite.
  {name:'shared-rosters-retirement',args:['tests/shared-rosters-retirement.cjs'],report:'shared-rosters-retirement.json'},
  {name:'performance',args:['tests/performance-regression.cjs'],report:'performance-regression.json'},
  { name: 'onboarding', args: ['tests/onboarding-regression.cjs'], report: 'onboarding-regression.json' },
  { name: 'trial-reset', args: ['tests/trial-reset-regression.cjs'], report: 'trial-reset-regression.json' },
  { name: 'profile-qr', args: ['tests/profile-qr-regression.cjs'], report: 'profile-qr-regression.json' },
  { name: 'name-roster', args: ['tests/name-roster-regression.cjs'], report: 'name-roster-regression.json' },
  { name: 'auth-startup', args: ['tests/auth-startup-regression.cjs'], report: 'auth-startup-regression.json' },
  { name: 'student-profile', args: ['tests/student-profile-regression.cjs'], report: 'student-profile-regression.json' },
  { name: 'record-expansion', args: ['tests/record-expansion.cjs'], report: 'record-expansion.json' },
  { name: 'stability', args: ['tests/stability-regression.cjs'], report: 'stability-regression.json' },
  { name: 'promotion', args: ['tests/promotion-regression.cjs'], report: 'promotion-regression.json' },
  { name: 'service-worker-upgrade', args: ['tests/service-worker-upgrade.cjs'], report: 'service-worker-upgrade.json' },
  { name: 'function-metadata', args: ['tests/function-metadata-static.cjs'], report: 'function-metadata-static.json' },
  { name: 'static', args: ['tests/security-isolation-static.cjs'], report: 'security-isolation-static.json' },
  { name: 'backend', args: ['--test', ...backendFiles], report: 'backend-unit-tests.json' },
  { name: 'browser', args: ['tests/personal-ui-regression.cjs'], report: 'personal-ui-regression.json' },
  { name: 'prefixes', args: ['tests/department-prefix-regression.cjs'], report: 'department-prefix-regression.json' },
  { name: 'name-qr-unit', args: ['tests/name-qr-unit.cjs'], report: 'name-qr-unit.json' },
  { name: 'name-only-ui', args: ['tests/name-only-ui-regression.cjs'], report: 'name-only-ui-regression.json' },
  { name: 'name-qr-browser', args: ['tests/name-qr-regression.cjs'], report: 'name-qr-regression.json' },
  { name: 'sync-transport', args: ['tests/sync-transport-regression.cjs'], report: 'sync-transport-regression.json' },
  { name: 'emulator', args: ['tests/personal-rules-emulator.cjs'], report: 'personal-rules-emulator.json' }
];
const results = [];
async function run(suite) {
  const startedAt = Date.now();
  const result = await new Promise(resolve => {
    let output = '';
    const child = spawn(process.execPath, suite.args, { cwd: APP, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
    child.once('error', error => resolve({ passed: false, output: output + error.stack }));
    child.once('exit', code => resolve({ passed: code === 0, exitCode: code, output }));
  });
  fs.mkdirSync(REPORTS, { recursive: true });
  if (suite.name === 'backend') {
    fs.writeFileSync(path.join(REPORTS, suite.report), JSON.stringify({ checkedAt: new Date().toISOString(), ...result,
      mode: 'synthetic-transaction-mocks', cloudWrites: 0, credentialsRead: false,
      tests: Number(result.output.match(/# tests (\d+)/)?.[1] || 0), failed: Number(result.output.match(/# fail (\d+)/)?.[1] || 0) }, null, 2) + '\n');
  }
  const reportPath = path.join(REPORTS, suite.report);
  const detail = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {};
  results.push({ suite: suite.name, passed: result.passed, elapsedMs: Date.now() - startedAt,
    total: detail.cases?.length || detail.tests || 0, report: reportPath });
  console.log((result.passed ? 'PASS' : 'FAIL') + ' ' + suite.name + ' (' + results.at(-1).total + ' cases)');
  if (!result.passed) console.error(result.output);
}
(async () => {
  for (const suite of suites) await run(suite);
  const summary = { checkedAt: new Date().toISOString(), passed: results.every(row => row.passed),
    cloudWrites: 0, productionDataRead: false, credentialsRead: false, syntheticOnly: true,
    total: results.reduce((sum, row) => sum + row.total, 0), results };
  fs.writeFileSync(path.join(REPORTS, 'local-regression-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary)); if (!summary.passed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
