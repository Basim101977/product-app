"use strict";

// Course-only reset. Shared cohort documents are NEVER deleted or modified.
// A complete server-only backup is committed before the first live deletion.
module.exports = function({db, onCall, HttpsError, FieldValue, Timestamp, authorisedSubject, authorisedWorkspaceOwner, cohortIdForSubject}) {
  const options={region:"us-central1",invoker:"public",timeoutSeconds:540,memory:"1GiB"};
  const hash=value=>require("crypto").createHash("sha256").update(value).digest("hex");
  const stamp=()=>Timestamp.now();
  async function batches(items, apply) {
    for(let i=0;i<items.length;i+=300){const batch=db.batch();items.slice(i,i+300).forEach(item=>apply(batch,item));await batch.commit();}
  }
  async function subjectRecords(ref) {
    const out=[];
    for(const name of ["students","faceTemplates","attendanceSummaries","lectures"]){
      const snap=await ref.collection(name).get();
      for(const doc of snap.docs){
        out.push({path:`${name}/${doc.id}`,record:doc.data()});
        if(name==="lectures")for(const child of ["marks","excuses","scanEvents"]){
          const children=await doc.ref.collection(child).get();
          children.docs.forEach(d=>out.push({path:`lectures/${doc.id}/${child}/${d.id}`,record:d.data()}));
        }
      }
    }
    return out;
  }
  function cleanSubject(data) {
    const result={...data};
    for(const key of ["students","archivedStudents","academicStatuses","lectures","lectureMeta","attendance","excuses","policySnapshot","policyVersion","summarySchemaVersion","summaryCalculationModel","summaryGeneration","summaryState","summaryReferenceMinutes","summaryLiveReferenceMinutes","summarySourceFingerprint","summaryReviewCutoffMillis","summaryReviewCutoffAt","summaryNextReviewAt","summaryReviewPending","summaryEligibleLectureCount","summaryBuildStartedAt","lastSummaryRebuildAt","attendanceClearInProgress","attendanceClearStartedAt","attendanceClearStartedBy","rosterOperationId"])delete result[key];
    return result;
  }
  const clearSubjectRoster=onCall(options,async request=>{
    const context=await authorisedSubject(request,"studentsManage",{edit:true});
    await authorisedWorkspaceOwner(request);
    if(request.data?.confirmation!=="CLEAR_SUBJECT_ROSTER")throw new HttpsError("invalid-argument","Explicit confirmation required.");
    const workspace=db.collection("attendanceWorkspaces").doc(context.workspaceId);
    const backup=workspace.collection("subjectRosterBackups").doc();
    const cohortId="private_"+hash(context.subjectId+":"+backup.id).slice(0,40);
    const cohort=workspace.collection("cohorts").doc(cohortId);
    let ready=false;
    const original=await db.runTransaction(async tx=>{
      const snap=await tx.get(context.subjectRef);
      if(!snap.exists)throw new HttpsError("not-found","Subject not found.");
      const data=snap.data();
      if(data.rosterOperationId || data.attendanceClearInProgress)throw new HttpsError("failed-precondition","توجد عملية مسح أو استعادة جارية لهذه المادة.");
      tx.update(context.subjectRef,{rosterOperationId:backup.id,updatedAt:stamp()});
      return data;
    });
    try {
      const source=workspace.collection("cohorts").doc(cohortIdForSubject(original));
      const sourceMeta=await source.get();
      const records=await subjectRecords(context.subjectRef);
      const central=await Promise.all([source.collection("students").get(),source.collection("faceTemplates").get()]);
      let students,faces;
      if(original.rosterCohortId || original.lastRosterResetId || Number(sourceMeta.data()?.rosterVersion)>=1 || central[0].docs.length){
        [students,faces]=central.map(s=>s.docs.map(d=>({id:d.id,record:d.data()})));
      }else{
        students=records.filter(r=>/^students\/[^/]+$/.test(r.path)).map(r=>({id:r.path.split("/")[1],record:r.record}));
        if(!students.length)students=(original.students || []).map(s=>({id:String(s.id),record:s}));
        faces=records.filter(r=>/^faceTemplates\/[^/]+$/.test(r.path)).map(r=>({id:r.path.split("/")[1],record:r.record}));
      }
      const saved=[...records.map(r=>({...r,kind:"subject"})),...students.map(r=>({kind:"cohort",path:`students/${r.id}`,record:r.record})),...faces.map(r=>({kind:"cohort",path:`faceTemplates/${r.id}`,record:r.record}))];
      await backup.set({subjectId:context.subjectId,subject:original,cohortId,label:original.titleAr || original.titleEn || context.subjectId,studentCount:students.length,createdAt:stamp(),status:"preparing",actor:request.auth.uid});
      await batches(saved,(b,r)=>b.set(backup.collection("records").doc(hash(r.kind+":"+r.path)),r));
      await backup.update({status:"clearing",ready:true});ready=true;
      const legacyImportScope=original.legacyImportConfigured===true ? {academicYearStart:original.academicYearStart,stageNumber:original.stageNumber,
        departmentPrefix:original.departmentPrefix,entryYear:original.academicYearStart-original.stageNumber+1} : null;
      await cohort.set({id:cohortId,departmentId:original.departmentId || "",stageId:original.stageId || "",rosterVersion:1,studentCount:0,rosterOperationId:backup.id,
        ...(legacyImportScope?{legacyImportScope}:{})});
      await batches(records,(b,r)=>b.delete(db.doc(context.subjectRef.path+"/"+r.path)));
      const final=db.batch();
      final.set(context.subjectRef,{...cleanSubject(original),rosterCohortId:cohortId,studentCount:0,attendanceLocked:false,lastRosterResetId:backup.id,updatedAt:stamp()});
      final.update(cohort,{rosterOperationId:FieldValue.delete(),updatedAt:stamp()});
      final.update(backup,{status:"cleared",finishedAt:stamp()});await final.commit();
      return {backupId:backup.id,studentCount:students.length};
    }catch(error){
      if(ready)await backup.update({status:"failed",failedAt:stamp()}).catch(()=>{});
      else await context.subjectRef.update({rosterOperationId:FieldValue.delete()}).catch(()=>{});
      throw new HttpsError("internal",ready?"لم يكتمل المسح. النسخة محفوظة؛ افتح الاستعادة لاسترجاع المادة قبل استخدامها.":"تعذر إنشاء نسخة الاستعادة؛ لم يبدأ حذف البيانات.");
    }
  });
  const listSubjectRosterBackups=onCall(options,async request=>{
    const {workspaceRef}=await authorisedWorkspaceOwner(request);
    const snap=await workspaceRef.collection("subjectRosterBackups").orderBy("createdAt","desc").limit(100).get();
    return {records:snap.docs.filter(d=>d.data().ready && d.data().status!=="restored").map(d=>({id:d.id,label:d.data().label,studentCount:d.data().studentCount,status:d.data().status,createdAt:d.data().createdAt.toMillis()}))};
  });
  const restoreSubjectRoster=onCall(options,async request=>{
    const {workspaceRef}=await authorisedWorkspaceOwner(request);
    const id=String(request.data?.backupId || "");
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||request.data?.confirmation!=="RESTORE_SUBJECT_ROSTER")throw new HttpsError("invalid-argument","Confirmation required.");
    const backup=workspaceRef.collection("subjectRosterBackups").doc(id);
    const data=await db.runTransaction(async tx=>{
      const b=await tx.get(backup);if(!b.exists || !b.data().ready)throw new HttpsError("not-found","Backup unavailable.");
      const value=b.data();
      const operationTime=value.restoreStartedAt || value.createdAt;
      if(["clearing","restoring"].includes(value.status) && Date.now()-operationTime.toMillis()>600000)value.status="failed";
      if(!["cleared","failed"].includes(value.status))throw new HttpsError("failed-precondition","النسخة مستعادة أو توجد عملية جارية.");
      const subject=workspaceRef.collection("subjects").doc(value.subjectId),cohort=workspaceRef.collection("cohorts").doc(value.cohortId);
      const current=await tx.get(subject);
      if(!current.exists)throw new HttpsError("not-found","استعد المادة المحذوفة أولًا.");
      const s=current.data();
      if(s.rosterOperationId && s.rosterOperationId!==id)throw new HttpsError("failed-precondition","Another operation is running.");
      if(value.status==="cleared"){
        const students=await tx.get(cohort.collection("students").limit(1)),lectures=await tx.get(subject.collection("lectures").limit(1));
        if(s.lastRosterResetId!==id || !students.empty || !lectures.empty || (s.students || []).length || (s.lectures || []).length)throw new HttpsError("failed-precondition","لن تُستبدل بيانات جديدة. الاستعادة الكاملة متاحة ما دامت المادة فارغة بعد هذا المسح.");
      }else if(s.rosterOperationId!==id)throw new HttpsError("failed-precondition","The subject has changed.");
      tx.update(subject,{rosterOperationId:id});
      tx.set(cohort,{id:value.cohortId,departmentId:value.subject.departmentId || "",stageId:value.subject.stageId || "",rosterVersion:1,rosterOperationId:id},{merge:true});
      tx.update(backup,{status:"restoring",restoreStartedAt:stamp()});return value;
    });
    const subject=workspaceRef.collection("subjects").doc(data.subjectId),cohort=workspaceRef.collection("cohorts").doc(data.cohortId);
    try{
      const snap=await backup.collection("records").get();
      await batches(snap.docs,(b,d)=>{const r=d.data();
        if(!/^(students|faceTemplates|attendanceSummaries|lectures)\/[^/]+(\/(marks|excuses|scanEvents)\/[^/]+)?$/.test(r.path) || !["subject","cohort"].includes(r.kind))throw new Error("Invalid snapshot path");
        b.set(db.doc((r.kind==="cohort"?cohort.path:subject.path)+"/"+r.path),r.record);
      });
      const final=db.batch();
      const restored={...data.subject,rosterCohortId:data.cohortId,studentCount:data.studentCount,summaryState:"pending",updatedAt:stamp()};delete restored.rosterOperationId;
      final.set(subject,restored);final.update(cohort,{rosterOperationId:FieldValue.delete(),studentCount:data.studentCount,updatedAt:stamp()});
      final.update(backup,{status:"restored",restoredAt:stamp()});await final.commit();
      return {restored:true,subjectId:data.subjectId};
    }catch(error){await backup.update({status:"failed"}).catch(()=>{});throw new HttpsError("internal","لم تكتمل الاستعادة؛ أعد المحاولة. النسخة الأصلية محفوظة.");}
  });
  return {clearSubjectRoster,listSubjectRosterBackups,restoreSubjectRoster};
};
