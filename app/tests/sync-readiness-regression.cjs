'use strict';
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs'),fixture=require('../functions/test/live-fixture.cjs');
const report=makeReport('sync-readiness-regression');
(async()=>{
 const harness=await launch(report),server=fixture();let clients=[];
 try{
  async function device(){
   const client=await harness.page();clients.push(client);const {page,context}=client;
   await page.clock.setFixedTime(new Date('2026-09-27T06:05:00Z'));await context.setOffline(true);
   let pushed=0;client.pushed=()=>pushed;const uid=await page.evaluate(()=>personalFixture.uid);await page.exposeFunction('liveTransport',payload=>{if(payload.action==='push')pushed+=payload.operations.length;return server.call(payload,uid);});
   await page.evaluate(async()=>{
    personalFixture.verified=true;personalFixture.accountStatus='approved';fixtureAuth.currentUser=fixtureUser();lang='ar';const uid=personalFixture.uid;
    const owner={uid,workspaceId:uid,role:'owner',active:true,local:false,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};
    const subject={id:'qa_live',titleAr:'اختبار المزامنة',titleEn:'Live QA',ownerUserId:uid,departmentId:DEFAULT_DEPARTMENT_ID,stageId:DEFAULT_STAGE_ID,totalHours:60,lectureDurationHours:2,students:[{id:'A',name:'أحمد'},{id:'B',name:'علي'}],attendance:{},lectures:[],lectureMeta:{},excuses:{},archivedStudents:[]};
    const data={workspace:{id:uid,ownerUid:uid},users:{[uid]:owner},departments:Object.fromEntries(defaultDepartments().map(d=>[d.id,d])),stages:Object.fromEntries(defaultStages().map(s=>[s.id,s])),subjects:{qa_live:subject}};
    await HathirDeviceStore.save({uid,session:owner,data,base:null,pendingClose:0,legacyOperations:[]},0);
    firebase.app=()=>({functions:()=>({httpsCallable:name=>async payload=>({data:name==='deviceLiveSync'?await liveTransport(payload):payload.action==='head'?{revision:null,count:0}:payload.action==='commit'?{revision:payload.revision}:{stored:true}})})});
    enableAudio=async()=>true;beep=async()=>true;vibrate=()=>{};
    await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
   });
   await context.setOffline(false);await page.evaluate(()=>HathirDeviceWorkspace.runLive());return client;
  }
  const a=await device(),b=await device();
  await check(report,'Fresh matching device does not send duplicate bootstrap records',async()=>{assert.equal(b.pushed(),0);});
  await check(report,'Confirmed empty queue stays green without a background-check spinner',async()=>{
   await a.page.evaluate(()=>{const original=liveTransport;window.liveTransport=async payload=>{if(payload.action==='pull'&&!window.readinessHeld){window.readinessHeld=true;await new Promise(resolve=>window.releaseReadiness=resolve);}return original(payload);};window.readinessRun=HathirDeviceWorkspace.runLive();});
   await a.page.waitForFunction(()=>!!window.releaseReadiness);
   assert.equal(await a.page.locator('#workspaceSyncReminder .workspaceSyncPercent').textContent(),'100%');
   assert.equal(await a.page.locator('#workspaceSyncReminder').getAttribute('data-state'),'synced');
   assert.equal(await a.page.locator('#workspaceSyncReminder .workspaceSyncCheck').count(),0);
   await a.page.evaluate(async()=>{releaseReadiness();await readinessRun;});
   await a.page.waitForFunction(()=>document.getElementById('workspaceSyncReminder').dataset.state==='synced');
  });

  const sync=async(...devices)=>{for(const d of devices){await d.context.setOffline(false);await d.page.evaluate(()=>HathirDeviceWorkspace.runLive());}};
  const state=d=>d.page.evaluate(async()=>{const r=await HathirDeviceStore.get(session.uid);return {data:r.data,queue:r.live?.queue||[],cursor:r.live?.cursor};});
  await check(report,'Both devices bootstrap without dropping their roster or queuing false conflicts',async()=>{for(const d of [a,b]){const r=await state(d);assert.equal(r.data.subjects.qa_live.students.length,2);assert.equal(r.queue.length,0);}});
  await check(report,'Offline marks from two devices merge in the same open lecture',async()=>{
   for(const d of [a,b])await d.context.setOffline(true);
   await a.page.evaluate(()=>markAttendance('A','manual'));await b.page.evaluate(()=>markAttendance('B','manual'));
   assert.equal(await a.page.evaluate(()=>lastDisplayedReading?.studentId),'A');assert.equal(await b.page.evaluate(()=>lastDisplayedReading?.studentId),'B');
   assert((await state(a)).queue.length>0);assert((await state(b)).queue.length>0);
   await sync(a,b,a);
   for(const d of [a,b]){const r=await state(d),s=r.data.subjects.qa_live;assert.equal(s.lectures.length,1);assert.deepEqual(Object.keys(s.attendance[s.lectures[0]]).sort(),['A','B']);assert.equal(r.queue.length,0);assert.equal(s.lectureMeta[s.lectures[0]].status,'active');}
  });
  await check(report,'Conflicting corrections remain local and are explicitly resolvable',async()=>{
   for(const d of [a,b])await d.context.setOffline(true);
   await a.page.evaluate(()=>updateAttendanceTime('A',currentLectureKey(getSubject()),'09:15'));await b.page.evaluate(()=>updateAttendanceTime('A',currentLectureKey(getSubject()),'09:20'));
   await sync(a,b);let r=await state(b);const conflict=r.queue.find(op=>op.conflict&&op.path[0]==='mark');assert(conflict);assert.equal(conflict.value.time,'09:20');
   await b.page.setViewportSize({width:390,height:844});await b.page.evaluate(()=>HathirDeviceWorkspace.details());assert.match(await b.page.locator('#deviceCloudDialog').innerText(),/مراجعة التعديلات/);assert.doesNotMatch(await b.page.locator('#deviceCloudDialog').innerText(),/markedBy|attendedMinutes/);await b.page.screenshot({path:require('node:path').resolve(__dirname,'../reports/live-conflict-mobile.png')});await b.page.locator('.deviceCloudClose').click();await b.page.setViewportSize({width:1440,height:1000});
   await b.page.evaluate(id=>HathirDeviceWorkspace.resolveLive(id,'cloud'),conflict.id);await sync(b,a);
   r=await state(b);assert.equal(r.queue.length,0);const s=r.data.subjects.qa_live;assert.equal(s.attendance[s.lectures[0]].A.time,'09:15');
  });
  await check(report,'Background polling delivers an edit without pressing refresh or calling sync',async()=>{
   await a.page.evaluate(()=>updateAttendanceTime('B',currentLectureKey(getSubject()),'09:11'));
   await b.page.waitForFunction(()=>{const s=getSubject();return s.attendance[s.lectures[0]]?.B?.time==='09:11';},null,{timeout:20000});
   assert.equal((await state(a)).queue.length,0);
  });
  await check(report,'Closing from one device converges and both allocate the same next lecture ID',async()=>{
   await a.page.evaluate(()=>setTodayLectureStatus('completed',{confirmed:true}));await sync(a,b);
   const ids=await Promise.all([a,b].map(d=>d.page.evaluate(()=>currentLectureKey(getSubject(),{create:true}))));assert.equal(ids[0],ids[1]);assert.match(ids[0],/__/);
  });
  await check(report,'An incoming response cannot overwrite a local edit made while the network is waiting',async()=>{
   await b.page.evaluate(()=>updateAttendanceTime('B',getSubject().lectures[0],'09:12'));await sync(b);
   await a.page.evaluate(()=>{const transport=liveTransport;window.originalTransport=transport;window.liveTransport=async payload=>{const result=await transport(payload);if(payload.action==='pull'&&!window.heldOnce){window.heldOnce=true;await new Promise(resolve=>window.releasePull=resolve);}return result;};window.heldRun=HathirDeviceWorkspace.runLive();});
   await a.page.waitForFunction(()=>Boolean(window.releasePull));
   await a.page.evaluate(async()=>{await updateAttendanceTime('A',getSubject().lectures[0],'09:17');releasePull();await heldRun;window.liveTransport=originalTransport;});
   const r=await state(a),s=r.data.subjects.qa_live;assert.equal(s.attendance[s.lectures[0]].A.time,'09:17');assert.equal(s.attendance[s.lectures[0]].B.time,'09:12');assert.equal(r.queue.length,0);await sync(b);
  });
  await check(report,'A slow backup does not block live attendance corrections',async()=>{
   await a.page.evaluate(()=>{const app=firebase.app;window.originalApp=app;firebase.app=()=>({functions:region=>({httpsCallable:(name,...args)=>{const fn=app().functions(region).httpsCallable(name,...args);return async payload=>{if(name==='closedLectureWorkspace'&&payload.action==='commit'&&!window.backupHeld){window.backupHeld=true;await new Promise(resolve=>window.releaseBackup=resolve);}return fn(payload);};}})});});
   await a.page.evaluate(()=>updateAttendanceTime('A',getSubject().lectures[0],'09:18'));await sync(a);
   await a.page.waitForFunction(()=>Boolean(window.releaseBackup));
   await a.page.evaluate(()=>updateAttendanceTime('B',getSubject().lectures[0],'09:13'));await sync(a,b);
   const r=await state(b),s=r.data.subjects.qa_live;assert.equal(s.attendance[s.lectures[0]].B.time,'09:13');
   await a.page.evaluate(async()=>{releaseBackup();await HathirDeviceWorkspace.upload();firebase.app=originalApp;});
  });
  await check(report,'Incoming updates preserve the session, scanner subject and an unsaved profile code',async()=>{
   await a.page.evaluate(()=>{window.savedSession=session;window.savedSubject=getSubject();activeProfileStudentId='A';studentProfileMode='edit';els.studentProfileModal.hidden=false;renderStudentProfile();els.profileStudentCodeInput.value='UNSAVED';});
   await b.page.evaluate(()=>updateAttendanceTime('B',getSubject().lectures[0],'09:14'));await sync(b,a);
   const kept=await a.page.evaluate(()=>({session:session===savedSession,subject:getSubject()===savedSubject,code:els.profileStudentCodeInput.value}));assert.deepEqual(kept,{session:true,subject:true,code:'UNSAVED'});
   await a.page.evaluate(()=>{els.profileStudentCodeInput.value='A';closeStudentProfile();});
  });
  await check(report,'A stale offline device cannot revive a deleted lecture',async()=>{
   await b.context.setOffline(true);
   await a.page.evaluate(async()=>{const s=getSubject();s.attendance={};s.lectures=[];s.lectureMeta={};s.excuses={};await HathirDeviceWorkspace.save({recovery:true});});await sync(a);
   await b.page.evaluate(()=>updateAttendanceTime('B',getSubject().lectures[0],'09:25'));await sync(b);
   const r=await state(b);assert(r.queue.some(op=>op.conflict));await sync(a);assert.equal((await state(a)).data.subjects.qa_live.lectures.length,0);
  });
  await check(report,'A local disk failure reports failure without sending the unsaved import',async()=>{
   await a.context.setOffline(true);
   const result=await a.page.evaluate(async()=>{const original=HathirDeviceStore;window.HathirDeviceStore={...original,save:async()=>{throw Error('disk full');}};let rejected=false;try{await HathirDeviceWorkspace.importNames(['لا تحفظ']);}catch{rejected=true;}finally{window.HathirDeviceStore=original;}return {rejected,names:getSubject().students.map(s=>s.name)};});assert(result.rejected);assert(!result.names.includes('لا تحفظ'));
  });
  await check(report,'Lost acknowledgement survives reload and retry does not duplicate an imported student',async()=>{
   await a.context.setOffline(true);await a.page.evaluate(()=>HathirDeviceWorkspace.importNames(['طالب بعد إعادة الفتح']));
   await a.page.evaluate(()=>{const transport=liveTransport;window.liveTransport=async payload=>{const result=await transport(payload);if(payload.action==='push'&&!window.droppedAck){window.droppedAck=true;throw Error('Lost acknowledgement');}return result;};});
   await a.context.setOffline(false);await a.page.evaluate(()=>HathirDeviceWorkspace.runLive().catch(()=>{}));
   assert((await state(a)).queue.some(op=>op.wire));await a.context.setOffline(true);
   await a.context.setOffline(false);await a.page.reload();await a.page.waitForFunction(()=>Boolean(window.HathirDeviceWorkspace));
   await a.page.evaluate(async()=>{fixtureAuth.currentUser=fixtureUser();firebase.app=()=>({functions:()=>({httpsCallable:name=>async payload=>({data:name==='deviceLiveSync'?await liveTransport(payload):payload.action==='head'?{revision:null,count:0}:payload.action==='commit'?{revision:payload.revision}:{stored:true}})})});await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);});
   await sync(a);const r=await state(a);assert.equal(r.queue.length,0);assert.equal(r.data.subjects.qa_live.students.filter(s=>s.name==='طالب بعد إعادة الفتح').length,1);
  });
  await check(report,'Idle checks do not rewrite the local workspace',async()=>{
   await sync(a,a);const before=await a.page.evaluate(async()=>(await HathirDeviceStore.get(session.uid)).revision);await sync(a);const after=await a.page.evaluate(async()=>(await HathirDeviceStore.get(session.uid)).revision);assert.equal(after,before);
  });
  await check(report,'No uncaught browser errors',async()=>assert.deepEqual(report.pageErrors,[]));
 }finally{for(const c of clients)await c.context.close();await harness.close();saveReport(report,'sync-readiness-regression');}
 if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
