/* Offline attendance integration. Firebase Auth remains the account identity. */
const offlinePrepared=new Map();
let offlineSyncBusy=false,offlineQueueCount=0;
let offlinePendingSubjectIds=new Set();
function offlineHasPendingForSubject(subject) {
  return Boolean(subject?.id && offlinePendingSubjectIds.has(subject.id));
}
let offlinePreparing=false,offlineLastAttempt=0;
const offlineAutoPrepared=new WeakMap();
const offlinePreparationProgress=new Map();
let offlineUploadProgress={uid:'',done:0};
let offlineSyncTask=null,offlineSyncRequested=false,offlineRetryTimer=0,offlineRetryDelay=1000;
// Transport failures are not attendance conflicts. Keep their diagnostics
// separate: never mark/delete a durable operation merely for lost connectivity.
let offlineTransportFailure=null;
function offlineTransportFailureFor(uid=session?.uid) {
  return offlineTransportFailure?.uid===uid && offlineTransportFailure.workspaceId===session?.workspaceId ? offlineTransportFailure : null;
}
function recordOfflineTransportFailure(uid,workspaceId,error) {
  if(session?.uid!==uid||session.workspaceId!==workspaceId)return;
  const raw=String(error?.code||'unavailable').replace(/^(functions|auth)\//,'');
  const code=['unavailable','deadline-exceeded','unauthenticated','permission-denied','internal','not-found','resource-exhausted','cancelled','network-request-failed'].includes(raw)?raw:'unavailable';
  offlineTransportFailure={uid,workspaceId,code,at:Date.now()};
}
function clearOfflineTransportFailure(uid,workspaceId) {
  if(offlineTransportFailure?.uid===uid&&offlineTransportFailure.workspaceId===workspaceId)offlineTransportFailure=null;
}
function offlineTransportMessage(failure) {
  if(failure.code==='permission-denied')return offlineText('صلاحية الحساب الحالية لا تسمح بالرفع. العمليات محفوظة، وستُعاد المحاولة بعد استعادة الصلاحية.','The account currently cannot upload. Operations are saved and will retry when access is restored.');
  if(failure.code==='unauthenticated')return offlineText('تعذر التحقق من جلسة الحساب عند الرفع. التسجيلات محفوظة؛ يعيد البرنامج المحاولة تلقائيًا.','The upload could not verify the account session. Records are saved; automatic retry will continue.');
  if(failure.code==='deadline-exceeded')return offlineText('لم يصل تأكيد الخادم ضمن المهلة. التسجيلات ما زالت محفوظة وتُعاد المحاولة؛ لن تُحذف قبل التأكيد.','The server did not acknowledge within the timeout. Records remain saved and will be retried; nothing is removed before acknowledgement.');
  return offlineText('تعذر الاتصال بخدمة المزامنة أو استلام تأكيد صالح منها. التسجيلات محفوظة على الجهاز وتُعاد المحاولة تلقائيًا. هذا خطأ اتصال، وليس تعارضًا في سجلات الطلبة.','Could not contact the sync service or receive a valid acknowledgement. Records remain saved on this device and retry automatically. This is a connection error, not a student-record conflict.');
}
function offlineSubjectMissing(error) {
  // A generic HTTP 404 can mean a missing endpoint and remains retryable.
  // Only the application's explicit subject lookup failure is a review case.
  return error?.code==='functions/not-found' &&
    (error?.details?.reason==='subject-not-found'||error?.message==='The subject no longer exists.');
}
const offlineFailureReviewVersion='20260925-preview-close-reconcile-v2';
const offlineEpochRefreshTasks=new Map();
const offlineAssetTasks=new Map();
let offlineStatusRevision=0;
let offlineStatusScheduled=false;
let offlineLastStatusRead=0;
let offlineActionAvailabilityState='';
let offlineStartupSnapshots={uid:'',items:new Map()};
// Snapshot writes contain the whole subject. Keep every live attendance
// mutation, its local commit and rollback in one per-subject critical section.
const attendanceMutationTails=new Map();
function attendanceMutationScope(subject) {
  return {subject,liveSubject:subjects.find(s=>s===subject)||subjects.find(s=>s.id===subject.id),uid:session?.uid,workspaceId:session?.workspaceId,
    rosterResetId:subject.lastRosterResetId||'',attendanceClearedAtMillis:subject.attendanceClearedAtMillis||0};
}
function attendanceMutationScopeValid(scope) {
  return session?.uid===scope.uid&&session?.workspaceId===scope.workspaceId&&subjects.includes(scope.liveSubject)&&
    (scope.liveSubject.lastRosterResetId||'')===scope.rosterResetId&&
    (scope.liveSubject.attendanceClearedAtMillis||0)===scope.attendanceClearedAtMillis&&
    (scope.subject.lastRosterResetId||'')===scope.rosterResetId&&
    (scope.subject.attendanceClearedAtMillis||0)===scope.attendanceClearedAtMillis;
}
async function withAttendanceMutation(subject,mutate) {
  const scope=attendanceMutationScope(subject),key=JSON.stringify([scope.uid,scope.workspaceId,subject.id]);
  const previous=attendanceMutationTails.get(key)||Promise.resolve();
  const task=previous.catch(()=>{}).then(()=>attendanceMutationScopeValid(scope)?mutate(scope):false);
  attendanceMutationTails.set(key,task);
  try{return await task;}finally{if(attendanceMutationTails.get(key)===task)attendanceMutationTails.delete(key);}
}
function rememberOfflineStartupSnapshots(uid,items) {
  offlineStartupSnapshots={uid,items:new Map((items||[]).filter(item=>item.uid===uid&&item.workspaceId===uid&&item.session?.uid===uid&&item.session?.active&&item.subject?.id&&item.key===uid+':'+item.subject.id).map(item=>[item.subject.id,item]))};
}
function cachedSubjectPreview(item) {
  // A preview cannot scan faces. Exclude biometric arrays before serialization,
  // but retain a display-only indicator for the roster icon. Keep independent
  // copies: render helpers and attendance removal can mutate cached records.
  const studentPreview=student=>{
    const {faceDescriptor,faceDescriptors,faceDescriptorMap,...display}=student;
    return {...display,_cachedHasFaceDescriptor:hasFaceDescriptor(student)};
  };
  const {faceTemplateDescriptors,_cachedPreview,students,archivedStudents,...display}=item.subject;
  const s=JSON.parse(JSON.stringify({...display,students:(students||[]).map(studentPreview),
    ...(archivedStudents?{archivedStudents:archivedStudents.map(studentPreview)}:{})}));
  s.faceTemplateDescriptors=new Map();s.loadedLectureDates=new Set();s.loadedSummaryStudentIds=new Set();
  s.cachedDisplayOnly=true;s.liveLoadPending=true;s.historyPending=true;s.summaryLoaded=false;
  return s;
}
function showCachedWorkspacePreview(uid) {
  if(session?.uid!==uid||session.workspaceId!==uid||offlineStartupSnapshots.uid!==uid)return;
  const entries=[...offlineStartupSnapshots.items.values()];if(!entries.length)return;
  departments=entries[0].departments||[];stages=entries[0].stages||[];
  subjects=entries.map(cachedSubjectPreview);renderAll();
}
function attachCachedRecordPreview(subject) {
  if(offlineStartupSnapshots.uid!==session?.uid)return;
  const cached=offlineStartupSnapshots.items.get(subject.id);if(!cached)return;
  if(cached.subject.offlineEpochPending)subject.offlineEpochPending=true;
  // A replaced roster or cleared attendance must never be resurrected even as a preview.
  if(['rosterCohortId','lastRosterResetId','attendanceClearedAtMillis'].some(k=>(cached.subject[k]||'')!==(subject[k]||''))){offlinePrepared.delete(session.uid+':'+subject.id);return;}
  subject._cachedPreview=cachedSubjectPreview(cached);
}
function attendanceDisplaySubject(subject) {
  const old=subject?._cachedPreview;if(!old)return subject;
  return {...subject,students:subject.rosterLoaded?subject.students:old.students,
    lectures:subject.lectureIndexLoaded?subject.lectures:[...new Set([...(old.lectures||[]),...(subject.lectures||[])])].sort(),
    attendance:{...old.attendance,...subject.attendance},lectureMeta:{...old.lectureMeta,...subject.lectureMeta},
    excuses:{...old.excuses,...subject.excuses},_displayPreview:true};
}
function attendanceInputReady() {
  return !cloudDataLoading&&!sectionLoadPending&&!sectionLoadFailed&&selectedSubjectGroup().every(s=>!s.cachedDisplayOnly&&!s.liveLoadPending&&!s.liveLoadError&&!s.clearPending&&!s.attendanceClearInProgress&&!s.offlineEpochPending);
}
function offlinePreparationValid(subject) {
  const preparedAt=Number(subject?.offlinePreparedAt||0);
  return Number.isFinite(preparedAt)&&preparedAt>0&&preparedAt>=Number(subject?.attendanceClearedAtMillis||0);
}
const offlineFingerprint=s=>JSON.stringify([s.students,s.attendance,s.lectureMeta,s.absenceSettings,s.totalHours,s.lectureDurationHours]);
const offlineText=(ar,en)=>lang==='ar'?ar:en;
function isOfflineConnectionError(error) {
  const code=String(error?.code||'').replace(/^(firestore|functions|auth)\//,'');
  return ['unavailable','deadline-exceeded','network-request-failed'].includes(code)||(!code&&/client is offline|failed to fetch|network request failed/i.test(String(error?.message||'')));
}
async function recoverOfflineLogin(user,error) {
  // Never use a cached approval to bypass a server rejection.
  if(!isOfflineConnectionError(error)||auth?.currentUser?.uid!==user.uid)return false;
  const restored=await restoreOfflineSession(user);
  if(restored)syncOfflineAttendance().catch(()=>{});
  return restored;
}
async function cacheOfflineAsset(cache,url) {
  // Reuse exact-version assets without downloading them again. Keep a copy in
  // the persistent offline cache so a shell update cannot evict prepared models.
  if(await cache.match(url))return;
  const cached=await caches.match(url);
  if(cached){await cache.put(url,cached);return;}
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetch(url,{signal:controller.signal});
    if(!response.ok)throw Error('Offline asset HTTP '+response.status);
    await cache.put(url,response);
  } finally {clearTimeout(timer);}
}
function offlineSnapshot(subject) {
  const {_cachedPreview,...data}=subject;
  return {key:HathirOfflineStore.key(session.uid,subject.id),uid:session.uid,workspaceId:session.workspaceId,session:JSON.parse(JSON.stringify({...session,offlineMode:false})),departments,stages,subject:JSON.parse(JSON.stringify(data)),savedAt:Date.now()};
}
function offlineManaged(subject) {return Boolean(session && !usesLocalWorkspace(session) && offlinePrepared.has(session.uid+':'+subject?.id)&&offlinePreparationValid(subject)&&!subject.offlineEpochPending);}
function scheduleOfflineStatus() {
  // Only merge fire-and-forget progress requests made in the same turn. Calls
  // that await offlineStatus still perform fresh reads, including stale-read
  // races and cross-tab enqueue/acknowledgement visibility.
  if(offlineStatusScheduled)return;
  offlineStatusScheduled=true;
  queueMicrotask(()=>{offlineStatusScheduled=false;offlineStatus().catch(()=>{});});
}
async function offlineStatus() {
  if(!session||session.local)return;
  const uid=session.uid,revision=++offlineStatusRevision;
  const operations=await HathirOfflineStore.operations(uid);
  offlineLastStatusRead=Date.now();
  if(session?.uid!==uid||revision!==offlineStatusRevision)return;
  window.HathirSyncReminder?.update({
    uid, count: operations.length, busy: offlineSyncBusy,
    error: operations.some(op => op.error) || offlineTransportFailureFor(uid),
    ready: !session.offlineMode && !!session.active, unit: 'changes',
    percent: Math.floor((offlineUploadProgress.uid === uid ? offlineUploadProgress.done : 0) /
      Math.max(1, (offlineUploadProgress.uid === uid ? offlineUploadProgress.done : 0) + operations.length) * 100)
  });
  offlineQueueCount=operations.length;
  offlinePendingSubjectIds=new Set(operations.filter(op=>op.workspaceId===session.workspaceId).map(op=>op.subjectId));
  const actionState=JSON.stringify([uid,session.workspaceId,[...offlinePendingSubjectIds].sort(),navigator.onLine,!!session.offlineMode,!!session.active]);
  if(actionState!==offlineActionAvailabilityState){
    offlineActionAvailabilityState=actionState;
    if(typeof renderActionPermissions==='function')renderActionPermissions();
    if(typeof renderStudentProfile==='function'&&document.getElementById('studentProfileModal')?.hidden===false)renderStudentProfile();
    globalThis.HathirSettings?.render?.();
  }
  const label=document.getElementById('offlineStatus');
  if(label){
    const group=selectedSubjectGroup();
    const failed=operations.some(o=>o.error),ready=group.length>0&&group.every(offlineManaged);
    const currentSubjectIds=new Set(group.map(subject=>subject.id));
    const currentOperations=operations.filter(op=>op.workspaceId===session.workspaceId&&currentSubjectIds.has(op.subjectId));
    const loading=cloudDataLoading||sectionLoadPending||group.some(s=>s.cachedDisplayOnly||s.liveLoadPending||s.historyPending||!s.rosterLoaded||!s.lectureIndexLoaded);
    const loadFailed=sectionLoadFailed||group.some(s=>s.liveLoadError||s.historyError);
    const preparation=offlinePreparationProgress.get(uid+':'+getSubject()?.id);
    const reception=window.HathirLiveSync?.state();
    const done=offlineUploadProgress.uid===uid?offlineUploadProgress.done:0;
    let percent=0,state='preparing',message='';
    if(operations.length&&!currentOperations.length&&ready&&!loading&&!loadFailed){
      percent=100;state='review';
      message=offlineText(`لا رفع معلّق للمادة الحالية · ${operations.length} عملية أخرى تحتاج مراجعة`,`No pending upload for this subject · ${operations.length} other operation(s) need review`);
    }
    else if(operations.length){
      percent=Math.floor(done/(done+operations.length)*100);
      const transport=offlineTransportFailureFor(uid);
      state=failed||transport?'error':'pending';
      const missingSubject=operations.some(op=>op.error==='The subject no longer exists.'&&op.errorCode==='functions/not-found');
      message=missingSubject?offlineText('المادة غير موجودة · مراجعة','Subject missing · review'):
        failed?offlineText('عمليات تحتاج مراجعة','Operations need review'):
        !navigator.onLine?offlineText('بانتظار الاتصال','Waiting for connection'):
        !offlineSyncEligible(uid)?offlineText('بانتظار التحقق من الحساب','Waiting for account verification'):
        transport?offlineText('تعذر الاتصال · إعادة المحاولة','Connection failed · retrying'):
        offlineText(`مزامنة ${percent}%`,`Syncing ${percent}%`);
    }
    else if(group.some(s=>s.offlineEpochPending)){state='error';message=offlineText('يلزم تحديث السجل عبر الإنترنت','Refresh records online to continue');}
    else if(loadFailed){state='error';message=offlineText('تعذر تحميل السجل','Record load failed');}
    else if(loading){message=offlineText('تحميل السجل…','Loading records…');}
    else if(!group.length){state='idle';message=offlineText('اختر المادة','Select a subject');}
    // Once this subject is durably prepared, refreshing assets/data in the
    // background must not reset the attendance upload bar to "Preparing 0%".
    else if(ready&&reception){percent=100;state=reception.error?'error':reception.receivedAt&&reception.connected?'synced':'idle';message=!reception.connected?offlineText('محفوظ على الجهاز · دون اتصال','Saved on device · offline'):reception.error?offlineText('تم الرفع · تعذر استقبال السجل','Uploaded · record reception failed'):reception.loading?offlineText('تم الرفع · يجري استقبال السجل','Uploaded · receiving records'):reception.receivedAt?offlineText('تم الرفع واستقبال السجل','Uploaded and records received'):offlineText('لا رفع معلّق · لم يُتحقق من السجل','No pending upload · records not verified');}
    else if(ready){state='synced';percent=100;message=offlineText('لا عمليات معلّقة','No pending operations');}
    else if(preparation?.error){state='error';percent=Math.floor(preparation.done/8*100);message=offlineText('تعذر تجهيز ','Preparation failed: ')+(preparation.detail||offlineText('المادة','subject'));}
    else if(preparation&&preparation.done<8||!ready){percent=Math.floor((preparation?.done||0)/8*100);message=navigator.onLine?offlineText(`تجهيز ${percent}%`,`Preparing ${percent}%`):offlineText('بانتظار الاتصال','Waiting for connection');}
    else {state='synced';percent=100;message=offlineText('لا عمليات معلّقة','No pending operations');}
    label.querySelector('.offlineProgressText').textContent=message;
    label.querySelector('.offlineProgressFill').style.width=percent+'%';
    label.style.setProperty('--progress-color',state==='error'?'#b91c1c':state==='synced'?'#0f8473':percent<50?'#b7791f':'#a16207');
    label.title=message+' — '+offlineText('اضغط لعرض تفاصيل المزامنة والنسخة الاحتياطية','Tap for synchronization details and a local backup');label.setAttribute('aria-label',label.title);label.setAttribute('aria-valuenow',String(percent));label.setAttribute('aria-valuetext',message);label.dataset.state=state;
  }
}
async function prepareOfflineAssets(needsFaces) {
  const key=needsFaces?'faces':'base';
  if(offlineAssetTasks.has(key))return offlineAssetTasks.get(key);
  const task=(async()=>{
    if(needsFaces){
      await prepareOfflineAssets(false);
    } else await Promise.all(['jsqr','functions'].map(loadOptionalLibrary));
    const cache=await caches.open('hathir-offline-assets-v1');
    // Cache recognition resources without evaluating face-api/TensorFlow or
    // allocating models. ensureFaceReady() remains exclusively scanner work.
    const urls=needsFaces?[OPTIONAL_LIBRARIES.faceapi.src]:['/','/index.html','/manifest.webmanifest',...Array.from(document.scripts).filter(s=>s.dataset?.optionalLibrary!=='faceapi').map(s=>s.src).filter(Boolean).filter(url=>{const u=new URL(url,location.href);return u.origin===location.origin||['www.gstatic.com','cdn.jsdelivr.net'].includes(u.hostname);})];
    if(needsFaces)await Promise.all(['tiny_face_detector','face_landmark_68','face_recognition'].map(async model=>{
      const url=FACE_MODEL_URL+'/'+model+'_model-weights_manifest.json';
      await cacheOfflineAsset(cache,url);
      const groups=await (await caches.match(url)).json();
      for(const group of groups)for(const filename of group.paths)urls.push(FACE_MODEL_URL+'/'+filename);
    }));
    const pending=[...new Set(urls)];let next=0;
    await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{while(next<pending.length)await cacheOfflineAsset(cache,pending[next++]);}));
  })();
  offlineAssetTasks.set(key,task);
  try{await task;}catch(error){offlineAssetTasks.delete(key);throw error;}
}
async function ensureOfflineServiceWorker() {
  if(!('serviceWorker' in navigator))throw Error(offlineText('هذا المتصفح لا يدعم حفظ البرنامج دون إنترنت.','This browser does not support offline app storage.'));
  // The usual registration runs after window.load. On a slow first visit that
  // event can lag behind the subject load, so preparation must register too.
  const registration=await navigator.serviceWorker.register('service-worker.js');
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_,reject)=>setTimeout(()=>reject(Error(offlineText('لم يكتمل تثبيت ملفات البرنامج؛ أعد فتح الصفحة عند توفر الإنترنت.','App files did not finish installing; reopen the page while online.'))),20000))
  ]);
  if(navigator.serviceWorker.controller)return registration;
  // clients.claim() can arrive after ready; wait for that event instead of
  // asking the teacher to refresh while there may be local attendance.
  await Promise.race([
    new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true})),
    new Promise((_,reject)=>setTimeout(()=>reject(Error(offlineText('اكتمل تثبيت البرنامج لكن الصفحة لم تتصل به بعد؛ أعد فتحها.','The app installed but this page is not controlled yet; reopen it.'))),5000))
  ]);
  return registration;
}
const offlineFacePreparationTasks=new WeakMap();
const offlineFaceRetryAfter=new WeakMap();
function prepareOfflineFaceSupport(source) {
  if(!source||!session||usesLocalWorkspace(session)||session.offlineMode||!navigator.onLine||!offlineManaged(source)||Date.now()<(offlineFaceRetryAfter.get(source)||0))return;
  if(offlineFacePreparationTasks.has(source))return offlineFacePreparationTasks.get(source);
  if(source.faceTemplatesLoaded&&(!(source.students||[]).some(hasFaceDescriptor)||source.offlineFaceAssetsReady))return;
  const scope=attendanceMutationScope(source),startedAt=typeof performance!=='undefined'?performance.now():0;
  const storedScope={uid:scope.uid,workspaceId:scope.workspaceId,subjectId:source.id,rosterCohortId:source.rosterCohortId||'',rosterResetId:scope.rosterResetId,attendanceClearedAtMillis:scope.attendanceClearedAtMillis};
  let revision='';
  const current=()=>attendanceMutationScopeValid(scope)&&(source.rosterCohortId||'')===storedScope.rosterCohortId&&!source.liveLoadPending&&!source.historyPending&&!source.historyError;
  const persist=(includeTemplates=false)=>withAttendanceMutation(source,async()=>{
    if(!current())return false;
    const saved=await HathirOfflineStore.updateFaceSupport(storedScope,{...(includeTemplates?{students:source.students,faceTemplatesLoaded:source.faceTemplatesLoaded}:{}),
      offlineFaceAssetsReady:source.offlineFaceAssetsReady,offlineFacePreparationState:source.offlineFacePreparationState},revision);
    if(!current())return false;
    if(!saved?.saved){
      // A different tab/mark changed the durable revision during optional work.
      // Keep QR attendance intact and reload authoritative templates on retry.
      source.faceTemplatesLoaded=false;source.offlineFaceAssetsReady=false;source.offlineFacePreparationState='preparing';
      return false;
    }
    revision=saved.revision;
    offlineAutoPrepared.set(source,offlineFingerprint(source));
    return true;
  });
  const task=Promise.resolve().then(async()=>{
    source.offlineFacePreparationState='preparing';
    const refreshTemplates=!source.faceTemplatesLoaded;
    revision=(await HathirOfflineStore.readState(scope.uid,source.id)).revision;
    if(!current())return;
    if(refreshTemplates)await ensureSubjectFaceTemplatesLoaded(source,{force:true});
    if(!current()||!source.faceTemplatesLoaded)return;
    // Retain numeric templates even if optional model downloads fail. A
    // biometric-only transaction preserves history and fences other tabs.
    source.offlineFaceAssetsReady=false;
    const needsFaces=(source.students||[]).some(hasFaceDescriptor);
    if(!needsFaces)source.offlineFacePreparationState='unneeded';
    if(refreshTemplates&&!await persist(true))return;
    if(!needsFaces)return;
    await prepareOfflineAssets(true);
    if(!current())return;
    source.offlineFaceAssetsReady=true;source.offlineFacePreparationState='cached';
    if(!await persist())return;
    if(typeof traceApplicationLoadPhase==='function')traceApplicationLoadPhase('Offline face assets cached',startedAt);
  }).catch(error=>{
    if(!current())return;
    source.offlineFaceAssetsReady=false;source.offlineFacePreparationState='error';
    offlineFaceRetryAfter.set(source,Date.now()+30000);
    console.warn('Optional offline face assets will retry:',error?.code||error?.name||'Error');
  }).finally(()=>{if(offlineFacePreparationTasks.get(source)===task)offlineFacePreparationTasks.delete(source);});
  offlineFacePreparationTasks.set(source,task);
  return task;
}
async function prepareOfflineSubject() {
  const source=getSubject();
  if(source?.offlineEpochPending&&!source.clearPending&&!source.attendanceClearInProgress&&!source.liveLoadPending&&!cloudDataLoading&&!sectionLoadPending&&!offlineSyncBusy&&session&&!session.local&&navigator.onLine){await refreshOfflineSubjectEpoch(source);return;}
  if(!source||!session||usesLocalWorkspace(session)||!navigator.onLine||session.offlineMode||offlineQueueCount||offlinePreparing||!source.rosterLoaded||source.historyPending||source.historyError||!attendanceInputReady()||document.getElementById('scannerStage')?.classList.contains('cameraLive')||Date.now()-offlineLastAttempt<30000)return;
  offlineLastAttempt=Date.now();
  const fingerprint=offlineFingerprint;
  const preparationScope=attendanceMutationScope(source);
  const preparationCheckpoint=Number(source.offlinePreparedAt||source.attendanceServerReadAt||Date.now());
  const before=fingerprint(source);
  if(offlineAutoPrepared.get(source)===before){prepareOfflineFaceSupport(source);return;}
  offlinePreparing=true;
  const progressKey=session.uid+':'+source.id;
  const advance=done=>{offlinePreparationProgress.set(progressKey,{done});scheduleOfflineStatus();};
  advance(0);
  const subject={...source,attendance:JSON.parse(JSON.stringify(source.attendance||{})),lectureMeta:JSON.parse(JSON.stringify(source.lectureMeta||{})),lectures:[...(source.lectures||[])],loadedLectureDates:new Set(source.loadedLectureDates||[])};
  try {
    const uid=session.uid;
    await ensureOfflineServiceWorker();
    advance(1);
    await ensureSubjectRosterLoaded(subject);
    advance(2);
    await ensureSubjectLectureIndexLoaded(subject,{all:true});
    advance(3);
    await ensureSubjectAttendanceLoaded(subject);
    advance(4);
    advance(5);
    subject.students=source.students;
    await prepareOfflineAssets(false);
    advance(6);
    if(session?.uid!==uid)throw Error('Account changed');
    advance(7);
    const prepared=await withAttendanceMutation(source,async()=>{
      if(!attendanceMutationScopeValid(preparationScope)||offlineQueueCount||attendanceDirectWrites.size||document.getElementById('scannerStage')?.classList.contains('cameraLive'))return false;
      // Recheck only after earlier mutations have committed or rolled back.
      if(before!==fingerprint(source)){offlineLastAttempt=0;return false;}
      subject.students=source.students;
      subject.faceTemplatesLoaded=source.faceTemplatesLoaded===true;
      subject.attendanceLoaded=true;subject.rosterLoaded=true;subject.historyPending=false;subject.offlinePreparedAt=Math.max(preparationCheckpoint,Number(subject.attendanceClearedAtMillis||0));
      const snapshot=offlineSnapshot(subject);await HathirOfflineStore.save(snapshot);offlinePrepared.set(snapshot.key,true);
      // Publish prepared history only after its local save succeeds.
      Object.assign(source,{attendance:subject.attendance,lectureMeta:subject.lectureMeta,lectures:subject.lectures,loadedLectureDates:subject.loadedLectureDates,attendanceLoaded:true,lectureIndexLoaded:true,lectureIndexComplete:true,historyPending:false});
      source.offlinePreparedAt=subject.offlinePreparedAt;offlineAutoPrepared.set(source,fingerprint(source));
      return true;
    });
    if(!prepared)return;
    // Persistence is optional browser protection, not a prerequisite for IndexedDB.
    try {await navigator.storage?.persist?.();}catch(error){console.info('Persistent storage not granted; local data remains saved.');}
    advance(8);
    if(selectedSubjectGroup().includes(source)){renderSummary();renderRoster();renderActionPermissions();}
    await offlineStatus();
    // QR/manual attendance is durably prepared now. Optional biometrics must
    // not hold its readiness indicator or invalidate this preparation pass.
    prepareOfflineFaceSupport(source);
  }catch(error){const done=offlinePreparationProgress.get(progressKey)?.done||0;const stages=[['تهيئة المتصفح','Browser setup'],['قائمة الطلبة','Student list'],['قائمة المحاضرات','Lecture index'],['سجل الحضور','Attendance history'],['بصمات الوجه','Face templates'],['مكتبات الماسح','Scanner libraries'],['ملفات التشغيل','Application assets'],['الحفظ على الجهاز','Local storage']];offlinePreparationProgress.set(progressKey,{done,error:true,detail:offlineText(...stages[Math.min(done,7)]),code:error.code||error.name,errorMessage:String(error.message||error).slice(0,240)});offlineStatus().catch(()=>{});console.warn('Automatic offline preparation will retry at stage '+done+':',error.message);}finally{offlinePreparing=false;}
}
const offlineOperationOrder=(a,b)=>(a.queueOrder??a.createdAt)-(b.queueOrder??b.createdAt);
function applyPendingOfflineOperation(subject,op) {
  if(!subject.lectures.includes(op.date))subject.lectures.push(op.date);
  const previous=subject.lectureMeta[op.date]||{};
  const lifecycleOperation=['close','cancel'].includes(op.kind);
  const status=op.kind==='close'?'completed':op.kind==='cancel'?'cancelled':
    ['completed','cancelled','voided'].includes(previous.status)?previous.status:op.meta.status;
  subject.lectureMeta[op.date]={...previous,...op.meta,
    hideWhenEmpty:op.kind==='unmark'||previous.hideWhenEmpty===true||op.meta.hideWhenEmpty===true,
    status,
    ...(lifecycleOperation&&op.protocolVersion===3?{lifecycleRevision:op.id}:{lifecycleRevision:previous.lifecycleRevision||op.meta.lifecycleRevision||null}),
    markRevisions:{...previous.markRevisions,...(op.studentId?{[op.studentId]:op.id}:{})}};
  subject.attendance[op.date] ||= {};
  if(op.kind==='mark'||op.kind==='setTime')subject.attendance[op.date][op.studentId]=op.record;
  if(op.kind==='unmark')delete subject.attendance[op.date][op.studentId];
  subject.summaryLoaded=false;subject.attendanceStatsDirty=true;
}
async function offlineAttendanceReadState(subject) {
  if(!session||session.local)return {revision:'',operations:[],uid:session?.uid,workspaceId:session?.workspaceId};
  const uid=session.uid,workspaceId=session.workspaceId;
  const state=await HathirOfflineStore.readState(uid,subject.id);
  return {...state,uid,workspaceId};
}
function applyOfflineAttendanceOverlay(subject,state,date) {
  if(session?.uid!==state.uid||session?.workspaceId!==state.workspaceId)return;
  const pending=state.operations.filter(o=>o.workspaceId===state.workspaceId&&o.subjectId===subject.id&&(!date||o.date===date)&&
    (o.rosterResetId||'')===(subject.lastRosterResetId||'')&&Number(o.preparedAt||0)>=Number(subject.attendanceClearedAtMillis||0)).sort(offlineOperationOrder);
  for(const op of pending)applyPendingOfflineOperation(subject,op);
}
async function overlayPendingOfflineAttendance(subject,date) {
  applyOfflineAttendanceOverlay(subject,await offlineAttendanceReadState(subject),date);
}
async function readAttendanceWithoutLocalRace(subject,read,commit) {
  // The revision changes atomically on both enqueue and acknowledgement,
  // including in another tab. A stale network read cannot undo a local edit
  // merely because its upload receipt has already removed the queued op.
  const scope=attendanceMutationScope(subject);
  for(let attempt=0;attempt<3;attempt++){
    const before=await offlineAttendanceReadState(subject);
    const value=await read();
    const committed=await withAttendanceMutation(subject,async()=>{
      if(!attendanceMutationScopeValid(scope))throw Error('Account or subject changed during attendance loading.');
      const after=await offlineAttendanceReadState(subject);
      if(!attendanceMutationScopeValid(scope))throw Error('Account or subject changed during attendance loading.');
      if(before.revision!==after.revision)return false;
      commit(value,after);return true;
    });
    if(committed)return;
  }
  throw Error(offlineText('تغيّر الحضور أثناء التحميل؛ أعد المحاولة بعد اكتمال الحفظ.','Attendance changed during loading; retry after saving finishes.'));
}
async function restoreOfflineSession(user) {
  if(!user)return false;
  const stored=await HathirOfflineStore.subjects(user.uid);
  const entries=stored.filter(s=>s.uid===user.uid && s.workspaceId===user.uid &&
    s.session?.uid===user.uid && s.session.workspaceId===user.uid && s.session.active===true &&
    s.subject?.id && s.key===HathirOfflineStore.key(user.uid,s.subject.id));
  if(!entries.length)return false;
  for(const op of (await HathirOfflineStore.operations(user.uid)).sort(offlineOperationOrder)) {
    const s=entries.find(e=>e.subject.id===op.subjectId)?.subject;if(!s)continue;
    if(op.workspaceId!==user.uid||(op.rosterResetId||'')!==(s.lastRosterResetId||'')||Number(op.preparedAt||0)<Number(s.attendanceClearedAtMillis||0))continue;
    applyPendingOfflineOperation(s,op);
  }
  if(auth?.currentUser?.uid!==user.uid)return false;
  session={...entries[0].session,offlineMode:true,local:false};
  membersCache=[session];departments=entries[0].departments;stages=entries[0].stages;
  subjects=entries.map(item=>{const s=item.subject;s.clearPending=false;s.offlineEpochPending=Boolean(s.offlineEpochPending)||!offlinePreparationValid(s);if(s.offlineEpochPending)offlinePrepared.delete(item.key);else offlinePrepared.set(item.key,true);delete s._cachedPreview;s.cachedDisplayOnly=false;s.liveLoadPending=false;s.liveLoadError=false;s.historyError=false;s.faceTemplateDescriptors=new Map((s.students||[]).map(p=>[normalizeId(p.id),getFaceDescriptors(p)]));s.loadedLectureDates=new Set(Object.keys(s.attendance||{}));s.rosterLoaded=true;s.faceTemplatesLoaded=s.faceTemplatesLoaded!==false;s.attendanceLoaded=s.attendanceLoaded!==false;s.lectureIndexLoaded=true;s.historyPending=!s.attendanceLoaded;s.summaryLoaded=false;return s;});
  // JSON snapshots do not retain Set prototypes. History is fully local here.
  for(const subject of subjects)subject.loadedSummaryStudentIds=new Set((subject.students||[]).map(student=>normalizeId(student.id)));
  activeSubjectId=subjects[0].id;compactScope=null;cloudDataLoading=false;sectionLoadPending=0;sectionLoadFailed=false;
  showApp();buildStudentCache();
  for(const subject of subjects)for(const date of subject.lectures||[]) {
    if(subject.offlineEpochPending)continue;
    const meta=subject.lectureMeta[date],end=meta?.status==='active'?lectureEndAt(subject,date):null;
    if(end&&end.getTime()<=Date.now())await withAttendanceMutation(subject,async()=>{
      const current=subject.lectureMeta[date];
      if(current?.status!=='active')return false;
      const before={...current};current.status='completed';
      current.closeReason='elapsed';current.closedAtMillis=end.getTime();
      try{await queueOfflineAttendance(subject,date,null,null,'close',before);}
      catch(error){subject.lectureMeta[date]=before;throw error;}
      return true;
    });
  }
  await offlineStatus();return true;
}
async function queueOfflineAttendance(subject,date,student,record,kind='mark',before=null) {
  if(subject.offlineEpochPending||subject.clearPending||subject.attendanceClearInProgress)throw Error(offlineText('حدّث سجل المادة عبر الإنترنت قبل تسجيل حضور جديد.','Refresh this subject online before recording new attendance.'));
  const previousPreparedAt=subject.offlinePreparedAt;
  const preparedAt=Number(previousPreparedAt||(!session.offlineMode&&navigator.onLine?Math.max(Number(subject.attendanceServerReadAt||Date.now()),Number(subject.attendanceClearedAtMillis||0)):0));
  if(!Number.isFinite(preparedAt)||preparedAt<=0||preparedAt<Number(subject.attendanceClearedAtMillis||0))throw Error(offlineText('نسخة الحضور تحتاج تحديثاً عبر الإنترنت؛ لم يتغير أي تسجيل معلّق.','The attendance snapshot needs an online refresh; no pending records were changed.'));
  if(!offlineQueueCount)offlineUploadProgress={uid:session.uid,done:0};
  subject.summaryLoaded=false;
  const meta=lectureMeta(subject,date),studentId=student?.id||'',oldRevisions=meta.markRevisions;
  const lifecycleOperation=['close','cancel'].includes(kind);
  const oldLifecycleRevision=before?.lifecycleRevision||meta.lifecycleRevision||null;
  // The server reads this student's expectedRevision, not a copy of every
  // student's revision map. Keep the full map in the atomic subject snapshot.
  const {markRevisions,...operationMeta}=meta;
  const op={id:crypto.randomUUID(),protocolVersion:3,uid:session.uid,workspaceId:session.workspaceId,subjectId:subject.id,date,kind,studentId,studentName:student?.name||'',record:record||null,
    expectedLifecycleRevision:oldLifecycleRevision,
    expectedLifecycleStatus:lifecycleOperation?(before?.status||'active'):null,
    expectedTime:before?.time||null,expectedRevision:oldRevisions?.[studentId]||null,expectedMarkedAtMillis:before?.markedAtMillis||null,
    meta:JSON.parse(JSON.stringify(operationMeta)),rosterResetId:subject.lastRosterResetId||'',preparedAt,createdAt:Date.now()};
  if(studentId)meta.markRevisions={...oldRevisions,[studentId]:op.id};
  if(lifecycleOperation)meta.lifecycleRevision=op.id;
  subject.offlinePreparedAt=preparedAt;
  const snapshot=offlineSnapshot(subject);
  try {await HathirOfflineStore.enqueue(snapshot,op);} catch(error) {
    if(subject.offlinePreparedAt===preparedAt){if(previousPreparedAt===undefined)delete subject.offlinePreparedAt;else subject.offlinePreparedAt=previousPreparedAt;}
    // Rendering may replace the metadata object while IndexedDB is pending.
    // Roll back only this failed revision, keeping concurrent students intact.
    const current=subject.lectureMeta?.[date],revisions=current?.markRevisions;
    if(lifecycleOperation&&current?.lifecycleRevision===op.id)current.lifecycleRevision=oldLifecycleRevision;
    if(studentId&&revisions?.[studentId]===op.id){
      current.markRevisions={...revisions};
      if(oldRevisions?.[studentId])current.markRevisions[studentId]=oldRevisions[studentId];
      else delete current.markRevisions[studentId];
    }
    throw error;
  }
  // enqueue already saved the complete current local snapshot atomically.
  // A new attendance mark does not require repeating offline asset preparation.
  if(subject.attendanceLoaded&&subject.faceTemplatesLoaded)offlineAutoPrepared.set(subject,offlineFingerprint(subject));
  // A status-rendering failure must not turn a committed local mark into a
  // failed save (and roll it back in memory while it remains in the outbox).
  try {await offlineStatus();} catch(error) {console.warn('Attendance saved; status refresh failed:',error.message);}
  syncOfflineAttendance().catch(()=>{});
}
function offlineSyncEligible(uid=session?.uid) {
  return Boolean(!window.HathirDeviceWorkspace&&navigator.onLine&&session&&!session.local&&session.uid===uid&&auth?.currentUser?.uid===uid);
}
function scheduleOfflineRetry(uid) {
  if(offlineRetryTimer||!offlineSyncEligible(uid))return;
  offlineRetryTimer=setTimeout(()=>{offlineRetryTimer=0;if(offlineSyncEligible(uid))syncOfflineAttendance().catch(()=>{});},Math.round(offlineRetryDelay*(0.8+Math.random()*0.4)));
  offlineRetryDelay=Math.min(30000,offlineRetryDelay*2);
}
const offlineQueueScope=op=>JSON.stringify([op.workspaceId,op.subjectId]);
async function refreshOfflineSubjectEpoch(subject) {
  if(!subject?.offlineEpochPending||!session||session.local||!navigator.onLine||typeof reloadSubjectAttendance!=='function')return false;
  const key=JSON.stringify([session.uid,session.workspaceId,subject.id]);
  if(offlineEpochRefreshTasks.has(key))return offlineEpochRefreshTasks.get(key);
  const scope=attendanceMutationScope(subject);
  const task=Promise.resolve().then(async()=>{
    if(!attendanceMutationScopeValid(scope))return false;
    // Verified reload preserves the outbox and filters pre-clear overlays.
    // A real pre-clear conflict must not lock this readiness marker forever.
    return reloadSubjectAttendance(subject);
  });offlineEpochRefreshTasks.set(key,task);
  try{return await task;}finally{if(offlineEpochRefreshTasks.get(key)===task)offlineEpochRefreshTasks.delete(key);}
}
function offlineSyncQueues(operations) {
  const queues=new Map();
  for(const operation of operations.sort(offlineOperationOrder)){
    const key=offlineQueueScope(operation);
    if(!queues.has(key))queues.set(key,[]);
    queues.get(key).push(operation);
  }
  return queues;
}
async function reconcileAuthorizedTrialReset(uid) {
  if(!navigator.onLine||!uid||auth?.currentUser?.uid!==uid||!db)return 0;
  const pending=await HathirOfflineStore.operations(uid),seen=new Set();
  const scopes=pending.filter(op=>{if(op.workspaceId!==uid||seen.has(op.subjectId))return false;seen.add(op.subjectId);return true;});
  // Independent subjects can be checked concurrently; each local reset remains
  // transactional and requires its own fresh authoritative server marker.
  await runLimited(scopes,3,async op=>{
    try{
      const doc=await db.collection('attendanceWorkspaces').doc(uid).collection('subjects').doc(op.subjectId).get({source:'server'});
      if(auth?.currentUser?.uid!==uid)return;
      const reset=doc.exists&&!doc.metadata?.fromCache?doc.data().lastRosterResetId:null;
      if(!String(reset||'').startsWith('trial-reset-'))return;
      await HathirOfflineStore.reconcileTrialReset(uid,uid,[{id:op.subjectId,lastRosterResetId:reset}]);
    }catch(error){
      // Failed/offline/unauthorized reads never authorize deletion. Preserve
      // the normal queue and its existing recovery behavior in those cases.
      console.warn('Trial reset verification deferred:',error.code||error.name);
    }
  });
  return Math.max(0,pending.length-(await HathirOfflineStore.operations(uid)).length);
}
async function syncOfflineAttendance() {
  offlineSyncRequested=true;
  if(offlineSyncTask)return offlineSyncTask;
  if(!offlineSyncEligible())return;
  clearTimeout(offlineRetryTimer);offlineRetryTimer=0;
  offlineSyncBusy=true;const uid=session.uid,workspaceId=session.workspaceId,refreshAfterReceipts=new Map();
  const run=async()=>{
    try{
      const retired=await reconcileAuthorizedTrialReset(uid);
      if(retired&&session?.uid===uid&&session.workspaceId===workspaceId){
        rememberOfflineStartupSnapshots(uid,await HathirOfflineStore.subjects(uid));
        await offlineStatus();
        if(!(await HathirOfflineStore.operations(uid)).length){
          await initializeCloudSession(auth.currentUser);
          return;
        }
      }
      if(!(await HathirOfflineStore.operations(uid)).length){offlineSyncRequested=false;clearOfflineTransportFailure(uid,workspaceId);return;}
      await loadOptionalLibrary('functions');
      if(offlineUploadProgress.uid!==uid)offlineUploadProgress={uid,done:0};
      const attemptedScopes=new Set();
      while(offlineSyncEligible(uid)){
        offlineSyncRequested=false;
        const operations=await HathirOfflineStore.operations(uid);
        if(!operations.length){offlineRetryDelay=1000;clearOfflineTransportFailure(uid,workspaceId);break;}
        // Preserve FIFO within each workspace/subject; an unresolved conflict
        // must not block an unrelated classroom for the same account.
        let first,batch,scope;
        for(const [key,queue] of offlineSyncQueues(operations)){
          if(attemptedScopes.has(key))continue;
          let head=queue[0];
          if(head.error){
            const claimed=await HathirOfflineStore.claimFailureReview(head.id,offlineFailureReviewVersion);
            if(!claimed)continue;
            // Revalidate one old failed payload exactly, under all original
            // server fences. A durable lease survives an interrupted response.
            head=claimed;batch=[head];
          }else{
            batch=[];
            for(const op of queue){if(batch.length===25||op.error)break;batch.push(op);}
          }
          first=head;scope=key;break;
        }
        if(!first)break;
        try{
          if(!offlineSyncEligible(uid))break;
          const response=await firebase.app().functions('asia-south1').httpsCallable(window.HathirLiveSync ? 'syncOfflineAttendancePreview' : 'syncOfflineAttendanceBatch',{timeout:120000})({workspaceId:first.workspaceId,subjectId:first.subjectId,operations:batch});
          const result=response?.data,accepted=result?.acceptedOperationIds;
          if(!Array.isArray(accepted)||accepted.length>batch.length||accepted.some((id,i)=>id!==batch[i].id)||
             (result.failure&&(typeof result.failure!=='object'||accepted.length>=batch.length||
               typeof result.failure.operationId!=='string'||result.failure.operationId!==batch[accepted.length].id||
               typeof result.failure.code!=='string'||!result.failure.code||typeof result.failure.message!=='string'||!result.failure.message))||
             (!result.failure&&accepted.length!==batch.length))throw Object.assign(Error('Invalid synchronization acknowledgement'),{code:'functions/internal'});
          clearOfflineTransportFailure(uid,first.workspaceId);
          if(accepted.length){
            for(const op of batch.slice(0,accepted.length))if(op.error==='Attendance was cleared after offline preparation; review required.'){
              await HathirOfflineStore.requireAttendanceRefresh(uid,op.subjectId,op.workspaceId);
              refreshAfterReceipts.set(offlineQueueScope(op),op);
              if(session?.uid===uid&&session.workspaceId===op.workspaceId&&typeof subjects!=='undefined'){
                const subject=subjects.find(s=>s.id===op.subjectId);if(subject){subject.offlineEpochPending=true;offlinePrepared.delete(uid+':'+subject.id);}
              }
            }
            await HathirOfflineStore.acknowledgeMany(accepted);offlineUploadProgress.done+=accepted.length;offlineRetryDelay=1000;
            window.HathirLiveSync?.refresh().catch(()=>{});
          }
          if(result.failure){
            const rejected=batch[accepted.length];
            await HathirOfflineStore.fail({...rejected,error:String(result.failure.message),errorCode:result.failure.code,failureReviewVersion:offlineFailureReviewVersion,failureReviewState:'done',failureReviewLeaseOwner:null,failureReviewLeaseUntil:0});
            attemptedScopes.add(scope);
          }
          await offlineStatus();
          // Re-read the durable outbox, so marks arriving during this request
          // are sent now rather than waiting for the 30-second safety timer.
        }catch(error){
          const missingSubject=offlineSubjectMissing(error);
          const permanent=missingSubject||['functions/failed-precondition','functions/invalid-argument','functions/already-exists'].includes(error.code);
          if(permanent){clearOfflineTransportFailure(uid,first.workspaceId);await HathirOfflineStore.fail({...first,error:missingSubject?'The subject no longer exists.':String(error.message),errorCode:error.code,failureReviewVersion:offlineFailureReviewVersion,failureReviewState:'done',failureReviewLeaseOwner:null,failureReviewLeaseUntil:0});}
          else {recordOfflineTransportFailure(uid,first.workspaceId,error);scheduleOfflineRetry(uid);}
          attemptedScopes.add(scope);offlineSyncRequested=false;
        }
      }
    }catch(error){offlineSyncRequested=false;recordOfflineTransportFailure(uid,workspaceId,error);scheduleOfflineRetry(uid);}
  };
  // New tabs elect one uploader. Older tabs still remain safe through receipts.
  // A missed lock schedules a retry instead of spinning or dropping the queue.
  offlineSyncTask=navigator.locks?.request
    ? navigator.locks.request('hathir-attendance-upload:'+uid,{ifAvailable:true},lock=>{
      if(lock)return run();offlineSyncRequested=false;scheduleOfflineRetry(uid);
    })
    : run();
  try{await offlineSyncTask;}finally{
    offlineSyncTask=null;offlineSyncBusy=false;await offlineStatus();
    if(refreshAfterReceipts.size&&session?.uid===uid&&navigator.onLine){
      const remaining=await HathirOfflineStore.operations(uid);
      for(const [scope,op] of refreshAfterReceipts){
        if(session?.uid!==uid||session.workspaceId!==op.workspaceId||remaining.some(item=>offlineQueueScope(item)===scope))continue;
        const subject=typeof subjects!=='undefined'?subjects.find(s=>s.id===op.subjectId):null;
        if(subject&&selectedSubjectGroup().includes(subject))await refreshOfflineSubjectEpoch(subject).catch(error=>console.warn('Post-recovery record refresh remains required:',error?.code||error?.name||'Error'));
      }
    }
    // Close the race between the final empty read and finishing this task.
    if(session?.uid===uid&&session.offlineMode&&navigator.onLine&&typeof revalidateOnlineSession==='function')await revalidateOnlineSession();
    if(offlineSyncRequested&&offlineSyncEligible())queueMicrotask(()=>syncOfflineAttendance().catch(()=>{}));
  }
}
async function exportOfflineEmergency() {
  if(!session)return;
  const uid=session.uid,operations=await HathirOfflineStore.operations(uid);
  if(session?.uid!==uid)return;
  const blob=new Blob([JSON.stringify({app:'Hathir',uid,exportedAt:new Date().toISOString(),operations},null,2)],{type:'application/json'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='Hathir-pending-attendance.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
function offlineFailureReason(operation) {
  const reasons={
    'The subject no longer exists.':['المادة الأصلية غير موجودة حاليًا في الخادم. التسجيلات محفوظة للمراجعة والاستعادة؛ نزّل نسخة احتياطية. لا تنشئ مادة بديلة لربط هذه التسجيلات بها تلقائيًا.','The original subject is missing on the server. Records are retained for review and recovery; download a backup. Do not automatically attach them to a replacement subject.'],
    'Subject or roster changed; review required.':['تغيّرت المادة أو قائمة الطلبة؛ يلزم مطابقة السجل قبل رفعه.','The subject or roster changed; the record needs review.'],
    'Attendance was cleared after offline preparation; review required.':['مُسح سجل الحضور بعد حفظ النسخة المحلية؛ لم نُعد إنشاء بيانات ممسوحة.','Attendance was cleared after this device was prepared; deleted data has not been recreated.'],
    'The lecture no longer exists.':['لم تعد المحاضرة موجودة في الخادم.','The lecture no longer exists on the server.'],
    'Lecture was cancelled.':['أُلغيت المحاضرة في الخادم؛ بقي السجل المحلي محفوظاً للمراجعة.','The lecture was cancelled on the server; the local record is retained for review.'],
    'Lecture state changed on another device; review required.':['تغيّرت حالة المحاضرة أو نسختها على جهاز آخر؛ يلزم مراجعتها.','The lecture state or version changed on another device; review is required.'],
    'Lecture status changed; review required.':['تغيّرت حالة المحاضرة؛ يلزم مراجعتها.','The lecture status changed; review is required.'],
    'Only an open lecture can be closed.':['طلب الإغلاق لا يطابق محاضرة مفتوحة.','The closure request does not match an open lecture.'],
    'Another device recorded a different lecture time.':['سجّل جهاز آخر وقت بدء مختلفاً للمحاضرة.','Another device recorded a different lecture start time.'],
    'Lecture duration changed.':['تغيّرت مدة المحاضرة في الخادم.','The lecture duration changed on the server.'],
    'Student list changed; attendance needs review.':['تغيّرت بيانات الطالب في القائمة؛ يلزم مطابقة التسجيل.','The student roster entry changed; the attendance needs review.'],
    'Attendance changed on another device; review required.':['عُدّل حضور هذا الطالب على جهاز آخر؛ لم نستبدل التعديل.','This attendance was changed on another device; that change was not overwritten.'],
    'Attendance timestamp changed on another device; review required.':['تغيّرت نسخة توقيت الحضور على جهاز آخر.','The attendance timestamp changed on another device.'],
    'Attendance was removed on another device; review required.':['حُذف هذا الحضور على جهاز آخر؛ لم نُعد إنشاءه.','This attendance was removed on another device; it was not recreated.'],
    'Attendance outside lecture duration.':['وقت التسجيل خارج مدة المحاضرة المحددة.','The recorded attendance time is outside the lecture duration.'],
    'Attendance exists at another time; review required.':['يوجد تسجيل حضور بوقت مختلف في الخادم.','Attendance already exists at a different time on the server.'],
    'Invalid device clock or lecture date.':['وقت الجهاز أو تاريخ المحاضرة غير صالح؛ تحقّق من الساعة والتاريخ.','The device clock or lecture date is invalid; check the date and time.'],
    'Invalid lecture closure time.':['وقت إغلاق المحاضرة غير صالح؛ تحقّق من ساعة الجهاز.','The lecture closure time is invalid; check the device clock.'],
    'Account mismatch.':['الحساب الحالي لا يطابق حساب التسجيل المحفوظ.','The current account does not match the saved operation.']
  };
  const message=String(operation.error||''),code=String(operation.errorCode||'').replace(/^functions\//,'');
  if(reasons[message])return offlineText(...reasons[message]);
  if(code==='permission-denied')return offlineText('رفض الخادم صلاحية الحساب لهذه العملية؛ راجع الحساب وصلاحياته.','The server denied permission for this operation; check the account and its permissions.');
  if(code==='invalid-argument')return offlineText('رفض الخادم بيانات العملية. التفاصيل: ','The server rejected the operation data. Details: ')+message.slice(0,300);
  return message.slice(0,300)||offlineText('يلزم مراجعة السجل المحفوظ قبل مزامنته.','The saved operation requires review before it can synchronize.');
}
async function showOfflineSyncDetails() {
  if(!session||session.local||document.getElementById('offlineSyncDetails'))return;
  const uid=session.uid,operations=(await HathirOfflineStore.operations(uid)).sort(offlineOperationOrder);
  if(session?.uid!==uid)return;
  const failed=operations.filter(op=>op.error),dialog=document.createElement('dialog');
  dialog.id='offlineSyncDetails';dialog.dir=lang==='ar'?'rtl':'ltr';dialog.setAttribute('aria-labelledby','offlineSyncDetailsTitle');
  dialog.style.cssText='box-sizing:border-box;width:min(92vw,520px);max-height:80vh;overflow:auto;border:1px solid #dbe5e2;border-radius:18px;padding:22px;color:#183e35;background:#fff;box-shadow:0 20px 70px #0003;font:inherit;';
  const add=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;dialog.appendChild(node);return node;};
  const title=add('h2',offlineText('تفاصيل المزامنة','Synchronization details'));title.id='offlineSyncDetailsTitle';title.tabIndex=-1;title.setAttribute('autofocus','');title.style.cssText='font-size:20px;margin:0 0 12px';
  add('p',offlineText(`عمليات محفوظة على هذا الجهاز بانتظار الرفع: ${operations.length}. تحتاج مراجعة: ${failed.length}.`,`Operations saved on this device awaiting upload: ${operations.length}. Requiring review: ${failed.length}.`));
  add('p',offlineText('عدد العمليات يشمل التسجيل والتعديل وإغلاق المحاضرة، وليس عدد الطلبة. عرض الحضور لا يؤكد رفعه إلى الخادم.','Operations include marks, corrections and lecture closure; this is not a student count. Displayed attendance is not confirmation of server upload.'));
  add('p',offlineText('هذه حالة العمليات على هذا الجهاز. حدّث السجل للاطلاع على تعديلات الأجهزة الأخرى.','This is the queue on this device. Refresh the record to see changes from other devices.'));
  const transport=offlineTransportFailureFor(uid);
  if(operations.length&&transport){
    add('p',offlineTransportMessage(transport));
    const diagnostic=add('small','');diagnostic.dir='ltr';diagnostic.style.display='block';
    diagnostic.textContent=transport.code+' · '+new Date(transport.at).toLocaleTimeString(lang==='ar'?'ar-IQ':'en-US');
    add('p',offlineText('«تحتاج مراجعة: 0» تعني عدم وجود تعارض مُبلغ عنه، ولا تعني نجاح الرفع.','“Requiring review: 0” means no reported record conflict, not a successful upload.'));
  }else if(operations.length&&!offlineSyncEligible(uid))add('p',offlineText('بانتظار اتصال الإنترنت وجلسة الحساب الصحيحة. لا تمسح بيانات الموقع؛ التسجيلات المعلقة محفوظة.','Waiting for a connection and the correct account session. Do not clear site data; pending records remain saved.'));
  const localCopies=await HathirOfflineStore.subjects(uid);
  if(session?.uid!==uid)return;
  const readyCopies=localCopies.filter(item=>item.session?.active===true&&item.workspaceId===uid&&offlinePreparationValid(item.subject));
  add('p',readyCopies.length?offlineText(`جاهز لفتح ${readyCopies.length} مادة محفوظة دون إنترنت على هذا الجهاز. افتح البرنامج من المتصفح نفسه دون تسجيل الخروج.`,`Ready to reopen ${readyCopies.length} saved subjects offline on this device. Use the same browser and remain signed in.`):offlineText('لم تجهز نسخة محلية بعد. افتح المادة بوجود الإنترنت وانتظر اكتمال التجهيز قبل العمل أوفلاين.','No local copy is ready yet. Open the subject online and wait for preparation before working offline.'));
  const preparation=offlinePreparationProgress.get(uid+':'+getSubject()?.id);
  if(preparation?.error){
    add('p',offlineText('تعذر تجهيز المادة عند مرحلة: ','Subject preparation failed at: ')+(preparation.detail||'—'));
    if(preparation.errorMessage)add('p',preparation.errorMessage);
    if(preparation.code){const code=add('small',String(preparation.code));code.dir='ltr';code.style.display='block';}
    add('p',offlineText('سيُعاد التجهيز تلقائيًا عند توفر الاتصال. لا تمسح بيانات الموقع أو التسجيلات المحفوظة.','Preparation retries automatically when connected. Do not clear site data or saved attendance.'));
  }
  const faceStates=selectedSubjectGroup().map(subject=>subject.offlineFacePreparationState);
  if(faceStates.includes('error'))add('p',offlineText('لم يكتمل تجهيز ملفات الوجه دون إنترنت. حفظ حضور QR والحضور اليدوي مستقل عن ذلك.','Offline face assets are not fully prepared. QR and manual attendance saving are independent of this.'));
  else if(faceStates.includes('preparing'))add('p',offlineText('يجري تجهيز ملفات الوجه في الخلفية؛ لا يتطلب حفظ حضور QR والحضور اليدوي انتظارها.','Face assets are being prepared in the background; QR and manual attendance saving do not need to wait.'));
  else if(faceStates.includes('cached'))add('p',offlineText('ملفات الوجه محفوظة دون إنترنت؛ يبدأ تشغيل نماذج الوجه عند استخدام ماسح الوجه.','Face assets are cached for offline use; face models start when the face scanner is used.'));
  const kinds={mark:['تسجيل حضور','Attendance mark'],setTime:['تعديل وقت','Time correction'],unmark:['إزالة حضور','Attendance removal'],close:['إغلاق محاضرة','Lecture closure'],cancel:['إلغاء محاضرة','Lecture cancellation']};
  for(const op of failed.slice(0,10)){
    const section=document.createElement('section');section.style.cssText='border-top:1px solid #e4ece8;padding:12px 0;';dialog.appendChild(section);
    const subject=typeof subjects!=='undefined'?subjects.find(item=>item.id===op.subjectId):null;
    const heading=document.createElement('strong');heading.textContent=(subject?.name?subject.name+' · ':'')+offlineText(...(kinds[op.kind]||['عملية محفوظة','Saved operation']))+' — ';const date=document.createElement('bdi');date.dir='ltr';date.textContent=String(op.date||'').slice(0,10)+(op.meta?.startTime?' · '+op.meta.startTime:'');heading.appendChild(date);section.appendChild(heading);
    const reason=document.createElement('p');reason.textContent=offlineFailureReason(op);section.appendChild(reason);
    const code=document.createElement('small');code.textContent=String(op.errorCode||'');section.appendChild(code);
    const retry=document.createElement('button');retry.type='button';retry.className='btn ghost';retry.textContent=offlineText('إعادة التحقق من هذه العملية','Recheck this operation');
    retry.disabled=!offlineSyncEligible(uid);
    retry.addEventListener('click',async()=>{
      retry.disabled=true;
      try {
        if(session?.uid!==uid||session.workspaceId!==op.workspaceId)return;
        if(await HathirOfflineStore.requestFailureReview(op.id,uid,op.workspaceId)){
          await syncOfflineAttendance();
          dialog.close();await showOfflineSyncDetails();
        }else retry.textContent=offlineText('تجري مراجعتها؛ حاول بعد قليل','Review in progress; retry shortly');
      }catch{retry.textContent=offlineText('تعذر الاتصال؛ العملية محفوظة','Connection failed; operation is saved');retry.disabled=false;}
    });section.appendChild(retry);
    const explanation=document.createElement('small');explanation.style.display='block';explanation.textContent=offlineText('يفحص الخادم العملية الأصلية مجددًا. لا يستبدل سجلًا أحدث ولا يحذف العملية عند التعارض.','Revalidates the original operation. Never overwrites a newer record or deletes a conflict.');section.appendChild(explanation);
  }
  if(failed.length>10)add('p',offlineText('تتضمن النسخة الاحتياطية بقية التفاصيل.','The backup includes the remaining details.'));
  if(!failed.length&&!transport)add('p',operations.length?offlineText('تُرفع العمليات تلقائياً عند توفر الاتصال وصلاحية الحساب.','Operations upload automatically when a connection and an authorized account are available.'):offlineText('لا توجد عمليات حضور معلّقة على هذا الجهاز.','There are no pending attendance operations on this device.'));
  if(failed.length)add('p',offlineText('احتفظ بنسخة احتياطية قبل أي معالجة. لا تمسح بيانات الموقع أو تحذف التسجيلات المعلّقة. يستمر رفع المواد الأخرى مستقلاً.','Save a backup before any recovery. Do not clear site data or delete pending records. Other subjects can continue uploading independently.'));
  const actions=document.createElement('div');actions.style.cssText='display:flex;gap:10px;flex-wrap:wrap;margin-top:18px';dialog.appendChild(actions);
  if(operations.length){
    const backup=document.createElement('button');backup.type='button';backup.className='btn';backup.textContent=offlineText('تنزيل نسخة الحضور المعلّق','Download pending attendance backup');
    backup.addEventListener('click',()=>{if(session?.uid===uid)exportOfflineEmergency().catch(()=>{backup.textContent=offlineText('تعذر التنزيل؛ حاول مجدداً','Download failed; try again');});});actions.appendChild(backup);
  }
  const close=document.createElement('button');close.type='button';close.className='btn ghost';close.textContent=offlineText('إغلاق','Close');close.addEventListener('click',()=>dialog.close());actions.appendChild(close);
  dialog.addEventListener('close',()=>{dialog.remove();document.getElementById('offlineStatus')?.focus();});document.body.appendChild(dialog);dialog.showModal();title.focus({preventScroll:true});
}
function wakeOfflineSync() {
  if(document.hidden||!session||session.local)return;
  // Safari can suspend timers while backgrounded. Wake immediately on return,
  // retaining the same ordered outbox and single-flight upload task.
  scheduleOfflineStatus();
  if(offlineSyncEligible())syncOfflineAttendance().catch(()=>{});
}
function initOfflineAttendance() {
  document.querySelectorAll('#prepareOfflineBtn,#offlineSyncBtn,#offlineExportBtn').forEach(node=>node.remove());
  document.getElementById('offlineStatus')?.remove();
  const indicator=document.createElement('div');indicator.id='offlineStatus';indicator.setAttribute('role','progressbar');indicator.setAttribute('aria-valuemin','0');indicator.setAttribute('aria-valuemax','100');indicator.setAttribute('aria-valuenow','0');indicator.tabIndex=0;
  indicator.innerHTML='<span class="offlineProgressFill" aria-hidden="true"></span><span class="offlineProgressText">'+offlineText('تجهيز 0%','Preparing 0%')+'</span>';
  indicator.setAttribute('aria-haspopup','dialog');indicator.style.cursor='pointer';
  const details=()=>showOfflineSyncDetails().catch(error=>console.warn('Synchronization details unavailable:',error.name));
  indicator.addEventListener('click',details);indicator.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();details();}});
  const host=document.getElementById('syncStatusHost');
  if(host)host.appendChild(indicator);
  else document.getElementById('appVersion')?.insertAdjacentElement('afterend',indicator);
  const tick=()=>{if(session&&!session.local){if(Date.now()-offlineLastStatusRead>=30000)scheduleOfflineStatus();prepareOfflineSubject().catch(()=>{});}};
  window.addEventListener('hathir-offline-change',scheduleOfflineStatus);
  window.addEventListener('online',()=>{wakeOfflineSync();tick();});window.addEventListener('offline',()=>offlineStatus());
  window.addEventListener('pageshow',wakeOfflineSync);
  window.addEventListener('focus',wakeOfflineSync);
  document.addEventListener('visibilitychange',wakeOfflineSync);
  setInterval(tick,5000);
  setInterval(()=>{if(session&&!session.local)syncOfflineAttendance().catch(()=>{});},30000);
  window.addEventListener('beforeunload',event=>{if(offlineQueueCount){event.preventDefault();event.returnValue='';}});
}
