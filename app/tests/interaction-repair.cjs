const vm=require('vm');const {fs,path,assert,launch,makeReport,check,saveReport}=require('./offline-harness.cjs');
const source=fs.readFileSync(path.join(__dirname,'subject-tools-regression.cjs'),'utf8');
const fixture=vm.runInNewContext(source.slice(source.indexOf('async function menu('),source.indexOf('(async()=>{const h='))+';({setup})');
const report=makeReport('interaction-repair');
(async()=>{const h=await launch(report);try{const {page:p,context}=await h.page({width:1440});try{await fixture.setup(p);await context.setOffline(true);await p.evaluate(()=>{document.getElementById('tourClose')?.click();getSubject().students.push({id:'student_two',name:'علي حسن محمد'},{id:'student_three',name:'حسن محمد علي'});buildStudentCache();renderRoster();enableAudio=async()=>true;beep=()=>{};vibrate=()=>{};window.notices=[];const original=notify;notify=(m,t)=>{notices.push(m);return original(m,t);};});
 await check(report,'Changing the subject restores every desktop attendance name without page reload',async()=>{
  const result=await p.evaluate(async()=>{const count=()=>document.querySelectorAll('#rosterRows .rosterFullName[data-name-attendance]').length;const before=count();await compactRefresh();return {before,after:count(),ready:attendanceInputReady(),pending:sectionLoadPending};});
  assert(result.before>0);assert(result.ready);assert.equal(result.pending,0);assert.equal(result.after,result.before);
 });
 const name=id=>p.locator('#rosterRows .rosterFullName[data-name-attendance="'+id.toUpperCase()+'"]');
 await check(report,'Desktop double-click records different students after subject refresh, offline',async()=>{
  for(const id of ['student_one','student_two']){await name(id).dblclick();await p.waitForFunction(id=>!!getAttendanceRecord(getSubject(),currentLectureKey(getSubject()),normalizeId(id)),id);}
  assert.equal(await p.evaluate(()=>getSubject().attendance['2026-10-01'].student_one.time),'09:00');
 });
 await check(report,'Busy state explains rejection and does not swallow the immediate retry',async()=>{
  await p.evaluate(()=>{sectionLoadPending=1;renderRoster();});await name('student_three').dblclick();
  assert(await p.evaluate(()=>notices.some(m=>m.includes('لم يُسجّل حضور'))));
  assert.equal(await p.evaluate(()=>!!getAttendanceRecord(getSubject(),currentLectureKey(getSubject()),'STUDENT_THREE')),false);
  await p.evaluate(()=>{sectionLoadPending=0;renderRoster();});await name('student_three').dblclick();
  await p.waitForFunction(()=>!!getAttendanceRecord(getSubject(),currentLectureKey(getSubject()),'STUDENT_THREE'));
 });
 await check(report,'Refresh restores cell correction actions as well as names',async()=>{
  await p.evaluate(()=>compactRefresh());assert(await p.locator('#rosterRows [data-attendance-edit]').count()>0);
 });
 await check(report,'Failed load remains protected and a successful retry restores input without refresh',async()=>{
  const prior=await p.evaluate(()=>JSON.stringify(getSubject().attendance));
  await p.evaluate(async()=>{window.savedHydrate=hydrateActiveSubjectAttendance;hydrateActiveSubjectAttendance=async()=>{throw Error('Synthetic load failure');};try{await compactRefresh();}catch{};});
  assert.equal(await p.evaluate(()=>attendanceInputReady()),false);await name('student_one').dblclick();
  assert.equal(await p.evaluate(()=>JSON.stringify(getSubject().attendance)),prior);
  assert(await p.evaluate(()=>notices.some(m=>m.includes('تعذر تجهيز سجل المادة'))));
  await p.evaluate(async()=>{hydrateActiveSubjectAttendance=savedHydrate;await compactRefresh();});assert.equal(await p.evaluate(()=>attendanceInputReady()),true);
 });
 await check(report,'Numbering excludes hidden empty lectures and stays global across page slices',async()=>{
  const result=await p.evaluate(()=>{const s=structuredClone(getSubject());s.lectures=Array.from({length:14},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'));s.attendance={};s.lectureMeta={};const hidden=new Set([2,5,8,10]);s.lectures.forEach((k,i)=>{s.lectureMeta[k]={status:'completed',startTime:'09:00',durationHours:2,hideWhenEmpty:hidden.has(i)};s.attendance[k]=hidden.has(i)?{}:{student_one:{time:'09:00'}};});const before=JSON.stringify(s),retained=s.lectures.filter(k=>!lectureColumnRemovedAfterUnmark(s,k)),last=retained.slice(-3).reverse();const numbers=retained.map(k=>lectureColumnParts(s,k,last).number),paged=last.map(k=>lectureColumnParts(s,k,last).number);return {numbers,paged,unchanged:JSON.stringify(s)===before};});
  assert.deepEqual(result.numbers,[1,2,3,4,5,6,7,8,9,10]);assert.deepEqual(result.paged,[10,9,8]);assert(result.unchanged);
 });
 await check(report,'Late completion from an old session cannot corrupt the new readiness counter',async()=>{
  const result=await p.evaluate(async()=>{window.savedHydrate=hydrateActiveSubjectAttendance;hydrateActiveSubjectAttendance=()=>new Promise(resolve=>window.releaseOldLoad=resolve);const job=compactRefresh();const savedSession=session;session={...session,uid:'qa_switched'};cloudLoadGeneration++;sectionLoadPending=0;sectionLoadFailed=false;releaseOldLoad();await job;const count=sectionLoadPending;session=savedSession;hydrateActiveSubjectAttendance=savedHydrate;return count;});assert.equal(result,0);
 });
}finally{await context.close();}}finally{await h.close();}saveReport(report,'interaction-repair');})().catch(e=>{console.error(e);process.exitCode=1;});
