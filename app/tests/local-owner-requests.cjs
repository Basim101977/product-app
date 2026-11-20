'use strict';
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs');
const report=makeReport('local-owner-requests');
(async()=>{const harness=await launch(report);try{
 const {page}=await harness.page();
 await page.evaluate(async()=>{
  const uid=HATHIR_RUNTIME_CONFIG.ownerUid;
  personalFixture.uid=uid;personalFixture.email=HATHIR_RUNTIME_CONFIG.ownerEmail;personalFixture.verified=false;
  fixtureAuth.currentUser=fixtureUser();window.ownerProbeCalls=[];window.ownerProbeMode='pending';
  firebase.app=()=>({functions:()=>({httpsCallable:name=>async()=>{
   ownerProbeCalls.push(name);
   if(name==='getPersonalAccountStatus'){
    if(ownerProbeMode==='fail')throw Error('Synthetic network failure');
    if(ownerProbeMode==='pending')await new Promise(resolve=>{window.finishOwnerProbe=resolve;});
    return {data:{status:'approved',isPlatformOwner:true,emailVerificationRequired:false}};
   }
   if(name==='listPersonalRegistrations')return {data:{pendingCount:2,requests:[]}};
   throw Error('Unexpected callable');
  }})});
  const owner={uid,workspaceId:uid,role:'owner',active:true,local:false,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};
  const data={workspace:{id:uid,ownerUid:uid},users:{[uid]:owner},departments:Object.fromEntries(defaultDepartments().map(d=>[d.id,d])),stages:Object.fromEntries(defaultStages().map(s=>[s.id,s])),subjects:{}};
  await HathirDeviceStore.save({uid,session:owner,data,base:null,pendingClose:0,legacyOperations:[]},0);
  await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
 });
 await check(report,'Restoring local owner data does not wait for the account status request',async()=>{
  await page.waitForFunction(()=>typeof finishOwnerProbe==='function');
  const state=await page.evaluate(()=>({active:HathirDeviceWorkspace.active(),visible:!els.appPage.hidden,allowed:canManageRegistration()}));
  assert.deepEqual(state,{active:true,visible:true,allowed:false});
 });
 await check(report,'Server-confirmed legacy owner sees Requests in sidebar, outside Settings',async()=>{
  await page.evaluate(async()=>{finishOwnerProbe();await HathirPersonal.refreshOwnerAccess();ownerProbeMode='success';HathirSettings.open();await HathirPersonal.refreshOwnerAccess();});
  await page.waitForFunction(()=>document.getElementById('settingsInvitesSection').hidden&&!document.getElementById('ownerRegistrationBtn').hidden);
  assert.equal(await page.locator('#settingsModal #ownerRegistrationBtn').count(),0);assert.equal(await page.locator('#beginnerMenuItems #ownerRegistrationBtn').count(),1);assert(await page.locator('#settingsRequestBadge').isHidden());
  assert.equal(await page.evaluate(()=>canManageRegistration()),true);
 });
 await check(report,'Sidebar request badge is retained and owner can open Requests directly',async()=>{
  await page.waitForFunction(()=>document.getElementById('ownerRequestBadge').textContent==='2');await page.evaluate(()=>HathirSettings.close(false));await page.locator('#beginnerMenuButton').click();assert(await page.locator('#ownerRegistrationBtn').isVisible());assert.equal(await page.locator('#ownerRequestBadge').textContent(),'2');const order=await page.evaluate(()=>[...document.querySelectorAll('#beginnerMenuItems>button')].filter(b=>!b.hidden).sort((a,b)=>Number(a.style.order)-Number(b.style.order)).map(b=>b.id));assert.deepEqual(order,['ownerRegistrationBtn','consolidationOpen','announcementsOpen','settingsBtn','tourReplay','syncBtn']);await page.setViewportSize({width:390,height:844});await page.locator('.beginnerSideMenu').evaluate(async el=>{getComputedStyle(el).translate;await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});await page.mouse.move(380,840);const icons=await page.evaluate(()=>[...document.querySelectorAll('#beginnerMenuItems>button')].filter(b=>!b.hidden).map(b=>{const r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect();return {x:i.x,width:i.width,height:i.height,offset:Math.abs(i.y+i.height/2-r.y-r.height/2)};}));assert(Math.max(...icons.map(i=>i.x))-Math.min(...icons.map(i=>i.x))<1,JSON.stringify(icons));assert(icons.every(i=>i.width===24&&i.height===24&&i.offset<1.5),JSON.stringify(icons));await page.screenshot({path:require('node:path').join(__dirname,'../reports/sidebar-requests-phone.png')});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:require('node:path').join(__dirname,'../reports/sidebar-requests-desktop.png')});await page.locator('#ownerRegistrationBtn').click();assert(await page.locator('#ownerRegistrationModal').isVisible());assert(await page.locator('#settingsModal').isHidden());assert(!(await page.locator('body').evaluate(b=>b.classList.contains('beginnerMenuOpen'))));await page.locator('#closeOwnerRegistrationBtn').click();await page.evaluate(()=>HathirSettings.open());
 });
 await check(report,'Account request failure does not block local work or close Settings',async()=>{
  await page.evaluate(async()=>{ownerProbeMode='fail';await HathirPersonal.refreshOwnerAccess();});
  assert.deepEqual(await page.evaluate(()=>({active:HathirDeviceWorkspace.active(),open:!document.getElementById('settingsModal').hidden})),{active:true,open:true});
 });
 await check(report,'Another account cannot inherit owner access or trigger owner refresh',async()=>{
  const state=await page.evaluate(async()=>{personalFixture.uid='qa_other';fixtureAuth.currentUser=fixtureUser();session={...session,uid:'qa_other',workspaceId:'qa_other'};const before=ownerProbeCalls.length;await HathirPersonal.refreshOwnerAccess();HathirSettings.render();return {allowed:canManageRegistration(),hidden:document.getElementById('settingsInvitesSection').hidden,buttonHidden:document.getElementById('ownerRegistrationBtn').hidden,calls:ownerProbeCalls.length-before};});
  assert.deepEqual(state,{allowed:false,hidden:true,buttonHidden:true,calls:0});
 });
}finally{await harness.close();saveReport(report,'local-owner-requests');}})().catch(error=>{console.error(error);process.exitCode=1;});
