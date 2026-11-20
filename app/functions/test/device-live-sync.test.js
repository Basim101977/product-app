'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fixture=require('./live-fixture.cjs'),M=require('../device-sync-model');
const operation=(path,value,before=null,expected=0)=>({id:crypto.randomUUID(),path,value,before,expected});
const push=async(f,...operations)=>(await f.call({action:'push',operations})).results;
async function setup(){const f=fixture();await f.call({action:'bootstrap'});await push(f,operation(['subject','s'],{id:'s'}),operation(['student','s','a'],{id:'a',name:'A'}),operation(['student','s','b'],{id:'b',name:'B'}),operation(['lecture','s','day'],{status:'active',durationHours:2,startTime:'09:00'}));return f;}
test('Live sync rejects unauthenticated, foreign workspace and disabled accounts',async()=>{const f=fixture();await assert.rejects(f.call({action:'bootstrap'},null),{code:'unauthenticated'});await assert.rejects(f.call({action:'bootstrap',workspaceId:'other'}),{code:'permission-denied'});f.disable();await assert.rejects(f.call({action:'bootstrap'}),{code:'permission-denied'});assert.equal(f.records.size,0);});

test('Two teachers with identical record and operation IDs cannot read or overwrite each other',async()=>{
 const f=fixture();for(const uid of ['teacherA','teacherB'])await f.call({action:'bootstrap'},uid);
 const id=crypto.randomUUID();
 for(const uid of ['teacherA','teacherB'])await f.call({action:'push',operations:[{...operation(['subject','same'],{id:'same',titleAr:uid}),id}]},uid);
 for(const uid of ['teacherA','teacherB']){
  const rows=await f.call({action:'pull',cursor:0},uid);assert.equal(rows.records.length,1);assert.equal(rows.records[0].value.titleAr,uid);
  const before=JSON.stringify([...f.records]);
  for(const action of ['bootstrap','pull','push'])await assert.rejects(f.call({action,workspaceId:uid==='teacherA'?'teacherB':'teacherA',cursor:0,operations:[operation(['subject','same'],null)]},uid),{code:'permission-denied'});
  assert.equal(JSON.stringify([...f.records]),before);
 }
});
test('Typed records reject malformed changed fields without modifying the stored record',async()=>{
 const f=await setup();
 for(const [path,value]of [
  [['student','s','c'],{id:'c',name:{html:'bad'}}],
  [['student','s','c'],{id:'c',name:'x'.repeat(151)}],
  [['subject','new'],{totalHours:-1}],
  [['lecture','s','bad'],{durationHours:'NaN'}],
  [['mark','s','day','a'],{time:[],attendedMinutes:5}],
  [['mark','s','day','a'],{time:'09:00',attendedMinutes:-5}],
  [['student','s','c'],{faceDescriptors:'not-an-array'}],
  [['student','s','c'],[]],
  [['subject','new'],{name:'x'.repeat(151)}]
 ]){const before=JSON.stringify([...f.records]);await assert.rejects(push(f,operation(path,value)),{code:'invalid-argument'});assert.equal(JSON.stringify([...f.records]),before);}
});
test('Forged before cannot grandfather a malformed field into a new cloud record',async()=>{
 const f=await setup(),bad={name:{unexpected:true}};
 await assert.rejects(push(f,operation(['student','s','c'],bad,bad)),{code:'invalid-argument'});
});
test('Record schema covers all synchronized kinds while retaining legacy optional and numeric-string fields',()=>{
 const valid=require('../device-record-validation');
 for(const [kind,value]of Object.entries({departments:{name:[]},stages:{sort:{}},scopeRoster:{stageId:[]},scopeStudent:{name:3},subject:{lectureDurationHours:-2},student:{faceTemplateCount:-1},lecture:{hideWhenEmpty:'yes'},mark:{method:[]},excuse:{reason:{}}})){
  assert.equal(valid([kind],value,null),false,kind);assert.equal(valid([kind],{},null),true,kind);
 }
 assert(valid(['subject'],{totalHours:'60',lectureDurationHours:'2',stageId:null,extension:[1,2]},null));
 assert(valid(['mark'],'09:05',null));assert(valid(['excuse'],true,null));
 assert(valid(['student'],null,{name:'old'}));
});
test('Authoritative legacy fields survive unrelated edits and remain repairable and deletable',async()=>{
 const f=await setup(),path=['student','s','a'];
 const entry=[...f.records].find(([,r])=>r.path&&JSON.stringify(r.path)===JSON.stringify(path));
 const old={id:'a',name:'x'.repeat(200),custom:{retained:true}};
 f.records.set(entry[0],{...entry[1],valueJson:JSON.stringify(old)});
 const edited={...old,custom:{retained:true,added:1}};
 assert.equal((await push(f,operation(path,edited,old,1)))[0].status,'accepted');
 const repaired={...edited,name:'اسم مصحح'};
 assert.equal((await push(f,operation(path,repaired,edited,2)))[0].status,'accepted');
 assert.equal((await push(f,operation(path,null,repaired,3)))[0].status,'accepted');
});
test('Different students and different lectures merge independently',async()=>{const f=await setup();const results=await Promise.all([push(f,operation(['mark','s','day','a'],{time:'09:01'})),push(f,operation(['mark','s','day','b'],{time:'09:02'}))]);assert(results.flat().every(r=>r.status==='accepted'));const rows=await f.call({action:'pull',cursor:0});assert.equal(rows.records.filter(r=>r.path[0]==='mark').length,2);});
test('Concurrent first scans deduplicate and retain the earlier time',async()=>{const f=await setup();await push(f,operation(['mark','s','day','a'],{time:'09:05'}));const [r]=await push(f,operation(['mark','s','day','a'],{time:'09:03'}));assert.equal(r.status,'accepted');assert.equal(r.record.value.time,'09:03');});
test('Concurrent presence and excuse for one student require explicit review',async()=>{const f=await setup();await push(f,operation(['excuse','s','day','a'],{reason:'medical'}));const [r]=await push(f,operation(['mark','s','day','a'],{time:'09:03'}));assert.equal(r.reason,'attendance-excuse-conflict');const [removed]=await push(f,operation(['excuse','s','day','a'],null,{reason:'medical'},1));assert.equal(removed.status,'accepted');assert.equal((await push(f,operation(['mark','s','day','a'],{time:'09:03'})))[0].status,'accepted');});
test('Different corrections to the same mark conflict without dropping either request',async()=>{const f=await setup();const [first]=await push(f,operation(['mark','s','day','a'],{time:'09:05'}));await push(f,operation(first.record.path,{time:'09:06'},first.record.value,1));const [r]=await push(f,operation(first.record.path,{time:'09:07'},first.record.value,1));assert.equal(r.status,'conflict');assert.equal(r.current.value.time,'09:06');assert([...f.records.values()].some(v=>v.payloadJson&&JSON.parse(v.payloadJson).operation?.value?.time==='09:07'&&JSON.parse(v.payloadJson).result.status==='conflict'));});
test('Tombstones prevent deleted attendance and deleted lectures from returning',async()=>{const f=await setup();const [first]=await push(f,operation(['mark','s','day','a'],{time:'09:05'}));await push(f,operation(first.record.path,null,first.record.value,1));const [stale]=await push(f,operation(first.record.path,{time:'09:07'}));assert.equal(stale.status,'conflict');const lecture=(await f.call({action:'pull',cursor:0})).records.find(r=>r.path[0]==='lecture');await push(f,operation(lecture.path,null,lecture.value,lecture.revision));const [late]=await push(f,operation(['mark','s','day','b'],{time:'09:09'}));assert.equal(late.reason,'parent-deleted');});
test('Duplicate request after a lost acknowledgement is idempotent and immutable',async()=>{const f=await setup(),op=operation(['mark','s','day','a'],{time:'09:01'});const first=await push(f,op);assert.deepEqual(await push(f,op),first);await assert.rejects(push(f,{...op,value:{time:'09:09'}}),{code:'already-exists'});});
test('Resolving a conflict still compares against the latest server revision',async()=>{const f=await setup();const path=['mark','s','day','a'];await push(f,operation(path,{time:'09:01'}));await push(f,operation(path,{time:'09:02'},{time:'09:01'},1));const [r]=await push(f,operation(path,{time:'09:03'},{time:'09:02'},2));assert.equal(r.status,'accepted');assert.equal(r.record.revision,3);});
test('Cloud bootstrap resumes in pages and does not overwrite the existing backup',async()=>{const f=fixture(),data={workspace:{id:'owner'},subjects:{s:{id:'s',students:Array.from({length:125},(_,i)=>({id:'s'+i})),lectureMeta:{},attendance:{},excuses:{},lectures:[]}}};f.records.set('attendanceDeviceCopies/owner',{revision:'old',count:1});f.records.set('attendanceDeviceCopies/owner/versions/old/chunks/0',{text:JSON.stringify({schema:1,uid:'owner',data})});assert.equal((await f.call({action:'bootstrap'})).ready,false);assert.equal((await f.call({action:'bootstrap'})).ready,true);const first=await f.call({action:'pull',cursor:0}),second=await f.call({action:'pull',cursor:first.cursor});assert.equal(first.records.length+second.records.length,126);assert.equal(f.records.get('attendanceDeviceCopies/owner').revision,'old');});
test('Model materialization respects subject and lecture tombstones',()=>{const data={workspace:{id:'owner'},subjects:{s:{id:'s',students:[{id:'a'}],lectures:['d'],lectureMeta:{d:{status:'active'}},attendance:{d:{a:{time:'09:00'}}}}}};const flat=M.flatten(data);flat[M.key(['lecture','s','d'])]=null;assert.deepEqual(M.materialize(flat,data).subjects.s.attendance,{});flat[M.key(['subject','s'])]=null;assert.deepEqual(M.materialize(flat,data).subjects,{});});
test('Shared successor ID is deterministic and changes for a different predecessor',()=>{assert.equal(M.lectureId('s','2026-09-27','a'),M.lectureId('s','2026-09-27','a'));assert.notEqual(M.lectureId('s','2026-09-27','a'),M.lectureId('s','2026-09-27','b'));});
test('Malformed paths, prototype keys, missing fields and excessive batches are rejected',async()=>{const f=await setup();await assert.rejects(push(f,operation(['subject','__proto__'],{})),{code:'invalid-argument'});await assert.rejects(push(f,{...operation(['subject','s'],{}),expected:-1}),{code:'invalid-argument'});await assert.rejects(f.call({action:'push',operations:Array(21).fill({})}),{code:'invalid-argument'});});

test('Invalid later operation cannot partially save the earlier operations in its batch',async()=>{
 const f=await setup(),before=JSON.stringify([...f.records]);
 await assert.rejects(push(f,operation(['mark','s','day','a'],{time:'09:01'}),{...operation(['mark','s','day','b'],{time:'09:02'}),expected:-1}),{code:'invalid-argument'});
 assert.equal(JSON.stringify([...f.records]),before);
});
test('Nested prototype keys, non-finite values, excessive nesting and oversized payloads fail without writes',async()=>{
 const f=await setup(),before=JSON.stringify([...f.records]);let deep={};for(let i=0;i<66;i++)deep={child:deep};
 for(const value of [JSON.parse('{"details":{"__proto__":{"polluted":true}}}'),{score:NaN},deep,{name:'x'.repeat(300001)}]){
  await assert.rejects(push(f,operation(['student','s','c'],value)),{code:'invalid-argument'});
  assert.equal(JSON.stringify([...f.records]),before);
 }
 assert.equal({}.polluted,undefined);
});
test('Legacy scalar attendance, extension fields and null deletion remain compatible',async()=>{
 const f=await setup();const op=operation(['mark','s','day','a'],'09:01');
 assert.equal((await push(f,op))[0].status,'accepted');assert.equal((await push(f,op))[0].status,'accepted');
 assert.equal((await push(f,operation(op.path,null,'09:01',1)))[0].status,'accepted');
 const extra=operation(['student','s','c'],{id:'c',name:'طالب',custom:{nested:[1,true,null,'value']}});
 assert.equal((await push(f,extra))[0].status,'accepted');
});

test('Nested face arrays survive bootstrap, edits and receipt replay without native nested arrays',async()=>{const f=fixture(),data={workspace:{id:'owner'},subjects:{s:{id:'s',students:[{id:'a',faceDescriptors:[[0.1,0.2],[0.3,0.4]]}],lectureMeta:{},lectures:[],attendance:{},excuses:{}}}};f.records.set('attendanceDeviceCopies/owner',{revision:'old',count:1});f.records.set('attendanceDeviceCopies/owner/versions/old/chunks/0',{text:JSON.stringify({schema:1,uid:'owner',data})});await f.call({action:'bootstrap'});const rows=await f.call({action:'pull',cursor:0}),student=rows.records.find(r=>r.path[0]==='student');assert.deepEqual(student.value.faceDescriptors,[[0.1,0.2],[0.3,0.4]]);const op=operation(student.path,{...student.value,faceDescriptors:[[0.5,0.6]]},student.value,1);const ack=await push(f,op);assert.equal(ack[0].status,'accepted');assert.deepEqual(await push(f,op),ack);for(const [key,value]of f.records)if(key.startsWith('attendanceDeviceSync/'))assert(!Object.hasOwn(value,'value')&&!Object.hasOwn(value,'operation'),'Payload fields must be opaque JSON');});

test('Previously stored native records and receipts remain readable during rolling upgrade',async()=>{const f=await setup();for(const [key,value]of f.records)if(key.includes('/records/')&&value.path[0]==='student'){const next={...value,value:JSON.parse(value.valueJson)};delete next.valueJson;f.records.set(key,next);}const op=operation(['mark','s','day','a'],{time:'09:05'}),ack=await push(f,op);const key='attendanceDeviceSync/owner/receipts/'+op.id,encoded=f.records.get(key),native={fingerprint:encoded.fingerprint,...JSON.parse(encoded.payloadJson),createdAt:encoded.createdAt};f.records.set(key,native);assert.deepEqual(await push(f,op),ack);const rows=await f.call({action:'pull',cursor:0});assert.equal(rows.records.find(r=>r.path[0]==='student').value.name,'A');});
