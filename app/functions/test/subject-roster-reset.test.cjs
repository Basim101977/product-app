const assert=require('assert/strict');
const records=new Map();let serial=0,failBackup=false,deletes=0;
const DEL=Symbol('delete');
class Ref{
 constructor(path,collection=false){this.path=path;this.id=path.split('/').pop();this.isCollection=collection;}
 collection(name){return new Ref(this.path+'/'+name,true)}doc(id='auto'+(++serial)){return new Ref(this.path+'/'+id)}
 orderBy(){return this}limit(n){const q=new Ref(this.path,true);q.limitCount=n;return q}
 async get(){if(this.isCollection){const docs=[...records].filter(([p])=>p.startsWith(this.path+'/')&&p.split('/').length===this.path.split('/').length+1).map(([p,v])=>({id:p.split('/').pop(),ref:new Ref(p),exists:true,data:()=>v})).slice(0,this.limitCount);return {docs,empty:docs.length===0,size:docs.length}}const v=records.get(this.path);return {exists:!!v,data:()=>v,id:this.id}}
 async set(v,o){if(failBackup&&this.path.includes('/records/'))throw Error('backup unavailable');let data=o?.merge?{...records.get(this.path),...v}:{...v};for(const k of Object.keys(data))if(data[k]===DEL)delete data[k];records.set(this.path,data)}
 async update(v){assert(records.has(this.path));return this.set(v,{merge:true})}
}
const db={collection:n=>new Ref(n,true),doc:p=>new Ref(p),batch:()=>{const jobs=[];return {set:(r,v,o)=>jobs.push(()=>r.set(v,o)),update:(r,v)=>jobs.push(()=>r.update(v)),delete:r=>jobs.push(()=>{deletes++;records.delete(r.path)}),commit:async()=>{for(const j of jobs)await j()}}},runTransaction:async fn=>{const jobs=[];const result=await fn({get:r=>r.get(),set:(r,v,o)=>jobs.push(()=>r.set(v,o)),update:(r,v)=>jobs.push(()=>r.update(v))});for(const j of jobs)await j();return result}};
const workspace=db.collection('attendanceWorkspaces').doc('owner');
const authorize=async r=>{if(r.auth?.uid!=='owner'||r.data.workspaceId!=='owner')throw Error('denied');return {workspaceRef:workspace}};
const api=require('../subject-roster-reset')({db,onCall:(_,fn)=>fn,HttpsError:class extends Error{},FieldValue:{delete:()=>DEL},Timestamp:{now:()=>({toMillis:()=>Date.now()})},authorisedWorkspaceOwner:authorize,authorisedSubject:async r=>{await authorize(r);return {workspaceId:'owner',subjectId:r.data.subjectId,subjectRef:workspace.collection('subjects').doc(r.data.subjectId)}},cohortIdForSubject:s=>s.rosterCohortId || 'shared'});
const request=(data)=>({auth:{uid:'owner'},data:{workspaceId:'owner',...data}});
async function seed(){records.clear();deletes=0;await workspace.collection('subjects').doc('a').set({id:'a',titleAr:'A',departmentId:'d',stageId:'s',lectures:['2026-09-01']});await workspace.collection('subjects').doc('b').set({id:'b',titleAr:'B',departmentId:'d',stageId:'s'});const cohort=workspace.collection('cohorts').doc('shared');await cohort.set({rosterVersion:1});await cohort.collection('students').doc('S1').set({id:'S1',name:'Student'});await cohort.collection('faceTemplates').doc('S1').set({studentId:'S1',faceDescriptor:[1,2,3]});await workspace.collection('subjects').doc('a').collection('lectures').doc('2026-09-01').set({status:'completed'});await db.doc(workspace.path+'/subjects/a/lectures/2026-09-01/marks/S1').set({studentId:'S1',time:'10:00'});}
(async()=>{
 await seed();await assert.rejects(()=>api.clearSubjectRoster({auth:{uid:'other'},data:{workspaceId:'owner'}}));
 await assert.rejects(()=>api.clearSubjectRoster(request({subjectId:'a'})));
 failBackup=true;await assert.rejects(()=>api.clearSubjectRoster(request({subjectId:'a',confirmation:'CLEAR_SUBJECT_ROSTER'})));assert.equal(deletes,0);assert(records.has(workspace.path+'/subjects/a/lectures/2026-09-01/marks/S1'));failBackup=false;
 await seed();const beforeB=JSON.stringify(records.get(workspace.path+'/subjects/b')),beforeShared=JSON.stringify(records.get(workspace.path+'/cohorts/shared/students/S1'));
 const r=await api.clearSubjectRoster(request({subjectId:'a',confirmation:'CLEAR_SUBJECT_ROSTER'}));
 assert.equal(r.studentCount,1);assert.equal(JSON.stringify(records.get(workspace.path+'/subjects/b')),beforeB);assert.equal(JSON.stringify(records.get(workspace.path+'/cohorts/shared/students/S1')),beforeShared);
 assert(!records.has(workspace.path+'/subjects/a/lectures/2026-09-01'));const a=records.get(workspace.path+'/subjects/a');assert(a.rosterCohortId.startsWith('private_'));assert.equal(a.studentCount,0);assert(!a.rosterOperationId);
 const newStudent=db.doc(workspace.path+'/cohorts/'+a.rosterCohortId+'/students/NEW');await newStudent.set({id:'NEW'});
 await assert.rejects(()=>api.restoreSubjectRoster(request({backupId:r.backupId,confirmation:'RESTORE_SUBJECT_ROSTER'})));records.delete(newStudent.path);
 await api.restoreSubjectRoster(request({backupId:r.backupId,confirmation:'RESTORE_SUBJECT_ROSTER'}));
 assert.equal(records.get(workspace.path+'/subjects/a/lectures/2026-09-01/marks/S1').time,'10:00');assert(records.has(workspace.path+'/cohorts/'+a.rosterCohortId+'/faceTemplates/S1'));assert(records.has(workspace.path+'/cohorts/'+a.rosterCohortId+'/students/S1'));
 await assert.rejects(()=>api.restoreSubjectRoster(request({backupId:r.backupId,confirmation:'RESTORE_SUBJECT_ROSTER'})));
 console.log('PASS scoped bulk clear/restore, untouched shared roster/other subject, protected newer records, auth/confirmation, zero deletions on backup failure (mock Firestore)');
})().catch(e=>{console.error(e);process.exitCode=1});
