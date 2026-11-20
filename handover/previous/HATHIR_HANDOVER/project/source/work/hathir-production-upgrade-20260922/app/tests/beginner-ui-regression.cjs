'use strict';
const {assert,path,makeReport,check,saveReport,launch}=require('./offline-harness.cjs');
const report=makeReport('beginner-ui-regression');let harness;
async function open(page,students=null){await page.waitForFunction(()=>Boolean(window.HathirBeginnerUI&&document.getElementById('beginnerHub')));await page.evaluate(students=>{fixtureAuth.currentUser=fixtureUser();session={uid:'qa_beginner',workspaceId:'qa_beginner',email:'teacher@example.test',displayName:'أحمد علي',role:'owner',active:true,local:true,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};departments=defaultDepartments();stages=defaultStages();subjects=[];compactScope={departmentId:'medical_devices',stageId:'medical_devices_stage_2',section:''};activeSubjectId='';if(Array.isArray(students)){const s={id:'subject_beginner',titleAr:'الحاسوب',titleEn:'Computer',ownerUserId:session.uid,departmentId:'medical_devices',stageId:'medical_devices_stage_2',rosterNaming:'name',lectureDurationHours:2,totalHours:60,students,attendance:{},lectureMeta:{},lectures:[],excuses:{},archivedStudents:[]};subjects=[s];activeSubjectId=s.id;localData.subjects={[s.id]:s}}showApp()},students);await page.locator('#beginnerHub').waitFor()}
(async()=>{harness=await launch(report);try{
await check(report,'Daily screen shows only the requested actions and version',async()=>{const{page,context}=await harness.page({width:390});try{await open(page);assert.equal(await page.locator('#beginnerChooseSubject').innerText().then(x=>x.trim().replace(/^▾\s*/,'')),'اختيار المادة الدراسية');assert.equal(await page.locator('#beginnerStartAttendance').innerText().then(x=>x.replace(/\s+/g,' ').trim()),'ابدأ تسجيل الحضور');assert.equal(await page.locator('#beginnerOpenRecord').innerText(),'سجل الحضور');assert.equal(await page.locator('#appVersion').isVisible(),false);await page.locator('#beginnerMenuButton').click();assert(await page.locator('#beginnerMenuVersion').isVisible());await page.locator('#beginnerMenuClose').click();assert.equal(await page.locator('.stats').isVisible(),false);await page.locator('#beginnerChooseSubject').click();assert(await page.locator('#beginnerSubjectMenu').isVisible());await page.locator('#beginnerCreateSubject').click();assert(await page.locator('#teachingSetupModal').isVisible())}finally{await context.close()}});
await check(report,'Start requests a roster when the subject has no students',async()=>{const{page,context}=await harness.page({width:390});try{await open(page,[]);await page.locator('#beginnerStartAttendance').click();assert(await page.locator('#beginnerRosterDialog').isVisible());assert.equal(await page.locator('.beginnerRosterChoice').count(),2)}finally{await context.close()}});
await check(report,'A second lecture on the same day starts with its own attendance and reading',async()=>{
 const {page,context}=await harness.page({width:390});
 try{
  await open(page,Array.from({length:5},(_,i)=>({id:'s'+i,name:'طالب '+i})));
  const first=await page.evaluate(()=>{
   const s=subjects[0],day=todayISO(),second=day+'__'+'a'.repeat(32);
   s.lectures=[day,second];
   s.lectureMeta[day]={date:day,status:'completed',startTime:'00:48',durationHours:2};
   s.lectureMeta[second]={date:second,status:'active',startTime:'08:33',durationHours:2};
   s.attendance[day]=Object.fromEntries(s.students.slice(0,4).map(student=>[student.id,{studentName:student.name,time:'00:55'}]));
   s.attendance[second]={};renderAll();return {day,second};
  });
  assert.equal(await page.evaluate(()=>currentLectureKey(subjects[0])),first.second);
  assert.equal(await page.locator('#presentCount').textContent(),'0');
  assert.equal(await page.locator('#lastScanId').textContent(),'—');
  await page.evaluate(second=>{subjects[0].attendance[second].s4={studentName:'طالب 4',time:'08:34'};renderAll()},first.second);
  assert.equal(await page.locator('#presentCount').textContent(),'1');
  assert.equal(await page.locator('#lastScanId').textContent(),'طالب 4');
  assert.equal(await page.evaluate(day=>Object.keys(subjects[0].attendance[day]).length,first.day),4);
  await page.locator('#beginnerOpenRecord').click();
  const headers=await page.locator('#rosterHead th.ltr').allInnerTexts();
  assert(headers.some(label=>label.includes('م(1)')));
  assert(headers.some(label=>label.includes('م(2)')));
 }finally{await context.close()}
});
await check(report,'Elapsed lecture closes despite a pending upload and retries a failed local save',async()=>{
 const {page,context}=await harness.page({width:390});
 try{
  await open(page,[{id:'s1',name:'سارة علي'}]);
  await page.waitForTimeout(300);
  const allowed=await page.evaluate(()=>{
   const subject=subjects[0],date=todayISO();
   const start=new Date(Date.now()-180000).toLocaleTimeString('en-US',{timeZone:'Asia/Baghdad',hourCycle:'h23',hour:'2-digit',minute:'2-digit'});
   subject.attendance[date]={s1:{studentName:'سارة علي',time:start}};
   subject.lectures=[date];subject.lectureMeta[date]={date,status:'active',startTime:start,durationHours:1/60};
   session.local=false;session.offlineMode=false;offlineQueueCount=1;offlinePendingSubjectIds=new Set([subject.id]);
   offlineStatus=async()=>{};
   window.__autoCloseWrites=0;
   queueOfflineAttendance=async()=>{if(++window.__autoCloseWrites===1)throw Error('synthetic local save failure')};
   const permission=hasPermission('attendanceMark')&&!hasPermission('attendanceEdit');
   const access=memberCanAccessSubject(subject);
   scheduleAutomaticLectureClose();
   return {permission,access,end:lectureEndAt(subject,date)?.getTime(),now:Date.now()};
  });
  assert.equal(allowed.permission,true);
  assert.equal(allowed.access,true);
  assert(allowed.end<=allowed.now);
  await page.waitForFunction(()=>window.__autoCloseWrites===1);
  assert.equal(await page.evaluate(()=>subjects[0].lectureMeta[todayISO()].status),'active');
  await page.waitForFunction(()=>subjects[0].lectureMeta[todayISO()].status==='completed',null,{timeout:8000});
  assert.equal(await page.evaluate(()=>window.__autoCloseWrites),2);
 }finally{await context.close()}
});
await check(report,'Repeated end-lecture clicks create only one confirmation while refresh is pending',async()=>{
 const {page,context}=await harness.page({width:390});
 try{
  await open(page,[{id:'s1',name:'سارة علي'}]);
  await page.evaluate(()=>{
   const subject=subjects[0],date=todayISO();
   subject.lectures=[date];subject.lectureMeta[date]={date,status:'active',startTime:'23:00',durationHours:2};
   window.__lecturePrompts=0;window.confirm=()=>{window.__lecturePrompts++;return true;};
   window.__releaseLectureRefresh=null;
   window.HathirLiveSync={refresh:()=>new Promise(resolve=>window.__releaseLectureRefresh=resolve)};
   renderLectureBanner();
   els.completeLectureBtn.click();
   els.completeLectureBtn.click();
  });
  assert(await page.locator('#completeLectureBtn').isDisabled());
  assert.equal(await page.evaluate(()=>window.__lecturePrompts),1);
  await page.evaluate(()=>window.__releaseLectureRefresh());
  await page.waitForFunction(()=>subjects[0].lectureMeta[todayISO()].status==='completed');
  assert.equal(await page.evaluate(()=>window.__lecturePrompts),1);
  assert(await page.locator('#completeLectureBtn').isDisabled());
  assert.equal(await page.evaluate(()=>manualLectureStatusInFlight),false);
 }finally{await context.close()}
});
for(const width of [390,1440])await check(report,`${width}px cancelled lecture has a red heading and white cells`,async()=>{
 const {page,context}=await harness.page({width});
 try{
  await open(page,[{id:'s1',name:'سارة علي'}]);
  await page.evaluate(()=>{
   const subject=subjects[0],date=todayISO();
   subject.lectures=[date];subject.lectureMeta[date]={date,status:'cancelled',startTime:'08:00',durationHours:2};
   renderRoster();
  });
  await page.locator('#beginnerOpenRecord').click();
  const heading=page.locator('#rosterHead th.cancelledLectureColumn');
  assert.equal(await heading.count(),1);
  assert.match(await heading.innerText(),/ملغاة/);
  assert.match(await heading.innerText(),/08:00/);
  assert.match(await heading.innerText(),/م\(1\)/);
  assert.match(await heading.innerText(),/\n08:00 · م\(1\)\nملغاة/);
  assert.equal(await page.locator('#rosterRows tr:first-child td.cancelledLectureColumn').count(),1);
  const colors=await heading.evaluate(node=>({header:getComputedStyle(node).backgroundColor,text:getComputedStyle(node).color,cell:getComputedStyle(document.querySelector('#rosterRows td.cancelledLectureColumn')).backgroundColor}));
  assert.equal(colors.header,'rgb(243, 247, 251)');
  assert.equal(colors.text,'rgb(180, 35, 45)');
  assert.equal(colors.cell,'rgb(255, 255, 255)');
  await page.evaluate(()=>{const subject=subjects[0],date=todayISO();subject.lectureMeta[date].status='completed';subject.attendance[date]={S1:{time:'08:15',attendedMinutes:120}};renderRoster();});
  assert.equal(await page.locator('#rosterRows td.attendedLectureCell').count(),0);
  assert.equal(await page.locator('#rosterRows tr:first-child td.ltr').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');
 }finally{await context.close()}
});
for(const width of[320,390,768,1440])await check(report,`${width}px attendance record opens and closes without printing`,async()=>{const{page,context}=await harness.page({width});try{await open(page,[{id:'s1',name:'سارة علي'}]);await page.evaluate(()=>{window.__printCalls=0;window.print=()=>window.__printCalls++});assert.equal(await page.locator('#attendanceRecordCard').isVisible(),false);await page.locator('#beginnerOpenRecord').click();assert(await page.locator('#attendanceRecordCard').isVisible());assert.equal(await page.locator('#beginnerRecordDialog').getAttribute('open'),'');assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('attendanceRecordCard')).filter),'none');assert.equal(await page.locator('#attendanceRecordCard [data-i18n="attendanceRecordHelp"]').count(),0);const geometry=await page.evaluate(()=>{const card=document.querySelector('#attendanceRecordCard').getBoundingClientRect(),table=document.querySelector('#attendanceRecordCard .tableWrap').getBoundingClientRect();return{cardBottom:card.bottom,tableBottom:table.bottom,tableHeight:table.height,viewport:innerHeight}});assert(geometry.cardBottom-geometry.tableBottom<30,JSON.stringify(geometry));assert(geometry.tableHeight>geometry.viewport*.55,JSON.stringify(geometry));assert.equal(await page.evaluate(()=>window.__printCalls),0);assert.equal(await page.locator('#printBtn').isDisabled(),true);await page.screenshot({path:path.join(require('./offline-harness.cjs').REPORTS,`record-open-${width}.png`)});await page.waitForTimeout(900);assert.equal(await page.locator('#printBtn').isEnabled(),true);await page.locator('#beginnerRecordClose').click();assert.equal(await page.locator('#attendanceRecordCard').isVisible(),false);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(require('./offline-harness.cjs').REPORTS,`daily-actions-${width}.png`),fullPage:true})}finally{await context.close()}})
for(const width of[390,768,1440])await check(report,`${width}px record close stays at the left edge with no action beyond it`,async()=>{
 const{page,context}=await harness.page({width});try{
  await open(page,[{id:'s1',name:'سارة علي'}]);await page.locator('#beginnerOpenRecord').click();
  const x=await page.locator('#beginnerRecordClose').boundingBox();assert(x);
  const actions=await page.locator('#attendanceActions > :is(button,details)').evaluateAll(nodes=>nodes.filter(node=>node.id!=='beginnerRecordClose'&&getComputedStyle(node).display!=='none').map(node=>{const b=node.getBoundingClientRect();return{id:node.id||node.className,x:b.x,y:b.y,w:b.width}}));
  assert(actions.every(item=>item.y>=x.y+x.height-1||item.x>=x.x+x.width-1),JSON.stringify({width,x,actions}));
  if(width<=720){const card=await page.locator('#attendanceRecordCard').boundingBox();assert(x.x-card.x<55,JSON.stringify({width,x,card}));}
  await page.locator('#beginnerRecordClose').click();assert.equal(await page.locator('#beginnerRecordDialog').evaluate(node=>node.open),false);
 }finally{await context.close()}
});
for(const width of [320,390,768,1440])await check(report,`${width}px More menu stays inside the attendance dialog in both languages`,async()=>{
 const {page,context}=await harness.page({width});
 try{
  await open(page,[{id:'s1',name:'سارة علي'}]);
  await page.locator('#beginnerOpenRecord').click();
  for(const language of ['ar','en']){
   await page.evaluate(language=>{lang=language;applyLanguage()},language);
   const menu=page.locator('#attendanceRecordCard .actionMenu');
   await menu.locator('summary').click();
   const box=await page.locator('#attendanceRecordCard .actionMenuList').boundingBox();
   const card=await page.locator('#attendanceRecordCard').boundingBox();
   assert(box&&box.x>=card.x-1&&box.x+box.width<=card.x+card.width+1,JSON.stringify({width,language,box,card}));
   await menu.locator('summary').click();
  }
 }finally{await context.close()}
});
for(const width of [390,1440])await check(report,`${width}px student profile opens above the attendance record and returns to it`,async()=>{
 const {page,context}=await harness.page({width});
 try{
  await open(page,[{id:'s1',name:'سارة علي'}]);
  await page.locator('#beginnerOpenRecord').click();
  await page.locator('#rosterRows [data-profile]').first().click();
  assert(await page.locator('#studentProfileModal').isVisible());
  assert.equal(await page.locator('#beginnerRecordDialog').evaluate(dialog=>dialog.open),false);
  assert(await page.locator('#profileStudentNameInput').isEnabled());
  assert(await page.locator('#saveStudentProfileBtn').isEnabled());
  assert(await page.locator('#profileFaceImageBtn').isEnabled());
  assert(await page.locator('#profileFaceStartBtn').isEnabled());
  await page.locator('#profileStudentNameInput').fill('سارة علي اختبار');
  assert.equal(await page.locator('#profileStudentNameInput').inputValue(),'سارة علي اختبار');
  await page.evaluate(()=>renderAll()); // Face enrollment rerenders while the record dialog is suspended.
  assert.equal(await page.locator('#beginnerRecordDialog #attendanceRecordCard').count(),1);
  await page.locator('#closeStudentProfileBtn').click();
  assert.equal(await page.locator('#studentProfileModal').isVisible(),false);
  assert.equal(await page.locator('#beginnerRecordDialog').evaluate(dialog=>dialog.open),true);
  assert.equal(await page.locator('#beginnerRecordDialog #attendanceRecordCard').count(),1);
  assert(await page.locator('#beginnerRecordDialog #rosterRows [data-profile]').first().isVisible());
  await page.locator('#addStudentQuickBtn').click();
  assert(await page.locator('#studentProfileModal').isVisible());
  assert.equal(await page.locator('#beginnerRecordDialog').evaluate(dialog=>dialog.open),false);
  await page.locator('#closeStudentProfileBtn').click();
  assert.equal(await page.locator('#beginnerRecordDialog').evaluate(dialog=>dialog.open),true);
  await page.locator('#beginnerRecordClose').click();
  assert.equal(await page.locator('#beginnerRecordDialog').evaluate(dialog=>dialog.open),false);
  assert.equal(await page.locator('#attendanceRecordCard').isVisible(),false);
 }finally{await context.close()}
});
await check(report,'Profile editing remains available after the roster loads while lecture history is pending',async()=>{
 const {page,context}=await harness.page({width:390});
 try{
  await open(page,[{id:'s1',name:'سارة علي'}]);
  await page.evaluate(()=>{session.local=false;subjects[0].rosterLoaded=true;subjects[0].liveLoadPending=true;subjects[0].cachedDisplayOnly=false;});
  await page.locator('#beginnerOpenRecord').click();
  await page.locator('#rosterRows [data-profile]').first().click();
  assert(await page.locator('#saveStudentProfileBtn').isEnabled());
  assert(await page.locator('#profileFaceImageBtn').isEnabled());
  assert(await page.locator('#profileFaceStartBtn').isEnabled());
  await page.locator('#closeStudentProfileBtn').click();
  assert.equal(await page.locator('#beginnerRecordDialog').evaluate(dialog=>dialog.open),true);
 }finally{await context.close()}
});
await check(report,'Attendance time editor is reachable from the record and restores its dialog',async()=>{
 const {page,context}=await harness.page({width:390});
 try{
  await open(page,[{id:'s1',name:'سارة علي'}]);
  await page.evaluate(()=>{const s=subjects[0],date=todayISO();s.lectures=[date];s.lectureMeta[date]={date,status:'active',startTime:'09:00',durationHours:2};s.attendance[date]={s1:{studentName:'سارة علي',time:'09:15'}};renderAll()});
  await page.locator('#beginnerOpenRecord').click();
  await page.evaluate(()=>openAttendanceTimeEditor('s1',todayISO()));
  const state=await page.evaluate(()=>{const overlay=document.getElementById('attendanceTimeModal'),box=overlay.querySelector('.modalCard').getBoundingClientRect();return{visible:!overlay.hidden,front:overlay.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)),recordOpen:document.getElementById('beginnerRecordDialog').open}});
  assert(state.visible&&state.front&&!state.recordOpen,JSON.stringify(state));
  await page.locator('#closeAttendanceTimeModalBtn').click();
  assert.equal(await page.locator('#beginnerRecordDialog').evaluate(dialog=>dialog.open&&dialog.contains(document.getElementById('attendanceRecordCard'))),true);
  await page.locator('#beginnerRecordClose').click();
  assert.equal(await page.locator('#beginnerRecordDialog').evaluate(dialog=>dialog.open),false);
 }finally{await context.close()}
});
await check(report,'Phone drawer has four separate rows in both languages; dialog survives refresh',async()=>{
 const {page,context}=await harness.page({width:390});
 try {
  await open(page,[{id:'s1',name:'سارة علي'}]);
  for(const language of ['ar','en']) {
   await page.evaluate(language=>{lang=language;applyLanguage()},language);
   await page.locator('#beginnerMenuButton').click();
   await page.waitForTimeout(300);
   const boxes=await Promise.all(['settingsBtn','syncBtn','tourReplay'].map(id=>page.locator('#'+id).boundingBox()));
   for(let i=1;i<boxes.length;i++) assert(boxes[i].y>=boxes[i-1].y+boxes[i-1].height-1,JSON.stringify(boxes));
   const account=await page.locator('#beginnerMenuUser').boundingBox(),logout=await page.locator('#logoutBtn').boundingBox();
   assert(Math.abs(account.y+account.height/2-logout.y-logout.height/2)<2);
   assert(language==='ar'?logout.x<account.x:logout.x>account.x);
   await page.screenshot({path:path.join(require('./offline-harness.cjs').REPORTS,`phone-drawer-${language}.png`)});
   await page.locator('#beginnerMenuClose').click();
  }
  await page.locator('#beginnerOpenRecord').click();
  await page.evaluate(()=>{renderAll();renderAll()});
  assert.equal(await page.locator('#beginnerRecordDialog #attendanceRecordCard').count(),1);
  await page.screenshot({path:path.join(require('./offline-harness.cjs').REPORTS,'phone-record-dialog.png')});
  await page.locator('#beginnerRecordClose').click();
  assert.equal(await page.locator('#beginnerRecordDialog').isVisible(),false);
 } finally { await context.close(); }
});
await check(report,'Phone camera presentation stays inline and closing record preserves its stream',async()=>{
 const {page,context}=await harness.page({width:390});
 try {
  await open(page,[{id:'s1',name:'سارة علي'}]);
  await page.evaluate(()=>{
   window.__fullscreenCalls=0;
   document.getElementById('scannerStage').requestFullscreen=()=>{window.__fullscreenCalls++};
   enterMobileScannerPresentation();
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#194b50';ctx.fillRect(0,0,320,240);
   cameraStream=canvas.captureStream(1);window.__testStream=cameraStream;
   els.qrVideo.srcObject=cameraStream;els.qrVideo.play();els.scannerStage.classList.add('cameraLive');
   document.body.classList.add('beginnerScannerVisible');
  });
  assert.equal(await page.evaluate(()=>window.__fullscreenCalls),0);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('scannerFullscreen')),false);
  await page.evaluate(()=>{HathirBeginnerUI.render();renderLectureBanner()});
  assert(await page.locator('#beginnerHub .stats').isVisible());
  const finish=await page.locator('#beginnerStartAttendance').boundingBox(),cancel=await page.locator('#cancelLectureBtn').boundingBox();
  assert(finish.x>cancel.x&&Math.abs(finish.width-cancel.width)<1&&Math.abs(finish.height-cancel.height)<1);
  assert.equal(await page.locator('#beginnerStartAttendance').innerText(),'إنهاء المحاضرة');
  assert(await page.evaluate(()=>{const start=document.getElementById('beginnerStartAttendance'),scanner=document.querySelector('.scannerCard'),record=document.getElementById('beginnerOpenRecord');return start.parentElement.nextElementSibling===scanner&&scanner.nextElementSibling===record}));
  await page.locator('#beginnerOpenRecord').click();
  await page.evaluate(()=>renderAll());
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert(await page.locator('#attendanceRecordCard').isVisible());
  assert.equal(await page.locator('#attendanceRecordCard .recordControls').isVisible(),false);
  await page.locator('#expandAttendanceRecordBtn').click();
  assert(await page.locator('#beginnerRecordDialog').evaluate(el=>el.open&&el.classList.contains('recordMaximized')));
  assert.equal(await page.locator('.scannerCard').isVisible(),false);
  assert.equal(await page.locator('#beginnerScannerPip').count(),0);
  assert.equal(await page.evaluate(()=>cameraStream.getVideoTracks()[0].readyState),'live');
  await page.evaluate(()=>renderAll());
  assert.equal(await page.locator('#beginnerRecordDialog #attendanceRecordCard').count(),1);
  await page.locator('#expandAttendanceRecordBtn').click();
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert(await page.locator('#attendanceRecordCard').isVisible());
  await page.locator('#beginnerRecordClose').click();
  assert.equal(await page.evaluate(()=>cameraStream===window.__testStream&&cameraStream.getVideoTracks()[0].readyState==='live'),true);
  await page.locator('#scannerStage').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.evaluate(()=>{setScanStatus('saved','ok',true);HathirBeginnerUI.showAttendanceSuccess('سارة علي')});
  assert.equal(await page.locator('.attendanceSuccess strong').textContent(),'سارة علي');
  await page.locator('#scannerStage').scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('#scannerHudResult').evaluate(el=>Number(getComputedStyle(el).opacity)),1);
  await page.screenshot({path:path.join(require('./offline-harness.cjs').REPORTS,'phone-scanner-success.png')});
  await page.evaluate(()=>{setScanStatus('Already present','warn',true)});
  assert.equal(await page.locator('#scannerHudResult').innerText(),'Already present');
  await page.evaluate(()=>renderLectureBanner());
  assert.equal(await page.locator('#beginnerScannerRecordButton').count(),0);
  assert.equal(await page.locator('#completeLectureBtn').isVisible(),false);
  assert(await page.locator('#cancelLectureBtn').isVisible());
  await page.locator('#cancelLectureBtn').click();
  assert.equal(await page.locator('.scannerCard').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.__testStream.getVideoTracks()[0].readyState),'ended');
  assert.equal(await page.locator('#beginnerStartAttendance').innerText(),'ابدأ تسجيل الحضور');
  await page.evaluate(()=>{document.body.classList.add('beginnerScannerVisible');renderLectureBanner()});
  await page.locator('#beginnerStartAttendance').click();
  assert.equal(await page.locator('.scannerCard').isVisible(),false);
  await page.evaluate(()=>{document.body.classList.add('beginnerScannerVisible');stopScanner()});
  assert.equal(await page.locator('.scannerCard').isVisible(),false);
 } finally { await context.close(); }
});
}finally{await harness.close()}saveReport(report,'beginner-ui-regression')})().catch(e=>{console.error(e);process.exitCode=1});
