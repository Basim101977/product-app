"use strict";
const OWNER=process.env.HATHIR_OWNER_UID || 'HATHIR_OWNER_UID_REQUIRED';
module.exports=({db,approvedIdentity,fail,now=Date.now})=>{
 const announcements=db.collection('attendanceSupportBroadcasts'),jobs=db.collection('attendanceSupportBroadcastJobs');
 async function manage(request){
  const {user}=await approvedIdentity(request);if(user.uid!==OWNER)fail('permission-denied','الإعلان للجميع متاح للمالك فقط.');
  const d=request.data||{};
  if(d.action==='list'){const rows=await announcements.orderBy('createdAt','desc').limit(5).get();return {announcements:rows.docs.map(x=>({id:x.id,...x.data()}))};}
  const text=typeof d.text==='string'?d.text.trim():'';
  if(d.action!=='send'||!text||text.length>2000||typeof d.id!=='string'||!/^[a-f0-9-]{36}$/.test(d.id))fail('invalid-argument','اكتب إعلانًا لا يتجاوز 2000 حرف.');
  const ref=announcements.doc(d.id),gate=db.collection('attendanceServerConfig').doc('supportBroadcast');
  return db.runTransaction(async tx=>{const [old,limit]=await Promise.all([tx.get(ref),tx.get(gate)]);if(old.exists){if(old.data().text!==text)fail('already-exists','هذا المعرف مرتبط بإعلان مختلف.');return {id:d.id};}if(now()-(limit.data()?.lastSent||0)<60000)fail('resource-exhausted','انتظر دقيقة قبل إرسال إعلان آخر.');tx.create(ref,{text,createdAt:now(),senderUid:OWNER,status:'queued',delivered:0});tx.create(jobs.doc(d.id+'-0'),{announcementId:d.id,page:0,cursor:null,done:false});tx.set(gate,{lastSent:now()});return {id:d.id};});
 }
 async function process(jobId){
  const jobRef=jobs.doc(jobId),job=(await jobRef.get()).data();if(!job||job.done)return;
  const announcementRef=announcements.doc(job.announcementId),announcement=(await announcementRef.get()).data();if(!announcement)return;
  let q=db.collection('attendanceIndividualRequests').orderBy('__name__').limit(25);if(job.cursor)q=q.startAfter(job.cursor);const rows=await q.get();let delivered=0;
  for(const row of rows.docs){if(row.id===OWNER)continue;
   const thread=db.collection('attendanceSupportThreads').doc(row.id),message=thread.collection('messages').doc('announcement-'+job.announcementId),signal=db.collection('attendanceSupportSignals').doc(row.id);
   const sent=await db.runTransaction(async tx=>{const [old,approval,t,s]=await Promise.all([tx.get(message),tx.get(row.ref),tx.get(thread),tx.get(signal)]);if(old.exists)return true;const a=approval.data();if(a?.status!=='approved')return false;
    const data=t.data()||{uid:row.id,name:a.fullName||'تدريسي',email:a.email||'',lastSeq:0,ownerReceived:0,userReceived:0,ownerSeen:0,userSeen:0};
    tx.create(message,{seq:data.lastSeq+1,senderUid:OWNER,recipientUid:row.id,text:announcement.text,hasImage:false,createdAt:now(),announcementId:job.announcementId});
    tx.set(thread,{...data,lastSeq:data.lastSeq+1,latestOwnerMessageRead:false,userReceived:(data.userReceived||0)+1,status:data.status||'open',updatedAt:now()});tx.set(signal,{unread:(s.data()?.unread||0)+1,revision:now()});return true;});if(sent)delivered++;
  }
  await db.runTransaction(async tx=>{const [j,a]=await Promise.all([tx.get(jobRef),tx.get(announcementRef)]);if(j.data()?.done)return;const more=rows.size===25;tx.update(jobRef,{done:true});tx.update(announcementRef,{delivered:(a.data().delivered||0)+delivered,status:more?'sending':'complete',updatedAt:now()});if(more)tx.create(jobs.doc(job.announcementId+'-'+(job.page+1)),{announcementId:job.announcementId,page:job.page+1,cursor:rows.docs.at(-1).id,done:false});});
 }
 return {manage,process};
};
