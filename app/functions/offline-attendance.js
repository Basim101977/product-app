"use strict";
const { safeLectureId, calendarDate } = require("./lecture-session");
module.exports=({onCall,HttpsError,db,Timestamp,authorisedSubject,rosterForSubject})=>({
  syncOfflineAttendance:onCall({region:'us-central1',invoker:'public',timeoutSeconds:120,memory:'512MiB'},async request=>{
    const ctx=await authorisedSubject(request,'attendanceMark');
    const op=request.data.operation;
    if(!op || !/^[a-zA-Z0-9-]{16,80}$/.test(op.id||'') || !safeLectureId(op.date) || !['mark','close'].includes(op.kind))throw new HttpsError('invalid-argument','Invalid offline operation.');
    if(!Number.isFinite(op.createdAt)||op.createdAt>Date.now()+300000)throw new HttpsError('invalid-argument','Invalid device clock or lecture date.');
    if(op.uid!==request.auth.uid || op.subjectId!==ctx.subjectId || op.workspaceId!==ctx.workspaceId)throw new HttpsError('permission-denied','Account mismatch.');
    const meta=op.meta || {},duration=Number(meta.durationHours);
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(meta.startTime||'') || !Number.isFinite(duration)||duration<=0||duration>24)throw new HttpsError('invalid-argument','Invalid lecture.');
    const receipt=ctx.subjectRef.collection('offlineReceipts').doc(op.id);
    if((await receipt.get()).exists)return {accepted:true,replayed:true};
    const roster=await rosterForSubject(ctx.workspaceId,{...ctx.subject,id:ctx.subjectId});
    const student=op.kind==='mark'?roster.find(s=>s.id===op.studentId):null;
    if(op.kind==='mark'&&(!student || student.name!==op.studentName))throw new HttpsError('failed-precondition','Student list changed; attendance needs review.');
    const ref=ctx.subjectRef.collection('lectures').doc(op.date);
    const markRef=op.kind==='mark'?ref.collection('marks').doc(op.studentId):null;
    await db.runTransaction(async tx=>{
      const seen=await tx.get(receipt);if(seen.exists)return;
      const freshSubject=await tx.get(ctx.subjectRef),snap=await tx.get(ref),mark=markRef?await tx.get(markRef):null;
      if(!freshSubject.exists || freshSubject.data().rosterOperationId || (freshSubject.data().lastRosterResetId||'')!==(op.rosterResetId||''))throw new HttpsError('failed-precondition','Subject or roster changed; review required.');
      if(freshSubject.data().attendanceClearInProgress || Number(freshSubject.data().attendanceClearedAt?.toMillis?.()||0)>Number(op.preparedAt||0))throw new HttpsError('failed-precondition','Attendance was cleared after offline preparation; review required.');
      const lecture=snap.exists?snap.data():{};
      if(lecture.lifecycleRevision)throw new HttpsError('failed-precondition','Lecture state changed; update this client and review pending attendance.');
      if(['cancelled','voided'].includes(lecture.status))throw new HttpsError('failed-precondition','Lecture was cancelled.');
      if(snap.exists && lecture.startTime && lecture.startTime!==meta.startTime)throw new HttpsError('failed-precondition','Another device recorded a different lecture time.');
      if(snap.exists && Number(lecture.durationHours||duration)!==duration)throw new HttpsError('failed-precondition','Lecture duration changed.');
      if(op.kind==='mark') {
        // Keep a deleted mark deleted even if a much older offline client
        // reconnects through this original, single-operation endpoint.
        if(!mark.exists && Object.prototype.hasOwnProperty.call(lecture.markRevisions||{},op.studentId))throw new HttpsError('failed-precondition','Attendance was removed on another device; review required.');
        const record=op.record||{};
        if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(record.time||''))throw new HttpsError('invalid-argument','Invalid attendance time.');
        const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
        const elapsed=minutes(record.time)-minutes(meta.startTime);
        if(elapsed<0||elapsed>=duration*60)throw new HttpsError('failed-precondition','Attendance outside lecture duration.');
        if(mark.exists) {
          if(mark.data().time!==record.time)throw new HttpsError('already-exists','Attendance exists at another time; review required.');
        } else tx.create(markRef,{studentId:student.id,studentName:student.name,time:record.time,method:['qr','face','manual','scan','image','rfid','nfc'].includes(record.method)?record.method:'manual',attendedMinutes:Math.max(0,Math.round(duration*60-elapsed)),markedBy:request.auth.uid,markedAt:Timestamp.now(),offlineRecordedAt:op.createdAt,source:'offline-outbox-v1'});
      }
      const status=lecture.status==='completed'||op.kind==='close'?'completed':'active';
      tx.set(ref,{date:op.date,calendarDate:calendarDate(op.date),startTime:meta.startTime,durationHours:duration,status,updatedAt:Timestamp.now(),...(op.kind==='mark'?{markRevisions:{...lecture.markRevisions,[op.studentId]:op.id}}:{}),...(status==='completed'?{completedAt:lecture.completedAt||Timestamp.now(),summaryState:'rebuild-pending'}:{})},{merge:true});
      tx.create(receipt,{operationId:op.id,kind:op.kind,actor:request.auth.uid,acceptedAt:Timestamp.now()});
    });
    // Existing lecture triggers/scheduler maintain summaries. Receipts make retries idempotent.
    return {accepted:true};
  })
});
