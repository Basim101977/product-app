'use strict';
const vm=require('node:vm');
const {REPORTS,assert,fs,path,launch,makeReport,check,saveReport}=require('./offline-harness.cjs');
const report=makeReport('student-profile-regression');
const source=fs.readFileSync(path.join(__dirname,'personal-ui-regression.cjs'),'utf8');
const fixture=vm.runInNewContext(source.slice(source.indexOf('async function installCallables'),source.indexOf('const row ='))+';({installWorkspace})');
let harness;
async function setup(page){
 await page.waitForFunction(()=>!!window.HathirPersonal);await fixture.installWorkspace(page);
 await page.evaluate(()=>{
  subjects=[subjects[0]];const s=subjects[0];s.rosterSource='cohort';s.faceTemplatesLoaded=true;s.faceTemplateDescriptors=new Map();
  s._rosterDocumentIds=Object.fromEntries(s.students.map(row=>[row.id,row.id]));s._rosterBaseline=Object.fromEntries(s.students.map(row=>[row.id,JSON.stringify([row.name,getFaceDescriptors(row)])]));
  const root='attendanceWorkspaces/'+session.uid+'/cohorts/'+cohortIdForSubject(s);personalFixture.records[root]={rosterVersion:1};
  for(const row of s.students)personalFixture.records[root+'/students/'+row.id]={id:row.id,name:row.name};
  openStudentProfile(s.students[0].id);
 });
}
(async()=>{
 harness=await launch(report);
 for(const width of [390,1440])await check(report,`Editable profile and square camera layout at ${width}px`,async()=>{
  const {page,context}=await harness.page({width});try{
   await setup(page);await page.evaluate(()=>document.fonts.ready);
   assert(await page.locator('#saveStudentProfileBtn').isEnabled());assert(await page.locator('#profileFaceStartBtn').isEnabled());assert(await page.locator('#profileFaceImageBtn').isEnabled());
   assert(await page.locator('#profileFaceCameraBtn').isDisabled());
   const box=await page.locator('#profileFaceStage').boundingBox();assert(Math.abs(box.width-box.height)<2);
   const screenshot=path.join(REPORTS,`student-profile-${width}.png`);await page.locator('#studentProfileModal .modalCard').screenshot({path:screenshot});report.screenshots.push(screenshot);
  }finally{await context.close();}
 });
 await check(report,'One face enrollment in an 85-student cohort writes only its template',async()=>{
  const {page,context}=await harness.page({width:390});
  try{
   await setup(page);
   const result=await page.evaluate(async()=>{
    const s=subjects[0],before=personalFixture.writes.length;
    s.students=Array.from({length:85},(_,i)=>({id:'ST'+String(i+1).padStart(3,'0'),name:'طالب اختبار '+String(i+1),faceDescriptors:[]}));
    s.faceTemplatesLoaded=true;
    await saveStudentFaceDescriptor(s,s.students[0],Array(128).fill(.2));
    renderAll();
    return {writes:personalFixture.writes.slice(before).map(x=>x.path),loaded:s.faceTemplatesLoaded,face:hasFaceDescriptor(s.students[0]),others:s.students.slice(1).filter(hasFaceDescriptor).length};
   });
   assert.equal(result.writes.length,1,JSON.stringify(result));
   assert(result.writes[0].endsWith('/faceTemplates/ST001'),JSON.stringify(result));
   assert.equal(result.loaded,true);assert.equal(result.face,true);assert.equal(result.others,0);
  }finally{await context.close()}
 });
 const {page,context}=await harness.page({width:390});await setup(page);
 await check(report,'Disabled actions explain offline and pending states and recover when eligible',async()=>{
  await page.evaluate(()=>{session.offlineMode=true;renderStudentProfile();});assert(await page.locator('#saveStudentProfileBtn').isDisabled());assert.match(await page.locator('#profileEditReason').textContent(),/الإنترنت/);
  await page.evaluate(()=>{session.offlineMode=false;offlineQueueCount=1;offlinePendingSubjectIds=new Set([subjects[0].id]);renderStudentProfile();});assert.match(await page.locator('#profileEditReason').textContent(),/معلّق/);
  await page.evaluate(()=>{offlineQueueCount=0;offlinePendingSubjectIds=new Set();renderStudentProfile();});assert(await page.locator('#saveStudentProfileBtn').isEnabled());
  await page.evaluate(()=>{offlineQueueCount=1;offlinePendingSubjectIds=new Set(['deleted-old-subject']);renderStudentProfile();});assert(await page.locator('#saveStudentProfileBtn').isEnabled(),'A deleted subject’s queued operation must not lock a different roster');
  assert(await page.locator('#deleteStudentBtn').isEnabled(),'The same orphaned operation must not lock student deletion');
  const unrelated=await page.evaluate(()=>({canEditAttendance:hasPermission('attendanceEdit'),canManageRoster:canManageStudents(subjects[0]),canClearRoster:canClearAction(subjects[0],'roster'),clearReason:clearActionDisabledReason(subjects[0],'roster')}));
  assert.equal(unrelated.canEditAttendance,true);assert.equal(unrelated.canManageRoster,true);
  if(unrelated.canClearRoster)assert(!/معلّق|مزامنة/.test(unrelated.clearReason),'An unrelated orphan must not block clearing this roster');
  await page.evaluate(()=>{offlineQueueCount=0;offlinePendingSubjectIds=new Set();renderStudentProfile();});
 });
 await check(report,'Profile controls recover automatically when the attendance upload is acknowledged',async()=>{
  const result=await page.evaluate(async()=>{
   offlineQueueCount=1;offlinePendingSubjectIds=new Set([subjects[0].id]);renderStudentProfile();
   const before=els.saveStudentProfileBtn.disabled;
   const original=HathirOfflineStore.operations;
   HathirOfflineStore.operations=async()=>[];
   try{await offlineStatus();}finally{HathirOfflineStore.operations=original;}
   return{before,after:els.saveStudentProfileBtn.disabled};
  });
  assert.equal(result.before,true);assert.equal(result.after,false);
 });
 await check(report,'Permission updates preserve typed names and failed save preserves stored name',async()=>{
  await page.locator('#profileStudentNameInput').fill('اسم معدل للاختبار');await page.evaluate(()=>renderStudentProfile());assert.equal(await page.locator('#profileStudentNameInput').inputValue(),'اسم معدل للاختبار');
  const result=await page.evaluate(async()=>{const original=persistCohortRoster,before=subjects[0].students[0].name;persistCohortRoster=async()=>{throw Error('Synthetic failure');};try{await saveStudentProfile();}catch{}finally{persistCohortRoster=original;}return {before,after:subjects[0].students[0].name};});assert.equal(result.before,result.after);
 });
 await check(report,'Saving a name targets existing roster and never moves attendance or IDs',async()=>{
  await page.evaluate(()=>saveStudentProfile());const state=await page.evaluate(()=>({name:subjects[0].students[0].name,writes:personalFixture.writes}));assert.equal(state.name,'اسم معدل للاختبار');assert(state.writes.length);assert(state.writes.every(row=>/\/(students|faceTemplates)\//.test(row.path)));
 });
 await check(report,'Camera warms models without waiting, captures only on demand and stops on close',async()=>{
  await page.evaluate(()=>{
   window.__beforeFaceWrites=personalFixture.writes.length;
   window.modelCalls=0;const modelGate=new Promise(resolve=>window.releaseModels=resolve);ensureFaceReady=async()=>{modelCalls++;await modelGate;return true;};detectFaceDescriptorFromElement=async()=>Array(128).fill(0.1);
   navigator.mediaDevices.getUserMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);window.profileTestStream=canvas.captureStream(1);return profileTestStream;};
  });
  await page.locator('#profileFaceStartBtn').click();await page.waitForFunction(()=>!!profileFaceStream&&!profileCameraOpening);
  assert.equal(await page.evaluate(()=>modelCalls),1);assert(await page.locator('#profileFaceCameraBtn').isEnabled());
  await page.locator('#profileFaceCameraBtn').click();await page.waitForFunction(()=>modelCalls===2);await page.evaluate(()=>releaseModels());await page.waitForFunction(()=>!faceBusy&&getFaceDescriptors(subjects[0].students[0]).length===1);assert.equal(await page.evaluate(()=>modelCalls),2);
  const writes=await page.evaluate(()=>personalFixture.writes.slice(window.__beforeFaceWrites));assert.equal(writes.filter(row=>row.path.includes('/faceTemplates/')).length,1);assert.equal(writes.filter(row=>row.path.includes('/students/')).length,0);
  assert.equal(await page.evaluate(()=>subjects[0].faceTemplatesLoaded),true);
  await page.locator('#closeStudentProfileBtn').click();assert.equal(await page.evaluate(()=>profileTestStream.getTracks()[0].readyState),'ended');
 });
 await check(report,'Late camera grant after closing the profile stops the returned stream',async()=>{
  await page.evaluate(()=>{openStudentProfile(subjects[0].students[0].id);navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.releaseProfileCamera=()=>{const c=document.createElement('canvas');c.width=c.height=4;window.lateStream=c.captureStream(1);resolve(lateStream);};});});
  await page.locator('#profileFaceStartBtn').click();await page.waitForFunction(()=>!!window.releaseProfileCamera);await page.locator('#closeStudentProfileBtn').click();await page.evaluate(()=>releaseProfileCamera());await page.waitForFunction(()=>lateStream.getTracks()[0].readyState==='ended');
 });
 await check(report,'Selected image enrolls a descriptor through the preserved roster path',async()=>{
  await page.evaluate(()=>{openStudentProfile(subjects[0].students[0].id);ensureFaceReady=async()=>true;detectFaceDescriptorFromElement=async()=>Array(128).fill(0.2);});
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=4;return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#profileFaceImageInput').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>!faceBusy&&getFaceDescriptors(subjects[0].students[0]).length===2);
  assert.equal(await page.evaluate(()=>subjects[0].faceTemplatesLoaded),true);
  assert((await page.locator('#rosterRows tr[data-student-id="MI20250001"] .js-face').innerHTML()).includes('facePortrait'));
  assert((await page.evaluate(()=>personalFixture.writes)).some(row=>row.path.includes('/faceTemplates/')));
 });
 await check(report,'A failed face write does not publish a new descriptor in memory',async()=>{
  const result=await page.evaluate(async()=>{const s=subjects[0],student=s.students[0],before=JSON.stringify(getFaceDescriptors(student)),original=cohortRefForSubject;cohortRefForSubject=()=>({collection:()=>({doc:()=>({set:async()=>{throw Error('Synthetic persistence failure')}})})});try{await saveStudentFaceDescriptor(s,student,Array(128).fill(0.3));}catch{}finally{cohortRefForSubject=original;}return {before,after:JSON.stringify(getFaceDescriptors(s.students[0]))};});assert.equal(result.before,result.after);
 });
 await context.close();await check(report,'No uncaught profile errors',()=>assert.deepEqual(report.pageErrors,[]));
})().catch(error=>report.cases.push({label:'setup',passed:false,error:error.stack})).finally(async()=>{if(harness)await harness.close();saveReport(report,'student-profile-regression');});
