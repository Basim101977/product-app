'use strict';
const crypto = require('node:crypto');

// Versioned closed-lecture copies. These never write the legacy live workspace,
// account roles, approval records or server-managed attendance summaries.
module.exports = ({db,onCall,HttpsError,authorisedWorkspaceOwner}) => {
  const fail=(code,message)=>{throw new HttpsError(code,message);};
  const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(value);
  const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
  function validateCopy(json,uid) {
    let payload;try{payload=JSON.parse(json);}catch{fail('invalid-argument','Invalid workspace copy.');}
    if(payload?.schema!==1||payload.uid!==uid||payload.data?.workspace?.id!==uid||!payload.data.subjects||Array.isArray(payload.data.subjects))fail('invalid-argument','Workspace identity mismatch.');
    for(const [id,subject] of Object.entries(payload.data.subjects)) {
      if(subject.id!==id||!Array.isArray(subject.students)||!Array.isArray(subject.lectures))fail('invalid-argument','Invalid subject.');
      const allowed=new Set(Object.entries(subject.lectureMeta||{}).filter(([,meta])=>['completed','cancelled','voided'].includes(meta?.status)).map(([date])=>date));
      if(Object.keys(subject.lectureMeta||{}).some(date=>!allowed.has(date))||subject.lectures.some(date=>!allowed.has(date))||['attendance','excuses'].some(field=>Object.keys(subject[field]||{}).some(date=>!allowed.has(date))))fail('failed-precondition','Only closed lectures may be uploaded.');
    }
    const clean=JSON.parse(JSON.stringify(payload.data));if(require('./device-sync-model').purgeRetiredCivil(clean))fail('failed-precondition','تم إلغاء قسم التقنيات المدنية القديم. حدّث حاضر لإكمال المزامنة.');
    return payload;
  }
  async function handler(request) {
    if(!request.auth)fail('unauthenticated','Sign in first.');
    if(request.data?.workspaceId!==request.auth.uid)fail('permission-denied','Only your own workspace is supported.');
    await authorisedWorkspaceOwner(request);
    const uid=request.auth.uid,{action,revision,index,count,text,base}=request.data;
    const root=db.collection('attendanceDeviceCopies').doc(uid);
    if(action==='head') {const snap=await root.get();return snap.exists?{revision:snap.data().revision,count:snap.data().count}:{revision:null,count:0};}
    if(!validId(revision))fail('invalid-argument','Invalid revision.');
    const version=root.collection('versions').doc(revision);
    if(action==='read') {
      const manifest=await version.get();
      if(!manifest.exists||!manifest.data().committed)fail('not-found','Copy not committed.');
      if(!Number.isInteger(index)||index<0||index>=manifest.data().count)fail('invalid-argument','Invalid chunk index.');
      const chunk=await version.collection('chunks').doc(String(index)).get();
      if(!chunk.exists)fail('data-loss','Copy chunk missing.');return {text:chunk.data().text};
    }
    if(!Number.isInteger(count)||count<1||count>512)fail('invalid-argument','Invalid chunk count.');
    if(action==='write') {
      if(!Number.isInteger(index)||index<0||index>=count||typeof text!=='string'||text.length>100000||Buffer.byteLength(text,'utf8')>400000)fail('invalid-argument','Invalid chunk.');
      const ref=version.collection('chunks').doc(String(index));
      await db.runTransaction(async tx=>{
        const [manifest,existing]=await Promise.all([tx.get(version),tx.get(ref)]);
        if(existing.exists){if(existing.data().hash!==hash(text)||existing.data().count!==count)fail('already-exists','Immutable chunk differs.');return;}
        if(manifest.exists&&manifest.data().committed)fail('failed-precondition','Copy already committed.');
        tx.create(ref,{text,count,hash:hash(text),createdAtMillis:Date.now()});
      });return {stored:true};
    }
    if(action!=='commit')fail('invalid-argument','Unknown action.');
    if(request.data.protocol!==2&&(await db.collection('attendanceDeviceSync').doc(uid).get()).data()?.ready)fail('failed-precondition','حدّث البرنامج لاستكمال المزامنة الجديدة. بياناتك المحلية محفوظة.');
    if(base!==null&&!validId(base))fail('invalid-argument','Invalid base revision.');
    const chunks=await Promise.all(Array.from({length:count},(_,i)=>version.collection('chunks').doc(String(i)).get()));
    if(chunks.some(chunk=>!chunk.exists||chunk.data().count!==count))fail('failed-precondition','Incomplete copy.');
    const json=chunks.map(chunk=>chunk.data().text).join('');validateCopy(json,uid);
    await db.runTransaction(async tx=>{
      const [head,manifest,live]=await Promise.all([tx.get(root),tx.get(version),tx.get(db.collection('attendanceDeviceSync').doc(uid))]);
      if(live.exists&&request.data.protocol!==2)fail('failed-precondition','حدّث البرنامج لاستكمال المزامنة الجديدة. بياناتك المحلية محفوظة.');
      // Lost acknowledgements remain idempotent even if another device later
      // advanced the head: retrying never restores this older revision.
      if(manifest.exists&&manifest.data().committed) {
        if(manifest.data().hash!==hash(json)||manifest.data().base!==base)fail('already-exists','Committed copy differs.');return;
      }
      if((head.exists?head.data().revision:null)!==base)fail('aborted','A newer cloud copy exists. Local work has been retained.');
      tx.set(version,{committed:true,count,hash:hash(json),base,createdAtMillis:Date.now()});
      tx.set(root,{revision,count,updatedAtMillis:Date.now()});
    });return {revision};
  }
  return {closedLectureWorkspace:onCall({region:'us-central1',invoker:'public',timeoutSeconds:120,memory:'512MiB'},handler),validateCopy};
};
