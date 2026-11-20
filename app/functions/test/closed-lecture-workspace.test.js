'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const factory=require('../closed-lecture-workspace');
class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
function fixture(){
 const records=new Map();let gate=Promise.resolve(),authorization=true;
 const ref=path=>({path,collection:name=>collection(path+'/'+name),get:async()=>snap(path)});
 const collection=path=>({doc:id=>ref(path+'/'+id)});
 const snap=path=>({exists:records.has(path),data:()=>structuredClone(records.get(path))});
 const db={collection,runTransaction:fn=>{const run=gate.catch(()=>{}).then(async()=>{const staged=[];const result=await fn({get:async r=>snap(r.path),create:(r,d)=>{assert(!records.has(r.path));staged.push([r.path,d]);},set:(r,d)=>staged.push([r.path,d])});staged.forEach(([p,d])=>records.set(p,structuredClone(d)));return result;});gate=run;return run;}};
 const {closedLectureWorkspace:handler}=factory({db,onCall:(_,fn)=>fn,HttpsError,authorisedWorkspaceOwner:async()=>{if(!authorization)throw new HttpsError('permission-denied','Disabled');}});
 const call=(data,uid='owner')=>handler({auth:uid?{uid}:null,data:{workspaceId:uid,...data}});
 const payload=(status='completed')=>JSON.stringify({schema:1,uid:'owner',data:{workspace:{id:'owner'},subjects:{a:{id:'a',students:[],lectures:['day'],lectureMeta:{day:{status}},attendance:{day:{}},excuses:{}}}}});
 const write=(id,json=payload())=>call({action:'write',revision:id,count:1,index:0,text:json});
 return {call,write,payload,records,disable:()=>{authorization=false;}};
}
const a='aaaaaaaaaaaaaaaa',b='bbbbbbbbbbbbbbbb',c='cccccccccccccccc';
test('Only authenticated, active owners can read or write their own copy',async()=>{const f=fixture();await assert.rejects(f.call({action:'head'},null),{code:'unauthenticated'});await assert.rejects(f.call({action:'head',workspaceId:'other'}),{code:'permission-denied'});f.disable();await assert.rejects(f.call({action:'head'}),{code:'permission-denied'});assert.equal(f.records.size,0);});
test('Partial upload is invisible until atomic commit; chunks are immutable',async()=>{const f=fixture();await f.write(a);assert.deepEqual(await f.call({action:'head'}),{revision:null,count:0});await assert.rejects(f.write(a,'different'),{code:'already-exists'});await f.call({action:'commit',revision:a,count:1,base:null});assert.deepEqual(await f.call({action:'head'}),{revision:a,count:1});assert.equal((await f.call({action:'read',revision:a,index:0})).text,f.payload());});
test('Open lecture payload is rejected by server, not just hidden in UI',async()=>{const f=fixture();await f.write(a,f.payload('active'));await assert.rejects(f.call({action:'commit',revision:a,count:1,base:null}),{code:'failed-precondition'});assert.equal((await f.call({action:'head'})).revision,null);});
test('Missing chunk, unknown action and oversized payload are rejected',async()=>{const f=fixture();await assert.rejects(f.call({action:'commit',revision:a,count:1,base:null}),{code:'failed-precondition'});await assert.rejects(f.call({action:'other',revision:a,count:1}),{code:'invalid-argument'});await assert.rejects(f.write(a,'x'.repeat(100001)),{code:'invalid-argument'});});
test('Foreign payload identity cannot become a cloud copy',async()=>{const f=fixture();await f.write(a,f.payload().replace('"uid":"owner"','"uid":"other"'));await assert.rejects(f.call({action:'commit',revision:a,count:1,base:null}),{code:'invalid-argument'});});
test('Lost acknowledgements are idempotent and cannot rewind a newer head',async()=>{const f=fixture();await f.write(a);await f.call({action:'commit',revision:a,count:1,base:null});await f.write(b);await f.call({action:'commit',revision:b,count:1,base:a});await f.call({action:'commit',revision:a,count:1,base:null});assert.equal((await f.call({action:'head'})).revision,b);});
test('Two devices based on the same version cannot silently overwrite each other',async()=>{const f=fixture();await f.write(a);await f.call({action:'commit',revision:a,count:1,base:null});await f.write(b);await f.write(c);const results=await Promise.allSettled([f.call({action:'commit',revision:b,count:1,base:a}),f.call({action:'commit',revision:c,count:1,base:a})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'aborted');});
test('New copy keeps deletions; no live data or approval documents are written',async()=>{const f=fixture();await f.write(a);await f.call({action:'commit',revision:a,count:1,base:null});const empty=JSON.parse(f.payload());empty.data.subjects={};await f.write(b,JSON.stringify(empty));await f.call({action:'commit',revision:b,count:1,base:a});assert.deepEqual(JSON.parse((await f.call({action:'read',revision:b,index:0})).text).data.subjects,{});assert([...f.records.keys()].every(key=>(key==='attendanceDeviceCopies/owner'||key.startsWith('attendanceDeviceCopies/owner/'))));});

test('An older client cannot replace snapshots after live migration starts',async()=>{const f=fixture();await f.write(a);f.records.set('attendanceDeviceSync/owner',{ready:false});await assert.rejects(f.call({action:'commit',revision:a,count:1,base:null}),{code:'failed-precondition'});await f.call({action:'commit',revision:a,count:1,base:null,protocol:2});assert.equal((await f.call({action:'head'})).revision,a);});
