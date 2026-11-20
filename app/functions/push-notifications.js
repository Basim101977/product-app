'use strict';
const {createHash}=require('crypto');
const webpush=require('web-push');
const OWNER=process.env.HATHIR_OWNER_UID || 'HATHIR_OWNER_UID_REQUIRED';
const hash=s=>createHash('sha256').update(s).digest('hex');
function validSubscription(s){
  if(!s||typeof s.endpoint!=='string'||s.endpoint.length>4096)return false;
  try{const u=new URL(s.endpoint);if(u.protocol!=='https:'||u.username||u.password||u.port)return false;
    if(!(u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname.endsWith('.push.services.mozilla.com')||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com')))return false;
    const key=s.keys?.p256dh,auth=s.keys?.auth;
    return typeof key==='string'&&typeof auth==='string'&&/^[A-Za-z0-9_-]+={0,2}$/.test(key)&&/^[A-Za-z0-9_-]+={0,2}$/.test(auth)&&Buffer.from(key,'base64url').length===65&&Buffer.from(auth,'base64url').length===16;
  }catch{return false;}
}
function createService({db,auth,approvedIdentity,HttpsError,FieldValue,transport=webpush}){
  const devices=db.collection('attendancePushDevices'),config=db.collection('attendanceServerConfig').doc('webPush');
  async function keys(){return db.runTransaction(async tx=>{const snap=await tx.get(config);if(snap.exists)return snap.data();const pair=transport.generateVAPIDKeys();tx.create(config,{...pair,createdAt:FieldValue.serverTimestamp()});return pair;});}
  async function manage(request){
    const {user}=await approvedIdentity(request),d=request.data||{};
    if(d.action==='config'){const pair=await keys();return {publicKey:pair.publicKey};}
    if(d.action==='remove'){
      if(typeof d.id!=='string'||!/^[a-f0-9]{64}$/.test(d.id))throw new HttpsError('invalid-argument','Invalid device');
      const ref=devices.doc(d.id);await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists&&snap.data().uid===user.uid)tx.delete(ref);});return {enabled:false};
    }
    if(d.action==='status'){
      if(typeof d.id!=='string'||!/^[a-f0-9]{64}$/.test(d.id))return {enabled:false};
      const snap=await devices.doc(d.id).get();return {enabled:snap.exists&&snap.data().uid===user.uid};
    }
    if(d.action!=='subscribe'||!validSubscription(d.subscription))throw new HttpsError('invalid-argument','Invalid push subscription');
    const id=hash(d.subscription.endpoint),pair=await keys();
    if(d.publicKey!==pair.publicKey)throw new HttpsError('failed-precondition','Refresh notification settings');
    await db.runTransaction(async tx=>{
      const rows=await tx.get(devices.where('uid','==',user.uid));
      if(rows.size>=10&&!rows.docs.some(x=>x.id===id))throw new HttpsError('resource-exhausted','Notification device limit reached');
      tx.set(devices.doc(id),{uid:user.uid,subscription:{endpoint:d.subscription.endpoint,keys:d.subscription.keys},updatedAt:FieldValue.serverTimestamp()});
    });
    return {enabled:true,id};
  }
  async function deliver(uid,kind,eventId,messageId){
    // Recheck account approval at delivery; registration/share writes never await push.
    let user;try{user=await auth.getUser(uid);await approvedIdentity({auth:{uid,token:{email:user.email,email_verified:user.emailVerified}}});}catch{return;}
    const rows=await devices.where('uid','==',uid).limit(10).get();if(rows.empty)return;
    const pair=await keys();
    const payload=JSON.stringify({uid,kind,...(kind==='announcement'&&typeof messageId==='string'?{messageId}:{}),tag:'hathir-'+hash(eventId).slice(0,32),title:'حاضر',body:kind==='announcement'?'وصل إعلان جديد من إدارة حاضر.':kind==='support'?'وصلت رسالة جديدة في محادثة الدعم.':kind==='registration'?'وصل طلب تسجيل جديد للمراجعة.':'وصلت مشاركة جديدة إلى حسابك.'});
    await Promise.all(rows.docs.map(async doc=>{
      for(let attempt=0;attempt<3;attempt++){
        try{await transport.sendNotification(doc.data().subscription,payload,{TTL:3600,timeout:10000,urgency:'normal',vapidDetails:{subject:'mailto:redacted@example.invalid',publicKey:pair.publicKey,privateKey:pair.privateKey}});return;}
        catch(e){if(e.statusCode===404||e.statusCode===410){await doc.ref.delete();return;}if(attempt===2)throw new Error('Push delivery temporarily unavailable');await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}
      }
    }));
  }
  return {manage,deliver};
}
module.exports=({db,auth,approvedIdentity,HttpsError,FieldValue,onCall})=>{
  const {onDocumentCreated}=require('firebase-functions/v2/firestore');
  const service=createService({db,auth,approvedIdentity,HttpsError,FieldValue});
  return {
    deviceNotifications:onCall({region:'us-central1',invoker:'public',timeoutSeconds:60},service.manage),
    notifySupportChat:onDocumentCreated({document:'attendanceSupportThreads/{uid}/messages/{messageId}',region:'us-central1'},event=>{const d=event.data?.data();return d?.recipientUid?service.deliver(d.recipientUid,d.announcementId?'announcement':'support',event.id,event.params.messageId):null;}),
    notifyRegistration:onDocumentCreated({document:'attendanceIndividualRequests/{uid}',region:'us-central1'},event=>event.data?.data()?.status==='pending'?service.deliver(OWNER,'registration',event.id):null),
    notifyPrivateShare:onDocumentCreated({document:'attendancePrivateShares/{id}',region:'us-central1'},event=>{const d=event.data?.data();return d?.status==='pending'&&d.recipientUid?service.deliver(d.recipientUid,'share',event.id):null;})
  };
};
module.exports.validSubscription=validSubscription;
module.exports.createService=createService;
