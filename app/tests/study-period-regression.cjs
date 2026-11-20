'use strict';
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs'),fixture=require('../functions/test/live-fixture.cjs');
const report=makeReport('study-period-regression');
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
 const a=await device(),b=await device();let eveningId,morningBefore;
 const sync=async()=>{for(const d of [a,b,a])await d.page.evaluate(()=>HathirDeviceWorkspace.runLive());};
 await check(report,'Existing roster defaults to morning without moving its students or attendance',async()=>{
  await a.page.evaluate(()=>markAttendance('A','manual'));await sync();morningBefore=await a.page.evaluate(()=>JSON.stringify(HathirSyncModel.flatten({workspace:localData.workspace,subjects:{qa_live:getSubject()}})));
  assert.equal(await a.page.evaluate(()=>subjectStudyPeriod(getSubject())),'morning');assert.equal(await a.page.locator('#attendanceStudyPeriodSelect').inputValue(),'morning');
 });
 await check(report,'Choosing evening opens an empty scope and creates a separate same-name subject',async()=>{
  await a.page.evaluate(()=>document.getElementById('teachingSetupBtn').click());
  await a.page.locator('#attendanceStudyPeriodSelect').selectOption('evening');await a.page.waitForFunction(()=>sectionLoadPending===0);
  assert.equal(await a.page.evaluate(()=>getSubject()),null);assert.equal(await a.page.evaluate(()=>compactSubjects().length),0);
  a.page.once('dialog',d=>d.accept('اختبار المزامنة'));await a.page.evaluate(()=>compactSubjectAction('__add'));
  console.log(await a.page.evaluate(()=>({scope:compactScope,activeSubjectId,subjects:subjects.map(s=>({id:s.id,studyPeriod:s.studyPeriod,section:s.section})),status:document.getElementById('teachingSetupStatus').textContent,hours:document.getElementById('teachingAnnualHours').value,duration:document.getElementById('attendanceDurationSelect').value})));eveningId=await a.page.evaluate(()=>getSubject().id);assert.notEqual(eveningId,'qa_live');assert.equal(await a.page.evaluate(()=>getSubject().students.length),0);assert.equal(await a.page.evaluate(()=>getSubject().studyPeriod),'evening');
 });
 await check(report,'Teacher imports evening students locally; sync preserves two independent rosters',async()=>{
  await a.page.evaluate(()=>HathirDeviceWorkspace.importNames(['طالب مسائي أول','طالب مسائي ثان']));await a.page.evaluate(()=>markAttendance(getSubject().students[0].id,'manual'));await sync();
  const rows=await b.page.evaluate(()=>subjects.map(s=>({id:s.id,period:subjectStudyPeriod(s),count:s.students.length,attendance:Object.values(s.attendance).reduce((n,x)=>n+Object.keys(x).length,0)})));
  assert.deepEqual(rows.find(r=>r.id==='qa_live'),{id:'qa_live',period:'morning',count:2,attendance:1});assert.deepEqual(rows.find(r=>r.id===eveningId),{id:eveningId,period:'evening',count:2,attendance:1});
  assert.equal(await a.page.evaluate(()=>sharedRosterPeers(getSubject()).length),1);
 });
 await check(report,'Dropdown selection restores the period and morning roster; clearing evening leaves morning intact',async()=>{
  await a.page.evaluate(()=>HathirDeviceWorkspace.clearRoster(getSubject()));await sync();
  assert.equal(await a.page.evaluate(()=>JSON.stringify(HathirSyncModel.flatten({workspace:localData.workspace,subjects:{qa_live:localData.subjects.qa_live}}))),morningBefore);
  await a.page.evaluate(()=>document.getElementById('teachingSetupModal').hidden=true);
  await a.page.evaluate(()=>{const s=document.getElementById('quickTeachingSubject');s.value='qa_live';s.dispatchEvent(new Event('change',{bubbles:true}));});await a.page.waitForFunction(()=>sectionLoadPending===0);
  assert.equal(await a.page.locator('#attendanceStudyPeriodSelect').inputValue(),'morning');assert.equal(await a.page.evaluate(()=>getSubject().students.length),2);
  assert.match(await a.page.locator('#beginnerChooseSubject').innerText(),/صباحي/);
  await a.page.setViewportSize({width:390,height:844});await a.page.evaluate(()=>document.getElementById('teachingSetupBtn').click());await a.page.screenshot({path:require('path').resolve(__dirname,'../reports/study-period-settings-390.png')});
 });
 }finally{for(const c of clients)await c.context.close();await harness.close();saveReport(report,'study-period-regression');}
 if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
