'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {countOwnerLectures,countSubjects}=require('../owner-lecture-count');
const {createPersonalService,OWNER_UID,OWNER_EMAIL}=require('../personal-workspace');
class HttpsError extends Error{constructor(code,msg){super(msg);this.code=code;}}
function memory(seed){const values=new Map(Object.entries(seed)),reads=[];
 const snap=p=>({id:p.split('/').at(-1),ref:doc(p),exists:values.has(p),data:()=>structuredClone(values.get(p))});
 const doc=p=>({path:p,id:p.split('/').at(-1),get:async()=>{reads.push(p);return snap(p);},collection:n=>col(p+'/'+n)});
 const col=(p,limit=Infinity,after='',fields=null)=>({doc:id=>doc(p+'/'+id),orderBy(){return this;},limit:n=>col(p,n,after,fields),startAfter:d=>col(p,limit,d.id,fields),select:(...f)=>col(p,limit,after,f),get:async()=>{reads.push(p+(fields?' projection':''));let docs=[...values.keys()].filter(k=>k.startsWith(p+'/')&&k.split('/').length===p.split('/').length+1).map(snap);if(after)docs=docs.slice(docs.findIndex(d=>d.id===after)+1);docs=docs.slice(0,limit);if(fields)docs=docs.map(d=>({...d,data:()=>Object.fromEntries(fields.map(f=>[f,d.data()[f]]))}));return {docs,empty:!docs.length};}});
 return {values,reads,collection:col,getAll:async(...refs)=>Promise.all(refs.map(r=>r.get()))};
}
test('Cloud lecture count uses live source, excludes tombstones/orphans/cancelled, never downloads faces',async()=>{
 const prefix='attendanceDeviceSync/t',record=(path,value)=>({path,valueJson:JSON.stringify(value)});
 const db=memory({[prefix]:{ready:true,seq:12},[prefix+'/records/s']:record(['subject','s'],{}),[prefix+'/records/deleted-subject']:record(['subject','gone'],null),[prefix+'/records/l1']:record(['lecture','s','d1'],{status:'active'}),[prefix+'/records/l2']:record(['lecture','s','d2'],{status:'completed'}),[prefix+'/records/l3']:record(['lecture','s','d3'],{status:'cancelled'}),[prefix+'/records/l4']:record(['lecture','s','d4'],null),[prefix+'/records/l5']:record(['lecture','gone','d1'],{status:'completed'}),[prefix+'/records/student']:record(['student','s','a'],{faceDescriptors:[[1]]}),'attendanceDeviceCopies/t':{revision:'older'}});
 assert.equal((await countOwnerLectures(db,'t')).lectureCount,2);assert(!db.reads.includes(prefix+'/records/student'));assert(!db.reads.includes('attendanceDeviceCopies/t'));
});
test('Count covers all subjects, date collisions remain separate lectures and duplicate dates are counted once',()=>{
 assert.equal(countSubjects({a:{lectures:['d','d','c'],lectureMeta:{d:{status:'completed'},c:{status:'cancelled'}}},b:{lectures:['d'],lectureMeta:{d:{status:'active'}}},c:{deleted:true,lectures:['d']}}),2);
});
test('Legacy cloud totals union embedded and subcollection lectures without double counting',async()=>{
 const p='attendanceWorkspaces/t/subjects/s';const db=memory({[p]:{lectures:['a','b'],lectureMeta:{a:{status:'completed'},b:{status:'completed'}}},[p+'/lectures/a']:{status:'completed'},[p+'/lectures/b']:{status:'voided'},[p+'/lectures/c']:{status:'active'}});assert.equal((await countOwnerLectures(db,'t')).lectureCount,2);
});
test('Committed copy count never adds legacy duplicates; incomplete copy fails rather than displaying zero',async()=>{
 const p='attendanceDeviceCopies/t',payload={uid:'t',data:{workspace:{id:'t'},subjects:{s:{lectures:['d'],lectureMeta:{d:{status:'completed'}}}}}};
 const db=memory({[p]:{revision:'revision',count:1},[p+'/versions/revision']:{committed:true},[p+'/versions/revision/chunks/0']:{text:JSON.stringify(payload)}});assert.equal((await countOwnerLectures(db,'t')).lectureCount,1);db.values.delete(p+'/versions/revision/chunks/0');await assert.rejects(()=>countOwnerLectures(db,'t'));
});
test('Owner search scans beyond 500 requests, normalizes Arabic, paginates results and protects teacher stats',async()=>{
 const entries={};for(let i=0;i<610;i++)entries['attendanceIndividualRequests/u'+i]={fullName:i===605?'أحمد  فاطمة':'مدرس '+i,email:'t'+i+'@example.test',status:'approved'};
 const db=memory(entries);let authReads=0;const auth={getUser:async uid=>{authReads++;return {uid,email:uid===OWNER_UID?OWNER_EMAIL:'x@example.test',emailVerified:true};}};
 const service=createPersonalService({db,auth,HttpsError,FieldValue:{serverTimestamp:()=>0}}),request=data=>({auth:{uid:OWNER_UID,token:{email:OWNER_EMAIL,email_verified:true}},data});
 const result=await service.listPersonalRegistrations(request({search:'احمد فاطمه'}));assert.equal(result.requests.length,1);assert.equal(result.requests[0].uid,'u605');assert(authReads<10);
 const email=await service.listPersonalRegistrations(request({search:'t609@example.test'}));assert.equal(email.requests[0].uid,'u609');
 const first=await service.listPersonalRegistrations(request({search:'مدرس'}));assert.equal(first.requests.length,100);assert(first.nextCursor);const next=await service.listPersonalRegistrations(request({search:'مدرس',cursor:first.nextCursor}));assert.equal(next.requests.length,100);assert(!next.requests.some(r=>first.requests.some(f=>f.uid===r.uid)));
 await assert.rejects(()=>service.listPersonalRegistrations({auth:{uid:'u1',token:{email:'x@example.test',email_verified:true}},data:{lectureUid:'u605'}}),e=>e.code==='permission-denied');
});
