'use strict';
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs'),fixture=require('../functions/test/live-fixture.cjs');
const report=makeReport('lecture-sync-ui');
(async()=>{
 const harness=await launch(report),server=fixture();let clients=[];
 try{
  async function device(){
   const client=await harness.page({touch:true});clients.push(client);const {page,context}=client;
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
  const a=await device(), {page,context}=a;
  await check(report,'Newest column is beside name with chronological numbering',async()=>{
    await context.setOffline(true);
    await page.evaluate(()=>{
      const s=getSubject(),day=todayISO(),older='2026-09-20';
      s.lectures=[older,day];
      s.lectureMeta[older]={date:older,startTime:'08:00',durationHours:2,status:'completed'};
      s.lectureMeta[day]={date:day,startTime:'09:00',durationHours:2,status:'active'};
      renderAll();
    });
    await page.waitForTimeout(200);
    const info=await page.evaluate(()=>({first:document.querySelector('#rosterHead th:nth-child(3) [data-device-lecture]')?.dataset.deviceLecture,label:document.querySelector('#rosterHead th:nth-child(3)').textContent}));
    assert.equal(await page.locator('.quickAttendanceColumn').count(),0);assert.equal(await page.locator('#rosterRows .miniActions [data-mark]').count(),0);assert.equal(info.first,'2026-09-27');assert(info.label.includes('م(2)'));
  });
  await check(report,'Single name click only reveals the name; double-click saves attendance offline',async()=>{
    const name=page.locator('#rosterRows tr[data-student-id="A"] .rosterFullName');
    await name.click();
    assert.equal(await page.evaluate(()=>Boolean(getAttendanceRecord(getSubject(),currentLectureKey(getSubject()),'A'))),false);
    await name.dblclick();
    await page.waitForFunction(()=>Boolean(getAttendanceRecord(getSubject(),currentLectureKey(getSubject()),'A')));
    const saved=await page.evaluate(async()=>{await saveLocalData();const r=await HathirDeviceStore.get(session.uid);return {marks:r.data.subjects.qa_live.attendance,queue:r.live.queue.length};});
    assert(saved.marks['2026-09-27'].A);assert(saved.queue>0);
    assert.match(await page.locator('#workspaceSyncReminder').innerText(),/بانتظار المزامنة/);
    assert.equal(await page.locator('#deviceRecordStatus').isVisible(),false);
    assert.equal(await page.locator('#offlineStatus').isVisible(),false);
    assert.equal(await page.locator('#workspaceSyncReminder button').count(),0);
    assert.equal(await page.locator('#attendanceRecordCard #workspaceSyncReminder').count(),0);
    assert(await page.evaluate(()=>document.querySelector('#workspaceSyncReminder').nextElementSibling.id==='beginnerHub'));
    assert.equal(await page.locator('.workspaceSyncPercent').innerText(),'0%');
    assert.equal(await page.locator('#rosterRows tr[data-student-id="A"] [data-attendance-register]').count(),0);
  });
  await check(report,'Pending changes remain visible in another subject',async()=>{
    await page.evaluate(async()=>{
      const s=JSON.parse(JSON.stringify(getSubject()));s.id='other_subject';s.titleAr='مادة أخرى';s.attendance={};s.lectures=[];s.lectureMeta={};
      localData.subjects[s.id]=s;subjects=Object.values(localData.subjects);activeSubjectId=s.id;compactScope=null;await saveLocalData();renderAll();
    });
    const view=await page.locator('#workspaceSyncReminder').innerText();assert.match(view,/بانتظار المزامنة/);
    const count=await page.evaluate(async()=>(await HathirDeviceStore.get(session.uid)).live.queue.length);
    assert(view.includes(String(count)));
  });
  await check(report,'Automatic reconnect uploads the unselected subject and clears pending state',async()=>{
    await context.setOffline(false);
    await page.waitForTimeout(1200);
    await page.waitForFunction(async()=>(await HathirDeviceStore.get(session.uid)).live.queue.length===0);
    const r=await page.evaluate(async()=>await HathirDeviceStore.get(session.uid));
    assert.equal(r.live.queue.length,0);
    await page.waitForFunction(()=>document.querySelector('#workspaceSyncReminder')?.dataset.state==='synced');
    assert(r.data.subjects.qa_live.attendance['2026-09-27'].A);
    assert.match(await page.locator('#workspaceSyncReminder').innerText(),/100%/);
  });
  await check(report,'Same-day new lecture becomes first without altering stored order',async()=>{
    await context.setOffline(true);
    const result=await page.evaluate(async()=>{
      activeSubjectId='qa_live';compactScope=null;
      const s=getSubject(),second=todayISO()+'__'+'b'.repeat(32);
      s.lectures.push(second);s.lectureMeta[second]={date:second,startTime:'12:00',durationHours:2,status:'active'};
      await saveLocalData();renderAll();await new Promise(requestAnimationFrame);
      return {first:visibleRosterLectures(s)[0],number:lectureColumnParts(s,second).detail,second,stored:s.lectures.slice()};
    });
    assert.equal(result.first,result.second);assert(result.number.includes('م(3)'));assert.equal(result.stored[0],'2026-09-20');
  });
  await check(report,'Desktop and phone keep reminder within screen',async()=>{
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});
      await page.evaluate(()=>{renderAll();HathirDeviceWorkspace.status()});await page.waitForTimeout(150);
      await page.locator('#workspaceSyncReminder').scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const bounds=await page.locator('#workspaceSyncReminder').boundingBox();
      assert(bounds && bounds.x>=0 && bounds.x+bounds.width<=width+1);
      await page.screenshot({path:require('node:path').resolve(__dirname,'../reports/lecture-sync-'+width+'.png')});
    }
  });
  await check(report,'Phone double tap registers from the visible frozen name and repeat taps preserve attendance',async()=>{
    await page.setViewportSize({width:390,height:900});
    await page.evaluate(()=>{renderAll();HathirDeviceWorkspace.status()});
    await page.waitForTimeout(200);
    const original=page.locator('#rosterRows tr[data-student-id="B"] .rosterFullName');
    const rail=page.locator('.rosterNameRail [data-name-attendance="B"]');
    const name=await rail.isVisible()?rail:original;
    const single=await name.boundingBox();assert(single);
    await page.dispatchEvent(await rail.isVisible()?'.rosterNameRail [data-name-attendance="B"]':'#rosterRows tr[data-student-id="B"] .rosterFullName','pointerdown',{pointerType:'touch',clientX:single.x+10,clientY:single.y+10});
    await page.dispatchEvent(await rail.isVisible()?'.rosterNameRail [data-name-attendance="B"]':'#rosterRows tr[data-student-id="B"] .rosterFullName','pointerup',{pointerType:'touch',clientX:single.x+10,clientY:single.y+10});
    assert.equal(await page.evaluate(()=>Boolean(getAttendanceRecord(getSubject(),currentLectureKey(getSubject()),'B'))),false);
    await page.waitForTimeout(550);
    const selector=await rail.isVisible()?'.rosterNameRail [data-name-attendance="B"]':'#rosterRows tr[data-student-id="B"] .rosterFullName';
    await page.locator(selector).tap();
    await page.locator(selector).tap();
    await page.waitForFunction(()=>Boolean(getAttendanceRecord(getSubject(),currentLectureKey(getSubject()),'B')));
    const before=await page.evaluate(()=>JSON.stringify(getAttendanceRecord(getSubject(),currentLectureKey(getSubject()),'B')));
    await page.dispatchEvent(selector,'dblclick');
    assert.equal(await page.evaluate(()=>JSON.stringify(getAttendanceRecord(getSubject(),currentLectureKey(getSubject()),'B'))),before);
  });
  await check(report,'No uncaught browser errors',async()=>assert.deepEqual(report.pageErrors,[]));
 } finally {for(const c of clients)await c.context.close();await harness.close();saveReport(report,'lecture-sync-ui');}
})().catch(e=>{console.error(e);process.exitCode=1;});





