const assert=require('node:assert/strict');
const {createHarness}=require('./offline-corrections-server.test.cjs');
async function run(){
 const h=createHarness(),revision='existing-elapsed-close-0001';
 const end=Date.parse('2026-09-16T10:00:00+03:00');
 function seed(extra={}){h.reset();h.seed({status:'completed',closeReason:'elapsed',closedAtMillis:end,lifecycleRevision:revision,elapsedCloseEquivalence:{revision,baseRevision:null,closedAtMillis:end,operationIds:[revision]},...extra});}
 const op=extra=>h.operation('close',{protocolVersion:3,expectedLifecycleRevision:null,expectedLifecycleStatus:'active',studentId:'',studentName:'',record:null,meta:{startTime:'08:00',durationHours:2,closeReason:'elapsed',closedAtMillis:0},...extra});
 for(const value of [0,undefined,end]){
  seed();const pending=op({meta:{startTime:'08:00',durationHours:2,closeReason:'elapsed',closedAtMillis:value}});
  const before=h.records.get(h.markPath(pending.date));await h.accepted([pending]);
  const lecture=h.records.get(h.lecturePath(pending.date));assert.equal(lecture.lifecycleRevision,revision);assert.equal(lecture.closedAtMillis,end);assert.equal(lecture.status,'completed');assert.deepEqual(h.records.get(h.markPath(pending.date)),before);
  await h.accepted([pending]);assert.equal(h.records.get(h.lecturePath(pending.date)).elapsedCloseEquivalence.operationIds.length,2);
 }
 for(const extra of [{status:'cancelled'},{closeReason:'manual'},{elapsedCloseEquivalence:null},{lifecycleRevision:'new-manual-revision-0001'},{startTime:'08:30'},{durationHours:3}]){seed(extra);await h.rejected(op());}
 seed();await h.rejected(op({meta:{startTime:'08:00',durationHours:2,closeReason:'elapsed',closedAtMillis:end-60000}}));
 seed();h.records.set(h.subjectPath,{...h.records.get(h.subjectPath),lastRosterResetId:'new-reset'});await h.rejected(op());
 console.log('PASS legacy zero/missing scheduled closure accepted only with exact server equivalence; marks retained, replay safe, cancellation/manual/revision/time/duration/reset fences retained');
}
run().catch(e=>{console.error(e);process.exitCode=1});
