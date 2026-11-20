/* Local-first workspace. Only closed lectures are included in explicit copies. */
(() => {
  'use strict';
  let row = null, saving = Promise.resolve(), saveEpoch = 0, uploading = null, uploadError = '', uploadConflict = false, retryTimer = 0;
  let uploadProgress='';
  let uploadPercent=0, retryAfter=0, failures=0;
  let receiving=null, receiveNotice='';
  let liveRunning=null,liveTimer=0,liveError='',liveFailures=0,localSaves=0,lastView=null;
  let liveConfirmedChanges = 0;
  let liveCheckedAt = 0;
  const liveEnabled=()=>Boolean(window.HathirSyncModel);
  const lectureKey=(id,date)=>JSON.stringify([id,date]);
  const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  const lectureValue=(subject,date)=>stable([subject?.lectureMeta?.[date],subject?.attendance?.[date]||{},subject?.excuses?.[date]||{},(subject?.students||[]).map(student=>[student.id,student.name])]);
  function versions(data,prior={},known={}) {
    const result={};
    for(const [id,subject] of Object.entries(data.subjects||{}))for(const [date,meta] of Object.entries(subject.lectureMeta||{}))if(closed(meta)){
      const key=lectureKey(id,date);
      result[key]=known[key]&&lectureValue(subject,date)===lectureValue(prior.subjects?.[id],date)?known[key]:crypto.randomUUID();
    }
    return result;
  }
  const copy = value => HathirDeviceStore.clone(value);
  const active = () => Boolean(session?.deviceFirst && row?.uid === session.uid);
  const closed = meta => ['completed','cancelled','voided'].includes(meta?.status);
  const current = uid => active() && session.uid === uid && auth?.currentUser?.uid === uid;
  function availableLectureKey(subject,day,candidate) {
    if(!active()||!row.live||!liveEnabled())return candidate;
    const M=HathirSyncModel;
    const pendingDeletes=new Set((row.live.queue||[]).filter(op=>op.path[0]==='lecture'&&op.path[1]===subject.id&&op.value===null).map(op=>op.path[2]));
    const visited=new Set();
    while(pendingDeletes.has(candidate)||(()=>{const r=row.live.records?.[M.key(['lecture',subject.id,candidate])];return r?.value===null&&r.revision>0;})()){
      if(visited.has(candidate))throw Error('تعذر إنشاء معرّف مستقل للمحاضرة. أعد المحاولة.');
      visited.add(candidate);
      candidate=M.lectureId(subject.id,day,candidate);
    }
    return candidate;
  }
  function revive(data) {
    window.HathirSyncModel?.purgeRetiredCivil(data);
    window.HathirPrivateScopeRoster?.project(data);
    for (const subject of Object.values(data.subjects || {})) {
      subject.students ||= []; subject.attendance ||= {}; subject.lectureMeta ||= {}; subject.excuses ||= {}; subject.lectures ||= [];
      subject.rosterLoaded = subject.attendanceLoaded = subject.lectureIndexLoaded = subject.lectureIndexComplete = true;
      subject.historyPending = subject.historyError = subject.liveLoadPending = subject.liveLoadError = subject.cachedDisplayOnly = subject.offlineEpochPending = false;
      subject.loadedLectureDates = new Set(subject.lectures);
      subject.loadedSummaryStudentIds = new Set(subject.students.map(student=>student.id));
      subject.faceTemplateDescriptors = new Map(subject.students.map(student=>[student.id,getFaceDescriptors(student)]));
      subject.faceTemplatesLoaded = true;
      // Totals are derived from the complete local history, never old server counters.
      subject.summaryLoaded = false;
      delete subject._cachedPreview;
    }
    return data;
  }
  function retireSavedCivil(saved){
    const subjectIds=new Set(Object.entries(saved.data.subjects||{}).filter(([,s])=>s.departmentId==='civil_techniques').map(([id])=>id));
    const scopeIds=new Set(Object.entries(saved.data.scopeRosters||{}).filter(([,s])=>s.departmentId==='civil_techniques').map(([id])=>id));
    for(const r of Object.values(saved.live?.records||{})){if(r.path?.[0]==='subject'&&r.value?.departmentId==='civil_techniques')subjectIds.add(r.path[1]);if(r.path?.[0]==='scopeRoster'&&r.value?.departmentId==='civil_techniques')scopeIds.add(r.path[1]);}
    const retired=o=>o.value?.departmentId==='civil_techniques'||o.path?.[0]==='departments'&&o.path[1]==='civil_techniques'||o.path?.[0]==='stages'&&o.path[1].startsWith('civil_techniques_stage_')||['subject','student','lecture','mark','excuse'].includes(o.path?.[0])&&subjectIds.has(o.path[1])||['scopeRoster','scopeStudent'].includes(o.path?.[0])&&scopeIds.has(o.path[1]);
    let changed=window.HathirSyncModel?.purgeRetiredCivil(saved.data)||false;
    if(saved.live){for(const[k,r]of Object.entries(saved.live.records||{}))if(retired(r)){delete saved.live.records[k];changed=true;}for(const field of ['queue','conflicts'])if(saved.live[field]){const before=saved.live[field].length;saved.live[field]=saved.live[field].filter(o=>!retired(o));changed=changed||saved.live[field].length!==before;}}
    if(saved.legacyOperations){const before=saved.legacyOperations.length;saved.legacyOperations=saved.legacyOperations.filter(o=>!subjectIds.has(o.subjectId));changed=changed||saved.legacyOperations.length!==before;}
    if(changed&&saved.uploadTicket){saved.uploadTicket=null;saved.pendingClose=crypto.randomUUID();}
    return changed;
  }
  function install(saved, user, {show=true}={}) {
    if (!saved || saved.uid !== user.uid || saved.session?.uid !== user.uid || saved.data?.workspace?.id !== user.uid || auth?.currentUser?.uid !== user.uid) throw Error('Local account mismatch');
    saved=copy(saved);const retiredCivil=retireSavedCivil(saved);
    clearTimeout(retryTimer);retryTimer=0;liveCheckedAt=0;row = saved; localData = revive(copy(saved.data));
    const civilBranchesAdded=ensureCivilBranchDefaults(localData)||retiredCivil;
    if(liveEnabled())lastView=HathirSyncModel.flatten(saved.data);
    session = {...saved.session, uid:user.uid, workspaceId:user.uid, local:false, deviceFirst:true, offlineMode:false};
    membersCache = [session]; departments = Object.values(localData.departments || {}); stages = Object.values(localData.stages || {}); subjects = Object.values(localData.subjects || {});
    if (!subjects.some(subject=>subject.id===activeSubjectId)) activeSubjectId = subjects[0]?.id || '';
    compactScope = null;
    cloudLoadGeneration++; cloudDataLoading = sectionLoadPending = sectionLoadFailed = false;
    offlineQueueCount = 0; offlinePendingSubjectIds.clear();
    buildStudentCache(); if (show) showApp(); else renderAll();
    status();
    preparePublicAssets();
    window.HathirPersonal?.refreshOwnerAccess?.();
    if(civilBranchesAdded)save().catch(error=>{console.warn("Department defaults could not be saved.");});
  }
  function preparePublicAssets() {
    if(!active()||!navigator.onLine||location.protocol!=='https:')return;
    const needsFaces=subjects.some(subject=>(subject.students||[]).some(hasFaceDescriptor));
    ensureOfflineServiceWorker().then(()=>prepareOfflineAssets(needsFaces)).catch(()=>{
      // Public scanner resources can retry independently of saved private work.
      console.warn('Offline scanner resources are not fully cached yet.');
    });
  }
  function refreshLiveView(){
    const profileId=activeProfileStudentId,profileMode=studentProfileMode,input=els.profileStudentCodeInput;
    const draftCode=els.studentProfileModal&&!els.studentProfileModal.hidden&&input&&input.value!==(activeProfile().student?.id||'')?input.value:null;
    const restored=revive(copy(row.data));
    const civilBranchesAdded=ensureCivilBranchDefaults(restored);
    // Keep object identity used by scanner/profile mutation guards, and keep
    // the current session, scope and camera instead of reinstalling the app.
    for(const [id,value] of Object.entries(restored.subjects||{})){
      const existing=subjects.find(subject=>subject.id===id);if(!existing)continue;
      for(const key of Object.keys(existing))if(!Object.hasOwn(value,key))delete existing[key];
      Object.assign(existing,value);restored.subjects[id]=existing;
    }
    localData=restored;subjects=Object.values(restored.subjects||{});departments=Object.values(restored.departments||{});stages=Object.values(restored.stages||{});
    if(!subjects.some(subject=>subject.id===activeSubjectId))activeSubjectId=subjects[0]?.id||'';
    lastView=HathirSyncModel.flatten(row.data);buildStudentCache();renderAll();
    if(civilBranchesAdded)save().catch(()=>console.warn("Department defaults could not be saved."));
    if(draftCode!==null&&profileId===activeProfileStudentId&&profileMode===studentProfileMode&&!els.studentProfileModal.hidden)input.value=draftCode;
  }
  async function restoreLocal(user) {
    let saved = await HathirDeviceStore.get(user.uid);
    if (!saved) return false;
    if(!saved.lectureVersions){
      const tracked=versions(saved.data);
      saved=await HathirDeviceStore.save({...saved,lectureVersions:tracked,uploadedLectures:{},pendingClose:saved.pendingClose||(Object.keys(tracked).length?crypto.randomUUID():0)},saved.revision);
    }
    install(saved,user);if(liveEnabled())wakeLive();else{checkIncoming().catch(()=>{});scheduleUpload();}return true;
  }
  async function remote(action, data={}, uid=session?.uid || auth?.currentUser?.uid) {
    if (!uid || auth?.currentUser?.uid !== uid) throw Error('Account changed');
    await loadOptionalLibrary('functions');
    if (auth?.currentUser?.uid !== uid) throw Error('Account changed');
    return (await firebase.app().functions('us-central1').httpsCallable('closedLectureWorkspace',{timeout:120000})({workspaceId:uid,action,...data})).data;
  }
  async function restoreCloud(user,{replace=false}={}) {
    const expectedRevision=replace?row.revision:0;
    const head = await remote('head',{},user.uid);
    if (!head.revision) return false;
    let json = '';
    for (let index=0; index<head.count; index++) json += (await remote('read',{revision:head.revision,index},user.uid)).text;
    if (auth?.currentUser?.uid !== user.uid) throw Error('Account changed');
    const payload = JSON.parse(json);
    if (payload.uid !== user.uid || payload.schema !== 1 || payload.data?.workspace?.id !== user.uid) throw Error('Invalid cloud copy');
    const tracked=versions(payload.data);
    const saved = await HathirDeviceStore.save({uid:user.uid,session:copy(session),data:payload.data,lectureVersions:tracked,uploadedLectures:{...tracked},base:head.revision,pendingClose:0,legacyOperations:row?.uid===user.uid?row.legacyOperations:[]},expectedRevision,{recovery:replace});
    uploadConflict=false;uploadError='';receiveNotice='';install(saved,user);if(liveEnabled())wakeLive();return true;
  }
  async function readCopy(uid,revision,count=64) {
    let json='';
    for(let index=0;index<count;index++){
      json+=(await remote('read',{revision,index},uid)).text;
      let payload;try{payload=JSON.parse(json);}catch{continue;}
      if(payload.schema!==1||payload.uid!==uid||payload.data?.workspace?.id!==uid)throw Error('Invalid cloud copy');
      return payload.data;
    }
    throw Error('Incomplete cloud copy');
  }
  async function checkIncoming() {
    if(liveEnabled())return runLive();
    if(receiving)return receiving;
    if(!active()||!navigator.onLine||uploading)return;
    const uid=session.uid;
    receiving=(async()=>{
      const head=await remote('head',{},uid);
      if(!current(uid))return;
      if(!head.revision||head.revision===row.base){receiveNotice='';return;}
      const captured=row,revision=row.revision;
      // Older devices may have never received/uploaded a cloud baseline. Do
      // not guess whether their local differences represent edits or deletions.
      const review='توجد نسخة أحدث من جهاز آخر · راجع الإعدادات ← النسخ الاحتياطية لاستقبالها بأمان';
      if(!captured.base||captured.pendingClose||captured.uploadTicket){receiveNotice=review;return;}
      const baseline=await readCopy(uid,captured.base);
      if(stable(publication(captured.data))!==stable(publication(baseline))){receiveNotice=review;return;}
      const data=await readCopy(uid,head.revision,head.count);
      // Preserve current open lectures; never replace attendance being taken.
      for(const [id,subject] of Object.entries(captured.data.subjects||{})){
        for(const [date,meta] of Object.entries(subject.lectureMeta||{}))if(!closed(meta)){
          const target=data.subjects[id];
          if(!target||target.lectureMeta?.[date]||(subject.students||[]).some(student=>!target.students?.some(other=>other.id===student.id))){receiveNotice=review;return;}
          for(const field of ['lectureMeta','attendance','excuses']){target[field]||={};if(subject[field]?.[date]!==undefined)target[field][date]=copy(subject[field][date]);}
          target.lectures=[...new Set([...(target.lectures||[]),date])];
        }
      }
      data.users=copy(captured.data.users||{});
      const task=saving.catch(()=>{}).then(async()=>{
        if(!current(uid)||row.revision!==revision||uploading)return;
        const tracked=versions(data);
        const saved=await HathirDeviceStore.save({...row,data,base:head.revision,lectureVersions:tracked,uploadedLectures:{...tracked},pendingClose:0,uploadTicket:null},revision,{recovery:true});
        receiveNotice='';uploadError='';uploadConflict=false;install(saved,auth.currentUser,{show:false});
      });saving=task;await task;
    })().finally(()=>{receiving=null;if(current(uid)){status();scheduleUpload();}});
    return receiving;
  }
  async function prepare(user) {
    const captured = session;
    cloudDataLoading = true; renderAll();
    try {
      await runLimited(subjects,3,async subject => {
        if(subject.rosterOperationId||subject.attendanceClearInProgress)throw Error('توجد عملية سحابية جارية على المادة. انتظر اكتمالها قبل تجهيز النسخة المحلية.');
        await ensureSubjectRosterLoaded(subject);
        await ensureSubjectLectureIndexLoaded(subject,{all:true});
        await ensureSubjectAttendanceLoaded(subject);
        await ensureSubjectFaceTemplatesLoaded(subject);
      });
      if (session !== captured || auth?.currentUser?.uid !== user.uid) throw Error('Account changed');
      const legacyOperations = await HathirOfflineStore.operations(user.uid);
      // Keep original operations byte-for-byte in both the old store and the
      // migration record. Only the account's matching subjects get an overlay.
      for (const operation of [...legacyOperations].sort(offlineOperationOrder)) {
        const subject = subjects.find(item=>item.id===operation.subjectId);
        if (subject && !operation.error && operation.workspaceId===user.uid && (operation.rosterResetId||'')===(subject.lastRosterResetId||'') && Number(operation.preparedAt||0)>=Number(subject.attendanceClearedAtMillis||0)) applyPendingOfflineOperation(subject,operation);
      }
      const data = {workspace:{id:user.uid,ownerUid:user.uid},users:{[user.uid]:copy(captured)},departments:Object.fromEntries(departments.map(item=>[item.id,item])),stages:Object.fromEntries(stages.map(item=>[item.id,item])),subjects:Object.fromEntries(subjects.map(item=>[item.id,item]))};
      // Normalize historical inferred statuses before storing the first copy.
      for(const subject of subjects)for(const date of subject.lectures||[])lectureMeta(subject,date);
      const tracked=versions(data);
      const saved = await HathirDeviceStore.save({uid:user.uid,session:copy(captured),data:copy(data),lectureVersions:tracked,uploadedLectures:{},base:null,pendingClose:Object.keys(tracked).length?crypto.randomUUID():0,legacyOperations},0);
      install(saved,user);
      scheduleUpload();
      navigator.storage?.persist?.().catch(()=>{});
    } finally {cloudDataLoading=false; renderAll();}
  }
  function save({recovery=false}={}) {
    if (!active()) return Promise.reject(Error('No local workspace'));
    const uid=session.uid, captured=copy(localData), epoch=saveEpoch;
    liveCheckedAt=0;
    const changes=liveEnabled()?HathirSyncModel.diff(lastView||HathirSyncModel.flatten(row.data),HathirSyncModel.flatten(captured),()=>crypto.randomUUID()):null;
    if(liveEnabled())lastView=HathirSyncModel.flatten(captured);
    localSaves++;
    const task=saving.catch(()=>{}).then(async()=>{
      if (!current(uid)) throw Error('Account changed');
      if(epoch!==saveEpoch)throw Error('تعذر حفظ العملية السابقة. أعد تنفيذ التعديل بعد مراجعة السجل.');
      let data=captured,live=row.live;
      if(changes){
        const values=HathirSyncModel.flatten(row.data);for(const op of changes)values[HathirSyncModel.key(op.path)]=op.value;
        data=HathirSyncModel.materialize(values,captured);
        if(live?.initialized)live={...live,queue:[...live.queue,...changes]};
      }
      let newlyClosed=false;
      for(const subject of Object.values(data.subjects))for(const [date,meta] of Object.entries(subject.lectureMeta||{})) {
        if(closed(meta)&&!closed(row.data.subjects?.[subject.id]?.lectureMeta?.[date]))newlyClosed=true;
      }
      const removed=Object.values(row.data.subjects||{}).some(prior=>!data.subjects[prior.id]||
        (prior.students||[]).some(student=>!data.subjects[prior.id].students?.some(item=>item.id===student.id))||
        (prior.lectures||[]).some(date=>!data.subjects[prior.id].lectures?.includes(date)));
      const changedDuringUpload=row.uploadTicket&&JSON.stringify(publication(data))!==JSON.stringify(publication(row.data));
      const tracked=versions(data,row.data,row.lectureVersions||{});
      const changedClosed=stable(tracked)!==stable(row.lectureVersions||{});
      try {
        row=await HathirDeviceStore.save({...row,...(live?{live}:{}),data,lectureVersions:tracked,pendingClose:newlyClosed||changedDuringUpload||changedClosed?crypto.randomUUID():row.pendingClose},row.revision,{recovery:recovery||removed});
      } catch(error) {
        saveEpoch++;
        if(liveEnabled())lastView=HathirSyncModel.flatten(row.data);
        // Restore the last durable state; never report an unsaved edit as saved.
        if(current(uid)) {localData=revive(copy(row.data));subjects=Object.values(localData.subjects);departments=Object.values(localData.departments);stages=Object.values(localData.stages);buildStudentCache();renderAll();}
        throw error;
      }
      if(changes&&localSaves===1&&!HathirSyncModel.equal(HathirSyncModel.flatten(data),HathirSyncModel.flatten(captured)))refreshLiveView();
      status();if(liveEnabled())wakeLive();else if(row.pendingClose)scheduleUpload();
    }).finally(()=>{localSaves--;});
    saving=task; return task;
  }
  function publication(data) {
    const result=copy(data);
    // No active/draft attendance leaves the device, including other subjects.
    for(const subject of Object.values(result.subjects||{})) {
      const dates=new Set(Object.entries(subject.lectureMeta||{}).filter(([,meta])=>closed(meta)).map(([date])=>date));
      subject.lectures=(subject.lectures||[]).filter(date=>dates.has(date));
      for(const field of ['attendance','lectureMeta','excuses'])subject[field]=Object.fromEntries(Object.entries(subject[field]||{}).filter(([date])=>dates.has(date)));
      for(const field of ['_rosterBaseline','_rosterDocumentIds','faceTemplateDescriptors','loadedLectureDates','loadedSummaryStudentIds','attendanceSummaries'])delete subject[field];
      for(const field of Object.keys(subject))if(field.startsWith('_'))delete subject[field];
      delete subject.attendanceStatsDirty;
    }
    result.users={}; return result;
  }
  async function liveCall(action,args={},uid=session.uid){
    if(!current(uid))throw Error('Account changed');
    await loadOptionalLibrary('functions');if(!current(uid))throw Error('Account changed');
    return (await firebase.app().functions('us-central1').httpsCallable('deviceLiveSync',{timeout:120000})({workspaceId:uid,action,...args})).data;
  }
  function wakeLive(delay=700){
    if(!liveEnabled()||!active()||liveTimer||liveRunning||!navigator.onLine)return;
    liveTimer=setTimeout(()=>{liveTimer=0;runLive().catch(()=>{});},delay);
  }
  async function liveCommit(uid,change,{render=false,recovery=false}={}){
    const task=saving.catch(()=>{}).then(async()=>{
      if(!current(uid))throw Error('Account changed');
      const next=change(row);if(!next)return false;
      if(next.data!==row.data){const tracked=versions(next.data,row.data,row.lectureVersions||{});if(stable(tracked)!==stable(row.lectureVersions||{}))next.pendingClose=crypto.randomUUID();next.lectureVersions=tracked;}
      row=await HathirDeviceStore.save(next,row.revision,{recovery});
      if(render&&localSaves===0)refreshLiveView();
      status();return true;
    });saving=task;return task;
  }
  async function runLive(){
    if(liveRunning)return liveRunning;
    if(!liveEnabled()||!active()||!navigator.onLine)return;
    const uid=session.uid,M=HathirSyncModel;
    liveConfirmedChanges = 0;
    liveCheckedAt = 0;
    liveRunning=(async()=>{
      if(!row.live?.initialized){const prepared=await liveCall('bootstrap',{},uid);if(!prepared.ready){liveError='';liveFailures=0;return;}}
      if(!current(uid))return;
      if(!row.live?.initialized){
        // The original cloud baseline identifies local edits and deletions.
        // No baseline: preserve known deletion intent from recovery snapshots.
        let baseline=row.base?M.flatten(await readCopy(uid,row.base)):{};
        if(!row.base){const snapshots=await HathirDeviceStore.recoveries(uid);const now=M.flatten(row.data);for(const item of snapshots)for(const [k,value] of Object.entries(M.flatten(item.row.data)))if(!Object.hasOwn(now,k))baseline[k]=value;}
        const records={};let cursor=0,more=true;
        while(more){const batch=await liveCall('pull',{cursor},uid);for(const r of batch.records)records[M.key(r.path)]=r;cursor=batch.cursor;more=batch.more;}
        await liveCommit(uid,currentRow=>{
          if(currentRow.live?.initialized||localSaves)return null;
          // Only suppress newly generated, exact no-ops against the pulled
          // journal. Never prune a persisted queue, deletion intent or conflict.
          const queue=M.diff(baseline,M.flatten(currentRow.data),()=>crypto.randomUUID()).filter(op=>{
            const record=records[M.key(op.path)];
            return !record||!M.equal(record.value,op.value);
          });
          const data=M.materialize(M.overlay(records,queue),currentRow.data);
          return {...currentRow,data,live:{initialized:true,cursor,records,queue},legacyUploadTicket:currentRow.uploadTicket||currentRow.legacyUploadTicket||null,uploadTicket:null};
        },{render:true,recovery:true});
      }
      if(!current(uid)||!row.live?.initialized)return;
      // A bounded batch keeps the local save queue independent of network IO.
      for(let round=0;round<8;round++){
        const cursor=row.live.cursor,batch=await liveCall('pull',{cursor},uid);
        const applied=!batch.records.length?!localSaves:await liveCommit(uid,currentRow=>{
          if(localSaves)return null;
          const live=copy(currentRow.live);for(const record of batch.records){const k=M.key(record.path);if((live.records[k]?.seq||0)<record.seq)live.records[k]=record;}
          live.cursor=Math.max(live.cursor,batch.cursor);
          return {...currentRow,live,data:M.materialize(M.overlay(live.records,live.queue),currentRow.data)};
        },{render:batch.records.length>0});
        if(!applied)return;if(batch.more)continue;
        let operations=[];
        await liveCommit(uid,currentRow=>{
          const live=copy(currentRow.live),seen=new Set();
          for(const op of live.queue){const k=M.key(op.path);if(seen.has(k))continue;seen.add(k);if(op.conflict)continue;
            op.wire||={id:op.id,path:op.path,before:op.before,value:op.value,expected:live.records[k]?.revision||0};operations.push(op.wire);if(operations.length===20)break;}
          return operations.length?{...currentRow,live}:null;
        });
        if(!operations.length){
          // This pull reached the journal head and all local work is durable.
          // A push acknowledgement alone does not confirm incoming changes.
          if(!localSaves&&!row.live.queue.length)liveCheckedAt=Date.now();
          break;
        }
        const ack=await liveCall('push',{operations},uid);
        await liveCommit(uid,currentRow=>{
          const live=copy(currentRow.live);
          for(const result of ack.results){const op=live.queue.find(item=>item.id===result.id);if(!op)continue;
            const record=result.record||result.current,k=M.key(op.path);if(record&&(live.records[k]?.seq||0)<=record.seq)live.records[k]=record;
            if(result.status==='accepted'){live.queue=live.queue.filter(item=>item.id!==result.id);liveConfirmedChanges++;}else op.conflict={reason:result.reason,current:result.current};
          }
          return {...currentRow,live,data:M.materialize(M.overlay(live.records,live.queue),currentRow.data)};
        },{render:true});
      }
      liveError='';liveFailures=0;
      // The live journal is authoritative. This closed-lecture snapshot is a
      // separate recovery copy, never the transport used to merge devices.
      if(current(uid)&&row.pendingClose&&!row.live.queue.length&&!uploading){
        try{
          const head=await remote('head',{},uid);await liveCommit(uid,r=>({...r,base:head.revision}));
          upload({manual:true}).catch(async error=>{
            if(current(uid)&&error.code==='functions/aborted')await liveCommit(uid,r=>({...r,uploadTicket:null}),{recovery:true});
          }).catch(()=>{});
        }catch{/* Backup retries never block the live journal. */}
      }
    })().catch(error=>{if(current(uid)){liveError=String(error.message||error);liveFailures++;}throw error;})
      .finally(()=>{liveRunning=null;if(current(uid)){status();wakeLive(Math.min(60000,liveFailures?3000*2**Math.min(liveFailures,4):3000));}});
    status();
    return liveRunning;
  }
  async function resolveLive(id,choice){
    const uid=session.uid,M=HathirSyncModel;
    await liveCommit(uid,currentRow=>{
      const live=copy(currentRow.live),op=live.queue.find(item=>item.id===id);if(!op?.conflict)return null;
      const k=M.key(op.path),currentRecord=live.records[k];
      const related=live.queue.filter(item=>M.key(item.path)===k),last=related.at(-1);
      live.queue=live.queue.filter(item=>M.key(item.path)!==k);
      // Explicitly accepting a lecture tombstone also discards its pending
      // positive child edits; otherwise they remain impossible orphan conflicts.
      // Keep child deletions and unrelated lectures. The commit saves a recovery.
      if(choice==='cloud'&&op.path[0]==='lecture'&&currentRecord?.value===null){
        live.queue=live.queue.filter(item=>!(item.value!==null&&['mark','excuse'].includes(item.path[0])&&item.path[1]===op.path[1]&&item.path[2]===op.path[2]));
      }
      if(choice==='local'){
        if(op.conflict.reason==='attendance-excuse-conflict'){
          const peer=[op.path[0]==='mark'?'excuse':'mark',...op.path.slice(1)],peerKey=M.key(peer),record=live.records[peerKey];
          live.queue=live.queue.filter(item=>M.key(item.path)!==peerKey);
          if(record?.value)live.queue.push({id:crypto.randomUUID(),path:peer,before:record.value,value:null});
        }
        live.queue.push({id:crypto.randomUUID(),path:op.path,before:currentRecord?.value??null,value:last.value});
      }
      return {...currentRow,live,data:M.materialize(M.overlay(live.records,live.queue),currentRow.data)};
    },{render:true,recovery:true});wakeLive();
  }
  function scheduleUpload() {
    if(liveEnabled()){wakeLive();return;}
    if(retryTimer||uploading||receiving||uploadConflict||receiveNotice)return;
    if(active()&&row.pendingClose&&navigator.onLine)retryTimer=setTimeout(()=>{retryTimer=0;upload().catch(()=>{});},Math.max(1000,retryAfter-Date.now()));
  }
  async function upload({manual=false}={}) {
    if(uploading)return uploading;
    if(!manual&&(receiving||receiveNotice))return;
    if(!active())throw Error('لم تجهز النسخة المحلية لهذا الحساب بعد.');
    if(!navigator.onLine){if(!manual)return;uploadError='لا يوجد اتصال بالإنترنت. بياناتك محفوظة محليًا؛ أعد المحاولة بعد الاتصال.';status();throw Error(uploadError);}
    if(!manual&&uploadConflict)return;
    const uid=session.uid;
    uploading=(async()=>{
      // Failed saves have already rolled back to the last durable local row.
      // They must not permanently poison subsequent upload attempts.
      await saving.catch(()=>{});
      if(!current(uid)||(!row.pendingClose&&!manual))return;
      // An upload receipt is persisted before sending: retrying after a lost
      // acknowledgement uses the same immutable payload and base revision.
      let ticket;
      const reserve=saving.catch(()=>{}).then(async()=>{
        if(!current(uid))throw Error('Account changed');
        ticket=row.uploadTicket;
        if(!ticket){
          const json=JSON.stringify({schema:1,uid,data:publication(row.data)}),chunks=[];
          for(let index=0;index<json.length;){let end=Math.min(json.length,index+100000);if(end<json.length&&/[\uD800-\uDBFF]/.test(json[end-1]))end--;chunks.push(json.slice(index,end));index=end;}
          if(chunks.length>512)throw Error('حجم النسخة يتجاوز حد الرفع الحالي. نزّل نسخة محلية.');
          ticket={id:crypto.randomUUID(),base:row.base,pending:row.pendingClose,revision:row.revision,chunks,lectureVersions:{...row.lectureVersions}};
          row=await HathirDeviceStore.save({...row,uploadTicket:ticket},row.revision);
        }
        if(!ticket.lectureVersions){
          const ticketData=JSON.parse(ticket.chunks.join('')).data;
          ticket={...ticket,lectureVersions:versions(ticketData,row.data,row.lectureVersions)};
          row=await HathirDeviceStore.save({...row,uploadTicket:ticket},row.revision);
        }
      }); saving=reserve;await reserve;
      for(let index=0;index<ticket.chunks.length;index++) {
        if(!current(uid))throw Error('Account changed');
        uploadProgress=`جارٍ الرفع: الجزء ${index+1} من ${ticket.chunks.length}`;status();
        await remote('write',{revision:ticket.id,index,count:ticket.chunks.length,text:ticket.chunks[index]},uid);
        uploadPercent=Math.min(95,Math.round((index+1)/ticket.chunks.length*95));status();
      }
      uploadProgress='جارٍ تأكيد حفظ النسخة على الخادم…';status();
      const ack=await remote('commit',{revision:ticket.id,count:ticket.chunks.length,base:ticket.base,...(liveEnabled()?{protocol:2}:{})},uid);
      if(ack.revision!==ticket.id)throw Error('Invalid copy acknowledgement');
      // Serialize acknowledgement with edits. It changes metadata only and
      // must never replace local data edited while the upload was in flight.
      const task=saving.catch(()=>{}).then(async()=>{
        if(!current(uid))return;
        row=await HathirDeviceStore.save({...row,base:ack.revision,lastUploadedAt:Date.now(),uploadedLectures:{...ticket.lectureVersions},uploadTicket:null,pendingClose:row.pendingClose===ticket.pending?0:row.pendingClose},row.revision);
      }); saving=task; await task; uploadError='';
      failures=0;retryAfter=0;uploadConflict=false;
    })().catch(error=>{if(current(uid)){uploadConflict=error.code==='functions/aborted';uploadError=uploadConflict?'توجد نسخة أحدث على جهاز آخر. احتفظ بنسختك المحلية قبل اختيار النسخة المعتمدة.':String(error.message||error);}throw error;})
      .finally(()=>{uploading=null;uploadProgress='';uploadPercent=0;if(uploadError){failures++;retryAfter=Date.now()+Math.min(60000,5000*2**Math.min(failures-1,4));}status();if(current(uid)&&row.pendingClose)scheduleUpload();});
    status();return uploading;
  }
  function lectureState() {
    const subject=getSubject();
    if(!subject)return {state:'empty',message:'لا توجد محاضرة للرفع',percent:null};
    const visible=visibleRosterLectures(subject);
    let date=window.HathirBeginnerUI?.selectedLectureDate?.() || currentLectureKey(subject);
    if(!subject.lectureMeta?.[date]||(visible.length&&!visible.includes(date)))date=visible[0];
    if(!date||!subject.lectureMeta?.[date])return {state:'empty',message:'لا توجد محاضرات للرفع',percent:null};
    const key=lectureKey(subject.id,date),prefix=lectureColumnLabel(subject,date,visible)+' — ';
    const result=(state,message,percent=null)=>({state,message:prefix+message,percent,key,date});
    if(liveEnabled()){
      const queue=row.live?.queue||[],relevant=queue.filter(op=>op.path[1]===subject.id&&(!['lecture','mark','excuse'].includes(op.path[0])||op.path[2]===date));
      if(relevant.some(op=>op.conflict))return result('error','محفوظة محليًا · يوجد تعارض يحتاج مراجعة في الإعدادات');
      if(!navigator.onLine)return result('offline','محفوظة على الجهاز · بانتظار الإنترنت');
      if(liveError)return result('pending','محفوظة على الجهاز · تعذر إكمال المزامنة وسنعيد المحاولة');
      if(!row.live?.initialized||relevant.length)return result('uploading','محفوظة على الجهاز · جارٍ تبادل التغييرات');
      return result('synced','تم تبادل التغييرات · '+(closed(subject.lectureMeta[date])?'المحاضرة مغلقة':'المحاضرة جارية'),100);
    }
    if(!closed(subject.lectureMeta[date]))return result('waiting','محفوظة على الجهاز · بانتظار انتهاء المحاضرة');
    const version=row.lectureVersions?.[key];
    if(version&&row.uploadedLectures?.[key]===version)return result('synced','تمت مزامنة هذه المحاضرة',100);
    if(!navigator.onLine)return result('offline','محفوظة على الجهاز · بانتظار الإنترنت');
    if(uploading&&row.uploadTicket?.lectureVersions?.[key]===version)return result('uploading',uploadPercent>=95?'جارٍ تأكيد حفظ المحاضرة…':`جارٍ رفع المحاضرة… ${uploadPercent}%`,uploadPercent);
    if(uploadError)return result('error',uploadConflict?'توجد نسخة أحدث على جهاز آخر · راجع النسخ الاحتياطية':'تعذر الرفع مؤقتًا · سنعيد المحاولة تلقائيًا');
    return result('pending','محفوظة على الجهاز · بانتظار الرفع التلقائي');
  }
  function status() {
    if(!active())return;
    const queue = liveEnabled() ? row.live?.queue || [] : [];
    const pendingLectures = Object.keys(row.lectureVersions || {}).filter(key =>
      row.lectureVersions[key] !== row.uploadedLectures?.[key]).length;
    const pending = liveEnabled() ? queue.length : pendingLectures || (row.pendingClose || row.uploadTicket ? 1 : 0);
    window.HathirSyncReminder?.update({
      uid: row.uid, count: pending,
      busy: liveEnabled() ? !!liveRunning : !!uploading,
      error: receiveNotice || (liveEnabled() ? liveError || queue.some(op => op.conflict) : uploadError),
      ready: liveEnabled() ? !!row.live?.initialized&&!!liveCheckedAt : !!row.lastUploadedAt,
      lastCheckedAt: liveEnabled() ? liveCheckedAt : row.lastUploadedAt,
      unit: liveEnabled() ? 'changes' : 'lectures',
      percent: liveEnabled()
        ? Math.floor(liveConfirmedChanges / Math.max(1, liveConfirmedChanges + pending) * 100)
        : uploadPercent
    });
    const panel=document.getElementById('deviceCloudStatus'),button=document.getElementById('deviceCloudUpload');
    if(panel){
      panel.textContent=receiveNotice?'توجد نسخة أحدث من جهاز آخر. نزّل نسخة محلية أولًا إن كان هنا عمل تريد الاحتفاظ به، ثم اختر «جلب آخر نسخة مرفوعة».':uploading?(uploadProgress||'جارٍ تجهيز النسخة للرفع…'):uploadError?'تعذر الرفع: '+uploadError:row.pendingClose?'توجد محاضرة مغلقة بانتظار الرفع.':row.lastUploadedAt?'تم الرفع بنجاح. آخر تأكيد: '+new Date(row.lastUploadedAt).toLocaleString('ar-IQ'):'الرفع يشمل قوائم الطلبة والمواد والمحاضرات المغلقة. الحضور الجاري يبقى على جهازك.';
      panel.dataset.state=uploading?'busy':uploadError?'error':row.lastUploadedAt&&!row.pendingClose?'success':'ready';
      if(liveEnabled()){const pending=row.live?.queue||[];panel.textContent=pending.some(op=>op.conflict)?'توجد تعديلات متعارضة محفوظة على هذا الجهاز. راجعها أدناه.':liveError?'العمل محفوظ على الجهاز. تعذر إكمال المزامنة وسنعيد المحاولة تلقائيًا.':pending.length?'تغييرات محفوظة على الجهاز بانتظار تبادلها: '+pending.length:'المزامنة التلقائية تعمل أثناء فتح البرنامج. آخر نسخة احتياطية: '+(row.lastUploadedAt?new Date(row.lastUploadedAt).toLocaleString('ar-IQ'):'لم تُنشأ بعد');}
    }
    if(button){button.disabled=!!uploading;button.textContent=uploading?'جارٍ الرفع…':'رفع النسخة الآن';}
    const card=document.getElementById('attendanceRecordCard');
    if(card&&!document.getElementById('deviceRecordStatus')){const bar=document.createElement('div');bar.id='deviceRecordStatus';(document.getElementById('beginnerSyncStatus')||card).prepend(bar);}
    const view=receiveNotice?{state:'pending',message:receiveNotice,percent:null}:lectureState();
    document.querySelectorAll('[data-device-lecture]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.deviceLecture===view.date)));
    for(const label of [document.getElementById('offlineStatus'),document.getElementById('deviceRecordStatus')].filter(Boolean)){
    label.replaceChildren(document.createTextNode(view.message));label.dataset.deviceStatus='true';label.dataset.state=view.state;
    label.style.setProperty('--lecture-progress',`${view.percent||0}%`);
    label.title=uploadError||'الرفع تلقائي. اضغط تاريخ محاضرة في السجل لعرض حالتها. النسخ الاحتياطية في الإعدادات.';
    label.removeAttribute('tabindex');label.setAttribute('aria-label',view.message);label.setAttribute('aria-live','polite');label.setAttribute('role',view.state==='uploading'?'progressbar':'status');
    for(const name of ['aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext'])label.removeAttribute(name);
    if(view.state==='uploading'&&view.percent!==null){label.setAttribute('aria-valuemin','0');label.setAttribute('aria-valuemax','100');label.setAttribute('aria-valuenow',String(view.percent));}
    }
  }
  function exportCopy() {
    if(!active())return;
    download({...row,data:copy(localData)});
  }
  function download(value) {
    const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='Hathir-local-workspace.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }
  function details() {
    if(document.getElementById('deviceCloudDialog'))return;
    const dialog=document.createElement('dialog');dialog.id='deviceCloudDialog';dialog.dir='rtl';dialog.setAttribute('aria-labelledby','deviceCloudTitle');
    dialog.innerHTML='<header><div><h2 id="deviceCloudTitle">النسخ الاحتياطية</h2><p>الرفع تلقائي بعد غلق المحاضرة.</p></div><button type="button" class="deviceCloudClose" aria-label="إغلاق">×</button></header><section class="deviceCloudMain"><p id="deviceCloudStatus" role="status" aria-live="polite"></p></section><section class="deviceCloudAdvanced"><p>حفظ نسخة على جهازك أو استقبال آخر نسخة مرفوعة.</p><div class="deviceCloudOptions"></div><div class="deviceCloudRecovery"></div><p class="deviceCloudNote" role="status"></p></section>';
    dialog.querySelector('.deviceCloudClose').onclick=()=>dialog.close();
    const note=dialog.querySelector('.deviceCloudNote'),options=dialog.querySelector('.deviceCloudOptions'),recovery=dialog.querySelector('.deviceCloudRecovery');
    if(liveEnabled()){
      dialog.querySelector('header p').textContent='الحفظ محلي والمزامنة في الخلفية أثناء العمل. النسخة الاحتياطية بعد إغلاق المحاضرة.';
      const conflicts=(row.live?.queue||[]).filter(op=>op.conflict);
      if(conflicts.length){
        const heading=document.createElement('h3');heading.textContent='مراجعة التعديلات المتعارضة';recovery.append(heading);
        for(const op of conflicts){
          const block=document.createElement('section'),label=document.createElement('p'),local=document.createElement('p'),cloud=document.createElement('p');
          const subject=localData.subjects[op.path[1]],student=subject?.students?.find(s=>s.id===op.path.at(-1));
          const date=['lecture','mark','excuse'].includes(op.path[0])?op.path[2]:null;
          label.textContent=[subject?.titleAr||'سجل المادة',student?.name||'',date?(subject?lectureColumnLabel(subject,date):date.slice(0,10)):''].filter(Boolean).join(' · ');
          const preview=value=>{
            if(value===null)return 'محذوف';
            if(op.path[0]==='mark')return 'حاضر · الوقت: '+(value.time||'غير محدد');
            if(op.path[0]==='excuse')return 'معذور'+(value.reason?' · '+value.reason:'');
            if(op.path[0]==='lecture')return ({active:'جارية',draft:'لم تبدأ',completed:'مغلقة',cancelled:'ملغاة',voided:'ملغاة'}[value.status]||'محاضرة')+' · البداية: '+(value.startTime||'غير محددة')+' · المدة: '+(value.durationHours||'—')+' ساعة';
            return [value.name||value.titleAr||value.titleEn||'تعديل بيانات السجل',value.totalHours!==undefined?'الساعات: '+value.totalHours:'',value.lectureDurationHours!==undefined?'مدة المحاضرة: '+value.lectureDurationHours:''].filter(Boolean).join(' · ');
          };
          local.textContent='هذا الجهاز: '+preview(op.value);cloud.textContent='السحابة: '+preview(row.live.records[HathirSyncModel.key(op.path)]?.value??null);block.append(label,local,cloud);
          for(const [choice,title] of [['cloud','اعتماد السحابة'],['local','اعتماد تعديل هذا الجهاز']]){const button=document.createElement('button');button.className='btn ghost';button.textContent=title;button.disabled=choice==='local'&&['parent-deleted','deleted-record'].includes(op.conflict.reason);button.onclick=async()=>{button.disabled=true;try{await resolveLive(op.id,choice);dialog.close();details();}catch(error){note.textContent=error.message;button.disabled=false;}};block.append(button);}
          if(['parent-deleted','deleted-record'].includes(op.conflict.reason)){const hint=document.createElement('p');hint.textContent='السجل أو المادة حُذف على جهاز آخر. تعديلك محفوظ في النسخة المحلية؛ لا تتم إعادته تلقائيًا.';block.append(hint);}
          recovery.append(block);
        }
      }
    }
    const showError=error=>{note.textContent=error.message||String(error);};
    if(row.legacyOperations?.length)note.textContent='التسجيلات المعلقة القديمة محفوظة ضمن النسخة المحلية الكاملة.';
    for(const [label,action] of [['تنزيل نسخة محلية كاملة',exportCopy],['نسخ ما قبل الحذف',async()=>{
      const uid=session.uid,items=await HathirDeviceStore.recoveries(uid);if(!current(uid))return;
      if(!items.length){note.textContent='لا توجد نسخ قبل الحذف بعد.';return;}
      const list=document.createElement('select');list.setAttribute('aria-label','تاريخ النسخة المحلية');items.forEach((item,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=new Date(item.savedAt).toLocaleString();list.append(option);});
      const button=document.createElement('button');button.className='btn';button.textContent='تنزيل النسخة المختارة';button.onclick=()=>{if(current(uid))download(items[Number(list.value)].row);};recovery.replaceChildren(list,button);
    }],['جلب آخر نسخة مرفوعة',async()=>{
      if(liveEnabled()){await runLive();note.textContent='اكتمل فحص التغييرات. أي تعارض يبقى محفوظًا للمراجعة.';return;}
      if(!navigator.onLine)throw Error('اتصل بالإنترنت لجلب النسخة المرفوعة.');
      if(uploading)throw Error('انتظر اكتمال الرفع الجاري أولًا.');
      if(!confirm('ستحل النسخة المرفوعة محل العمل المحلي على هذا الجهاز. نزّل نسخة محلية أولًا للاحتفاظ بها. هل تريد المتابعة؟'))return;
      await saving.catch(()=>{});const user=auth.currentUser;if(!await restoreCloud(user,{replace:true}))note.textContent='لا توجد نسخة مرفوعة بعد.';else dialog.close();
    }]]) {const button=document.createElement('button');button.className='btn ghost';button.textContent=liveEnabled()&&label==='جلب آخر نسخة مرفوعة'?'فحص التغييرات الواردة':label;button.onclick=async()=>{try{await action();}catch(error){showError(error);}};options.append(button);}
    dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();status();
  }
  async function importNames(names,skipped=0) {
    if(!requireSingleSection())return [];
    const subject=getSubject();if(!canManageStudents(subject))throw Error(text('noPermission'));
    if(!names.length)throw Error(text('excelNoRows'));
    if(names.some(name=>! /\p{L}/u.test(String(name||''))))throw Error('يجب أن تحتوي قائمة الطلبة على أسماء، وليس أرقام التسلسل.');
    const rows=names.map(name=>String(name||'').trim()).filter(Boolean).map(name=>normalizeStudentRecord({id:'L'+crypto.randomUUID().replaceAll('-','').toUpperCase(),name}));
    if(rows.length>700)throw Error('الحد 700 اسم في الدفعة الواحدة.');
    const before=new Set((subject.students||[]).map(s=>s.id));
    const plan=HathirPrivateScopeRoster.distribute(localData,subject,rows);
    for(const [id,update] of Object.entries(plan.subjects)){const peer=localData.subjects[id];Object.assign(peer,update);}
    await save();
    const added=plan.students.filter(s=>!before.has(s.id));
    if(els.bulkStudents)els.bulkStudents.value='';subjects=Object.values(localData.subjects);buildStudentCache();renderAll();notify(text('importDone',{added:added.length,skipped}),'ok');return plan.accepted;
  }
  async function clearRoster(subject) {
    if(!canManageStudents(subject))return;
    // Keep other subjects' history and roster intact; this subject gets its own roster.
    subject.rosterCohortId='device_'+crypto.randomUUID().replaceAll('-','');
    subject.students=[];subject.attendance={};subject.lectureMeta={};subject.lectures=[];subject.excuses={};subject.archivedStudents=[];subject.academicStatuses={};
    localData.subjects[subject.id]=subject;await save({recovery:true});buildStudentCache();renderAll();
  }
  const originalLoad=loadCloudData;
  loadCloudData=async function(...args){if(active()){departments=Object.values(localData.departments);stages=Object.values(localData.stages);subjects=Object.values(localData.subjects);renderAll();return;}return originalLoad(...args);};
  const originalRestore=restoreOfflineSession;
  restoreOfflineSession=async user=>await restoreLocal(user)||await originalRestore(user);
  const originalSave=saveLocalData;
  saveLocalData=async()=>active()?save():originalSave();
  const originalStatus=offlineStatus;
  offlineStatus=async()=>active()?status():originalStatus();
  const originalDetails=showOfflineSyncDetails;
  showOfflineSyncDetails=async()=>active()?undefined:originalDetails();
  const originalSync=syncOfflineAttendance;
  syncOfflineAttendance=async()=>{if(active()){await checkIncoming().catch(()=>{});scheduleUpload();status();return;}return originalSync();};
  window.addEventListener('online',()=>checkIncoming().catch(()=>{}));
  window.addEventListener('focus',()=>checkIncoming().catch(()=>{}));
  window.addEventListener('online',scheduleUpload);
  window.addEventListener('online',preparePublicAssets);
  window.addEventListener('pageshow',scheduleUpload);
  window.addEventListener('offline',status);
  document.addEventListener('click',event=>{const button=event.target.closest('[data-device-lecture]');if(active()&&button)status();});
  const originalRoster=renderRoster;renderRoster=function(...args){const result=originalRoster(...args);if(active())status();return result;};
  const originalRender=renderAll;renderAll=function(...args){const result=originalRender(...args);if(active())status();return result;};
  window.HathirDeviceWorkspace=Object.freeze({active,restoreLocal,restoreCloud,prepare,save,upload,publication,importNames,clearRoster,status,details,exportCopy,lectureState,checkIncoming,runLive,resolveLive,availableLectureKey});
})();


