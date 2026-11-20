const {assert,path,makeReport,check,saveReport,launch}=require('./offline-harness.cjs');
const report=makeReport('subject-tools-local');
async function menu(page){if(!await page.locator('#beginnerSubjectMenu').isVisible())await page.locator('#beginnerChooseSubject').click();}
async function setup(page){
 await page.waitForFunction(()=>window.HathirSubjectTools&&document.getElementById('subjectEditor'));
 await page.evaluate(()=>{
  fixtureAuth.currentUser=fixtureUser();session={uid:'subject_tools_teacher',workspaceId:'subject_tools_teacher',email:'teacher@example.test',displayName:'تدريسي تجريبي',role:'owner',active:true,local:true,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};
  departments=defaultDepartments();stages=defaultStages();compactScope={departmentId:'medical_devices',stageId:'medical_devices_stage_2',studyPeriod:'morning',section:''};
  const create=(id,title)=>({id,titleAr:title,titleEn:title,ownerUserId:session.uid,...compactScope,rosterNaming:'name',lectureDurationHours:2,totalHours:60,students:[{id:'student_one',name:'أحمد علي حسن'}],attendance:{'2026-10-01':{student_one:{time:'09:00',method:'manual'}}},lectureMeta:{'2026-10-01':{status:'completed',durationHours:2}},lectures:['2026-10-01'],excuses:{},archivedStudents:[],rosterLoaded:true});
  subjects=[create('circuits','دوائر إلكترونية'),create('computer','الحاسوب')];
  localData={workspace:{id:session.workspaceId},users:{},subjects:Object.fromEntries(subjects.map(s=>[s.id,s])),departments:Object.fromEntries(departments.map(d=>[d.id,d])),stages:Object.fromEntries(stages.map(s=>[s.id,s]))};activeSubjectId='circuits';showApp();HathirSubjectTools.render();
 });
}
(async()=>{const h=await launch(report);try{
 for(const width of [390,1280]) await check(report,'Create, edit and delete with preserved history at '+width,async()=>{
  const {page,context}=await h.page({width});try{
   await setup(page);await menu(page);await page.locator('#beginnerCreateSubject').click();await page.locator('#subjectName').fill('دوائر عملية');
   await page.locator('#subjectEditorSave').click();await page.waitForFunction(()=>!document.getElementById('subjectEditor').open);
   assert.equal(await page.evaluate(()=>getSubject().students.length),0);
   assert.equal(await page.evaluate(()=>getSubject().titleAr),'دوائر عملية');
   assert.equal(await page.evaluate(()=>localData.subjects.circuits.students.length),1);
   await menu(page);await page.locator('.subjectChoiceRow').filter({has:page.locator('button.active')}).locator('[data-subject-action=edit]').click();await page.locator('#subjectName').fill('دوائر عملية جديدة');await page.locator('#subjectHours').fill('70');await page.locator('#subjectEditorSave').click();await page.waitForFunction(()=>!document.getElementById('subjectEditor').open);
   assert.equal(await page.evaluate(()=>getSubject().totalHours),70);
   assert.equal(await page.evaluate(()=>localData.subjects.circuits.attendance['2026-10-01'].student_one.time),'09:00');
   page.once('dialog',d=>d.dismiss());await menu(page);await page.locator('.subjectChoiceRow').filter({has:page.locator('button.active')}).locator('[data-subject-action=delete]').click();assert.equal(await page.evaluate(()=>subjects.length),3);
   page.once('dialog',d=>d.accept());await menu(page);await page.locator('.subjectChoiceRow').filter({has:page.locator('button.active')}).locator('[data-subject-action=delete]').click();await page.waitForFunction(()=>subjects.length===2);
   await menu(page);await page.locator('#beginnerCreateSubject').click();
   assert(await page.locator('#subjectEditor').evaluate(el=>el.getBoundingClientRect().width<=innerWidth));
   await page.screenshot({path:path.join(__dirname,'../reports/subject-editor-'+width+'.png')});
   await page.locator('#subjectEditorCancel').click();await page.screenshot({path:path.join(__dirname,'../reports/subject-home-'+width+'.png')});
  }finally{await context.close();}
 });
 await check(report,'Weekly preference, manual priority, user isolation and missing subject',async()=>{
  const {page,context}=await h.page({width:390});try{await setup(page);
   const results=await page.evaluate(async()=>{
    const tools=HathirSubjectTools,monday=new Date(2026,9,19,10),next=new Date(2026,9,26,10);
    tools.remember('computer',monday);activeSubjectId='circuits';
    const applied=tools.applyDefault(next);await new Promise(r=>setTimeout(r,100));const chosen=activeSubjectId;
    tools.remember('circuits',next);const sameDay=tools.applyDefault(next);
    const original=session;session={...session,uid:'other_teacher'};const isolated=tools.preferences();session=original;
    subjects=subjects.filter(s=>s.id!=='circuits');activeSubjectId='computer';const missing=tools.applyDefault(new Date(2026,10,2,10));
    return {applied,chosen,sameDay,isolated,missing,current:activeSubjectId};
   });assert.equal(results.applied,true);assert.equal(results.chosen,'computer');assert.equal(results.sameDay,false);assert.deepEqual(results.isolated,{});assert.equal(results.missing,false);assert.equal(results.current,'computer');
  }finally{await context.close();}
 });
 await check(report,'Live lecture and open editor prevent automatic switching',async()=>{
  const {page,context}=await h.page({width:390});try{await setup(page);
   assert.equal(await page.evaluate(()=>{HathirSubjectTools.remember('computer',new Date(2026,9,19));getSubject().lectureMeta.live={status:'active'};return HathirSubjectTools.applyDefault(new Date(2026,9,26));}),false);
   await page.evaluate(()=>delete getSubject().lectureMeta.live);await menu(page);await page.locator('#beginnerCreateSubject').click();assert.equal(await page.evaluate(()=>HathirSubjectTools.applyDefault(new Date(2026,10,2))),false);
  }finally{await context.close();}
 });
 await check(report,'Dropdown actions target their own row without remembering a selection',async()=>{
  const {page,context}=await h.page({width:390});try{await setup(page);await menu(page);
   await page.screenshot({path:path.join(__dirname,'../reports/subject-dropdown-390.png')});
   await page.locator('[data-subject-action=edit][data-target-subject=computer]').click();assert.equal(await page.locator('#subjectName').inputValue(),'الحاسوب');assert.equal(await page.evaluate(()=>activeSubjectId),'circuits');
   assert.deepEqual(await page.evaluate(()=>HathirSubjectTools.preferences()),{});await page.locator('#subjectEditorCancel').click();
   await menu(page);page.once('dialog',async d=>{assert(d.message().includes('الحاسوب'));await d.accept();});await page.locator('[data-subject-action=delete][data-target-subject=computer]').click();await page.waitForFunction(()=>!subjects.some(s=>s.id==='computer'));assert(await page.evaluate(()=>subjects.some(s=>s.id==='circuits')));
  }finally{await context.close();}
 });
 await check(report,'Two subjects on Monday switch at their remembered times and keep manual priority',async()=>{
  const {page,context}=await h.page({width:390});try{await setup(page);
   const result=await page.evaluate(()=>{
    const tools=HathirSubjectTools;
    tools.remember('circuits',new Date(2026,9,19,9));tools.remember('computer',new Date(2026,9,19,11));
    const saved=tools.preferences()[1];activeSubjectId='computer';
    tools.applyDefault(new Date(2026,9,26,8,30));const early=activeSubjectId;
    tools.applyDefault(new Date(2026,9,26,10,59));const before=activeSubjectId;
    tools.applyDefault(new Date(2026,9,26,11));const after=activeSubjectId;
    activeSubjectId='circuits';tools.remember('circuits',new Date(2026,9,26,11,5));
    tools.applyDefault(new Date(2026,9,26,11,6));const manual=activeSubjectId;
    return {saved,early,before,after,manual};
   });assert.deepEqual(result.saved,[{id:'circuits',minute:540},{id:'computer',minute:660}]);assert.equal(result.early,'circuits');assert.equal(result.before,'circuits');assert.equal(result.after,'computer');assert.equal(result.manual,'circuits');
  }finally{await context.close();}
 });
 await check(report,'Manual chooser stores preference and refresh retains it',async()=>{
  const {page,context}=await h.page({width:390});try{await setup(page);await page.locator('#beginnerChooseSubject').click();await page.locator('[data-subject-id="computer"]').click();
   assert.equal(await page.evaluate(()=>HathirSubjectTools.preferences()[new Date().getDay()].at(-1).id),'computer');
   await page.reload();await setup(page);await page.waitForFunction(()=>activeSubjectId==='computer');
   await page.locator('#subjectForgetDay').click();assert.equal(await page.evaluate(()=>HathirSubjectTools.preferences()[new Date().getDay()]),undefined);
  }finally{await context.close();}
 });
 await check(report,'Failed local save retains existing subject and history',async()=>{
  const {page,context}=await h.page({width:390});try{await setup(page);await menu(page);await page.locator('.subjectChoiceRow').filter({has:page.locator('button.active')}).locator('[data-subject-action=edit]').click();
   await page.locator('#subjectName').fill('تعديل لم يحفظ');await page.evaluate(()=>{saveLocalData=async()=>{throw Error('Storage unavailable');};});await page.locator('#subjectEditorSave').click();
   await page.waitForFunction(()=>document.getElementById('subjectEditorError').textContent==='Storage unavailable');assert.equal(await page.evaluate(()=>getSubject().titleAr),'دوائر إلكترونية');assert.equal(await page.evaluate(()=>getSubject().attendance['2026-10-01'].student_one.time),'09:00');
  }finally{await context.close();}
 });
}finally{await h.close();saveReport(report,'subject-tools-local');}})().catch(e=>{console.error(e);process.exitCode=1;});
