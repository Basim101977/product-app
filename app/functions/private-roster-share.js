'use strict';
const {createHash,randomUUID}=require('crypto'),{gzipSync,gunzipSync}=require('node:zlib'),model=require('./private-share-model');
const hash=x=>createHash('sha256').update(x).digest('hex');
module.exports=({db,auth,approvedIdentity,fail,now=Date.now})=>async request=>{
 const {user,approval}=await approvedIdentity(request),uid=user.uid,d=request.data||{};
 const invites=db.collection('attendancePrivateShares'),box=id=>db.collection('attendancePrivateShareMailboxes').doc(id).collection('entries');
 const signal=(tx,id)=>tx.set(db.collection('attendancePrivateShareSignals').doc(id),{nonce:randomUUID(),changedAt:now()});
 async function recipient(email){
  let target;try{target=await auth.getUserByEmail(String(email||'').trim().toLowerCase());const identity=await approvedIdentity({auth:{uid:target.uid,token:{email:target.email,email_verified:target.emailVerified}}});target={...target,displayName:identity.approval?.fullName||target.displayName};}catch{fail('failed-precondition','المستلم يجب أن يكون حساباً مسجلاً ومعتمداً في حاضر.');}
  if(target.uid===uid)fail('invalid-argument','اختر حساب تدريسي آخر.');return target;
 }
 if(d.action==='lookup'){const t=await recipient(d.email);return {uid:t.uid,email:t.email,name:t.displayName||t.email};}
 if(d.action==='list'){
  if(d.activeOnly===true){const rows=await box(uid).where('status','in',['pending','accepted']).get();return {entries:rows.docs.map(x=>({id:x.id,...x.data(),expired:x.data().expiresAt<now()})).filter(x=>!x.expired).sort((a,b)=>b.createdAt-a.createdAt)};}
  const rows=await box(uid).orderBy('createdAt','desc').limit(100).get();return {entries:rows.docs.map(x=>({id:x.id,...x.data(),expired:x.data().expiresAt<now()}))};
 }
 if(d.action==='history'){
  let query=box(uid).orderBy('createdAt','desc');
  if(d.cursor){if(typeof d.cursor!=='string'||!/^[a-f0-9-]{36}$/.test(d.cursor))fail('invalid-argument','صفحة غير صالحة.');const cursor=await box(uid).doc(d.cursor).get();if(!cursor.exists)fail('not-found','أعد فتح السجل.');query=query.startAfter(cursor);}
  const rows=await query.limit(20).get(),entries=rows.docs.map(x=>({id:x.id,...x.data(),expired:x.data().expiresAt<now()}));
  return {entries:entries.filter(x=>x.expired||!['pending','accepted'].includes(x.status)),nextCursor:rows.docs.length===20?rows.docs.at(-1).id:null};
 }
 if(typeof d.id!=='string'||!/^[a-f0-9-]{36}$/.test(d.id))fail('invalid-argument','معرّف المشاركة غير صالح.');
 const ref=invites.doc(d.id);
 if(d.action==='send'){
  if(d.authorized!==true)fail('failed-precondition','أكد صلاحيتك لمشاركة البيانات مع المستلم.');
  const target=await recipient(d.email);if(target.uid!==d.recipientUid)fail('failed-precondition','تغير حساب المستلم. أعد معاينة بريده.');
  let snapshot;try{let raw=d.snapshot;if(d.snapshotGzip!==undefined){if(raw!==undefined||typeof d.snapshotGzip!=='string'||d.snapshotGzip.length>8000000||! /^[A-Za-z0-9+/]+={0,2}$/.test(d.snapshotGzip))throw Error('المشاركة المضغوطة غير صالحة.');raw=JSON.parse(gunzipSync(Buffer.from(d.snapshotGzip,'base64'),{maxOutputLength:16000000}).toString('utf8'));}snapshot=model.normalize(raw);}catch(e){fail('invalid-argument',e.message);}
  const json=JSON.stringify(snapshot);if(Buffer.byteLength(json)>9500000)fail('resource-exhausted','حجم المشاركة كبير. جرّب مشاركة الأسماء والبصمات دون سجل الحضور.');
  const chunks=[];for(let i=0;i<json.length;){let end=Math.min(i+120000,json.length);const last=json.charCodeAt(end-1);if(end<json.length&&last>=0xD800&&last<=0xDBFF)end--;chunks.push(json.slice(i,end));i=end;}
  const digest=hash(json),summary=model.summary(snapshot),clock=now(),quota=db.collection('attendancePrivateShareQuotas').doc(uid);
  return db.runTransaction(async tx=>{
   const existing=await tx.get(ref),limit=await tx.get(quota);
   if(existing.exists){const e=existing.data();if(e.senderUid!==uid||e.recipientUid!==target.uid||e.digest!==digest)fail('already-exists','معرّف مشاركة مستخدم.');return {id:d.id,status:e.status};}
   const recent=clock-(limit.data()?.at||0)<3600000,count=recent?(limit.data()?.count||0):0;if(count>=20)fail('resource-exhausted','بلغت حد المشاركات لهذه الساعة. حاول لاحقاً.');
   const meta={senderUid:uid,recipientUid:target.uid,senderEmail:user.email,recipientEmail:target.email,senderName:approval?.fullName||user.displayName||user.email,recipientName:target.displayName||target.email,status:'pending',createdAt:clock,expiresAt:clock+14*86400000,summary,count:chunks.length,digest};
   tx.set(ref,meta);tx.set(box(uid).doc(d.id),{...meta,direction:'sent'});tx.set(box(target.uid).doc(d.id),{...meta,direction:'received'});
   chunks.forEach((text,i)=>tx.set(ref.collection('chunks').doc(String(i)),{text}));tx.set(quota,{at:recent?limit.data().at:clock,count:count+1});
   signal(tx,uid);signal(tx,target.uid);
   return {id:d.id,status:'pending'};
  });
 }
 if(!['preview','seen','accept','reject','cancel','ack'].includes(d.action))fail('invalid-argument','إجراء غير صالح.');
 let meta;
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);if(!snap.exists)fail('not-found','المشاركة غير موجودة.');meta=snap.data();
  const receives=meta.recipientUid===uid,sends=meta.senderUid===uid;
  if(!receives&&!sends)fail('permission-denied','هذه المشاركة ليست لحسابك.');
  if(d.action==='cancel'?!sends:!receives)fail('permission-denied','غير مسموح.');
  if(meta.expiresAt<now())fail('failed-precondition','انتهت صلاحية الدعوة. اطلب مشاركة جديدة.');
  if(d.action==='seen'){
   if(!['pending','accepted'].includes(meta.status))fail('failed-precondition','الدعوة مغلقة.');
   if(!meta.recipientSeenAt){meta={...meta,recipientSeenAt:now()};tx.set(ref,meta);tx.set(box(uid).doc(d.id),{...meta,direction:'received'});signal(tx,uid);}
   return;
  }
  if(d.action==='accept'&&meta.summary.students>300&&d.snapshotCompression!=='gzip')fail('failed-precondition','حدّث حاضر والمتصفح لاستلام قائمة تتجاوز 300 طالب.');
  if(d.action==='accept'&&!meta.summary.choices.attendance&&d.scopeRosterSupport!==true)fail('failed-precondition','حدّث حاضر لاستلام الأسماء والبصمات للقسم والمرحلة والدراسة بدلاً من إنشاء مادة.');
  if(d.action==='preview'){if(!['pending','accepted'].includes(meta.status))fail('failed-precondition','الدعوة مغلقة.');return;}
  const next={accept:'accepted',reject:'rejected',cancel:'cancelled',ack:'imported'}[d.action];
  if(meta.status===next)return;
  if(meta.status!==(d.action==='ack'?'accepted':'pending'))fail('failed-precondition','تمت معالجة الدعوة سابقاً.');
  if(d.action==='accept'&&d.confirmed!==true)fail('failed-precondition','راجع البيانات وأكد قبول النسخة المستقلة.');
  meta={...meta,status:next,decidedAt:now()};tx.set(ref,meta);tx.set(box(meta.senderUid).doc(d.id),{...meta,direction:'sent'});tx.set(box(meta.recipientUid).doc(d.id),{...meta,direction:'received'});
  signal(tx,meta.senderUid);signal(tx,meta.recipientUid);
  if(next!=='accepted')for(let i=0;i<meta.count;i++)tx.delete(ref.collection('chunks').doc(String(i)));
 });
 if(!['preview','accept'].includes(d.action))return {status:meta.status};
 // Preview exposes names only. Biometric templates/attendance are delivered after acceptance.
 const parts=await Promise.all(Array.from({length:meta.count},(_,i)=>ref.collection('chunks').doc(String(i)).get()));
 if(parts.some(p=>!p.exists))fail('failed-precondition','أُغلقت الدعوة.');
 const json=parts.map(p=>p.data().text).join('');if(hash(json)!==meta.digest)fail('data-loss','تعذر التحقق من سلامة المشاركة.');
 const snapshot=JSON.parse(json);
 // Recheck after reading to prevent a concurrent rejection exposing a cancelled payload.
 const final=(await ref.get()).data();if(!['pending','accepted'].includes(final?.status))fail('failed-precondition','أُغلقت الدعوة.');
 return d.action==='preview'?{...meta,names:snapshot.students.map(s=>({name:s.name,hasFace:!!s.faceDescriptors?.length})),status:final.status}:d.snapshotCompression==='gzip'?{id:d.id,status:'accepted',snapshotGzip:gzipSync(Buffer.from(json)).toString('base64')}:{id:d.id,status:'accepted',snapshot};
};
