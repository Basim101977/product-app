'use strict';
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs'),fixture=require(process.env.HATHIR_STRESS_EMULATOR==='1'?'./emulator-live-fixture.cjs':'../functions/test/live-fixture.cjs');
const report=makeReport('sync-stress-regression');
if(process.env.HATHIR_STRESS_EMULATOR==='1'){report.mode='real-local-firestore-emulator-two-browsers';report.limitations=['Real Firestore transaction engine and application handler, synthetic authentication and backup transport; no production or physical phone verification.'];}
(async()=>{
 const harness=await launch(report);let server=fixture(),clients=[];
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
   page.on('dialog',dialog=>dialog.accept());await context.setOffline(false);await page.evaluate(()=>HathirDeviceWorkspace.runLive());return client;
  }
  const state=d=>d.page.evaluate(async()=>{const r=await HathirDeviceStore.get(session.uid);return {data:r.data,queue:r.live.queue};});
  const settle=async(a,b)=>{for(let i=0;i<12;i++){await Promise.all([a,b].map(async d=>{await d.context.setOffline(false);await d.page.evaluate(()=>HathirDeviceWorkspace.runLive());}));const states=await Promise.all([a,b].map(state));if(states.every(r=>!r.queue.length)){await a.page.evaluate(()=>HathirDeviceWorkspace.runLive());await b.page.evaluate(()=>HathirDeviceWorkspace.runLive());return;}if(states.some(r=>r.queue.some(o=>o.conflict)))return;}};
  const clean=async(a,b)=>{await settle(a,b);const x=await state(a),y=await state(b);for(const r of [x,y])assert.equal(r.queue.length,0,JSON.stringify(r.queue.map(o=>({path:o.path,reason:o.conflict?.reason}))));const M=require('../functions/device-sync-model');assert.deepEqual(M.flatten(x.data),M.flatten(y.data));return x.data.subjects.qa_live;};
  const scenario=async(name,fn)=>check(report,name,async()=>{server=fixture();const a=await device(),b=await device();await b.page.setViewportSize({width:390,height:844});try{await fn(a,b);}finally{for(const d of [a,b])await d.context.close();clients=[];}});
  await scenario('Concurrent additions: 200 distinct students, background sync and identical final rosters',async(a,b)=>{
    await Promise.all([a,b].map((d,k)=>d.page.evaluate(async k=>{await HathirDeviceWorkspace.importNames(Array.from({length:100},(_,i)=>'طالب اختبار '+k+' رقم '+i));},k)));
    const s=await clean(a,b);assert.equal(s.students.length,202);assert.equal(new Set(s.students.map(v=>v.id)).size,202);
  });
  await scenario('100 offline attendance marks from both devices merge once; repeat scans stay unique',async(a,b)=>{
    await a.page.evaluate(()=>HathirDeviceWorkspace.importNames(Array.from({length:100},(_,i)=>'طالب ضغط '+i)));await clean(a,b);
    await Promise.all([a,b].map(d=>d.context.setOffline(true)));
    await Promise.all([a,b].map((d,k)=>d.page.evaluate(async k=>{for(const s of getSubject().students.slice(2).filter((_,i)=>i%2===k))await markAttendance(s.id,'manual');await markAttendance('A','manual');await markAttendance('A','manual');},k)));
    const s=await clean(a,b);assert.equal(s.lectures.length,1);assert.equal(Object.keys(s.attendance[s.lectures[0]]).length,101);
  });
  await scenario('Delete and re-record presence 12 times with simultaneous independent attendance corrections',async(a,b)=>{
    await a.page.evaluate(async()=>{await markAttendance('A','manual');await markAttendance('B','manual');});await clean(a,b);
    for(let i=0;i<12;i++){
      await Promise.all([a.page.evaluate(()=>unmarkAttendance('A')),b.page.evaluate(i=>updateAttendanceTime('B',currentLectureKey(getSubject()),'09:'+String(i).padStart(2,'0')),i)]);
      let s=await clean(a,b);assert(!s.attendance[s.lectures[0]]?.A);
      await a.page.evaluate(()=>markAttendance('A','manual'));s=await clean(a,b);assert(s.attendance[s.lectures[0]].A);assert.equal(Object.keys(s.attendance[s.lectures[0]]).length,2);
    }
  });
  await scenario('Delete student with history while other device records another student; preserve archived attendance',async(a,b)=>{
    await a.page.evaluate(()=>markAttendance('A','manual'));await clean(a,b);
    await Promise.all([a.page.evaluate(async()=>{activeProfileStudentId='A';await deleteStudentFromRoster();}),b.page.evaluate(()=>markAttendance('B','manual'))]);
    const s=await clean(a,b);assert(!s.students.some(v=>v.id==='A'));assert(s.attendance[s.lectures[0]].B);assert(s.archivedStudents.some(v=>v.id==='A'));
  });
  await scenario('Real clear-attendance action repeated 6 times followed by fresh recording',async(a,b)=>{
    const ids=new Set();for(let i=0;i<6;i++){await a.page.evaluate(()=>markAttendance('A','manual'));let s=await clean(a,b);assert(!ids.has(s.lectures[0]));ids.add(s.lectures[0]);await a.page.evaluate(()=>clearAttendance());s=await clean(a,b);assert.equal(s.lectures.length,0);assert.equal(s.students.length,2);}
  });
  await scenario('Clear roster then import CSV via file input 4 times, including offline save and sync',async(a,b)=>{
    for(let i=0;i<4;i++){
      await a.context.setOffline(true);await a.page.evaluate(()=>HathirDeviceWorkspace.clearRoster(getSubject()));
      await a.page.locator('#studentImportFile').setInputFiles({name:'stress.csv',mimeType:'text/csv',buffer:Buffer.from('\uFEFFاسم الطالب\nطالب قائمة ألف\nطالب قائمة باء\nطالب قائمة جيم')});
      await a.page.waitForFunction(()=>document.querySelector('#studentImportProgressStatus')?.dataset.state==='success');
      await a.page.evaluate(()=>document.getElementById('studentImportProgress').close());await a.page.waitForFunction(()=>!document.getElementById('studentImportProgress'));
      await a.page.evaluate(()=>markAttendance(getSubject().students[0].id,'manual'));const s=await clean(a,b);assert.equal(s.students.length,3);assert.equal(s.lectures.length,1);assert.equal(Object.keys(s.attendance[s.lectures[0]]).length,1);
    }
  });
  await scenario('Delayed cloud response allows local import, mark, unmark and correction without lost edits',async(a,b)=>{
    await a.page.evaluate(async()=>{await markAttendance('A','manual');await markAttendance('B','manual');});await clean(a,b);
    await a.page.evaluate(()=>{const transport=liveTransport;window.savedTransport=transport;window.liveTransport=async p=>{const r=await transport(p);if(p.action==='pull'&&!window.onceHeld){window.onceHeld=true;await new Promise(resolve=>window.releaseStress=resolve);}return r;};window.stressRun=HathirDeviceWorkspace.runLive();});await a.page.waitForFunction(()=>Boolean(window.releaseStress));
    await a.page.evaluate(async()=>{await HathirDeviceWorkspace.importNames(['طالب أثناء الانتظار']);await unmarkAttendance('A');await updateAttendanceTime('B',currentLectureKey(getSubject()),'09:42');});
    await a.page.evaluate(async()=>{releaseStress();await stressRun;window.liveTransport=savedTransport;});const s=await clean(a,b);assert.equal(s.students.length,3);assert(!s.attendance[s.lectures[0]].A);assert.equal(s.attendance[s.lectures[0]].B.time,'09:42');
  });
  await scenario('Expected delete-versus-offline-edit conflict is retained, resolves by UI and new work continues',async(a,b)=>{
    await a.page.evaluate(()=>markAttendance('A','manual'));await clean(a,b);await b.context.setOffline(true);
    await a.page.evaluate(()=>clearAttendance());await a.page.evaluate(()=>HathirDeviceWorkspace.runLive());
    await b.page.evaluate(()=>updateAttendanceTime('A',currentLectureKey(getSubject()),'09:44'));await settle(a,b);
    assert((await state(b)).queue.some(o=>o.conflict));
    for(let i=0;i<10&&(await state(b)).queue.some(o=>o.conflict);i++){
      await b.page.evaluate(()=>HathirDeviceWorkspace.details());await b.page.getByRole('button',{name:'اعتماد السحابة',exact:true}).first().click();
      await b.page.waitForFunction(()=>!document.getElementById('deviceCloudDialog')||!document.getElementById('deviceCloudDialog').open);
      await settle(a,b);
    }
    let s=await clean(a,b);assert.equal(s.lectures.length,0);await b.page.evaluate(()=>markAttendance('B','manual'));s=await clean(a,b);assert.equal(Object.keys(s.attendance[s.lectures[0]]).length,1);
  });
 }finally{for(const c of clients)await c.context.close();await harness.close();saveReport(report,'sync-stress-regression');}
 if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
