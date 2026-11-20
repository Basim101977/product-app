(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.HathirPrivateScopeRoster=api;})(globalThis,()=>{
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const period=s=>s.studyPeriod==='evening'?'evening':'morning';
 const name=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ');
 // Restricted spelling equivalence; never fuzzy or partial-name matching.
 const matchName=s=>name(s).replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/\s+/g,' ').trim();
 function validateNames(list){const ids=new Set(),names=new Set();for(const row of list){const key=matchName(row.name);if(!row.id||!key||ids.has(row.id)||names.has(key))throw Error('توجد أسماء متطابقة بعد توحيد الكتابة أو معرّفات مكررة؛ راجع القائمة قبل الاستلام.');ids.add(row.id);names.add(key);}}
 const faces=s=>Array.isArray(s.faceDescriptors)&&s.faceDescriptors.length?s.faceDescriptors:Array.isArray(s.faceDescriptor)&&s.faceDescriptor.length?[s.faceDescriptor]:Object.values(s.faceDescriptorMap||{});
 const matches=(s,r)=>s.departmentId===r.departmentId&&s.stageId===r.stageId&&period(s)===period(r)&&!s.privateShareSource;
 function merge(existing,incoming,archived=[]){
  const result=clone(existing||[]),ids=new Map(),names=new Map(),retired=new Set(archived.map(s=>s.id));
  validateNames(result);validateNames(incoming);
  for(const s of result){ids.set(s.id,s);names.set(matchName(s.name),s);}
  for(const row of incoming){const byId=ids.get(row.id),byName=names.get(matchName(row.name)),current=byId||byName;
   if(byId&&matchName(byId.name)!==matchName(row.name)||byId&&byName&&byId!==byName)throw Error(`تعارض هوية الطالب «${row.name}»: المعرّف مرتبط باسم آخر. لم تُربط أي بصمة تلقائياً.`);
   if(retired.has(row.id)||archived.some(s=>matchName(s.name)===matchName(row.name)))throw Error(`الطالب «${row.name}» مؤرشف في إحدى المواد. راجع الأرشيف قبل الاستلام.`);
   if(current){if(!faces(current).length&&faces(row).length)current.faceDescriptors=clone(faces(row));}
   else{const s=clone(row);result.push(s);ids.set(s.id,s);names.set(matchName(s.name),s);}
  }
  if(result.length>700)throw Error('القائمة الناتجة تتجاوز 700 طالب.');return result;
 }
 function plan(data,payload,{id,departmentId,stageId,inviteId}){
  if(payload.choices.attendance)throw Error('سجل الحضور خاص بالمادة.');
  const prior=data.scopeRosters?.[id],record={id,departmentId,stageId,studyPeriod:period(payload.scope),students:[],receivedInvites:[...(prior?.receivedInvites||[])]};
  const targets=Object.values(data.subjects||{}).filter(s=>matches(s,record));
  let rows=merge(prior?.students||[],[]);
  // Validate all identities before producing any mutation; never rewrite marks or IDs.
  for(const s of targets)rows=merge(rows,s.students||[]);
  rows=merge(rows,payload.students);
  const updates={};for(const s of targets)updates[s.id]={...s,students:merge(s.students||[],rows,s.archivedStudents||[])};
  record.students=rows;
  // A received list becomes the same private face source as local enrollment.
  for(const row of record.students){
    const saved=prior?.students?.find(x=>x.id===row.id&&name(x.name)===name(row.name)&&x.sharedFaces===true);
    if(saved){row.sharedFaces=true;row.faceDescriptors=clone(faces(saved));}
    else {const descriptors=uniqueFaces([...targets.flatMap(s=>s.students||[]).filter(x=>x.id===row.id),row,...payload.students.filter(x=>x.id===row.id)]);if(descriptors.length){row.faceDescriptors=descriptors;row.sharedFaces=true;}}
  }
  for(const s of Object.values(updates))for(const row of s.students){const source=record.students.find(x=>matchName(x.name)===matchName(row.name));if(source?.sharedFaces&&(source.id===row.id||!faces(row).length))applyFaces(row,faces(source));}
 if(!record.receivedInvites.includes(inviteId))record.receivedInvites.push(inviteId);
  return {record,subjects:updates};
 }
 function seed(subject,data){
  if(isIndependent(subject))return subject;
  let students=merge(subject.students||[],[]);
  const sources=[...Object.values(data.subjects||{}).filter(s=>s.id!==subject.id&&!isIndependent(s)&&matches(s,subject)),...Object.values(data.scopeRosters||{}).filter(r=>matches(subject,r)&&!r.faceRegistryOnly)];
  for(const source of sources)students=merge(students,available(subject,source.students||[]));
  for(const record of Object.values(data.scopeRosters||{}).filter(r=>matches(subject,r)))for(const row of students){const canonical=(record.students||[]).find(s=>s.sharedFaces&&s.id===row.id&&matchName(s.name)===matchName(row.name));if(canonical&&JSON.stringify(validFaces(row))!==JSON.stringify(validFaces(canonical)))applyFaces(row,validFaces(canonical));}
  return {...subject,students};
 }
 function isIndependent(s){return !!s.privateShareSource||/^device_/.test(s.rosterCohortId||'')||!!s.lastRosterResetId;}
 function available(subject,students){return students.filter(row=>!(subject.archivedStudents||[]).some(old=>old.id===row.id||matchName(old.name)===matchName(row.name))).map(row=>{const value=clone(row);delete value.sharedFaces;return value;});}
 // Build every result before writing. Retain each course's own IDs and history.
 function distribute(data,subject,incoming=[]){
  const peers=isIndependent(subject)?[subject]:Object.values(data.subjects||{}).filter(s=>!isIndependent(s)&&matches(s,subject));
  if(!peers.some(s=>s.id===subject.id))peers.push(subject);
  let roster=seed(subject,data).students||[];
  roster=merge(roster,incoming,subject.archivedStudents||[]);
  const updates={};for(const peer of peers)updates[peer.id]={...peer,students:merge(peer.students||[],available(peer,roster)),rosterLoaded:true};
  return {subjects:updates,students:updates[subject.id].students,accepted:incoming.map(row=>updates[subject.id].students.find(s=>matchName(s.name)===matchName(row.name)))};
 }
 function applyFaces(row,descriptors){row.faceDescriptors=clone(descriptors);row.faceDescriptor=descriptors.length?clone(descriptors[descriptors.length-1]):null;row.faceDescriptorMap=Object.fromEntries(descriptors.map((d,i)=>['template_'+String(i+1).padStart(2,'0'),clone(d)]));}
 const scopeKey=s=>JSON.stringify([s.departmentId,s.stageId,period(s)]);
 function groups(data){const result=new Map();for(const s of Object.values(data.subjects||{})){if(s.privateShareSource||!s.departmentId||!s.stageId)continue;const key=scopeKey(s);if(!result.has(key))result.set(key,[]);result.get(key).push(s);}return result;}
 function validFaces(row){return faces(row).filter(d=>Array.isArray(d)&&d.length===128&&d.every(n=>typeof n==='number'&&Number.isFinite(n)));}
 function uniqueFaces(rows){const result=[],seen=new Set();for(const row of rows)for(const d of validFaces(row)){const k=JSON.stringify(d);if(!seen.has(k)){seen.add(k);result.push(d);if(result.length===5)return result;}}return result.slice(0,5);}
 // Project templates only onto students already present. Never recreate a roster
 // or a deleted student, and never match a biometric by name alone.
 function project(data){
  for(const [key,subjects] of groups(data)){
    const registries=Object.values(data.scopeRosters||{}).filter(r=>scopeKey(r)===key);
    const owners=new Map();for(const s of subjects)for(const row of s.students||[]){if(!owners.has(row))owners.set(row,[]);owners.get(row).push(s);}
    const all=[...owners.keys(),...registries.flatMap(r=>r.students||[])];
    const byId=new Map(),byName=new Map();for(const row of all){if(!byId.has(row.id))byId.set(row.id,[]);byId.get(row.id).push(row);if(!byName.has(name(row.name)))byName.set(name(row.name),new Set());byName.get(name(row.name)).add(row.id);}
    for(const [id,rows] of byId){if(new Set(rows.map(r=>name(r.name))).size!==1||byName.get(name(rows[0].name)).size!==1)continue;
      const canonical=rows.filter(r=>!owners.has(r)&&r.sharedFaces===true);
      // Multiple disagreeing canonical records require review, not selection by order.
      if(canonical.length>1&&new Set(canonical.map(r=>JSON.stringify(validFaces(r)))).size>1)continue;
      const descriptors=canonical.length?validFaces(canonical[0]):uniqueFaces(rows);
      if(!canonical.length&&!descriptors.length)continue;
      // Runtime projection shares read-only vectors; persistence/enrollment clone
      // their values. Do not clone thousands of vectors on every cache refresh.
      const projected={faceDescriptors:descriptors,faceDescriptor:descriptors.at(-1)||null,faceDescriptorMap:Object.fromEntries(descriptors.map((d,i)=>['template_'+String(i+1).padStart(2,'0'),d]))};
      for(const row of rows){const rowOwners=owners.get(row);if(!rowOwners)continue;Object.assign(row,projected);for(const owner of rowOwners)if(owner.faceTemplateDescriptors instanceof Map)owner.faceTemplateDescriptors.set(id,descriptors);}
    }
    // Scanner group views track map identity, not only its size.
    for(const s of subjects)if(s.faceTemplateDescriptors instanceof Map)s.faceTemplateDescriptors=new Map(s.faceTemplateDescriptors);
  }
  return data;
 }
 function enroll(data,subject,student,descriptors,id){
   if(subject.privateShareSource)throw Error('هذه نسخة حضور مستقلة.');
   const peers=Object.values(data.subjects||{}).filter(s=>matches(s,subject));
   const registries=Object.values(data.scopeRosters||{}).filter(r=>scopeKey(r)===scopeKey(subject));
   if(registries.length>1)throw Error('توجد قوائم نطاق مكررة؛ يلزم مراجعتها قبل ربط البصمة.');
   for(const row of [...peers.flatMap(s=>s.students||[]),...registries.flatMap(r=>r.students||[])])if((row.id===student.id&&name(row.name)!==name(student.name))||(name(row.name)===name(student.name)&&row.id!==student.id))throw Error('تعارض هوية الطالب بين المواد؛ لم يتم ربط البصمة.');
   const record=clone(registries[0]||{id,departmentId:subject.departmentId,stageId:subject.stageId,studyPeriod:period(subject),faceRegistryOnly:true,students:[],receivedInvites:[]});
   const existing=record.students.find(r=>r.id===student.id);const row=existing||{id:student.id,name:student.name};applyFaces(row,descriptors);row.sharedFaces=true;if(!existing)record.students.push(row);
   const updates={};for(const peer of peers)updates[peer.id]={...peer,students:(peer.students||[]).map(r=>{const result=clone(r);if(r.id===student.id)applyFaces(result,descriptors);return result;})};
   return {record,subjects:updates};
 }
 return {plan,seed,merge,matches,project,enroll,distribute};
});
