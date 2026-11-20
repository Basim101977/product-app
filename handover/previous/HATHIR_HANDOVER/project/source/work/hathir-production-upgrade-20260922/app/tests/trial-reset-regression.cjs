const {launch,makeReport,check,saveReport,assert}=require('./offline-harness.cjs');
const report=makeReport('authorized-trial-reset');
(async()=>{const h=await launch(report);try{const {page}=await h.page();await page.waitForFunction(()=>!!window.HathirOfflineStore);
 await check(report,'Explicit server trial-reset discards only superseded scope operations and preserves current/new account data',async()=>{
 const result=await page.evaluate(async()=>{
  const uid='qa_reset',workspaceId=uid,subjectId='trial',reset='trial-reset-00000000-test';
  const snapshot={uid,workspaceId,key:HathirOfflineStore.key(uid,subjectId),subject:{id:subjectId,lastRosterResetId:'old',attendanceClearedAtMillis:0},savedAt:Date.now()};
  const op={id:'old-trial-operation',uid,workspaceId,subjectId,rosterResetId:'old',createdAt:Date.now(),kind:'close'};
  await HathirOfflineStore.enqueue(snapshot,op);
  await HathirOfflineStore.enqueue(snapshot,{...op,id:'new-reset-operation',rosterResetId:reset});
  await HathirOfflineStore.enqueue({...snapshot,key:HathirOfflineStore.key(uid,'other'),subject:{id:'other'}},{...op,id:'other-scope',subjectId:'other'});
  await HathirOfflineStore.reconcileTrialReset(uid,workspaceId,[{id:subjectId,lastRosterResetId:reset}]);
  if(await HathirOfflineStore.subject(uid,subjectId))throw Error('Old trial snapshot survived authoritative reset');
  await HathirOfflineStore.save({...snapshot,subject:{id:subjectId,lastRosterResetId:reset,students:[],attendanceClearedAtMillis:Date.now()}});
  return {ids:(await HathirOfflineStore.operations(uid)).map(o=>o.id).sort(),saved:await HathirOfflineStore.subject(uid,subjectId)};
 });assert.deepEqual(result.ids,['new-reset-operation','other-scope']);assert.deepEqual(result.saved.subject.students,[]);
 });
 for(const fresh of [true,false])await check(report,`Remembered login with failed old close ${fresh?'cleans an authorized reset and loads online':'preserves an ordinary unresolved operation'}`,async()=>{
  const uid='qa_trial_login',base='attendanceWorkspaces/'+uid,reset='trial-reset-login';
  const fixture={uid,rememberedUser:true,verified:true,responses:{getPersonalAccountStatus:{status:'approved',emailVerified:true},openIndividualWorkspace:{workspaceId:uid}},records:{
   ['attendanceUserWorkspaces/'+uid]:{workspaceId:uid,active:true},
   [base+'/subjects/trial']:{id:'trial',titleAr:'اختبار',ownerUserId:uid,departmentId:'medical_devices',stageId:'stage_2',rosterNaming:'name',studentCount:0,lastRosterResetId:fresh?reset:'ordinary-reset'}
  }};
  const {page:p,context}=await h.page({fixture});try{
   await p.waitForFunction(()=>typeof subjects!=='undefined'&&subjects.some(s=>s.id==='trial'));
   await p.evaluate(async uid=>{
    const snapshot=offlineSnapshot({...subjects.find(s=>s.id==='trial'),lastRosterResetId:'old',students:[{id:'2A0001',name:'طالب تجربة'}],lectures:[],lectureMeta:{},attendance:{},offlinePreparedAt:Date.now()});
    await HathirOfflineStore.enqueue(snapshot,{id:'old-failed-close',uid,workspaceId:uid,subjectId:'trial',rosterResetId:'old',kind:'close',date:'2026-09-23T19:01',meta:{status:'completed'},preparedAt:Date.now(),createdAt:Date.now(),error:'Subject or roster changed; review required.'});
   },uid);
   await p.reload();
   await p.waitForFunction(()=>typeof subjects!=='undefined'&&!cloudDataLoading&&subjects.some(s=>s.id==='trial'));
   const result=await p.evaluate(async uid=>({pending:(await HathirOfflineStore.operations(uid)).map(o=>o.id),online:!session.offlineMode,students:subjects.find(s=>s.id==='trial').students.map(s=>s.id)}),uid);
   assert.deepEqual(result.pending,fresh?[]:['old-failed-close']);
   if(!fresh)assert.equal(result.online,false);
   if(fresh){
    assert.equal(result.online,true);assert(!result.students.includes('2A0001'));
    // Exercise the already-open stuck session, without navigation or reload.
    await p.evaluate(async uid=>{
     const snapshot=offlineSnapshot({...subjects.find(s=>s.id==='trial'),lastRosterResetId:'old',students:[{id:'2A0001',name:'طالب تجربة'}],lectures:[],lectureMeta:{},attendance:{},offlinePreparedAt:Date.now()});
     await HathirOfflineStore.enqueue(snapshot,{id:'old-close-active-session',uid,workspaceId:uid,subjectId:'trial',rosterResetId:'old',kind:'close',date:'2026-09-23T19:01',meta:{status:'completed'},preparedAt:Date.now(),createdAt:Date.now(),error:'Subject or roster changed; review required.'});
     session.offlineMode=true;
     await syncOfflineAttendance();
    },uid);
    await p.waitForFunction(()=>!cloudDataLoading&&!session.offlineMode);
    assert.deepEqual(await p.evaluate(uid=>HathirOfflineStore.operations(uid),uid),[]);
   }
  }finally{await context.close();}
 });
 }finally{await h.close();saveReport(report,'trial-reset-regression');}})().catch(e=>{console.error(e);process.exitCode=1});
