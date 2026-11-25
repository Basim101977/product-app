'use strict';

// Subject settings from the simple interface save through the classic subject
// editor (opened hidden). Local synthetic workspace, as in subject-tools.
const vm = require('node:vm');
const { REPORTS, assert, fs, path, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const report = makeReport('simple-ui-settings');
const source = fs.readFileSync(path.join(__dirname, 'subject-tools-regression.cjs'), 'utf8');
const { setup } = vm.runInNewContext(source.slice(source.indexOf('async function setup'), source.indexOf('(async()=>')) + ';({setup})');

const editorClosed = page => page.evaluate(() => { const e = document.getElementById('subjectEditor'); return !e.open && e.style.visibility === ''; });

(async () => {
  const harness = await launch(report);
  try {
    for (const width of [390, 1280]) {
      const { page, context } = await harness.page({ width });
      try {
        await setup(page);
        await page.evaluate(() => { renderAll(); HathirSimpleUI.enable(); });
        await page.locator('#simpleUi .suPrimary').waitFor();
        const before = await page.evaluate(() => { const s = getSubject(); return { id: s.id, title: s.titleAr, metas: JSON.stringify(Object.fromEntries(Object.keys(s.lectureMeta || {}).map(k => [k, lectureMeta(s, k).durationHours]))) }; });

        await check(report, `${width}px settings open from More with the current values and the classic editor stays closed`, async () => {
          await page.locator('[data-su-tab="more"]').click();
          await page.locator('#simpleUi [data-su="subjectSettings"]').click();
          await page.locator('#suSubName').waitFor();
          assert.equal(await page.locator('#suSubName').inputValue(), before.title);
          assert.equal(await page.locator('#suSubHours').inputValue(), '60');
          assert.equal(await page.locator('#suSubDuration').inputValue(), '2');
          assert(await page.locator('#suSubSystem option').count() >= 2);
          assert(await editorClosed(page));
          await page.screenshot({ path: path.join(REPORTS, `simple-ui-settings-${width}.png`) });
        });

        await check(report, `${width}px invalid absence limits show the editor's own message and change nothing`, async () => {
          await page.locator('#suSub_notice').fill('20'); await page.locator('#suSub_warning').fill('10'); await page.locator('#suSub_fail').fill('30');
          await page.locator('#simpleUi [data-x="save"]').click();
          await page.waitForFunction(() => document.getElementById('suSubStatus')?.dataset.state === 'error');
          assert.equal(await page.evaluate(() => getSubject().absenceSettings?.notice ?? null) === 20, false);
          assert(await editorClosed(page));
          assert.equal(await page.locator('#suSubName').isEnabled(), true, 'fields are usable again');
        });

        await check(report, `${width}px choosing a teaching system fills its default limits`, async () => {
          const values = await page.evaluate(() => { const sel = document.getElementById('suSubSystem'); const other = [...sel.options].find(o => o.value !== sel.value).value; sel.value = other; sel.dispatchEvent(new Event('change')); return { other, expected: defaultAbsenceSettings(other) }; });
          for (const k of ['notice', 'warning', 'fail']) assert.equal(await page.locator('#suSub_' + k).inputValue(), String(values.expected[k] ?? ''));
        });

        await check(report, `${width}px saving updates name, hours, length and limits, keeping past lecture lengths`, async () => {
          await page.locator('#suSubName').fill('دوائر بإعدادات جديدة');
          await page.locator('#suSubHours').fill('70'); await page.locator('#suSubDuration').fill('3');
          await page.locator('#suSub_notice').fill('5'); await page.locator('#suSub_warning').fill('10'); await page.locator('#suSub_fail').fill('15');
          await page.locator('#simpleUi [data-x="save"]').click();
          await page.waitForFunction(() => !document.querySelector('#simpleUi .suSheet'));
          const after = await page.evaluate(id => { const s = subjects.find(x => x.id === id); return { title: s.titleAr, hours: s.totalHours, duration: s.lectureDurationHours, limits: s.absenceSettings, stored: localData.subjects[id].totalHours,
            metas: JSON.stringify(Object.fromEntries(Object.keys(s.lectureMeta || {}).map(k => [k, lectureMeta(s, k).durationHours]))) }; }, before.id);
          assert.equal(after.title, 'دوائر بإعدادات جديدة'); assert.equal(after.hours, 70); assert.equal(after.stored, 70); assert.equal(after.duration, 3);
          assert.deepEqual([after.limits.notice, after.limits.warning, after.limits.fail], [5, 10, 15]);
          assert.equal(after.metas, before.metas, 'past lecture lengths unchanged');
          assert(await editorClosed(page));
          assert.deepEqual(report.pageErrors, []);
        });
      } finally { await context.close(); }
    }
  } finally { await harness.close(); }
})().catch(error => report.cases.push({ label: 'setup', passed: false, error: error.stack }))
  .finally(() => { saveReport(report, 'simple-ui-settings'); if (!report.passed) process.exitCode = 1; });
