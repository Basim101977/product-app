'use strict';
const crypto=require('node:crypto'),model=require('./device-sync-model');
const validRecord=require('./device-record-validation');
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:model.stable(value)).digest('hex');
// Firestore does not support arrays directly nested in arrays (face templates)
// or arbitrary nesting depth. Keep domain JSON opaque; index only the cursor.
const encodeRecord=record=>{const {value,...metadata}=record;return {...metadata,valueJson:JSON.stringify(value)};};
const decodeRecord=record=>Object.hasOwn(record,'valueJson')?{path:record.path,revision:record.revision,seq:record.seq,value:JSON.parse(record.valueJson)}:record;
module.exports=({db,onCall,HttpsError,authorisedWorkspaceOwner})=>{
  const fail=(code,message)=>{throw new HttpsError(code,message);};
  const recordRef=(root,path)=>root.collection('records').doc(hash(model.key(path)));
  const validPath=p=>Array.isArray(p)&&({departments:2,stages:2,scopeRoster:2,scopeStudent:3,subject:2,student:3,lecture:3,mark:4,excuse:4}[p[0]]===p.length)&&p.every(x=>typeof x==='string'&&x.length>0&&x.length<=180&&!['__proto__','prototype','constructor'].includes(x)&&!x.includes('/'));
  // Validate the complete batch before any writes. Retain legacy scalar marks,
  // nested face arrays, unknown extension fields and null deletion payloads.
  function safeJson(value, depth=0) {
    if (depth>64) return false;
    if (value===null || typeof value==='string' || typeof value==='boolean') return true;
    if (typeof value==='number') return Number.isFinite(value);
    if (!value || typeof value!=='object') return false;
    return Object.keys(value).every(key=>!['__proto__','prototype','constructor'].includes(key) && safeJson(value[key],depth+1));
  }
  function validateOperation(operation) {
    if(!operation || Array.isArray(operation) || !validPath(operation.path) || typeof operation.id!=='string' ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(operation.id) || !Number.isSafeInteger(operation.expected) || operation.expected<0 ||
      !Object.hasOwn(operation,'before') || !Object.hasOwn(operation,'value') || !safeJson(operation)) fail('invalid-argument','Invalid operation.');
    if(Buffer.byteLength(JSON.stringify(operation))>300000) fail('invalid-argument','Invalid operation.');
  }
  async function bootstrap(root,legacy){
    await db.runTransaction(async tx=>{
      const [state,head]=await Promise.all([tx.get(root),tx.get(legacy)]);if(state.exists)return;
      const source=head.exists?head.data():{};
      tx.set(root,{ready:!source.revision,source:source.revision||null,count:source.count||0,offset:0,seq:0});
    });
    const state=(await root.get()).data();if(state.ready)return state;
    let json='';for(let i=0;i<state.count;i++){const snap=await legacy.collection('versions').doc(state.source).collection('chunks').doc(String(i)).get();if(!snap.exists)fail('data-loss','Existing cloud backup is incomplete.');json+=snap.data().text;}
    const payload=JSON.parse(json);if(payload.uid!==root.id||payload.data?.workspace?.id!==root.id)fail('data-loss','Existing cloud identity mismatch.');
    const entries=Object.entries(model.flatten(payload.data)).sort(([a],[b])=>a.localeCompare(b));
    return db.runTransaction(async tx=>{
      const current=(await tx.get(root)).data();if(current.ready)return current;
      const batch=entries.slice(current.offset,current.offset+100);let seq=current.seq;
      for(const [key,value] of batch){const path=JSON.parse(key);tx.set(recordRef(root,path),encodeRecord({path,value,revision:1,seq:++seq}));}
      const next={...current,offset:current.offset+batch.length,seq,ready:current.offset+batch.length>=entries.length};tx.set(root,next);return next;
    });
  }
  async function apply(root,operation){
    if(!operation||!validPath(operation.path)||typeof operation.id!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(operation.id)||!Number.isSafeInteger(operation.expected)||operation.expected<0||!Object.hasOwn(operation,'before')||!Object.hasOwn(operation,'value')||Buffer.byteLength(JSON.stringify(operation))>300000)fail('invalid-argument','Invalid operation.');
    const path=operation.path,ref=recordRef(root,path),receipt=root.collection('receipts').doc(operation.id),fingerprint=hash(operation);
    return db.runTransaction(async tx=>{
      const refs=model.parents(path).map(p=>recordRef(root,p));
      const counterpart=['mark','excuse'].includes(path[0])?[path[0]==='mark'?'excuse':'mark',...path.slice(1)]:null;
      const sibling=counterpart?await tx.get(recordRef(root,counterpart)):null;
      const [state,old,prior,...parents]=await Promise.all([tx.get(root),tx.get(ref),tx.get(receipt),...refs.map(r=>tx.get(r))]);
      if(prior.exists){if(prior.data().fingerprint!==fingerprint)fail('already-exists','Operation ID reused.');return prior.data().payloadJson?JSON.parse(prior.data().payloadJson).result:prior.data().result;}
      if(!state.data()?.ready)fail('unavailable','Preparing synchronization.');
      const current=old.exists?decodeRecord(old.data()):{path,value:null,revision:0,seq:0};let value=operation.value,reason='';
      // Compare preserved fields with the authoritative record, never with the
      // caller's claimed "before". Receipts above keep old retries idempotent.
      if(!validRecord(path,value,current.value))fail('invalid-argument','Invalid record fields.');
      if(value!==null&&(value.departmentId==='civil_techniques'||path[0]==='departments'&&path[1]==='civil_techniques'||path[0]==='stages'&&path[1].startsWith('civil_techniques_stage_')))reason='retired-department';
      if(value!==null&&parents.some(p=>!p.exists||decodeRecord(p.data()).value===null))reason='parent-deleted';
      if(!reason&&value!==null&&sibling?.exists&&decodeRecord(sibling.data()).value!==null)reason='attendance-excuse-conflict';
      if(value!==null&&current.value===null&&current.revision>0&&['subject','student','lecture','scopeRoster','scopeStudent'].includes(path[0]))reason='deleted-record';
      const same=model.equal(current.value,value);
      let duplicateMark=false,sharedStart=false;
      if(!reason&&!same&&(operation.expected!==current.revision||!model.equal(operation.before,current.value))){
        duplicateMark=path[0]==='mark'&&operation.before===null&&current.value!==null&&value!==null;
        sharedStart=path[0]==='lecture'&&operation.before===null&&current.value?.status==='active'&&value?.status==='active'&&current.value.durationHours===value.durationHours;
        if(duplicateMark||sharedStart){
          // Concurrent first scans are one attendance fact. Keep the earlier
          // recorded time, and preserve both requests in immutable receipts.
          const field=duplicateMark?'time':'startTime';
          value=String(value[field]||'')<String(current.value[field]||'')?value:current.value;
        }else reason='concurrent-edit';
      }
      let result;
      if(reason)result={id:operation.id,status:'conflict',reason,current};
      else if(model.equal(current.value,value))result={id:operation.id,status:'accepted',record:current};
      else{
        const seq=state.data().seq+1,record={path,value,revision:current.revision+1,seq};
        tx.set(ref,encodeRecord(record));tx.set(root,{...state.data(),seq});result={id:operation.id,status:'accepted',record};
      }
      tx.set(receipt,{fingerprint,payloadJson:JSON.stringify({operation:['retired-department','parent-deleted','deleted-record'].includes(reason)?{id:operation.id,path:operation.path,value:null}:operation,result}),createdAt:Date.now()});return result;
    });
  }
  async function handler(request){
    if(!request.auth)fail('unauthenticated','Sign in first.');
    if(request.data?.workspaceId!==request.auth.uid)fail('permission-denied','Only your own workspace is supported.');
    await authorisedWorkspaceOwner(request);
    const root=db.collection('attendanceDeviceSync').doc(request.auth.uid),data=request.data;
    if(data.action==='bootstrap'){const state=await bootstrap(root,db.collection('attendanceDeviceCopies').doc(request.auth.uid));return {ready:state.ready,seq:state.seq};}
    const state=await root.get();if(!state.data()?.ready)fail('failed-precondition','Prepare synchronization first.');
    if(data.action==='pull'){
      if(!Number.isSafeInteger(data.cursor)||data.cursor<0)fail('invalid-argument','Invalid cursor.');
      const rows=await root.collection('records').where('seq','>',data.cursor).orderBy('seq').limit(100).get();
      return {records:rows.docs.map(s=>decodeRecord(s.data())),cursor:rows.empty?data.cursor:rows.docs.at(-1).data().seq,more:rows.size===100};
    }
    if(data.action==='push'){
      if(!Array.isArray(data.operations)||data.operations.length>20)fail('invalid-argument','Invalid operation batch.');
      data.operations.forEach(validateOperation);
      const results=[];for(const operation of data.operations)results.push(await apply(root,operation));return {results};
    }
    fail('invalid-argument','Unknown action.');
  }
  return {deviceLiveSync:onCall({region:'us-central1',invoker:'public',timeoutSeconds:120,memory:'512MiB'},handler)};
};
