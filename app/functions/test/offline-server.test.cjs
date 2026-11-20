const assert=require('assert/strict');
const records=new Map();
const ref=path=>({path,collection:n=>({doc:id=>ref(path+'/'+n+'/'+id)}),get:async()=>({exists:records.has(path),data:()=>records.get(path)})});
const subjectRef=ref('w/s');records.set('w/s',{});
const HttpsError=class extends Error{constructor(code,msg){super(msg);this.code=code}};
const call=require('../offline-attendance')({onCall:(_,fn)=>fn,HttpsError,Timestamp:{now:()=>123},authorisedSubject:async r=>{if(r.auth?.uid!=='owner'||r.data.workspaceId!=='owner')throw new HttpsError('permission-denied','denied');return {subjectRef,subjectId:'s',workspaceId:'owner',subject:{}}},rosterForSubject:async()=>[{id:'P1',name:'Student One'}],db:{runTransaction:async fn=>{const writes=[];await fn({get:r=>r.get(),create:(r,v)=>{if(records.has(r.path))throw Error('exists');writes.push([r.path,v])},set:(r,v)=>writes.push([r.path,{...records.get(r.path),...v}])});for(const [k,v]of writes)records.set(k,v);}}}).syncOfflineAttendance;
const operation={id:'operation-00000001',uid:'owner',workspaceId:'owner',subjectId:'s',kind:'mark',date:'2026-09-10',createdAt:Date.now(),meta:{startTime:'08:00',durationHours:2},studentId:'P1',studentName:'Student One',record:{time:'08:05',method:'qr'}};
const request=op=>({auth:{uid:'owner'},data:{workspaceId:'owner',subjectId:'s',operation:op}});
(async()=>{
await assert.rejects(()=>call({...request(operation),auth:{uid:'other'}}));
await call(request(operation));assert.equal(records.get('w/s/lectures/2026-09-10/marks/P1').attendedMinutes,115);
assert((await call(request(operation))).replayed);assert.equal(records.size,4);
await assert.rejects(()=>call(request({...operation,id:'operation-00000002',studentName:'Wrong name'})));
await assert.rejects(()=>call(request({...operation,id:'operation-00000002',record:{time:'08:10'}})));
await call(request({...operation,id:'operation-00000003',kind:'close'}));assert.equal(records.get('w/s/lectures/2026-09-10').status,'completed');
records.set('w/s',{lastRosterResetId:'reset'});await assert.rejects(()=>call(request({...operation,id:'operation-00000004'})));
assert(!records.has('w/s/offlineReceipts/operation-00000004'));
records.set('w/s',{});
for(const [method,date] of [['rfid','2026-09-11'],['nfc','2026-09-12']]){
 const op={...operation,id:'operation-reader-'+method,date,record:{time:'08:05',method}};
 await call(request(op));assert.equal(records.get('w/s/lectures/'+date+'/marks/P1').method,method);
 assert((await call(request(op))).replayed);
}
console.log('PASS RFID and NFC methods survive validated, idempotent offline replay');
const lecturePath='w/s/lectures/2026-09-10',markPath=lecturePath+'/marks/P1';
records.set(lecturePath,{...records.get(lecturePath),markRevisions:{P1:operation.id,P2:'other-operation-0001'},customMeta:'preserved'});
const duplicate={...operation,id:'legacy-duplicate-00001'};
await call(request(duplicate));assert.equal(records.get(lecturePath).markRevisions.P1,duplicate.id);
assert.equal(records.get(lecturePath).markRevisions.P2,'other-operation-0001');assert.equal(records.get(lecturePath).customMeta,'preserved');
records.delete(markPath);records.set(lecturePath,{...records.get(lecturePath),markRevisions:{...records.get(lecturePath).markRevisions,P1:'deleted-operation-0001'}});
await assert.rejects(()=>call(request({...operation,id:'legacy-stale-mark-0001'})),error=>error.code==='failed-precondition');
assert(!records.has(markPath));assert(!records.has('w/s/offlineReceipts/legacy-stale-mark-0001'));
assert((await call(request(operation))).replayed,'Lost old acknowledgement remains replayable after deletion');
assert((await call(request(duplicate))).replayed);assert.equal(records.get(lecturePath).markRevisions.P1,'deleted-operation-0001');
assert(!records.has(markPath));
console.log('PASS old single-operation endpoint cannot resurrect deletion tombstones; accepted marks advance versions, receipts replay without rolling back metadata');
console.log('PASS server auth isolation, idempotency, duration validation, name mismatch/conflict retention, closure and roster reset protection (transaction mock)');
})().catch(e=>{console.error(e);process.exitCode=1});
