const assert=require('node:assert/strict');
const {createHarness}=require('./offline-corrections-server.test.cjs');
(async()=>{
 const h=createHarness({acceptAlreadyClosed:true});
 const close=()=>h.operation('close',{protocolVersion:3,expectedLifecycleRevision:null,expectedLifecycleStatus:'active',studentId:'',record:null,
   meta:{startTime:'08:00',durationHours:2,closeReason:'manual',closedAtMillis:Date.parse('2026-09-16T09:00:00+03:00')}});
 h.reset();h.seed({status:'completed',lifecycleRevision:'server-new-revision-0001',closedAtMillis:12345,closeReason:'elapsed'});
 const before=JSON.stringify([...h.records]),op=close();await h.accepted([op]);
 const receipt=h.subjectPath+'/offlineReceipts/'+op.id;
 assert.equal(h.records.get(receipt).resolution,'already-closed');h.records.delete(receipt);
 assert.equal(JSON.stringify([...h.records]),before,'Only a receipt may change; all attendance and authoritative closure fields stay intact');
 for(const changes of [{status:'cancelled'},{status:'voided'},{status:'completed',startTime:'09:00'},{status:'completed',durationHours:3}]){
  h.reset();h.seed(changes);await h.rejected(close());
 }
 for(const changes of [{lastRosterResetId:'new-reset'},{attendanceClearInProgress:true},{attendanceClearedAt:h.timestamp(2000)}]){
  h.reset();h.seed({status:'completed'});h.records.set(h.subjectPath,{...h.records.get(h.subjectPath),...changes});await h.rejected(close());
 }
 h.reset();h.seed({status:'completed'});await h.rejected({...close(),kind:'cancel',expectedLifecycleRevision:'stale-revision-0000001'});
 h.reset();h.seed({status:'completed'});await h.rejected({...close(),meta:{...close().meta,closedAtMillis:1}},'invalid-argument');
 const legacy=createHarness();legacy.reset();legacy.seed({status:'completed',lifecycleRevision:'server-new-revision-0001'});await legacy.rejected(close());
 console.log('PASS preview duplicate closure acknowledgement preserves marks/cutoffs; reset, time, cancellation and production fences retained');
})().catch(e=>{console.error(e);process.exitCode=1});
