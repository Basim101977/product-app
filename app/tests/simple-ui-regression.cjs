'use strict';

// Opt-in simplified interface over the existing app. Synthetic students, the
// loopback Firebase mock and the existing offline queue; no cloud calls.
const vm = require('node:vm');
const { REPORTS, assert, fs, path, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const report = makeReport('simple-ui-regression');
const source = fs.readFileSync(path.join(__dirname, 'name-qr-regression.cjs'), 'utf8');
const { installWorkspace } = vm.runInNewContext(source.slice(source.indexOf('async function installWorkspace'),
  source.indexOf('async function currentState')) + ';({installWorkspace})');
const FIRST = 'فاطمه عبدالله احمد', SECOND = 'سارة محمد علي';

const state = page => page.evaluate(async () => {
  const s = attendanceView(), key = currentLectureKey(s);
  return { ops: (await HathirOfflineStore.operations(personalFixture.uid)).map(o => ({ kind: o.kind, studentId: o.studentId })),
    marked: s.students.filter(x => getAttendanceRecord(s, key, x.id)).map(x => x.id), writes: personalFixture.writes.length };
});
const row = (page, name) => page.locator('#simpleUi .suRow', { hasText: name });

(async () => {
  const harness = await launch(report);
  try {
    for (const width of [390, 1440]) {
      const { page, context } = await harness.page({ width });
      let dialogs = 0; page.on('dialog', d => { dialogs++; d.dismiss(); });
      try {
        await installWorkspace(page);
        await check(report, `${width}px classic interface stays the default until the simple interface is enabled`, async () => {
          assert.equal(await page.locator('#simpleUi').isVisible().catch(() => false), false);
          assert.equal(await page.evaluate(() => document.body.classList.contains('simpleUi')), false);
          await page.evaluate(() => HathirSimpleUI.enable());
          await page.locator('#simpleUi .suPrimary').waitFor();
          assert.equal(await page.evaluate(() => localStorage.getItem('hathir-simple-ui')), '1');
        });

        await check(report, `${width}px today screen shows the subject, the lecture count and one main action`, async () => {
          const view = page.locator('#suView');
          assert((await view.innerText()).includes('مادة الأسماء الأولى'));
          assert.equal((await page.locator('[data-su-count]').innerText()).trim(), '0 من 2');
          assert.equal(await page.locator('#simpleUi .suPrimary').count(), 1);
          assert.equal(await page.locator('#suNav button').count(), 4);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await page.screenshot({ path: path.join(REPORTS, `simple-ui-today-${width}.png`) });
        });

        await check(report, `${width}px a single tap does not mark; a double tap marks once through the existing queue`, async () => {
          await page.locator('[data-su="names"]').click();
          await row(page, FIRST).click();
          await page.waitForTimeout(650);
          assert.deepEqual((await state(page)).marked, []);
          await row(page, FIRST).click(); await row(page, FIRST).click();
          await page.waitForFunction(() => { const s = attendanceView(); return !!getAttendanceRecord(s, currentLectureKey(s), 'MI20250001'); });
          const after = await state(page);
          assert.deepEqual(after.marked, ['MI20250001']);
          assert.deepEqual(after.ops.map(o => o.studentId), ['MI20250001']);
          assert.equal(after.writes, 0);
          await page.locator('#simpleUi .suToast').waitFor();
          await page.waitForFunction(() => document.querySelector('#simpleUi .suRow .suCheck.on'));
          await page.screenshot({ path: path.join(REPORTS, `simple-ui-names-${width}.png`) });
        });

        await check(report, `${width}px undo removes the mark through unmarkAttendance without a native dialog`, async () => {
          await page.locator('#simpleUi .suToast button').click();
          await page.waitForFunction(() => { const s = attendanceView(); return !getAttendanceRecord(s, currentLectureKey(s), 'MI20250001'); });
          assert.equal(dialogs, 0);
          assert.equal(await page.evaluate(() => typeof window.confirm === 'function' && !String(window.confirm).includes('=> true')), true, 'window.confirm restored');
        });

        await check(report, `${width}px tapping a present student opens details; removal needs an in-page confirmation`, async () => {
          await row(page, SECOND).click(); await row(page, SECOND).click();
          await page.waitForFunction(() => { const s = attendanceView(); return !!getAttendanceRecord(s, currentLectureKey(s), 'MI20250002'); });
          await page.locator('#simpleUi .suToast').evaluate(el => el.remove());
          await row(page, SECOND).click();
          await page.locator('#simpleUi .suSheet [data-x="remove"]').click();
          assert.deepEqual((await state(page)).marked, ['MI20250002'], 'first press only asks');
          await page.locator('#simpleUi .suSheet [data-x="yes"]').click();
          await page.waitForFunction(() => { const s = attendanceView(); return !getAttendanceRecord(s, currentLectureKey(s), 'MI20250002'); });
          assert.equal(dialogs, 0);
        });

        await check(report, `${width}px search and filters narrow the list`, async () => {
          await page.locator('#suSearch').fill('سارة');
          assert.equal(await page.locator('#simpleUi .suRow').count(), 1);
          await page.locator('#suSearch').fill('');
          await page.locator('[data-su-filter="present"]').click();
          assert.equal(await page.locator('#simpleUi .suRow').count(), 0);
          await page.locator('[data-su-filter="all"]').click();
          assert.equal(await page.locator('#simpleUi .suRow').count(), 2);
        });

        await check(report, `${width}px students, record and more tabs render from the existing statistics`, async () => {
          await page.locator('[data-su="back"]').click();
          await page.locator('[data-su-tab="students"]').click();
          assert.equal(await page.locator('#simpleUi .suStudent').count(), 2);
          assert.equal(await page.locator('#simpleUi .suSummary button').count(), 4);
          const counted = await page.locator('#simpleUi .suSummary b').allInnerTexts();
          const note = await page.locator('#suView .suHint').allInnerTexts();
          // Every student is either counted in a status or explained in the note.
          assert.equal(counted.reduce((n, v) => n + Number(v), 0) + (note.length ? Number(note[0].match(/\d+/)[0]) : 0), 2);
          await page.screenshot({ path: path.join(REPORTS, `simple-ui-students-${width}.png`) });
          await page.locator('[data-su-tab="records"]').click();
          await page.locator('#simpleUi [data-su="fullRecord"]').waitFor();
          await page.locator('[data-su-tab="more"]').click();
          await page.locator('#simpleUi [data-su="classic"]').waitFor();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        });

        await check(report, `${width}px the classic switch restores the existing interface and forgets the preference`, async () => {
          await page.locator('#simpleUi [data-su="classic"]').click();
          await page.waitForFunction(() => document.getElementById('simpleUi').hidden && !document.body.classList.contains('simpleUi'));
          assert.equal(await page.evaluate(() => localStorage.getItem('hathir-simple-ui')), null);
          assert.equal(await page.locator('#appPage').isVisible(), true);
          const s = await state(page);
          assert.equal(s.writes, 0);
          assert.deepEqual(report.pageErrors, []);
        });
      } finally { await context.close(); }
    }
  } finally { await harness.close(); }
})().catch(error => report.cases.push({ label: 'setup', passed: false, error: error.stack }))
  .finally(() => { saveReport(report, 'simple-ui-regression'); if (!report.passed) process.exitCode = 1; });
