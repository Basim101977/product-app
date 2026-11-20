const {launch,makeReport,check,saveReport,assert,path,REPORTS}=require('./offline-harness.cjs');
const report=makeReport('reference-roster-ui');
async function workspace(p,uid='qa_consolidation'){await p.evaluate(uid=>{fixtureAuth.currentUser=fixtureUser();session={uid,workspaceId:uid,email:'qa@example.test',role:'owner',active:true,local:true,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};departments=defaultDepartments();stages=defaultStages();const s={id:'sample',titleAr:'مادة تصدير التطبيق',ownerUserId:uid,departmentId:DEFAULT_DEPARTMENT_ID,stageId:DEFAULT_STAGE_ID,studyPeriod:'morning',academicYearStart:2026,students:[{id:'s1',name:'أحمد علي'}],lectures:[],lectureMeta:{},attendance:{},excuses:{},rosterLoaded:true,totalHours:60,lectureDurationHours:2};subjects=[s];activeSubjectId=s.id;compactScope={departmentId:s.departmentId,stageId:s.stageId,studyPeriod:'morning',section:''};localData={workspace:{id:uid},users:{[uid]:session},departments:Object.fromEntries(departments.map(d=>[d.id,d])),stages:Object.fromEntries(stages.map(g=>[g.id,g])),subjects:{sample:s}};showApp();HathirConsolidation.open();},uid);await p.waitForFunction(()=>document.getElementById('consolidationView').getAttribute('aria-busy')==='false');}
const csv=(title,names='أحمد علي,1:30,0:30,25%,سليم\nفاطمة حسن,0:00,2:00,100%,تنبيه')=>`القسم,تقنيات الاجهزة الطبية\nالمرحلة,الثانية\nالمادة الحالية,${title}\nمدرس المادة,تدريسي تجريبي\nالدراسة,صباحي\nالسنة الدراسية,2026-2027\n\nالطالب,ساعات الحضور,ساعات الغياب,نسبة الغياب,موقف الغياب\n${names}`;
async function upload(p,name,body){await p.locator('#consolidationFiles').setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(body)});await p.waitForFunction(()=>document.getElementById('consolidationView').getAttribute('aria-busy')==='false');}
async function add(p,opts={}){const d=p.locator('.consolidationDraft').last();await d.locator('[data-add]').click();await p.waitForFunction(()=>document.getElementById('consolidationView').getAttribute('aria-busy')==='false');}

(async()=>{const h=await launch(report);try{const {page:p,context}=await h.page({width:390,fixture:{uid:'qa_consolidation',verified:true}});await workspace(p);
const course=csv('دوائر','أحمد علي,2:00,2:00,3.33%,سليم').replace('\n\nالطالب','\nمجموع ساعات المادة,60\nمرجع الغياب بالدقائق,240\nحد التنبيه,5\nحد الإنذار,7\nحد الرسوب,10\n\nالطالب');
await check(report,'Current report imports with subject policy and timing metadata',async()=>{await upload(p,'course.csv',course);await add(p);assert.equal(await p.locator('.consolidationSource').count(),1);});
const reference='القسم,تقنيات الاجهزة الطبية\nالمرحلة,الثانية\nالدراسة,صباحي\nالسنة الدراسية,2026-2027\n\nاسم الطالب\nاحمد علي\nسارة حسن\nطالب لم يحضر مطلقا';
await check(report,'Reference import requires an explicit complete-list confirmation',async()=>{
 await p.locator('#consolidationReference').setInputFiles({name:'reference.csv',mimeType:'text/csv',buffer:Buffer.from(reference)});
 await p.waitForFunction(()=>document.getElementById('consolidationView').getAttribute('aria-busy')==='false');
 assert.equal(await p.locator('.consolidationReferenceConfirm input').count(),1);
 await add(p);assert.equal(await p.locator('.consolidationSource').count(),1);
 assert.match(await p.locator('#consolidationStatus').innerText(),/أكد/);
 await p.locator('.consolidationReferenceConfirm input').check();await add(p);
 assert.equal(await p.locator('.consolidationSource').count(),2);
});
await check(report,'Never-scanned students are counted from the reference and original attendance is preserved',async()=>{
 assert.equal(await p.locator('.consolidationTable tbody tr').count(),3);
 await p.locator('#consolidationMetric').selectOption('absent');
 const missing=p.locator('.consolidationTable tbody tr').filter({hasText:'طالب لم يحضر مطلقا'});assert.match(await missing.innerText(),/4:00/);
 await p.locator('#consolidationMetric').selectOption('flag');assert.match(await missing.innerText(),/تنبيه/);
 assert.equal(await p.locator('.consolidationTable thead th').count(),2);
});
await check(report,'Excel export includes inferred hours, percentages and the reference source',async()=>{
 await p.locator('#consolidationMetric').selectOption('all');
 const result=await p.evaluate(async()=>{
  const old=download;let done;const exported=new Promise(resolve=>{done=resolve});download=content=>done(content);
  try{
   document.getElementById('consolidationExport').click();const buffer=await exported;
   const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
   const sheet=workbook.worksheets[0];let row;
   sheet.eachRow(r=>{if(r.getCell(1).value==='طالب لم يحضر مطلقا')row=r;});
   const numeric=v=>v instanceof Date?(v.getTime()-Date.UTC(1899,11,30))/86400000:v;return {attended:numeric(row.getCell(2).value),absent:numeric(row.getCell(3).value),percent:row.getCell(4).value,flag:row.getCell(5).value,format:row.getCell(3).numFmt,sources:workbook.worksheets[1].rowCount};
  }finally{download=old;}
 });
 assert.equal(result.attended,0);assert.equal(result.absent,240/1440);assert(Math.abs(result.percent-240/3600)<1e-9);assert.equal(result.flag,'تنبيه');assert.equal(result.format,'[h]:mm');assert.equal(result.sources,3);
});
await check(report,'Reference template includes exact scope metadata and is downloadable',async()=>{
 const result=await p.evaluate(async()=>{const old=download;let file;download=(content,name)=>{file={content,name}};try{document.getElementById('consolidationReferenceTemplate').click();await new Promise(r=>setTimeout(r,100));return file;}finally{download=old;}});
 assert(result.name.endsWith('.csv'));assert(result.content.includes('2026-2027'));assert(result.content.includes('سارة حسن'));
});
await check(report,'Reference survives reload and preserves original local subject roster',async()=>{
 await p.reload();await p.waitForFunction(()=>personalFixture.initialAuthDelivered);await workspace(p);
 assert.equal(await p.locator('.consolidationSource').count(),2);assert.equal(await p.locator('.consolidationTable tbody tr').count(),3);
 assert.equal(await p.evaluate(()=>getSubject().students.length),1);assert.equal(await p.evaluate(()=>personalFixture.writes.length),0);
});
await p.screenshot({path:path.join(REPORTS,'reference-roster-phone.png')});await p.setViewportSize({width:1440,height:1000});await p.screenshot({path:path.join(REPORTS,'reference-roster-desktop.png')});
await check(report,'No uncaught browser errors',async()=>assert.deepEqual(report.pageErrors,[]));
await context.close();}finally{await h.close();}saveReport(report,'reference-roster-ui');})().catch(e=>{console.error(e);process.exitCode=1;});

