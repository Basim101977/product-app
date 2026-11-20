const {assert,makeReport,check,saveReport}=require('./offline-harness.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const report=makeReport('name-attendance-toggle');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
 for(const width of [390,1440])await check(report,'Name activation confirms removal, cancel preserves attendance, and can register again: '+width,async()=>{
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390,serviceWorkers:'block'});
  await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4199/')?r.continue():r.abort());
  const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.goto('http://127.0.0.1:4199/');await page.locator('[data-preview-scan="matching"]').click();
  await page.waitForFunction(()=>getSubject().students.length===1);
  const state=()=>page.evaluate(()=>{const s=getSubject(),id=s.students[0].id;return {id,record:getAttendanceRecord(s,currentLectureKey(s),id),count:s.students.length};});
  const before=await state();assert(before.record);
  await page.evaluate(()=>{const s=getSubject(),id=s.students[0].id;s.attendance['2026-11-01']={[id]:{time:'08:00',attendedMinutes:120}};});
  async function activate(){
   const rail=page.locator('.rosterNameRail .rosterFullName[data-name-attendance]').first();
   const name=await rail.isVisible()?rail:page.locator('#rosterRows .rosterFullName[data-name-attendance]').first();
   if(width===390){await name.tap();await name.tap();}else await name.dblclick();
  }
  let dialogs=0;
  page.once('dialog',async d=>{dialogs++;assert(d.message().includes('إلغاء حضور'));await d.dismiss();});
  await activate();assert.equal(dialogs,1);assert.deepEqual((await state()).record,before.record);
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#rosterRows td')].some(c=>getComputedStyle(c).boxShadow.includes('239, 68, 68'))),false);
  await page.waitForTimeout(750);
  page.once('dialog',async d=>{dialogs++;await d.accept();});
  await activate();await page.waitForFunction(()=>{const s=getSubject();return !getAttendanceRecord(s,currentLectureKey(s),s.students[0].id);});
  assert.equal(dialogs,2);assert.equal((await state()).count,1);
  await page.waitForFunction(()=>[...document.querySelectorAll('#rosterRows td')].some(c=>getComputedStyle(c).boxShadow.includes('239, 68, 68')));
  assert(await page.evaluate(()=>{const cells=[...document.querySelectorAll('#rosterRows td')].filter(c=>c.getAnimations().length);return cells.length===2&&cells.every(c=>c.classList.contains('name')||c.dataset.attendanceDate===currentLectureKey(getSubject()));}));
  await page.locator('#attendanceRecordCard').screenshot({path:require('path').join(__dirname,'../reports/attendance-removal-'+width+'.png')});
  // Animation completion and its cleanup timer run on separate browser tasks.
  await page.waitForFunction(()=>attendanceRowFlashes.size===0&&[...document.querySelectorAll('#rosterRows td,.rosterRailCell')].every(c=>c.getAnimations().length===0));
  assert.equal(await page.evaluate(()=>attendanceRowFlashes.size),0);
  assert.equal(await page.evaluate(()=>getSubject().attendance['2026-11-01'][getSubject().students[0].id].time),'08:00');
  await page.waitForTimeout(750);await activate();
  await page.waitForFunction(()=>{const s=getSubject();return !!getAttendanceRecord(s,currentLectureKey(s),s.students[0].id);});
  await page.waitForTimeout(750);
  page.once('dialog',d=>d.accept());await activate();
  await page.waitForFunction(()=>{const s=getSubject();return !getAttendanceRecord(s,currentLectureKey(s),s.students[0].id);});
  await page.reload();await page.locator('[data-preview-scan="matching"]').waitFor();
  const persisted=await page.evaluate(id=>{const s=localData.subjects.preview_qr_empty;return {count:s.students.length,marks:Object.entries(s.attendance).filter(([date])=>date!=='2026-11-01').some(([,day])=>!!day[id]),historical:s.attendance['2026-11-01'][id].time};},before.id);
  assert.equal(persisted.marks,false);assert.equal(persisted.count,1);assert.equal(persisted.historical,'08:00');
  await context.close();
 });
 assert.deepEqual(report.pageErrors,[]);
}finally{await browser.close();saveReport(report,'name-attendance-toggle');}})().catch(e=>{console.error(e);process.exitCode=1;});
