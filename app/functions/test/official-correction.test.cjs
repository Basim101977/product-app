const test = require('node:test'), assert = require('node:assert/strict');
const factory = require('../official-correction');
function harness() {
  const rows = new Map(), root = 'attendanceWorkspaces/qa/subjects/s', lecture = root + '/lectures/2026-09-23';
  const ref = path => ({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})});
  const snap = path => ({exists:rows.has(path),data:()=>rows.get(path)});
  let onCommit;
  const db = {collection:name=>({doc:id=>ref(name+'/'+id)}),runTransaction:async work=>{
    for(let attempt=0;attempt<3;attempt++) {
      const writes=[];let writing=false;
      const value=await work({getAll:async(...refs)=>{assert(!writing);return refs.map(r=>snap(r.path));},
        set:(r,d,o)=>{writing=true;writes.push(()=>rows.set(r.path,o?.merge?{...rows.get(r.path),...d}:d));},
        delete:r=>{writing=true;writes.push(()=>rows.delete(r.path));},
        create:(r,d)=>{writing=true;writes.push(()=>{assert(!rows.has(r.path));rows.set(r.path,d);});}});
      if(onCommit){const hook=onCommit;onCommit=null;hook();continue;}
      writes.forEach(write=>write());return value;
    }throw Error('retry limit');
  }};
  class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
  rows.set(root,{});rows.set(lecture,{status:'active',startTime:'09:00',durationHours:2});
  rows.set(lecture+'/marks/a',{studentId:'a',time:'09:10'});
  const handler=factory({db,HttpsError,Timestamp:{now:()=>({toMillis:()=>123})},
    authorisedSubject:async()=>({workspaceId:'qa',subjectId:'s',subjectRef:ref(root),subject:{...rows.get(root)}}),
    studentExistsInSubject:async()=>({id:'a',name:'Synthetic Student'}),auditPayload:x=>x});
  const request=(extra={})=>({auth:{uid:'qa'},data:{workspaceId:'qa',subjectId:'s',studentId:'a',date:'2026-09-23',action:'setTime',time:'09:15',
    operationId:'correction-000000000001',expectedRevision:null,expectedLifecycleRevision:null,expectedTime:'09:10',...extra}});
  return {rows,root,lecture,handler,request,setHook:hook=>{onCommit=hook}};
}
test('Correction commits mark, revision and receipt; exact replay is idempotent',async()=>{
 const h=harness(),r=h.request(),first=await h.handler(r),size=h.rows.size;
 assert.equal(h.rows.get(h.lecture+'/marks/a').time,'09:15');assert.equal(h.rows.get(h.lecture).markRevisions.a,r.data.operationId);
 assert.equal(h.rows.get(h.root).summaryState,'pending');assert.deepEqual(await h.handler(r),first);assert.equal(h.rows.size,size);
 await assert.rejects(h.handler(h.request({time:'09:20'})),e=>e.code==='already-exists');
});
test('Cancellation between read and commit is detected on transaction retry',async()=>{
 const h=harness();h.setHook(()=>h.rows.set(h.lecture,{...h.rows.get(h.lecture),status:'cancelled'}));
 await assert.rejects(h.handler(h.request()),e=>e.code==='failed-precondition');assert.equal(h.rows.get(h.lecture+'/marks/a').time,'09:10');
 assert.equal(h.rows.has(h.root+'/correctionReceipts/correction-000000000001'),false);
});
test('Concurrent correction revision cannot be overwritten',async()=>{
 const h=harness();h.setHook(()=>h.rows.set(h.lecture,{...h.rows.get(h.lecture),markRevisions:{a:'other-device-000000001'}}));
 await assert.rejects(h.handler(h.request()),e=>e.code==='failed-precondition');assert.equal(h.rows.get(h.lecture+'/marks/a').time,'09:10');
});
test('Deletion retains a tombstone and replays without a second mutation',async()=>{
 const h=harness(),r=h.request({action:'unmark'});await h.handler(r);await h.handler(r);
 assert(!h.rows.has(h.lecture+'/marks/a'));assert.equal(h.rows.get(h.lecture).markRevisions.a,r.data.operationId);
});
test('Unversioned and out-of-lecture corrections fail without writes',async()=>{
 const h=harness();await assert.rejects(h.handler(h.request({expectedRevision:undefined})),e=>e.code==='failed-precondition');
 await assert.rejects(h.handler(h.request({time:'08:59'})),e=>e.code==='failed-precondition');assert.equal(h.rows.size,3);
});
test('Excuse changes require the observed state and share mark revision fence',async()=>{
 const h=harness(),r=h.request({action:'setExcuse',excused:true,expectedExcused:false});await h.handler(r);
 assert(h.rows.has(h.lecture+'/excuses/a'));assert(!h.rows.has(h.lecture+'/marks/a'));
 await assert.rejects(h.handler(h.request({operationId:'correction-000000000002',action:'setExcuse',excused:false,expectedExcused:false})),e=>e.code==='failed-precondition');
});
test('Clear or roster change racing correction prevents commit',async()=>{
 const h=harness();h.setHook(()=>h.rows.set(h.root,{lastRosterResetId:'new-roster'}));
 await assert.rejects(h.handler(h.request()),e=>e.code==='failed-precondition');assert.equal(h.rows.get(h.lecture+'/marks/a').time,'09:10');
});
