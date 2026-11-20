const {assert,makeReport,check,saveReport,path}=require('./offline-harness.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const report=makeReport('attendance-row-feedback');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
 for(const width of [390,1440])await check(report,'Successful attendance fades, survives render, and duplicate does not flash: '+width,async()=>{
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
  await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4199/')?r.continue():r.abort());
  const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.goto('http://127.0.0.1:4199/');await page.locator('[data-preview-scan="matching"]').waitFor();
  await page.evaluate(()=>{window.flashCalls=0;const original=flashAttendanceRow;flashAttendanceRow=(...args)=>{window.flashCalls++;return original(...args);};});
  await page.locator('[data-preview-scan="department"]').click();assert.equal(await page.evaluate(()=>window.flashCalls),0);
  await page.locator('[data-preview-scan="matching"]').click();
  await page.waitForFunction(()=>window.flashCalls===1&&document.querySelector('#rosterRows td.name')?.getAnimations().length>0);
  const started=Date.now();
  assert(await page.evaluate(()=>{const cells=[...document.querySelectorAll('#rosterRows td')].filter(c=>c.getAnimations().length);return cells.length===2&&cells.every(c=>c.classList.contains('name')||c.dataset.attendanceDate===currentLectureKey(getSubject()));}));
  assert(await page.evaluate(()=>[...document.querySelectorAll('#rosterRows td')].some(c=>getComputedStyle(c).boxShadow.includes('34, 197, 94'))));
  await page.evaluate(()=>renderRoster());
  await page.waitForFunction(()=>document.querySelector('#rosterRows td.name')?.getAnimations().length>0);
  await page.locator('#attendanceRecordCard').screenshot({path:path.join(__dirname,'../reports/attendance-row-feedback-'+width+'.png')});
  await page.waitForFunction(()=>[...document.querySelectorAll('#rosterRows td,.rosterRailCell')].every(c=>c.getAnimations().length===0));
  assert(Date.now()-started<1800,'Rerender must not restart duration');
  await page.locator('[data-preview-scan="matching"]').click();assert.equal(await page.evaluate(()=>window.flashCalls),1);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{const s=getSubject();flashAttendanceRow(s.students[0].id,s,session.uid,session.workspaceId);});
  assert(await page.evaluate(()=>{const a=document.querySelector('#rosterRows td.name').getAnimations()[0];const k=a.effect.getKeyframes();return k[0].boxShadow===k[1].boxShadow;}));
  await context.close();
 });
}finally{await browser.close();saveReport(report,'attendance-row-feedback');}})().catch(e=>{console.error(e);process.exitCode=1;});
