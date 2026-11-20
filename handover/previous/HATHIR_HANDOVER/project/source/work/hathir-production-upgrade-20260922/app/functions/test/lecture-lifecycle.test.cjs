const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const {createHarness}=require('./offline-corrections-server.test.cjs');
const h=createHarness();
const op=(kind,extra={})=>h.operation(kind,{protocolVersion:3,expectedLifecycleRevision:null,expectedLifecycleStatus:kind==='close'||kind==='cancel'?'active':null,...extra});
async function run(){
 h.reset();
 let mark=op('mark');
 const close=op('close',{meta:{startTime:'08:00',durationHours:2,closeReason:'manual',closedAtMillis:Date.parse('2026-09-16T08:45:00+03:00')}});
 let cancel=op('cancel',{expectedLifecycleRevision:close.id,expectedLifecycleStatus:'completed'});
 await h.accepted([mark,close,cancel]);
 let lecture=h.records.get(h.lecturePath(mark.date));
 assert.equal(lecture.status,'cancelled');assert.equal(lecture.lifecycleRevision,cancel.id);
 assert.equal(lecture.summaryState,'not-required','Cancelled sessions cannot starve the bounded lecture summary queue');
 assert.equal(h.records.get(h.subjectPath).summaryState,'pending','Accepted cancellation invalidates the parent summary atomically');
 assert.equal(h.records.get(h.subjectPath).rosterCohortId,'private_roster','Parent invalidation preserves unrelated subject fields');
 assert.equal(lecture.closeReason,'manual');assert.equal(lecture.closedAtMillis,close.meta.closedAtMillis);
 assert.equal(lecture.durationHours,2,'Early closure preserves configured attendance credit');
 assert.equal(h.records.get(h.markPath(mark.date)).attendedMinutes,115,'Cancellation keeps original attendance marks');
 await h.accepted([mark,close,cancel]);assert.equal(h.records.get(h.lecturePath(mark.date)).lifecycleRevision,cancel.id,'Receipt replay cannot undo cancellation');
 await h.rejected(op('mark',{studentId:'P2',studentName:'Student P2'}));
 await h.rejected(op('close'));
 assert.equal(h.records.get(h.lecturePath(mark.date)).status,'cancelled');
 // A prior explicit lifecycle decision fences even untouched student IDs.
 h.reset();mark=op('mark');await h.accepted([mark,close]);
 await h.rejected(op('mark',{studentId:'P2',studentName:'Student P2'}));
 await h.rejected(h.operation('mark',{studentId:'P2',studentName:'Student P2'}));
 const correction=op('setTime',{expectedRevision:mark.id,expectedLifecycleRevision:close.id,expectedMarkedAtMillis:null,record:{time:'08:15',method:'manual'}});
 await h.accepted([correction]);assert.equal(h.records.get(h.markPath(mark.date)).attendedMinutes,105);
 assert.equal(h.records.get(h.lecturePath(mark.date)).status,'completed');
 // A scheduled server close while the device was offline is not a conflicting
 // manual teacher action; cancelling that same lecture remains deliberate.
 h.reset();h.seed({status:'completed',closeReason:'elapsed'});
 cancel=op('cancel');await h.accepted([cancel]);assert(h.records.has(h.markPath(cancel.date)));
 h.reset();h.seed({status:'completed',closeReason:'manual'});await h.rejected(op('cancel'));
 h.reset();h.seed({status:'voided'});await h.rejected(op('cancel'));
 h.reset();await h.rejected(op('cancel'),'failed-precondition');
 // An unresolved stale transition stops the suffix, never drops later marks.
 h.reset();mark=op('mark');const stale=op('cancel',{expectedLifecycleRevision:'other-device-revision-00001'}),after=op('mark',{studentId:'P2',studentName:'Student P2'});
 const result=await h.call(h.request([mark,stale,after]));assert.deepEqual(result.acceptedOperationIds,[mark.id]);assert.equal(result.failure.operationId,stale.id);assert(!h.records.has(h.markPath(after.date,'P2')));
 for(const extra of [{lastRosterResetId:'reset-new'},{attendanceClearInProgress:true},{attendanceClearedAt:h.timestamp(2000)}]){
  h.reset();h.seed();h.records.set(h.subjectPath,{...h.records.get(h.subjectPath),...extra});await h.rejected(op('cancel'));assert(h.records.has(h.markPath('2026-09-16')));
 }
 h.reset();h.seed();h.allowEdit=false;await assert.rejects(()=>h.call(h.request([op('cancel')])),e=>e.code==='permission-denied');assert.equal(h.records.get(h.lecturePath('2026-09-16')).status,'active');
 h.allowEdit=true;
 for(const extra of [{protocolVersion:2},{expectedLifecycleRevision:undefined},{expectedLifecycleStatus:'unknown'}])await assert.rejects(()=>h.call(h.request([op('cancel',extra)])),e=>e.code==='invalid-argument');
 h.reset();h.seed();await h.rejected(op('close',{meta:{startTime:'08:00',durationHours:2,closeReason:'manual',closedAtMillis:Date.parse('2026-09-16T07:00:00+03:00')}}),'invalid-argument');
 // A following lecture is a new immutable key, never reopening the old one.
 h.reset();mark=op('mark');await h.accepted([mark,close]);
 const second=op('mark',{date:mark.date+'__'+'a'.repeat(32),studentId:'P2',studentName:'Student P2',meta:{startTime:'10:00',durationHours:2},record:{time:'10:00',method:'manual'}});
 await h.accepted([second]);assert.equal(h.records.get(h.lecturePath(mark.date)).status,'completed');assert.equal(h.records.get(h.lecturePath(second.date)).status,'active');
 assert.equal(h.records.get(h.markPath(mark.date)).attendedMinutes,115);assert.equal(h.records.get(h.markPath(second.date,'P2')).attendedMinutes,120);
 await assert.rejects(()=>h.call(h.request([op('reopen',{expectedLifecycleStatus:'completed'})])),e=>e.code==='invalid-argument');
 await h.rejected(op('mark',{studentId:'P2',studentName:'Student P2',expectedLifecycleRevision:close.id,record:{time:'14:00'}}));
 const source=fs.readFileSync(path.resolve(__dirname,'../../netlify_site/offline-attendance.js'),'utf8');
 const start=source.indexOf('function applyPendingOfflineOperation('),end=source.indexOf('\nasync function offlineAttendanceReadState',start);
 const ctx=vm.createContext({});vm.runInContext(source.slice(start,end),ctx);
 const s={lectures:[],lectureMeta:{},attendance:{}};
 const localMark={...mark,meta:{startTime:'08:00',durationHours:2,status:'active'}};
 ctx.applyPendingOfflineOperation(s,localMark);ctx.applyPendingOfflineOperation(s,{...close,meta:{...close.meta,status:'completed'}});ctx.applyPendingOfflineOperation(s,{...cancel,protocolVersion:3,meta:{startTime:'08:00',durationHours:2,status:'cancelled'}});
 assert.equal(s.lectureMeta[mark.date].status,'cancelled');assert(s.attendance[mark.date].P1);
 ctx.applyPendingOfflineOperation(s,localMark);assert.equal(s.lectureMeta[mark.date].status,'cancelled','Old overlay cannot reopen cancelled lecture');
 console.log('PASS lifecycle cancellation/closure: retained marks, independent following session, state fencing, legacy guard, idempotent replay, prefix failures, reset/security validation and offline overlay');
}
run().catch(e=>{console.error(e);process.exitCode=1});
