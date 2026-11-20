'use strict';
const {launch,makeReport,check,saveReport,assert,fs,path,APP}=require('./offline-harness.cjs'),vm=require('vm');
const src=fs.readFileSync(path.join(APP,'tests/personal-ui-regression.cjs'),'utf8');
const fixture=vm.runInNewContext(src.slice(src.indexOf('async function installCallables'),src.indexOf('const row ='))+';({installWorkspace})');
const report=makeReport('account-presence-ui');
(async()=>{const h=await launch(report);try{
 const {page:p,context:c}=await h.page({width:390});try{
 await p.waitForFunction(()=>!!window.HathirBeginnerUI);await fixture.installWorkspace(p);
 await check(report,'Private workspace owner displays Teacher without changing permissions',async()=>{
  await p.evaluate(()=>{renderAll();HathirBeginnerUI.refresh?.();});
  assert.equal(await p.locator('#beginnerMenuRole').textContent(),'تدريسي');
  assert.equal(await p.evaluate(()=>session.role),'owner');
 });
 await check(report,'Only pinned owner label uses System owner',async()=>{
  await p.evaluate(()=>{window.savedOwnerCheck=isPlatformOwnerEmail;isPlatformOwnerEmail=()=>true;renderAll();});
  assert.equal(await p.locator('#beginnerMenuRole').textContent(),'مالك النظام');
  await p.evaluate(()=>{isPlatformOwnerEmail=savedOwnerCheck;renderAll();});
 });
 await p.evaluate(()=>{
  session.local=false;window.presenceCalls=[];window.presenceFail=false;const prior=fixtureInvoke;
  fixtureInvoke=async(name,data)=>{if(name!=='accountPresence')return prior(name,data);presenceCalls.push(data);if(presenceFail)throw Error('offline');return data.action==='beat'?{ok:true}:{accounts:data.uids.map((uid,i)=>({uid,online:i===0,lastSeen:Date.now()-500000}))};};
 });
 await check(report,'Heartbeat is throttled; hidden owner panel makes no list requests',async()=>{
  await p.evaluate(()=>window.dispatchEvent(new Event('online')));
  await p.waitForFunction(()=>presenceCalls.some(x=>x.action==='beat'));
  await p.evaluate(()=>{for(let i=0;i<5;i++)document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await p.evaluate(()=>presenceCalls.filter(x=>x.action==='beat').length),1);
  assert.equal(await p.evaluate(()=>presenceCalls.filter(x=>x.action==='list').length),0);
 });
 await check(report,'Owner rows show online and last seen independently',async()=>{
  await p.evaluate(()=>{canManageRegistration=()=>true;document.getElementById('ownerRegistrationModal').hidden=false;document.getElementById('ownerRequestsList').innerHTML='<p data-presence-uid="teacher_a"></p><p data-presence-uid="teacher_b"></p>';window.dispatchEvent(new Event('online'));});
  await p.waitForFunction(()=>document.querySelector('[data-presence-uid="teacher_a"]').textContent.includes('متصل الآن'));
  assert((await p.locator('[data-presence-uid="teacher_b"]').textContent()).includes('آخر ظهور'));
 });
 await check(report,'Presence failure does not block local attendance or leave a green status',async()=>{
  await p.evaluate(()=>{presenceFail=true;window.dispatchEvent(new Event('online'));});
  await p.waitForFunction(()=>document.querySelector('[data-presence-uid="teacher_a"]').textContent.includes('غير متاحة'));
  assert.equal(await p.evaluate(()=>session.role),'owner');
  assert.equal(await p.evaluate(()=>typeof renderAll),'function');
 });
 await check(report,'No uncaught browser errors',()=>assert.deepEqual(report.pageErrors,[]));
 }finally{await c.close();}
 }finally{await h.close();}})().catch(error=>report.cases.push({label:'Harness',passed:false,error:error.stack})).finally(()=>saveReport(report,'account-presence-ui'));
