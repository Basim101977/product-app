'use strict';

// Adding students from the simple interface goes through the existing
// importParsedStudents / importStudentsFromFile and the synthetic
// importPersonalStudents callable. No cloud calls or real names.
const vm = require('node:vm');
const { REPORTS, assert, fs, path, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const report = makeReport('simple-ui-students');
const source = fs.readFileSync(path.join(__dirname, 'personal-ui-regression.cjs'), 'utf8');
const { installWorkspace } = vm.runInNewContext(source.slice(source.indexOf('async function installCallables'), source.indexOf('const row =')) + ';({installWorkspace})');
const imports = page => page.evaluate(() => personalFixture.calls.filter(c => c.name === 'importPersonalStudents').map(c => c.data.names));

(async () => {
  const harness = await launch(report);
  try {
    for (const width of [390, 1440]) {
      const { page, context } = await harness.page({ width });
      let dialogs = 0; page.on('dialog', d => { dialogs++; d.dismiss(); });
      try {
        await installWorkspace(page);
        await page.evaluate(() => HathirSimpleUI.enable());
        await page.locator('#simpleUi .suPrimary').waitFor();

        await check(report, `${width}px the add window opens from the students tab with the name field focused`, async () => {
          await page.locator('[data-su-tab="students"]').click();
          await page.locator('#simpleUi [data-su="addStudents"]').click();
          await page.locator('#suOneName').waitFor();
          assert.equal(await page.evaluate(() => document.activeElement?.id), 'suOneName');
          await page.screenshot({ path: path.join(REPORTS, `simple-ui-add-${width}.png`) });
        });

        await check(report, `${width}px a too-short name is refused before any request`, async () => {
          await page.locator('#suOneName').fill('عل');
          await page.locator('#simpleUi [data-x="one"]').click();
          assert.equal((await page.locator('#suAddStatus').getAttribute('data-state')), 'error');
          assert.deepEqual(await imports(page), []);
        });

        await check(report, `${width}px one name is added through importPersonalStudents and the window stays open for the next`, async () => {
          const before = await page.evaluate(() => getSubject().students.length);
          await page.locator('#suOneName').fill('  سارة   جديدة علي ');
          await page.locator('#suOneName').press('Enter');
          await page.waitForFunction(() => document.getElementById('suAddStatus')?.dataset.state === 'ok');
          assert.deepEqual(await imports(page), [['سارة جديدة علي']]);
          assert.equal(await page.locator('#suOneName').inputValue(), '');
          assert(await page.evaluate(n => getSubject().students.length > n, before));
        });

        await check(report, `${width}px a pasted list skips serial numbers and empty lines, then closes`, async () => {
          await page.locator('#suManyNames').fill('1. علي حسن محمد\n\n2) زينب عباس فاضل\n');
          assert.match(await page.locator('#simpleUi [data-x="many"]').innerText(), /2/);
          await page.locator('#simpleUi [data-x="many"]').click();
          await page.waitForFunction(() => !document.querySelector('#simpleUi .suSheet'));
          assert.deepEqual((await imports(page)).at(-1), ['علي حسن محمد', 'زينب عباس فاضل']);
        });

        await check(report, `${width}px a CSV file goes through the existing file import`, async () => {
          await page.locator('#simpleUi [data-su="addStudents"]').click();
          const file = path.join(REPORTS, 'simple-ui-names.csv');
          fs.writeFileSync(file, 'الاسم\nمريم سعد ناصر\nحسين كاظم جواد\n');
          await page.locator('#suNamesFile').setInputFiles(file);
          await page.waitForFunction(n => personalFixture.calls.filter(c => c.name === 'importPersonalStudents').length > n, (await imports(page)).length);
          assert.deepEqual((await imports(page)).at(-1), ['مريم سعد ناصر', 'حسين كاظم جواد']);
          await page.locator('#studentImportProgressStatus[data-state="success"]').waitFor();
          await page.keyboard.press('Escape');
        });

        await check(report, `${width}px no native dialogs, page errors or direct Firestore writes`, async () => {
          assert.equal(dialogs, 0);
          assert.deepEqual(report.pageErrors, []);
          assert.equal(await page.evaluate(() => personalFixture.writes.length), 0);
        });
      } finally { await context.close(); }
    }
  } finally { await harness.close(); }
})().catch(error => report.cases.push({ label: 'setup', passed: false, error: error.stack }))
  .finally(() => { saveReport(report, 'simple-ui-students'); if (!report.passed) process.exitCode = 1; });
