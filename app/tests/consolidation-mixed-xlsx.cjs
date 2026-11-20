const {launch,makeReport,check,saveReport,assert}=require('./offline-harness.cjs');
const report=makeReport('consolidation-mixed-xlsx');
const scopes=[];
for(const department of ['تقنيات الأجهزة الطبية','التقنيات الإلكترونية'])
 for(const stage of ['1','2'])
  for(const period of ['morning','evening'])scopes.push({department,stage,period,year:'2026-2027'});
scopes.push({department:'تقنيات الأجهزة الطبية',stage:'2',period:'morning',year:'2027-2028'});
scopes.push({department:'تقنيات الأجهزة الطبية',stage:'2',period:'',year:''});
const referenceOnly={department:'قسم مستقل للاختبار',stage:'3',period:'evening',year:'2026-2027'};
const tuple=m=>JSON.stringify([m.department,m.stage,m.period,m.year]);
const letters=['ألف','باء','جيم','دال','هاء','واو','زاي','حاء','طاء'];
const refName=i=>'طالب مرجع '+letters[i];
const duration=n=>Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
const flag=n=>n/3600*100>=20?'راسب بالغياب':n/3600*100>=10?'إنذار':n/3600*100>=5?'تنبيه':'سليم';
async function workspace(p){
 await p.evaluate(()=>{
  fixtureAuth.currentUser=fixtureUser();
  const uid='qa_mixed_excel';
  session={uid,workspaceId:uid,email:'qa@example.test',role:'owner',active:true,local:true,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};
  departments=defaultDepartments();stages=defaultStages();
  const s={id:'retained',titleAr:'مادة محفوظة',ownerUserId:uid,departmentId:DEFAULT_DEPARTMENT_ID,stageId:DEFAULT_STAGE_ID,studyPeriod:'morning',students:[{id:'s1',name:'طالب أصلي'}],lectures:[],lectureMeta:{},attendance:{},excuses:{},rosterLoaded:true,totalHours:60,lectureDurationHours:2};
  subjects=[s];activeSubjectId=s.id;compactScope={departmentId:s.departmentId,stageId:s.stageId,studyPeriod:'morning',section:''};
  localData={workspace:{id:uid},users:{[uid]:session},departments:Object.fromEntries(departments.map(d=>[d.id,d])),stages:Object.fromEntries(stages.map(g=>[g.id,g])),subjects:{retained:s}};
  showApp();HathirConsolidation.open();
 });
 await idle(p);
}
async function idle(p){await p.waitForFunction(()=>document.querySelector('#consolidationView').getAttribute('aria-busy')==='false');}
async function xlsx(p,{scope,index=0,course='A',reference=false,badField=''}){
 const result=await p.evaluate(async({scope,index,course,reference,badField})=>{
  await loadOptionalLibrary('exceljs');
  const wb=new ExcelJS.Workbook();
  const notes=wb.addWorksheet('ملاحظات');notes.addRow(['ملف اصطناعي لا يحتوي بيانات فعلية']);
  const s=wb.addWorksheet(reference?'قائمة كاملة':'حضور');
  const metadata=[
   ['القسم',scope.department],
   ['المرحلة',reference?scope.stage:scope.stage==='1'?'الأولى':scope.stage==='2'?'الثانية':scope.stage],
   ['الدراسة',reference?scope.period:scope.period==='morning'?'صباحي':scope.period==='evening'?'مسائي':''],
   ['السنة الدراسية',scope.year]
  ];
  for(const row of metadata)if(row[0]!==badField)s.addRow(row);
  let minutes=course==='A'?(index+1)*60:(index+1)*30;
  if(!reference){
   s.addRow(['المادة الحالية',course==='A'?'مادة مشتركة':'مادة ثانية']);
   s.addRow(['مدرس المادة','تدريسي اختبار']);
   s.addRow(['مجموع ساعات المادة',60]);
   s.addRow(['مرجع الغياب بالدقائق',minutes]);
   s.addRow(['حالة اعتماد الغياب','ready']);
   s.addRow(['حد التنبيه',5]);s.addRow(['حد الإنذار',10]);s.addRow(['حد الرسوب',20]);
  }
  s.addRow([]);
  if(reference){
   s.addRow(['اسم الطالب']);
   s.addRow(['احمد  علي']);s.addRow(['سارة حسن']);s.addRow(['طالب مرجع '+['ألف','باء','جيم','دال','هاء','واو','زاي','حاء','طاء'][index%9]]);
  }else{
   s.addRow(['اسم الطالب','ساعات الحضور','ساعات الغياب','نسبة الغياب','موقف الغياب']);
   const absent=course==='A'?15:10;
   const row=s.addRow(['أحمد علي',(minutes-absent)/1440,absent/1440,absent/3600,'سليم']);
   row.getCell(2).numFmt=row.getCell(3).numFmt='[h]:mm';row.getCell(4).numFmt='0.0%';
   if(course==='A'){
    const percent=minutes/3600*100;
    const r=s.addRow(['طالب خاص بالمادة',0,minutes/1440,percent/100,percent>=20?'راسب بالغياب':percent>=10?'إنذار':percent>=5?'تنبيه':'سليم']);
    r.getCell(2).numFmt=r.getCell(3).numFmt='[h]:mm';r.getCell(4).numFmt='0.0%';
   }
  }
  return Array.from(await wb.xlsx.writeBuffer());
 },{scope,index,course,reference,badField});
 return {name:(reference?'reference':'course')+'-'+index+'-'+course+(badField?'-invalid':'')+'.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(result)};
}
async function upload(p,files,reference=false){
 await p.locator(reference?'#consolidationReference':'#consolidationFiles').setInputFiles(files);await idle(p);
}
async function addDrafts(p,reference=false){
 while(await p.locator('.consolidationDraft').count()){
  const draft=p.locator('.consolidationDraft').first();
  if(reference)await draft.locator('.consolidationReferenceConfirm input').check();
  await draft.locator('[data-add]').click();await idle(p);
  if(await p.locator('#consolidationStatus').innerText().then(t=>/غير صالح|أكد|غير موجود/.test(t)))throw Error(await p.locator('#consolidationStatus').innerText());
 }
}
async function snapshot(p){
 return p.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hathir-consolidation-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{
   const saved=await new Promise((resolve,reject)=>{const t=db.transaction('summaries','readonly'),r=t.objectStore('summaries').get(JSON.stringify([session.uid,session.workspaceId]));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   return {sources:saved.sources,groups:HathirConsolidationModel.groups(saved.sources)};
  }finally{db.close();}
 });
}
function findGroup(state,scope){return state.groups.find(g=>tuple(g.meta)===tuple(scope));}
function values(group,name){return group.students.find(s=>s.name===name)?.values;}
(async()=>{
 const h=await launch(report);
 try{
  const {page:p,context}=await h.page({width:1280,fixture:{uid:'qa_mixed_excel',verified:true}});
  await workspace(p);
  let originalSources,baseState;
  const reports=[];
  for(let i=0;i<scopes.length;i++)for(const course of i===9?['A']:['A','B'])reports.push(await xlsx(p,{scope:scopes[i],index:i,course}));
  await check(report,'19 actual XLSX reports with two departments, two stages, two study periods and two years form 10 separate groups',async()=>{
   await upload(p,reports);assert.equal(await p.locator('.consolidationDraft').count(),19);await addDrafts(p);
   baseState=await snapshot(p);originalSources=JSON.stringify(baseState.sources);
   assert.equal(baseState.sources.length,19);assert.equal(baseState.groups.length,10);
   for(let i=0;i<scopes.length;i++){
    const g=findGroup(baseState,scopes[i]);assert(g,'Missing scope '+tuple(scopes[i]));
    assert.equal(g.courses.length,i===9?1:2);assert.equal(g.students.length,2);
    for(const c of g.courses)assert.equal(tuple(c.meta),tuple(scopes[i]));
   }
   assert.equal(await p.locator('.consolidationTable').count(),10);
  });
  await check(report,'Adding one full reference list changes only its exact group despite identical student names elsewhere',async()=>{
   await upload(p,await xlsx(p,{scope:scopes[0],index:0,reference:true}),true);await addDrafts(p,true);
   const state=await snapshot(p);assert.equal(state.groups.length,10);
   const target=findGroup(state,scopes[0]);assert.equal(target.students.length,4);
   for(let i=1;i<scopes.length;i++)assert.deepEqual(findGroup(state,scopes[i]),findGroup(baseState,scopes[i]),'Reference leaked into '+tuple(scopes[i]));
   const a=target.courses.find(c=>c.meta.title==='مادة مشتركة'),b=target.courses.find(c=>c.meta.title==='مادة ثانية');
   assert.equal(values(target,'سارة حسن')[a.id].absent,60);assert.equal(values(target,'سارة حسن')[b.id].absent,30);
   assert.equal(values(target,'طالب خاص بالمادة')[b.id],undefined,'A non-reference student must not get inferred absence');
  });
  await check(report,'Eight references apply to their own department/stage/period/year and one group with no reference remains unchanged',async()=>{
   for(const i of [1,2,3,4,5,6,8]){
    await upload(p,await xlsx(p,{scope:scopes[i],index:i,reference:true}),true);await addDrafts(p,true);
   }
   const state=await snapshot(p);
   assert.equal(state.groups.length,10);
   for(const i of [0,1,2,3,4,5,6,8]){
    const g=findGroup(state,scopes[i]);assert.equal(g.references.length,1);assert.equal(g.courses.length,2);assert.equal(g.students.length,4);
    assert(g.students.some(s=>s.name===refName(i)));
    for(const c of g.courses){
     const expected=c.meta.title==='مادة مشتركة'?(i+1)*60:(i+1)*30;
     for(const name of ['سارة حسن',refName(i)]){
      const v=values(g,name)[c.id];assert(v.inferred);assert.equal(v.attended,0);assert.equal(v.absent,expected);assert.equal(v.percent,expected/3600*100);assert.equal(v.flag,flag(expected));
     }
     const actual=values(g,'أحمد علي')[c.id],before=values(findGroup(baseState,scopes[i]),'أحمد علي')[c.id];
     assert.deepEqual(actual,before,'Original attendance changed');
    }
    const foreign=letters.map((_,j)=>refName(j)).filter(n=>n!==refName(i));
    assert(!g.students.some(s=>foreign.includes(s.name)),'Foreign reference student leaked');
   }
   assert.deepEqual(findGroup(state,scopes[7]),findGroup(baseState,scopes[7]));
   assert.deepEqual(findGroup(state,scopes[9]),findGroup(baseState,scopes[9]));
   assert.equal(JSON.stringify(state.sources.filter(s=>s.kind!=='reference')),originalSources,'Source report records were mutated');
  });
  await check(report,'An unmatched reference creates only its own scope, without modifying any course group',async()=>{
   const before=await snapshot(p);
   await upload(p,await xlsx(p,{scope:referenceOnly,index:0,reference:true}),true);await addDrafts(p,true);
   const state=await snapshot(p);assert.equal(state.groups.length,11);
   for(const scope of scopes)assert.deepEqual(findGroup(state,scope),findGroup(before,scope));
   const alone=findGroup(state,referenceOnly);assert.equal(alone.courses.length,0);assert.equal(alone.references.length,1);assert.equal(alone.students.length,3);
  });
  await check(report,'Group picker renders only its scope and never shows a reference as a subject column',async()=>{
   const state=await snapshot(p);
   await p.locator('#consolidationMetric').selectOption('absent');
   for(const i of [0,3,6,7,8,9]){
    const g=findGroup(state,scopes[i]);
    await p.locator('#consolidationGroup').selectOption(g.id);
    assert.equal(await p.locator('.consolidationTable').count(),1);
    assert.equal(await p.locator('.consolidationTable thead th').count(),g.courses.length+1);
    assert.equal(await p.locator('.consolidationTable tbody tr').count(),i===7||i===9?2:4);
    if(i!==7&&i!==9){
     const row=p.locator('.consolidationTable tbody tr').filter({hasText:'سارة حسن'});
     assert.match(await row.innerText(),new RegExp(duration((i+1)*60)));
    }
   }
   await p.locator('#consolidationGroup').selectOption('');
  });
  await check(report,'XLSX reports missing department or stage cannot be added and do not change saved groups',async()=>{
   const before=await snapshot(p);
   const bad=[await xlsx(p,{scope:scopes[0],index:20,badField:'القسم'}),await xlsx(p,{scope:scopes[0],index:21,badField:'المرحلة'})];
   await upload(p,bad);assert.equal(await p.locator('.consolidationDraft').count(),2);
   for(let i=0;i<2;i++){
    const d=p.locator('.consolidationDraft').first();await d.locator('[data-add]').click();await idle(p);
    assert.match(await p.locator('#consolidationStatus').innerText(),/غير موجود|غير صالحة/);
    await d.locator('[data-discard]').click();
   }
   assert.deepEqual(await snapshot(p),before);
  });
  await check(report,'A reference missing morning/evening classification is rejected rather than applied to both studies',async()=>{
   const before=await snapshot(p);
   await upload(p,await xlsx(p,{scope:{...scopes[0],period:''},index:0,reference:true}),true);
   const d=p.locator('.consolidationDraft').first();await d.locator('.consolidationReferenceConfirm input').check();await d.locator('[data-add]').click();await idle(p);
   assert.match(await p.locator('#consolidationStatus').innerText(),/الدراسة/);await d.locator('[data-discard]').click();
   assert.deepEqual(await snapshot(p),before);
  });
  await check(report,'Exported workbook has one worksheet per group, isolated inferred values and all source provenance',async()=>{
   await p.locator('#consolidationGroup').selectOption('');await p.locator('#consolidationMetric').selectOption('all');
   const result=await p.evaluate(async()=>{
    const old=download;let resolve;const done=new Promise(r=>{resolve=r});download=b=>resolve(b);
    try{
     document.getElementById('consolidationExport').click();const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await done);
     const numeric=v=>v instanceof Date?(v.getTime()-Date.UTC(1899,11,30))/86400000:v;
     return workbook.worksheets.map(s=>{
      const rows=[];s.eachRow({includeEmpty:true},r=>rows.push(Array.from({length:s.columnCount},(_,i)=>numeric(r.getCell(i+1).value))));
      return {name:s.name,rows};
     });
    }finally{download=old;}
   });
   assert.equal(result.length,12);
   const state=await snapshot(p);
   for(let i=0;i<state.groups.length;i++){
    const group=state.groups[i],sheet=result[i];
    assert.equal(sheet.rows[2].length,1+group.courses.length*4);
    assert.equal(sheet.rows.length,group.students.length+3);
    const actual=sheet.rows.slice(3);
    assert.deepEqual(actual.map(r=>r[0]),group.students.map(s=>s.name));
    const scope=scopes.findIndex(s=>tuple(s)===tuple(group.meta));
    if([0,1,2,3,4,5,6,8].includes(scope)){
     const row=actual.find(r=>r[0]==='سارة حسن');assert(row);
     for(let j=0;j<group.courses.length;j++){
      const minutes=group.courses[j].meta.title==='مادة مشتركة'?(scope+1)*60:(scope+1)*30;
      assert.equal(row[1+4*j],0);assert(Math.abs(row[2+4*j]-minutes/1440)<1e-8);assert(Math.abs(row[3+4*j]-minutes/3600)<1e-8);assert.equal(row[4+4*j],flag(minutes));
     }
    }
    if(scope===7||scope===9)assert(!actual.some(r=>r[0]==='سارة حسن'),'Reference leaked into exported unmatched group');
   }
   assert.equal(result.at(-1).rows.length,state.sources.length+1);
   return {sheets:result.length-1,sourceFiles:state.sources.length};
  });
  await check(report,'Reload preserves group separation and all reference mappings, with no production writes',async()=>{
   const before=await snapshot(p);
   await p.reload();await p.waitForFunction(()=>personalFixture.initialAuthDelivered);await workspace(p);
   assert.deepEqual(await snapshot(p),before);
   assert.equal(await p.evaluate(()=>getSubject().students[0].name),'طالب أصلي');
   assert.equal(await p.evaluate(()=>personalFixture.writes.length),0);
   assert.deepEqual(report.pageErrors,[]);
  });
  report.fixtureSummary={xlsxReports:19,referenceLists:9,groups:11,departments:2,stages:2,periods:['morning','evening'],years:['2026-2027','2027-2028'],includesUnknownScope:true,includesUnmatchedReference:true};
  await context.close();
 }finally{await h.close();saveReport(report,'consolidation-mixed-xlsx');}
})().catch(e=>{console.error(e);process.exitCode=1;});

