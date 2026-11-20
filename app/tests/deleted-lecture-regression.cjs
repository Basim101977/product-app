'use strict';
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs'),fixture=require('../functions/test/live-fixture.cjs');
const report=makeReport('deleted-lecture-regression');
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

 const a=await device(),b=await device();
 const sync=async(...ds)=>{for(const d of ds){await d.context.setOffline(false);await d.page.evaluate(()=>HathirDeviceWorkspace.runLive());}};
 const state=d=>d.page.evaluate(async()=>{const r=await HathirDeviceStore.get(session.uid);return {data:r.data,queue:r.live.queue,records:r.live.records};});
 const clear=async d=>d.page.evaluate(async()=>{const s=getSubject();s.lectures=[];s.lectureMeta={};s.attendance={};s.excuses={};await HathirDeviceWorkspace.save({recovery:true});});
 let first;
 await check(report,'Fresh attendance after synced deletion uses a new ID and merges across devices',async()=>{
  await a.page.evaluate(()=>markAttendance('A','manual'));await sync(a,b);
  first=(await state(a)).data.subjects.qa_live.lectures[0];
  await clear(a);await sync(a,b);assert.equal((await state(b)).data.subjects.qa_live.lectures.length,0);
  for(const d of [a,b])await d.context.setOffline(true);
  const ids=await Promise.all([a,b].map(d=>d.page.evaluate(()=>currentLectureKey(getSubject(),{create:true}))));
  assert.notEqual(ids[0],first);assert.equal(ids[0],ids[1]);
  await a.page.evaluate(()=>markAttendance('A','manual'));await b.page.evaluate(()=>markAttendance('B','manual'));await sync(a,b,a);
  for(const d of [a,b]){const r=await state(d),s=r.data.subjects.qa_live;assert.equal(r.queue.length,0);assert.deepEqual(s.lectures,[ids[0]]);assert.deepEqual(Object.keys(s.attendance[ids[0]]).sort(),['A','B']);assert.equal(r.records[JSON.stringify(['lecture','qa_live',first])].value,null);}
 });
 await check(report,'An offline clear immediately followed by recording cannot reuse queued deletion IDs',async()=>{
  await a.context.setOffline(true);const old=(await state(a)).data.subjects.qa_live.lectures[0];await clear(a);
  const next=await a.page.evaluate(()=>currentLectureKey(getSubject(),{create:true}));assert.notEqual(next,old);assert.notEqual(next,first);
  await a.page.evaluate(()=>markAttendance('A','manual'));await sync(a,b,a);
  const r=await state(a);assert.equal(r.queue.length,0);assert.deepEqual(r.data.subjects.qa_live.lectures,[next]);
 });
 await check(report,'Repeated clears skip every tombstone and survive restoration',async()=>{
  const seen=new Set();for(let i=0;i<3;i++){
   const old=(await state(a)).data.subjects.qa_live.lectures[0];seen.add(old);await clear(a);await sync(a,b);
   await a.page.evaluate(()=>HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser));
   const next=await a.page.evaluate(()=>currentLectureKey(getSubject(),{create:true}));assert(!seen.has(next));
   await a.page.evaluate(()=>markAttendance('A','manual'));await sync(a,b);assert.equal((await state(a)).queue.length,0);
  }
 });
 await check(report,'Accepting a deleted lecture removes only its queued children and keeps a recovery',async()=>{
  await b.context.setOffline(true);const date=(await state(b)).data.subjects.qa_live.lectures[0];
  await clear(a);await sync(a);
  await b.page.evaluate(async date=>{const s=getSubject();s.lectureMeta[date].durationHours=3;s.attendance[date].A.time='09:08';s.attendance[date].B={time:'09:09',studentName:'علي'};await saveLocalData();},date);
  await sync(b);let r=await state(b);const conflict=r.queue.find(o=>o.path[0]==='lecture'&&o.conflict);assert(conflict);
  await b.context.setOffline(true);
  const fresh=await b.page.evaluate(()=>currentLectureKey(getSubject(),{create:true}));assert.notEqual(fresh,date);
  await b.page.evaluate(()=>markAttendance('B','manual'));
  const before=await b.page.evaluate(async()=>(await HathirDeviceStore.recoveries(session.uid)).length);
  await b.page.evaluate(id=>HathirDeviceWorkspace.resolveLive(id,'cloud'),conflict.id);await sync(b,a);
  r=await state(b);assert.equal(r.queue.filter(o=>['lecture','mark','excuse'].includes(o.path[0])&&o.path[2]===date).length,0);assert(!r.data.subjects.qa_live.lectureMeta[date]);
  assert(r.data.subjects.qa_live.attendance[fresh]?.B);assert.equal(r.queue.length,0);
  assert(await b.page.evaluate(async()=>(await HathirDeviceStore.recoveries(session.uid)).length)>=before);
 });
 }finally{for(const c of clients)await c.context.close();await harness.close();saveReport(report,'deleted-lecture-regression');}
 if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
