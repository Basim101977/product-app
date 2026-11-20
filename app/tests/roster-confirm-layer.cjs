'use strict';
const path=require('node:path');
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs');
const report=makeReport('roster-confirm-layer');
(async()=>{const harness=await launch(report);try{
 const {page}=await harness.page();
 await page.evaluate(()=>{
  const record=document.createElement('dialog');record.id='qaRecordLayer';record.style.cssText='width:90vw;height:80vh';record.textContent='سجل الحضور';document.body.append(record);record.showModal();
  window.qaSubject={id:'test',titleAr:'دوائر إلكترونية صباحي',titleEn:'Test subject'};lang='ar';
 });
 for(const width of [1440,390])await check(report,'Confirmation is above an open modal and cancel preserves it at width '+width,async()=>{
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>{window.qaConfirmed='pending';confirmSubjectRosterReset(qaSubject).then(value=>qaConfirmed=value);});
  const input=page.locator('#rosterResetConfirm input');await input.fill('مسح');
  assert(await page.evaluate(()=>{const el=document.querySelector('#rosterResetConfirm input'),r=el.getBoundingClientRect();return document.getElementById('rosterResetConfirm').matches(':modal')&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;}));
  assert(await page.evaluate(()=>{const el=document.getElementById('rosterResetConfirm');return el.scrollWidth<=el.clientWidth;}));
  if(width===390)await page.screenshot({path:path.resolve(__dirname,'../reports/roster-confirm-mobile.png')});
  await input.press('Escape');await page.waitForFunction(()=>qaConfirmed===false);
  assert(await page.locator('#qaRecordLayer').isVisible());
 });
 await check(report,'Confirmation still requires the exact word and resolves once without deleting data',async()=>{
  await page.evaluate(()=>{window.qaConfirmed='pending';confirmSubjectRosterReset(qaSubject).then(value=>qaConfirmed=value);});
  const proceed=page.locator('#rosterResetConfirm .danger');assert(!await proceed.isEnabled());
  await page.locator('#rosterResetConfirm input').fill('مسح');assert(await proceed.isEnabled());
  await proceed.click();await page.waitForFunction(()=>qaConfirmed===true);assert(await page.locator('#qaRecordLayer').isVisible());
  assert.equal(await page.evaluate(()=>personalFixture.writes.length),0);
 });
}finally{await harness.close();saveReport(report,'roster-confirm-layer');}})().catch(error=>{console.error(error);process.exitCode=1;});
