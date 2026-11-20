'use strict';
const vm=require('node:vm');
const {APP,REPORTS,assert,fs,path,launch,makeReport,check,saveReport}=require('./offline-harness.cjs');
const report=makeReport('record-expansion');
const source=fs.readFileSync(path.join(__dirname,'personal-ui-regression.cjs'),'utf8');
const fixture=vm.runInNewContext(source.slice(source.indexOf('async function installCallables'),source.indexOf('const row ='))+';({installWorkspace})');
let harness;
(async()=>{
 harness=await launch(report);
 for(const width of [390,1440])for(const fallback of [true,false]){
  await check(report,`Record expands and restores at ${width}px, native fullscreen ${!fallback}`,async()=>{
   const {page,context}=await harness.page({width});
   try{
    await page.waitForFunction(()=>!!window.HathirPersonal);await fixture.installWorkspace(page);await page.evaluate(()=>{document.body.classList.remove('beginnerSimplified','beginnerRecordVisible');const css=[...document.styleSheets].find(x=>x.href?.includes('beginner-ui.css'));if(css)css.disabled=true;});
    await page.evaluate(()=>document.fonts.ready);
    const fonts=await page.evaluate(async()=>({family:getComputedStyle(document.body).fontFamily,loaded:(await document.fonts.load('400 16px Tajawal','سجل الحضور')).map(font=>font.status)}));
    assert(fonts.family.startsWith('Tajawal'));assert(fonts.loaded.length&&fonts.loaded.every(status=>status==='loaded'));
    if(fallback)await page.evaluate(()=>{document.documentElement.requestFullscreen=undefined;document.documentElement.webkitRequestFullscreen=undefined;});
    assert.equal(await page.locator('#absentCount,[data-i18n="absentToday"]').count(),0);
    assert.equal(await page.locator('#attendanceView .stats > article').count(),3);
    const original=await page.locator('#rosterRows').textContent();
    const status=page.locator('[data-personal-status="MI20250001"]');
    assert.equal(await status.isEnabled(),true);
    const button=page.locator('#expandAttendanceRecordBtn');await button.click();
    await page.waitForFunction(()=>document.getElementById('expandAttendanceRecordBtn').getAttribute('aria-expanded')==='true');
    const size=await page.evaluate(()=>{const r=document.getElementById('attendanceRecordCard').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight};});
    assert(Math.abs(size.x)<1&&Math.abs(size.y)<1);assert(Math.abs(size.w-size.vw)<2&&Math.abs(size.h-size.vh)<2);
    const tableSpace=await page.evaluate(()=>{const card=document.getElementById('attendanceRecordCard'),table=card.querySelector('.tableWrap');return {bottom:table.getBoundingClientRect().bottom,cardBottom:card.getBoundingClientRect().bottom,padding:parseFloat(getComputedStyle(card).paddingBottom)};});
    assert(Math.abs(tableSpace.cardBottom-tableSpace.bottom-tableSpace.padding)<3,'Expanded table must fill the available height without an empty lower area');
    assert.equal(await page.locator('#rosterRows').textContent(),original);
    await status.selectOption('مستوفي');
    await page.waitForFunction(()=>subjects.find(s=>s.id===document.querySelector('[data-personal-status="MI20250001"]').dataset.subjectId)?.academicStatuses?.MI20250001==='مستوفي');
    await page.evaluate(()=>{offlineQueueCount=1;offlinePendingSubjectIds=new Set([subjects[0].id]);renderRoster();});
    assert.equal(await status.count(),1,'Pending synchronization must not remove the dropdown');
    assert.equal(await status.isDisabled(),true);
    assert.equal(await page.locator('#academicStatusAvailability').isVisible(),true);
    await page.evaluate(async()=>{offlineActionAvailabilityState='synthetic-pending';await offlineStatus();});
    assert.equal(await status.isEnabled(),true,'Synchronization completion must re-enable the existing control');
    if(fallback){const file=path.join(REPORTS,`expanded-record-${width}.png`);await page.screenshot({path:file});report.screenshots.push(file);}
    await button.click();await page.waitForFunction(()=>!document.body.classList.contains('rosterExpanded'));
    assert.equal(await button.getAttribute('aria-expanded'),'false');
    await status.selectOption('');
    await page.waitForFunction(()=>!subjects.find(s=>s.id===document.querySelector('[data-personal-status="MI20250001"]').dataset.subjectId)?.academicStatuses?.MI20250001);
    assert.equal(await status.isEnabled(),true);
    if(fallback){await button.click();await page.keyboard.press('Escape');assert.equal(await button.getAttribute('aria-expanded'),'false');}
    await button.click();await page.evaluate(()=>{document.getElementById('appPage').hidden=true;});
    await page.waitForFunction(()=>!document.body.classList.contains('rosterExpanded'));
   }finally{await context.close();}
  });
 }
 await check(report,'No uncaught browser errors',()=>assert.deepEqual(report.pageErrors,[]));
})().catch(error=>report.cases.push({label:'setup',passed:false,error:error.stack})).finally(async()=>{if(harness)await harness.close();saveReport(report,'record-expansion');});
