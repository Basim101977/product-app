'use strict';
const {launch,makeReport,check,saveReport,assert}=require('./offline-harness.cjs');
const report=makeReport('name-roster-without-year'),uid='qa_personal_a',base='attendanceWorkspaces/'+uid;
const cohort='cohort_names_medical_devices__stage_2';
const fixture={uid,rememberedUser:true,verified:true,
 responses:{getPersonalAccountStatus:{status:'approved',emailVerified:true},openIndividualWorkspace:{workspaceId:uid}},
 records:{['attendanceUserWorkspaces/'+uid]:{workspaceId:uid,active:true},
 [base+'/departments/medical_devices']:{id:'medical_devices',nameAr:'الأجهزة الطبية',codePrefix:'MI',active:true},
 [base+'/stages/stage_2']:{id:'stage_2',nameAr:'الثانية',departmentId:'medical_devices',sort:2,active:true},
 [base+'/subjects/names_course']:{id:'names_course',titleAr:'مادة بالأسماء',departmentId:'medical_devices',stageId:'stage_2',ownerUserId:uid,rosterNaming:'name',totalHours:60,lectureDurationHours:2},
 [base+'/cohorts/'+cohort]:{rosterVersion:1,studentCount:2},
 [base+'/cohorts/'+cohort+'/students/أحمدعلي']:{id:'أحمدعلي',name:'أحمد علي'},
 [base+'/cohorts/'+cohort+'/students/أحمدعلي2']:{id:'أحمدعلي2',name:'أحمد علي 2'}}};
(async()=>{const h=await launch(report, {legacyCloud:true});try{
 await check(report,'Actual cloud-load mapping retains the name cohort across reload without year fields',async()=>{
  const {page,context}=await h.page({fixture});try{
   for(let i=0;i<2;i++){
    if(i)await page.reload();
    await page.waitForFunction(()=>typeof subjects!=='undefined'&&subjects.some(s=>s.id==='names_course'));
    const state=await page.evaluate(async()=>{const s=subjects.find(s=>s.id==='names_course');await ensureSubjectRosterLoaded(s);return {mode:s.rosterNaming,cohort:cohortIdForSubject(s),year:s.academicYearStart,names:s.students.map(s=>s.name).sort(),fields:document.querySelectorAll('#personalAcademicYear,#legacyImportScopeFields').length};});
    assert.deepEqual(state,{mode:'name',cohort,year:undefined,names:['أحمد علي','أحمد علي 2'],fields:0});
   }
  }finally{await context.close();}
 });
 await check(report,'Add from roster submits only names and auto-number policy without a legacy year prompt',async()=>{
  const {page,context}=await h.page({fixture});try{
   await page.waitForFunction(()=>typeof subjects!=='undefined'&&!cloudDataLoading&&attendanceInputReady()&&subjects.some(s=>s.id==='names_course'&&s.rosterLoaded));
   const result=await page.evaluate(async()=>{
    const s=getSubject();s.rosterCohortId=cohortIdForSubject(s);delete s.rosterNaming;
    const before=s.students.map(x=>({...x}));let request;
    const original=fixtureInvoke;fixtureInvoke=async(name,data)=>{if(name!=='importPersonalStudents')return original(name,data);request=data;throw Error('Synthetic stop after capturing request');};
    let prompts=0;window.confirm=()=>{prompts++;return false;};
    try{await importStudentText('سارة علي\nسارة علي');}catch{}
    return {request,prompts,before,after:s.students,year:s.academicYearStart};
   });
   assert.equal(result.prompts,0);assert.equal(result.year,undefined);assert.equal(result.request.nameOnly,true);
   assert.deepEqual(result.request.names,['سارة علي','سارة علي']);assert.deepEqual(result.before,result.after);
   assert(!Object.hasOwn(result.request,'academicYearStart'));
  }finally{await context.close();}
 });
}finally{await h.close();saveReport(report,'name-roster-regression');}})().catch(e=>{console.error(e);process.exitCode=1;});
