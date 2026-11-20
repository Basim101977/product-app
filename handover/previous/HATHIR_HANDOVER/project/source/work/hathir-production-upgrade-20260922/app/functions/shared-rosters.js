'use strict';
const {createHash}=require('crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
const clean=s=>typeof s==='string'?s.normalize('NFKC').trim().replace(/\s+/gu,' '):'';
const key=s=>clean(s).replace(/\u0640/gu,'').replace(/\p{M}/gu,m=>/\p{Script_Extensions=Arabic}/u.test(m)?'':m).replace(/[أإآٱ]/gu,'ا').replace(/ة/gu,'ه').replace(/ /g,'').toLowerCase();
const stored=s=>clean(s).replace(/\s+/gu,'').toUpperCase();
const valid=s=>s.length>=3&&s.length<=150&&/^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*(?: (?:[2-9]|[1-9][0-9]+))?$/u.test(s);
// Names-only publication; no public client writes and no access to another private workspace.
module.exports=function({db,fail,stamp,activeMember,ownerIdentity,cohortIdForSubject,departmentIds}){
 return async function sharedStudentRoster(request){
  const {action,workspaceId,subjectId,revision,token}=request.data||{};
  if(!['check','preview','apply','previewPublish','publish'].includes(action)||typeof subjectId!=='string'||!/^[\w-]{1,120}$/.test(subjectId))fail('invalid-argument','طلب قائمة غير صالح.');
  await activeMember(request,workspaceId);
  if(action==='publish'||action==='previewPublish')await ownerIdentity(request);
  const workspace=db.collection('attendanceWorkspaces').doc(workspaceId),ref=workspace.collection('subjects').doc(subjectId);
  return db.runTransaction(async tx=>{
   const snap=await tx.get(ref);if(!snap.exists)fail('not-found','المادة غير موجودة.');
   const subject=snap.data();
   if(subject.rosterOperationId||subject.attendanceClearInProgress)fail('failed-precondition','انتظر اكتمال العملية الجارية على القائمة.');
   if(!/^[\w-]{1,120}$/.test(subject.departmentId||'')||!/^[\w-]{1,120}$/.test(subject.stageId||''))fail('failed-precondition','اختر القسم والمرحلة أولاً.');
   const [dept,stage]=await Promise.all([tx.get(workspace.collection('departments').doc(subject.departmentId)),tx.get(workspace.collection('stages').doc(subject.stageId))]);
   const d=dept.data(),g=stage.data();
   if(!d||!g||g.departmentId!==subject.departmentId||!Number.isInteger(Number(g.sort))||Number(g.sort)<1||Number(g.sort)>6)fail('failed-precondition','القسم والمرحلة غير مكتملين.');
   const departmentKey=departmentIds.includes(subject.departmentId)?subject.departmentId:'custom_'+hash(key(d.nameAr||d.nameEn||'')).slice(0,32);
   if(!departmentIds.includes(subject.departmentId)&&!clean(d.nameAr||d.nameEn))fail('failed-precondition','أدخل اسم القسم.');
   const scopeId=hash(departmentKey+':'+Number(g.sort));
   const sharedRef=db.collection('attendanceSharedRosters').doc(scopeId),sharedSnap=await tx.get(sharedRef),shared=sharedSnap.data();
   const scope={department:clean(d.nameAr||d.nameEn)||subject.departmentId,stage:clean(g.nameAr||g.nameEn)||String(g.sort)};
   const cohort=workspace.collection('cohorts').doc(cohortIdForSubject(subject));
   // Cheap check reads metadata only; no roster download on startup.
   if(action==='check'){
    const ids=[subject.sharedRosterSubscriptionId,hash(scopeId+':'+cohort.path),hash(scopeId+':'+ref.path)].filter(Boolean);
    const states=await Promise.all(ids.map(id=>tx.get(workspace.collection('sharedRosterSubscriptions').doc(id))));
    const accepted=Math.max(0,...states.filter(s=>s.data()?.scopeId===scopeId).map(s=>Number(s.data().revision||0)));
    return {scope,available:!!shared,revision:shared?.revision||0,count:shared?.count||0,accepted,updateAvailable:!!shared&&shared.revision>accepted};
   }
   const [meta,central,local]=await Promise.all([tx.get(cohort),tx.get(cohort.collection('students')),tx.get(ref.collection('students'))]);
   if(meta.data()?.rosterOperationId)fail('failed-precondition','انتظر اكتمال تحديث قائمة الطلبة.');
   const centralSource=!!(subject.rosterCohortId||Number(meta.data()?.rosterVersion)>=1||central.docs.length||subject.lastRosterResetId);
   const embedded=!centralSource&&!local.docs.length&&Array.isArray(subject.students)&&subject.students.length>0;
   const source=centralSource||(!local.docs.length&&!embedded)?cohort:ref;
   const rows=source===cohort?central.docs.map(x=>({...x.data(),_doc:x.id})):embedded?subject.students.map((x,i)=>({...x,_index:i})):local.docs.map(x=>({...x.data(),_doc:x.id}));
   if(action==='previewPublish'||action==='publish'){
    if(rows.length>300||!rows.length)fail('failed-precondition','اختر قائمة تحتوي من 1 إلى 300 طالب للنشر.');
    const entries=rows.map(x=>({id:hash(String(x.id||x._doc)),name:clean(x.name)})).sort((a,b)=>a.id.localeCompare(b.id));
    if(new Set(entries.map(x=>x.id)).size!==entries.length||entries.some(x=>!valid(x.name))||new Set(entries.map(x=>key(x.name))).size!==entries.length)fail('failed-precondition','راجع الأسماء المكررة أو غير المكتملة قبل المشاركة.');
    const digest=hash(JSON.stringify({scopeId,entries})),current=shared?.revision||0;
    const result={scope,revision:current,token:digest,count:entries.length,names:entries.map(x=>x.name)};
    if(action==='previewPublish')return result;
    if(revision!==current||token!==digest)fail('failed-precondition','تغيرت القائمة. افتح المعاينة مجدداً قبل النشر.');
    if(shared?.digest===digest)return {...result,published:true,unchanged:true};
    tx.set(sharedRef,{scopeId,departmentKey,stageNumber:Number(g.sort),scope,entries,count:entries.length,revision:current+1,digest,publishedAt:stamp()});
    return {...result,revision:current+1,published:true};
   }
   if(!shared)fail('not-found','لا توجد قائمة منشورة لهذا القسم والمرحلة.');
   if(action==='apply'&&revision!==shared.revision)fail('failed-precondition','نُشر تحديث أحدث. راجع القائمة من جديد.');
   const stateId=hash(scopeId+':'+source.path),stateRef=workspace.collection('sharedRosterSubscriptions').doc(stateId);
   const [stateSnap,registry]=await Promise.all([tx.get(stateRef),tx.get(source.collection('nameReservations').doc('allocated'))]);
   let previous=stateSnap.data();
   if(!previous&&subject.sharedRosterSubscriptionId&&subject.sharedRosterSubscriptionId!==stateId){
    const prior=await tx.get(workspace.collection('sharedRosterSubscriptions').doc(subject.sharedRosterSubscriptionId));
    if(prior.data()?.scopeId===scopeId)previous=prior.data();
   }
   const links={...(previous?.links||{})},byId=new Map(rows.map(x=>[String(x.id||x._doc),x])),byName=new Map();
   rows.forEach(x=>{const k=key(x.name);byName.set(k,byName.has(k)?null:x);});
   const reserved=new Set(registry.data()?.names||[]);
   [...rows,...(subject.archivedStudents||[])].forEach(x=>{if(x.id)reserved.add(stored(x.id));});
   const occupied=new Set([...rows,...(subject.archivedStudents||[])].map(x=>key(x.name)));
   const changes=[],adds=[],updates=[];
   for(const entry of shared.entries){
    const link=links[entry.id];let row=link?byId.get(link.localId):byName.get(key(entry.name));
    if(link&&!row){changes.push({kind:'deletedLocally',name:entry.name});continue;}
    if(row){
     const id=String(row.id||row._doc);
     if(link&&row.name!==link.name){changes.push({kind:'editedLocally',name:row.name,publishedName:entry.name});continue;}
     if(link&&row.name!==entry.name){
      if(occupied.has(key(entry.name))&&key(row.name)!==key(entry.name)){changes.push({kind:'conflict',name:entry.name});continue;}
      updates.push({row,name:entry.name});occupied.add(key(entry.name));changes.push({kind:'rename',name:entry.name,oldName:row.name});
     }else changes.push({kind:'existing',name:row.name});
     links[entry.id]={localId:id,name:entry.name};continue;
    }
    let name=entry.name,n=2;const base=name.replace(/ (?:[2-9]|[1-9][0-9]+)$/u,'');
    while(occupied.has(key(name))||reserved.has(stored(name)))name=base+' '+n++;
    if(!valid(name))fail('failed-precondition','تعذر تمييز اسم طالب. راجع الأسماء.');
    const student={id:stored(name),name};reserved.add(student.id);occupied.add(key(name));adds.push(student);links[entry.id]={localId:student.id,name};changes.push({kind:'add',name});
   }
   const publishedIds=new Set(shared.entries.map(x=>x.id));
   for(const [id,link]of Object.entries(links))if(!publishedIds.has(id)&&byId.has(link.localId))changes.push({kind:'removedFromPublication',name:byId.get(link.localId).name});
   const digest=hash(JSON.stringify({scopeId,revision:shared.revision,rows,links,changes,registry:registry.data()||null,reset:subject.lastRosterResetId||null}));
   const result={scope,revision:shared.revision,token:digest,changes,added:adds.length,renamed:updates.length,count:shared.count};
   if(action==='preview')return result;
   if(token!==digest)fail('failed-precondition','تغيرت قائمتك منذ المعاينة. راجع التحديث مجدداً.');
   if(Buffer.byteLength(JSON.stringify(links))>650000||Buffer.byteLength(JSON.stringify([...reserved]))>750000)fail('resource-exhausted','بلغت القائمة حد السعة.');
   // Only names are copied. Existing status, face templates and attendance are untouched.
   if(embedded){
    const students=rows.map(({_index,...x})=>({...x}));updates.forEach(x=>{students[x.row._index].name=x.name;});
    tx.update(ref,{students:[...students,...adds],studentCount:rows.length+adds.length,sharedRosterSubscriptionId:stateId,updatedAt:stamp()});
   }else{
    for(const x of adds)tx.create(source.collection('students').doc(x.id),{...x,createdAt:stamp(),createdBy:request.auth.uid,updatedAt:stamp()});
    for(const x of updates)tx.update(source.collection('students').doc(x.row._doc),{name:x.name,updatedAt:stamp()});
    tx.update(ref,{studentCount:rows.length+adds.length,sharedRosterSubscriptionId:stateId,updatedAt:stamp()});
    if(source===cohort)tx.set(cohort,{rosterVersion:1,studentCount:rows.length+adds.length,updatedAt:stamp()},{merge:true});
   }
   tx.set(source.collection('nameReservations').doc('allocated'),{names:[...reserved],updatedAt:stamp()});
   tx.set(stateRef,{scopeId,revision:shared.revision,links,updatedAt:stamp()});
   return {...result,applied:true};
  });
 };
};
