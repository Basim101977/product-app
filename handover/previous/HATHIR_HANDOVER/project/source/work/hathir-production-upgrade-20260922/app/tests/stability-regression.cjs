'use strict';
const vm=require('node:vm');
const {APP,assert,fs,path,launch,makeReport,check,saveReport}=require('./offline-harness.cjs');
const report=makeReport('stability-regression');
const testSource=fs.readFileSync(path.join(__dirname,'personal-ui-regression.cjs'),'utf8');
const fixture=vm.runInNewContext(testSource.slice(testSource.indexOf('async function installCallables'),testSource.indexOf('const row ='))+';({installWorkspace})');
let harness;
(async()=>{
 harness=await launch(report);const {page}=await harness.page({width:390});await page.waitForFunction(()=>!!window.HathirPersonal);await fixture.installWorkspace(page);await page.evaluate(()=>{document.body.classList.remove('beginnerSimplified','beginnerRecordVisible');const css=[...document.styleSheets].find(sheet=>sheet.href?.includes('beginner-ui.css'));if(css)css.disabled=true;}); // This suite exercises the legacy paginated roster; the simplified view intentionally hides its navigation.
 await page.evaluate(()=>{
   const s=subjects[0];subjects=[s];s.students=Array.from({length:300},(_,i)=>({id:'QA'+String(i).padStart(4,'0'),name:'طالب اصطناعي '+i}));s.studentCount=300;s.lectures=[];s.attendance={};s.lectureMeta={};s.excuses={};s.academicStatuses={};
   for(let d=0;d<100;d++){const day=new Date(Date.UTC(2026,0,d+1)).toISOString().slice(0,10);s.lectures.push(day);s.lectureMeta[day]={status:'completed',startTime:'09:00',durationHours:2};s.attendance[day]={};}
   s.loadedLectureDates=new Set(s.lectures);s.loadedSummaryStudentIds=new Set(s.students.map(x=>x.id));s.attendanceStatsDirty=true;rosterDateRange='all';buildStudentCache();renderRoster();
 });
 await check(report,'Large roster bounds DOM without discarding full roster or history',async()=>{
  const state=await page.evaluate(()=>({rows:els.rosterRows.querySelectorAll('tr').length,cells:els.rosterRows.querySelectorAll('td').length,students:subjects[0].students.length,lectures:subjects[0].lectures.length,page:els.rosterPageInfo.textContent}));
  assert.equal(state.rows,40);assert(state.cells<=40*22);assert.equal(state.students,300);assert.equal(state.lectures,100);assert.match(state.page,/8/);return state;
 });
 await check(report,'Pagination reaches final student with continuous row numbering',async()=>{
  const ids=await page.locator('#rosterRows tr').evaluateAll(rows=>rows.map(row=>row.dataset.studentId));
  for(let i=0;i<7;i++){await page.locator('#rosterNextPageBtn').click();ids.push(...await page.locator('#rosterRows tr').evaluateAll(rows=>rows.map(row=>row.dataset.studentId)));}
  assert.equal(await page.locator('#rosterRows tr').count(),20);assert.equal(await page.locator('#rosterRows tr').first().locator('td').first().textContent(),'281');
  assert.equal(new Set(ids).size,300);assert(ids.includes('QA0299'));assert(await page.locator('#rosterNextPageBtn').isDisabled());
 });
 await check(report,'Search includes students outside the current page',async()=>{
  await page.locator('#studentSearch').fill('طالب اصطناعي 299');await page.waitForTimeout(230);
  assert.equal(await page.locator('#rosterRows tr').count(),1);assert(await page.locator('#rosterRows tr[data-student-id="QA0299"]').count());
  await page.locator('#studentSearch').fill('');await page.waitForTimeout(230);
 });
 await check(report,'All lecture windows remain reachable without oversized DOM',async()=>{
  const seen=await page.evaluate(()=>{const s=subjects[0],seen=new Set();for(let i=0;i<9;i++){rosterLecturePage=i;renderRoster();visibleRosterLectures(s).forEach(x=>seen.add(x));}return [...seen];});
  assert.equal(seen.length,100);assert(await page.locator('#rosterOlderLecturesBtn').isDisabled());
 });
 await check(report,'Print includes all filtered rows and history then restores pagination',async()=>{
  await page.evaluate(()=>{subjects[0].attendanceLoaded=true;window.print=()=>{window.printedRoster={rows:els.rosterRows.rows.length,lectures:visibleRosterLectures(subjects[0]).length};};});
  // The compact personal UI hides the legacy print control; exercise its
  // retained handler directly so desktop printing cannot silently lose rows.
  await page.evaluate(()=>document.getElementById('printBtn').click());
  await page.waitForFunction(()=>!!window.printedRoster);
  assert.deepEqual(await page.evaluate(()=>window.printedRoster),{rows:300,lectures:100});
  assert.equal(await page.locator('#rosterRows tr').count(),40);
 });
 await check(report,'Worker parses Arabic XLSX using the pinned local library',async()=>{
  const XLSX=require(path.join(APP,'netlify_site/vendor/xlsx-0.20.3.full.min.js'));assert.equal(XLSX.version,'0.20.3');
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['الاسم'],['أحمد محمد علي'],['زينب حسن سالم']]),'طلبة');
  const bytes=[...XLSX.write(book,{type:'buffer',bookType:'xlsx'})];
  const rows=await page.evaluate(bytes=>HathirSpreadsheetImport.read(new File([new Uint8Array(bytes)],'names.xlsx')),bytes);
  assert.deepEqual(rows,[['الاسم'],['أحمد محمد علي'],['زينب حسن سالم']]);
 });
 await check(report,'Oversized file is rejected before allocating its buffer',async()=>{
  const result=await page.evaluate(async()=>{try{await HathirSpreadsheetImport.read({size:6*1024*1024,arrayBuffer(){throw Error('read should not occur')}});}catch(e){return e.message;}});
  assert.equal(result,'FILE_TOO_LARGE');
 });
 await check(report,'Excess worksheet dimensions fail rather than silently truncate',async()=>{
  const XLSX=require(path.join(APP,'netlify_site/vendor/xlsx-0.20.3.full.min.js')),book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(Array.from({length:1100},()=>['Synthetic'])),'Roster');
  const bytes=[...XLSX.write(book,{type:'buffer',bookType:'xlsx'})];
  const result=await page.evaluate(async bytes=>{try{await HathirSpreadsheetImport.read(new File([new Uint8Array(bytes)],'large.xlsx'));return 'accepted';}catch(e){return e.message;}},bytes);
  assert.equal(result,'SHEET_TOO_LARGE');
 });
 await check(report,'Hung worker is terminated after the parsing deadline',async()=>{
  await page.route('**/spreadsheet-worker.js*',route=>route.fulfill({contentType:'text/javascript',body:'self.onmessage=()=>{};'}));
  const result=await page.evaluate(async()=>{try{await HathirSpreadsheetImport.read(new File(['test'],'test.xlsx'),{timeout:60});}catch(e){return e.message;}});
  assert.equal(result,'PARSE_TIMEOUT');await page.unroute('**/spreadsheet-worker.js*');
 });
 await check(report,'Manual failed-operation review preserves payload, identity and FIFO',async()=>{
  const state=await page.evaluate(async()=>{
   const uid=personalFixture.uid,s={id:'review_subject',attendance:{},attendanceLoaded:true},snapshot={key:uid+':review_subject',uid,workspaceId:uid,subject:s};
   const operation={id:crypto.randomUUID(),uid,workspaceId:uid,subjectId:s.id,kind:'mark',studentId:'QA',record:{time:'09:15'},expectedRevision:'previous-000000000001',createdAt:Date.now()};
   await HathirOfflineStore.enqueue(snapshot,operation);await HathirOfflineStore.fail({...operation,error:'Conflict',failureReviewVersion:offlineFailureReviewVersion,failureReviewState:'done'});
   const before=(await HathirOfflineStore.operations(uid)).find(x=>x.id===operation.id);
   const foreign=await HathirOfflineStore.requestFailureReview(operation.id,'foreign',uid);
   const own=await HathirOfflineStore.requestFailureReview(operation.id,uid,uid);
   const after=(await HathirOfflineStore.operations(uid)).find(x=>x.id===operation.id);
   await HathirOfflineStore.acknowledge(operation.id);return {before,after,own,foreign};
  });
  assert(!state.foreign);assert(state.own);assert.equal(state.after.failureReviewState,'pending');
  for(const key of ['id','uid','workspaceId','subjectId','kind','studentId','record','expectedRevision','createdAt','queueOrder'])assert.deepEqual(state.after[key],state.before[key]);
 });
})().catch(error=>report.cases.push({label:'Stability setup',passed:false,error:error.stack})).finally(async()=>{if(harness)await harness.close();saveReport(report,'stability-regression');});
