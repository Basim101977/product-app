'use strict';
const {createHash}=require('crypto');
const OWNER=process.env.HATHIR_OWNER_UID || 'HATHIR_OWNER_UID_REQUIRED';
module.exports=({db,approvedIdentity,fail,now=Date.now})=>async request=>{
 const {user,approval}=await approvedIdentity(request),uid=user.uid,d=request.data||{},owner=uid===OWNER;
 const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
 const threads=db.collection('attendanceSupportThreads'),signals=db.collection('attendanceSupportSignals');
 if(d.action==='list'){
  if(!owner)fail('permission-denied','هذه القائمة للمالك فقط.');
  let q=threads.orderBy('updatedAt','desc').limit(25);
  if(d.cursor){if(!validId(d.cursor))fail('invalid-argument','مؤشر غير صالح.');const cursor=await threads.doc(d.cursor).get();if(!cursor.exists)fail('not-found','المحادثة غير موجودة.');q=q.startAfter(cursor);}
  const rows=await q.get();return {threads:rows.docs.map(x=>({id:x.id,...x.data()})),cursor:rows.docs.length===25?rows.docs.at(-1).id:null};
 }
 const id=owner?d.threadId:uid;
 if(!validId(id)||id===OWNER||(!owner&&d.threadId&&d.threadId!==uid))fail('permission-denied','هذه المحادثة غير متاحة.');
 const ref=threads.doc(id),messages=ref.collection('messages'),role=owner?'owner':'user';
 const mailbox=require('./support-mailbox')({db,now});
 if(['announcements','announcementSeen','supportSeen'].includes(d.action)){
  if(owner)fail('permission-denied','هذه قائمة إعلانات حساب التدريسي.');
  if(d.action==='announcements'){if(d.before!==undefined&&(!Number.isSafeInteger(d.before)||d.before<1))fail('invalid-argument','مؤشر غير صالح.');return mailbox.list(uid,d.before);}
  if(d.action==='announcementSeen'){if(!validId(d.messageId))fail('invalid-argument','معرف غير صالح.');const m=await messages.doc(d.messageId).get();if(!m.exists||!m.data().announcementId)fail('not-found','الإعلان غير موجود.');return mailbox.read(uid,{announcementId:d.messageId});}
  if(!Array.isArray(d.ids)||d.ids.length>30||!d.ids.every(validId))fail('invalid-argument','رسائل غير صالحة.');return mailbox.read(uid,{ids:d.ids});
 }

 if(d.action==='messages'){
  const meta=await ref.get();if(!meta.exists)return {thread:null,messages:[],before:null};
  let q=messages.orderBy('seq','desc').limit(30);
  if(d.before!==undefined){if(!Number.isSafeInteger(d.before)||d.before<1)fail('invalid-argument','مؤشر غير صالح.');q=q.startAfter(d.before);}
  const rows=await q.get();return {thread:{id,...meta.data()},messages:rows.docs.map(x=>({id:x.id,...x.data()})).reverse(),before:rows.docs.length===30?rows.docs.at(-1).data().seq:null};
 }
 if(d.action==='image'){
  if(!validId(d.messageId))fail('invalid-argument','الصورة غير صالحة.');
  const image=await ref.collection('images').doc(d.messageId).get();if(!image.exists)fail('not-found','الصورة غير موجودة.');return {image:image.data().image};
 }
 if(d.action==='seen'){
  if(!Number.isSafeInteger(d.received)||d.received<0)fail('invalid-argument','قيمة غير صالحة.');
  if(!owner)return mailbox.read(uid,{legacyReceived:d.received});
  await db.runTransaction(async tx=>{const [t,s]=await Promise.all([tx.get(ref),tx.get(signals.doc(uid))]);if(!t.exists)return;const data=t.data(),total=data[role+'Received']||0,seen=data[role+'Seen']||0,next=Math.max(seen,Math.min(total,d.received));if(next===seen)return;tx.set(ref,{...data,[role+'Seen']:next});tx.set(signals.doc(uid),{unread:Math.max(0,(s.data()?.unread||0)-(next-seen)),revision:now()});});return {ok:true};
 }
 if(d.action==='close'){
  if(!owner)fail('permission-denied','إنهاء الطلب للمالك فقط.');
  await db.runTransaction(async tx=>{const t=await tx.get(ref);if(!t.exists)fail('not-found','المحادثة غير موجودة.');tx.set(ref,{...t.data(),status:'closed',updatedAt:now()});});return {ok:true};
 }
 if(d.action!=='send')fail('invalid-argument','طلب غير صالح.');
 if(typeof d.messageId!=='string'||!/^[a-f0-9-]{36}$/.test(d.messageId))fail('invalid-argument','معرف الرسالة غير صالح.');
 const text=typeof d.text==='string'?d.text.trim():'';const image=d.image||'';
 if(text.length>2000||(!text&&!image)||typeof image!=='string')fail('invalid-argument','اكتب رسالة لا تتجاوز 2000 حرف أو أرفق صورة.');
 if(image){if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image)||image.length>300000)fail('invalid-argument','الصورة كبيرة أو غير مدعومة.');const bytes=Buffer.from(image.split(',')[1],'base64');if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)fail('invalid-argument','الصورة غير صالحة.');}
 const fingerprint=createHash('sha256').update(JSON.stringify([uid,text,image])).digest('hex'),recipient=owner?id:OWNER,msg=messages.doc(d.messageId);
 return db.runTransaction(async tx=>{
  const [existing,t,s]=await Promise.all([tx.get(msg),tx.get(ref),tx.get(signals.doc(recipient))]);
  if(existing.exists){if(existing.data().fingerprint!==fingerprint)fail('already-exists','الرسالة السابقة مختلفة.');return {ok:true,id:d.messageId};}
  if(owner&&!t.exists)fail('not-found','المحادثة غير موجودة.');
  const data=t.data()||{uid:id,name:approval?.fullName||user.displayName||user.email||'تدريسي',email:user.email||'',lastSeq:0,ownerReceived:0,userReceived:0,ownerSeen:0,userSeen:0};
  if(now()-(data[role+'LastSent']||0)<1000)fail('resource-exhausted','انتظر لحظة ثم أعد الإرسال.');
  const seq=data.lastSeq+1,receiverRole=owner?'user':'owner';
  tx.set(msg,{seq,senderUid:uid,recipientUid:recipient,text,hasImage:Boolean(image),createdAt:now(),fingerprint});
  if(image)tx.set(ref.collection('images').doc(d.messageId),{image});
  tx.set(ref,{...data,lastSeq:seq,...(owner?{latestOwnerMessageRead:false}:{}),status:'open',updatedAt:now(),[role+'LastSent']:now(),[receiverRole+'Received']:(data[receiverRole+'Received']||0)+1});
  tx.set(signals.doc(recipient),{unread:(s.data()?.unread||0)+1,revision:now()});
  return {ok:true,id:d.messageId};
 });
};
