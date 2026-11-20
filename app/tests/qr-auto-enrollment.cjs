'use strict';
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs'),fixture=require('../functions/test/live-fixture.cjs');
const report=makeReport('qr-auto-enrollment');
(async()=>{
 const harness=await launch(report),server=fixture();let clients=[];
 try{
  async function device(){
   const client=await harness.page();clients.push(client);const {page,context}=client;
   await page.clock.setFixedTime(new Date('2026-09-27T06:05:00Z'));await context.setOffline(true);
   const uid=await page.evaluate(()=>personalFixture.uid);await page.exposeFunction('liveTransport',payload=>server.call(payload,uid));
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

 const a=await device(),{page,context}=a;
 await context.setOffline(true);
 await check(report,'Empty subject opens the scanner without requiring a shared list',async()=>{
  await page.evaluate(async()=>{const s=getSubject();s.students=[];await saveLocalData();renderAll();window.__cameraStart=0;document.getElementById('startCameraBtn').click=()=>window.__cameraStart++;});
  await page.locator('#beginnerStartAttendance').click();
  assert.equal(await page.locator('#beginnerRosterDialog').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.__cameraStart),1);
 });
 await check(report,'Readable-name QR enrolls offline and records attendance exactly once',async()=>{
  const result=await page.evaluate(async()=>{
   const payload=HathirNameQR.encodePortable('أحمد  علي');
   const scope=captureNameQrScope();
   const ok=await Promise.all([processNameQr(payload,'scan',scope),processNameQr(payload,'scan',scope)]);
   const r=await HathirDeviceStore.get(session.uid),s=r.data.subjects.qa_live;
   return {ok,students:s.students,marks:s.attendance[s.lectures.at(-1)],queue:r.live.queue.length};
  });
  assert(result.ok.some(Boolean));assert.equal(result.students.length,1);assert.equal(Object.keys(result.marks).length,1);assert(result.queue>0);
 });
 await check(report,'Old fingerprint cards and minor spelling variants reuse the same student and preserve time',async()=>{
  const result=await page.evaluate(async()=>{
   const s=getSubject(),date=currentLectureKey(s),student=s.students[0],before=JSON.stringify(s.attendance[date][student.id]);
   await processNameQr(HathirNameQR.encode('احمد علي'),'scan');
   await processNameQr(HathirNameQR.encodePortable('احمد علي'),'scan');
   return {count:s.students.length,before,after:JSON.stringify(s.attendance[date][student.id])};
  });
  assert.equal(result.count,1);assert.equal(result.before,result.after);
 });
 await check(report,'Invalid, unresolved old cards and archived names do not create students',async()=>{
  const result=await page.evaluate(async()=>{
   const s=getSubject();s.archivedStudents=[{id:'old',name:'سارة حسن'}];await saveLocalData();
   const before=s.students.length;
   await processNameQr('https://example.test/not-a-student','scan');
   await processNameQr(HathirNameQR.encode('اسم غير معروف'),'scan');
   await processNameQr(HathirNameQR.encodePortable('سارة حسن'),'scan');
   return {before,after:s.students.length};
  });
  assert.equal(result.before,result.after);
 });
 await check(report,'Failed enrollment save leaves no phantom student or attendance',async()=>{
  const result=await page.evaluate(async()=>{
   const original=window.HathirDeviceStore;
   window.HathirDeviceStore={...original,save:async()=>{throw Error('synthetic disk failure')}};
   let ok;try{ok=await processNameQr(HathirNameQR.encodePortable('علي محمود'),'scan')}finally{window.HathirDeviceStore=original;}
   const r=await HathirDeviceStore.get(session.uid);return {ok,names:r.data.subjects.qa_live.students.map(s=>s.name)};
  });
  assert.equal(result.ok,false);assert(!result.names.includes('علي محمود'));
 });
 await check(report,'Enrollment in one subject does not add students to unrelated subject lists',async()=>{
  const result=await page.evaluate(async()=>{
   const s=getSubject(),copy=JSON.parse(JSON.stringify(s));copy.id='second';copy.titleAr='مادة أخرى';copy.students=[];copy.attendance={};copy.lectures=[];copy.lectureMeta={};copy.archivedStudents=[];
   localData.subjects[copy.id]=copy;subjects=Object.values(localData.subjects);await saveLocalData();
   const ok=await processNameQr(HathirNameQR.encodePortable('ليلى حسن'),'scan');
   const r=await HathirDeviceStore.get(session.uid);return {ok,first:r.data.subjects.qa_live.students.length,second:r.data.subjects.second.students.length};
  });
  assert(result.ok);assert.equal(result.first,2);assert.equal(result.second,0);
 });
 await check(report,'Reconnect automatically synchronizes both enrollment and attendance',async()=>{
  await context.setOffline(false);await page.waitForTimeout(1500);
  await page.waitForFunction(async()=>(await HathirDeviceStore.get(session.uid)).live.queue.length===0);
  const r=await page.evaluate(async()=>await HathirDeviceStore.get(session.uid));assert.equal(r.live.queue.length,0);
 });
 await check(report,'No browser errors',async()=>assert.deepEqual(report.pageErrors,[]));
 }finally{for(const c of clients)await c.context.close();await harness.close();saveReport(report,'qr-auto-enrollment');}
})().catch(e=>{console.error(e);process.exitCode=1;});
