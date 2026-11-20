'use strict';
const fs=require('node:fs');
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs');
const report=makeReport('numbered-roster-import');
(async()=>{
 const harness=await launch(report);
 try{
  const {page,context}=await harness.page();
  await check(report,'Numbered and names-first sheets preserve names and ignore serials and headers',async()=>{
   const result=await page.evaluate(()=>({
    numbered:parseStudentRows([[1,'طالب أول'],['٢','طالب ثان'],['۳','طالب ثالث'],[],[4,'']]),
    header:parseStudentRows([['ت','اسم الطالب'],[1,'طالب أول']]),
    first:parseStudentRows([['الاسم','الرقم'],['طالب أول','CODE1']]),
    text:['1,طالب أول','"٢";"طالب ثان"','طالب ثالث\tCODE3'].map(parseStudentLine)
   }));
   assert.deepEqual(result.numbered,{parsed:[{name:'طالب أول'},{name:'طالب ثان'},{name:'طالب ثالث'}],skipped:1});
   assert.deepEqual(result.header.parsed,[{name:'طالب أول'}]);assert.deepEqual(result.first.parsed,[{name:'طالب أول'}]);
   assert.deepEqual(result.text,[{name:'طالب أول'},{name:'طالب ثان'},{name:'طالب ثالث'}]);
  });
  await page.evaluate(async()=>{
   personalFixture.verified=true;personalFixture.accountStatus='approved';fixtureAuth.currentUser=fixtureUser();lang='ar';
   const uid=personalFixture.uid,owner={uid,workspaceId:uid,role:'owner',active:true,local:false,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};
   const data={workspace:{id:uid,ownerUid:uid},users:{[uid]:owner},departments:Object.fromEntries(defaultDepartments().map(d=>[d.id,d])),stages:Object.fromEntries(defaultStages().map(s=>[s.id,s])),subjects:{}};
   data.subjects.qa_import={id:'qa_import',titleAr:'اختبار الاستيراد',ownerUserId:uid,departmentId:DEFAULT_DEPARTMENT_ID,stageId:DEFAULT_STAGE_ID,totalHours:60,lectureDurationHours:2,students:[{id:'KEEP1',name:'طالب موجود'}],attendance:{},lectures:[],lectureMeta:{},excuses:{},archivedStudents:[]};
   await HathirDeviceStore.save({uid,session:owner,data,base:null,pendingClose:0,legacyOperations:[]},0);await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
   window.importNotices=[];notify=(message)=>importNotices.push(String(message));
  });
  await check(report,'Numeric-only input fails without altering the saved roster',async()=>{
   const result=await page.evaluate(async()=>{let rejected=false;try{await HathirDeviceWorkspace.importNames(['1','2']);}catch{rejected=true;}return {rejected,count:(await HathirDeviceStore.get(session.uid)).data.subjects.qa_import.students.length};});
   assert.deepEqual(result,{rejected:true,count:1});
  });
  if(process.env.HATHIR_IMPORT_FILE){
   await check(report,'The real file input change handler imports the provided workbook',async()=>{
    await page.evaluate(()=>HathirBeginnerUI.openRecord(true));
    await page.locator('#studentImportFile').setInputFiles(process.env.HATHIR_IMPORT_FILE);
    await page.waitForFunction(()=>document.querySelector('#studentImportProgressStatus')?.dataset.state);
    assert(await page.locator('#studentImportProgressStatus').isVisible());
    assert.equal(await page.locator('#studentImportProgressStatus').getAttribute('data-state'),'success');
    const state=await page.evaluate(()=>({count:getSubject().students.length,notices:importNotices}));
    assert(state.count>1,JSON.stringify(state));
    await page.evaluate(async()=>{document.getElementById('studentImportProgress').close();getSubject().students=getSubject().students.filter(row=>row.id==='KEEP1');await saveLocalData();importNotices=[];});
   });
   await check(report,'Provided Excel file imports its name column and survives reopening with existing IDs intact',async()=>{
    const bytes=Array.from(fs.readFileSync(process.env.HATHIR_IMPORT_FILE));
    const result=await page.evaluate(async bytes=>{
     const file=new File([new Uint8Array(bytes)],'roster.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
     const rows=await HathirSpreadsheetImport.read(file);
     const expected=rows.filter(row=>/[\p{L}]/u.test(String(row[1]||''))).map(row=>String(row[1]).normalize('NFKC').trim().replace(/\s+/g,' '));
     await importStudentsFromFile({target:{files:[file],value:'roster.xlsx'}});
     await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
     const saved=(await HathirDeviceStore.get(session.uid)).data.subjects.qa_import.students;
     return {expected:expected.length,added:saved.length-1,namesMatch:expected.every(name=>saved.some(row=>row.name===name)),kept:saved.some(row=>row.id==='KEEP1'&&row.name==='طالب موجود'),numericNames:saved.filter(row=>! /\p{L}/u.test(row.name)).length,writes:personalFixture.writes.length,pending:(await HathirDeviceStore.get(session.uid)).pendingClose};
    },bytes);
    assert(result.expected>0);assert.equal(result.added,result.expected);assert(result.namesMatch);assert(result.kept);assert.equal(result.numericNames,0);assert.equal(result.writes,0);assert.equal(result.pending,0);
    return {importedNames:result.added,existingRowsPreserved:1};
   });
  }
  await check(report,'A competing tab save produces a persistent visible error without adding students',async()=>{
   await page.evaluate(async()=>{
    document.getElementById('studentImportProgress')?.close();
    const row=await HathirDeviceStore.get(session.uid);await HathirDeviceStore.save(row,row.revision);
    window.beforeFailedImport=getSubject().students.length;
   });
   await page.locator('#studentImportFile').setInputFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from('طالب اختبار إضافي')});
   await page.waitForFunction(()=>document.querySelector('#studentImportProgressStatus')?.dataset.state==='error');
   assert(await page.locator('#studentImportProgressStatus').isVisible());
   assert.match(await page.locator('#studentImportProgressStatus').innerText(),/تبويب آخر/);
   assert(await page.evaluate(()=>getSubject().students.length===beforeFailedImport));
  });
  await check(report,'A file that cannot be read times out rather than hanging before the worker starts',async()=>{
   const code=await page.evaluate(async()=>{try{await HathirSpreadsheetImport.read({size:12,arrayBuffer:()=>new Promise(()=>{})},{timeout:20});return 'unexpected';}catch(error){return error.message;}});
   assert.equal(code,'FILE_READ_TIMEOUT');
  });
  await check(report,'Clearing a formerly shared roster allows reimport and preserves its former peer',async()=>{
   // Native dialog close dispatches asynchronously; wait for its cleanup before
   // starting another import so the old error status cannot shadow the new one.
   await page.evaluate(()=>document.getElementById('studentImportProgress')?.close());
   await page.waitForFunction(()=>!document.getElementById('studentImportProgress'));
   const result=await page.evaluate(async()=>{
    document.getElementById('studentImportProgress')?.close();
    await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
    const subject=getSubject();subject.rosterSource='cohort';subject.rosterCohortId='cohort_qa_shared';
    const peer=HathirDeviceStore.clone(subject);peer.id='qa_peer';
    localData.subjects[peer.id]=peer;subjects.push(peer);await saveLocalData();
    const peerIds=peer.students.map(student=>student.id);
    await HathirDeviceWorkspace.clearRoster(subject);
    const pointer=subject.rosterCohortId;
    const file=new File(['طالب بعد المسح'],'after-clear.csv',{type:'text/csv'});
    await importStudentsFromFile({target:{files:[file],value:''}});
    await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
    const saved=await HathirDeviceStore.get(session.uid);
    let cloudRejected=false;session.deviceFirst=false;
    try{cohortIdForSubject({rosterCohortId:pointer});}catch{cloudRejected=true;}finally{session.deviceFirst=true;}
    return {state:document.getElementById('studentImportProgressStatus').dataset.state,names:saved.data.subjects.qa_import.students.map(student=>student.name),peerUnchanged:JSON.stringify(saved.data.subjects.qa_peer.students.map(student=>student.id))===JSON.stringify(peerIds),pointerRetained:saved.data.subjects.qa_import.rosterCohortId===pointer,cloudRejected};
   });
   if(result.state!=='success')console.log('Import diagnostic:',await page.locator('#studentImportProgressStatus').innerText());assert.deepEqual(result,{state:'success',names:['طالب بعد المسح'],peerUnchanged:true,pointerRetained:true,cloudRejected:true});
  });
 }finally{await harness.close();saveReport(report,'numbered-roster-import');}
})().catch(error=>{console.error(error);process.exitCode=1;});
