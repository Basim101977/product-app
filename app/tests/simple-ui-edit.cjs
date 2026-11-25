'use strict';

// Rename and delete from the simple interface reuse saveStudentProfile and
// deleteStudentFromRoster with the profile window hidden. Synthetic roster,
// loopback Firestore fixture only.
const vm = require('node:vm');
const { REPORTS, assert, fs, path, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const report = makeReport('simple-ui-edit');
const source = fs.readFileSync(path.join(__dirname, 'personal-ui-regression.cjs'), 'utf8');
const fixture = vm.runInNewContext(source.slice(source.indexOf('async function installCallables'), source.indexOf('const row =')) + ';({installWorkspace})');

async function setup(page) {
  await page.waitForFunction(() => !!window.HathirPersonal);
  await fixture.installWorkspace(page);
  await page.evaluate(() => {
    subjects = [subjects[0]]; const s = subjects[0]; s.rosterSource = 'cohort'; s.faceTemplatesLoaded = true; s.faceTemplateDescriptors = new Map();
    s._rosterDocumentIds = Object.fromEntries(s.students.map(row => [row.id, row.id]));
    s._rosterBaseline = Object.fromEntries(s.students.map(row => [row.id, JSON.stringify([row.name, getFaceDescriptors(row)])]));
    const root = 'attendanceWorkspaces/' + session.uid + '/cohorts/' + cohortIdForSubject(s); personalFixture.records[root] = { rosterVersion: 1 };
    for (const row of s.students) personalFixture.records[root + '/students/' + row.id] = { id: row.id, name: row.name };
    renderAll(); HathirSimpleUI.enable();
  });
}
const card = (page, name) => page.locator('#simpleUi .suStudent', { hasText: name });

(async () => {
  const harness = await launch(report);
  try {
    for (const width of [390, 1440]) {
      const { page, context } = await harness.page({ width });
      let dialogs = 0; page.on('dialog', d => { dialogs++; d.dismiss(); });
      try {
        await setup(page);
        await page.locator('[data-su-tab="students"]').click();

        await check(report, `${width}px a student card opens a sheet with the editable name and the profile hidden`, async () => {
          await card(page, 'طالب بدون حالة').click();
          await page.locator('#suEditName').waitFor();
          assert.equal(await page.locator('#suEditName').inputValue(), 'طالب بدون حالة');
          assert.equal(await page.evaluate(() => els.studentProfileModal.hidden && !activeProfileStudentId), true, 'profile state is closed again');
          await page.screenshot({ path: path.join(REPORTS, `simple-ui-edit-${width}.png`) });
        });

        await check(report, `${width}px renaming saves through saveStudentProfile and updates the roster`, async () => {
          const writes = await page.evaluate(() => personalFixture.writes.length);
          await page.locator('#suEditName').fill('طالب باسم جديد');
          await page.locator('#simpleUi [data-x="rename"]').click();
          await page.waitForFunction(() => document.getElementById('suEditStatus')?.dataset.state === 'ok');
          assert.equal(await page.evaluate(() => getSubject().students.find(s => s.id === 'MI20250001').name), 'طالب باسم جديد');
          assert(await page.evaluate(n => personalFixture.writes.length > n, writes), 'a roster write was made');
          assert.equal(await page.evaluate(() => els.studentProfileModal.hidden && !activeProfileStudentId), true);
          await page.locator('#simpleUi .suSheet [data-x="close"]').click();
          await card(page, 'طالب باسم جديد').waitFor();
        });

        await check(report, `${width}px delete asks in the sheet, then removes through deleteStudentFromRoster without a native dialog`, async () => {
          await card(page, 'طالب محمل').click();
          await page.locator('#simpleUi [data-x="delete"]').click();
          assert(await page.evaluate(() => getSubject().students.some(s => s.id === 'MI20250004')), 'first press only asks');
          await page.locator('#simpleUi [data-x="yes"]').click();
          await page.waitForFunction(() => !getSubject().students.some(s => s.id === 'MI20250004'));
          await page.waitForFunction(() => !document.querySelector('#simpleUi .suSheet'));
          assert.equal(await card(page, 'طالب محمل').count(), 0);
          assert.equal(dialogs, 0);
          assert.equal(await page.evaluate(() => typeof window.confirm === 'function' && !String(window.confirm).includes('=> true')), true, 'window.confirm restored');
        });

        await check(report, `${width}px when the classic profile would refuse edits offline, the sheet shows its reason and disables saving`, async () => {
          await page.evaluate(() => { session.offlineMode = true; });
          await card(page, 'طالب مستوفي').click();
          assert.equal(await page.locator('#suEditName').isDisabled(), true);
          assert.equal(await page.locator('#simpleUi [data-x="rename"]').isDisabled(), true);
          assert.match(await page.locator('#simpleUi .suSheet .suStatus[data-state="error"]').innerText(), /الإنترنت/);
          await page.locator('#simpleUi .suSheet [data-x="close"]').click();
          await page.evaluate(() => { session.offlineMode = false; });
        });

        await check(report, `${width}px the profile link opens the full classic profile for face and QR`, async () => {
          await card(page, 'طالب مستوفي').click();
          await page.locator('#simpleUi [data-x="profile"]').click();
          await page.waitForFunction(() => !els.studentProfileModal.hidden);
          assert.deepEqual(report.pageErrors, []);
        });
      } finally { await context.close(); }
    }
  } finally { await harness.close(); }
})().catch(error => report.cases.push({ label: 'setup', passed: false, error: error.stack }))
  .finally(() => { saveReport(report, 'simple-ui-edit'); if (!report.passed) process.exitCode = 1; });
