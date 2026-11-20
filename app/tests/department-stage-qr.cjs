'use strict';
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs'),fixture=require('../functions/test/live-fixture.cjs');
const report=makeReport('department-stage-qr');
(async()=>{
 const harness=await launch(report),server=fixture();let clients=[];
 try{
  async function device(){
   const client=await harness.page();clients.push(client);const {page,context}=client;
   await page.clock.setFixedTime(new Date('2026-09-27T06:05:00Z'));await context.setOffline(true);
   const uid=await page.evaluate(()=>personalFixture.uid);await page.exposeFunction('liveTransport',payload=>server.call(payload,uid));
   await page.evaluate(async()=>{
    personalFixture.verified=true;personalFixture.accountStatus='approved';fixtureAuth.currentUser=fixtureUser();lang='ar';const uid=personalFixture.uid;
    const owner={uid,workspaceId:uid,role:'owner',active:true,local:false,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};
    const subject={id:'qa_live',titleAr:'اختبار المزامنة',titleEn:'Live QA',ownerUserId:uid,departmentId:DEFAULT_DEPARTMENT_ID,stageId:DEFAULT_STAGE_ID,totalHours:60,lectureDurationHours:2,students:[{id:'A',name:'أحمد'},{id:'B',name:'علي'}],attendance:{},lectures:[],lectureMeta:{},excuses:{},archivedStudents:[]};
    const data={workspace:{id:uid,ownerUid:uid},users:{[uid]:owner},departments:Object.fromEntries(defaultDepartments().map(d=>[d.id,d])),stages:Object.fromEntries(defaultStages().map(s=>[s.id,s])),subjects:{qa_live:subject}};
    await HathirDeviceStore.save({uid,session:owner,data,base:null,pendingClose:0,legacyOperations:[]},0);
    firebase.app=()=>({functions:()=>({httpsCallable:name=>async payload=>({data:name==='deviceLiveSync'?await liveTransport(payload):payload.action==='head'?{revision:null,count:0}:payload.action==='commit'?{revision:payload.revision}:{stored:true}})})});
    enableAudio=async()=>true;beep=async()=>true;vibrate=()=>{};
    await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
   });
   await context.setOffline(false);await page.evaluate(()=>HathirDeviceWorkspace.runLive());return client;
  }

 const a=await device(),{page,context}=a;
 await context.setOffline(true);
 let approveLegacy=true,dialogs=0;
 page.on('dialog',async d=>{dialogs++;if(approveLegacy)await d.accept();else await d.dismiss();});
 const historical=await page.evaluate(async()=>{
  const s=getSubject();for(const [date,rows] of [['2026-09-10',{A:{time:'08:05',method:'scan'}}],['2026-09-17',{A:{time:'08:07',method:'scan'},B:{time:'08:09',method:'manual'}}]]){
   s.lectures.push(date);s.lectureMeta[date]={date,startTime:'08:00',durationHours:2,status:'completed',closed:true};s.attendance[date]=rows;
  }
  await saveLocalData();return {attendance:JSON.parse(JSON.stringify(s.attendance)),meta:JSON.parse(JSON.stringify(s.lectureMeta)),ids:s.students.map(x=>x.id)};
 });
 await check(report,'H4 validates department/stage and excludes section; old V1/H2/H3 still decode',async()=>{
  const r=await page.evaluate(()=>{
   const s=getSubject(),q=HathirNameQR,p=q.encodeScoped('أحمد علي',s.departmentId,s.stageId),d=q.decode(p);
   return {d,section:Object.hasOwn(d,'section'),old:[q.encode('أحمد علي'),q.encodePortable('أحمد علي'),'HATHIR-NAME:1:'+encodeURIComponent('أحمد علي')].map(x=>q.decode(x).ok),bad:q.decode('H4:'+encodeURIComponent(JSON.stringify(['أحمد علي','dept','stage','B']))).ok};
  });assert.equal(r.d.version,4);assert.equal(r.section,false);assert(r.old.every(Boolean));assert.equal(r.bad,false);
 });
 await check(report,'Wrong department or stage rejects even an existing matching name without changing history or percentages',async()=>{
  const r=await page.evaluate(async()=>{
   const s=getSubject(),before=JSON.stringify(s),stats=JSON.stringify([...cumulativeAttendanceStats(s)]);
   const results=[];for(const [d,t] of [['other',s.stageId],[s.departmentId,'other']])results.push(await processNameQr(HathirNameQR.encodeScoped('أحمد',d,t),'scan'));
   return {results,same:before===JSON.stringify(s),stats:stats===JSON.stringify([...cumulativeAttendanceStats(s)])};
  });assert(r.results.every(x=>!x));assert(r.same);assert(r.stats);assert.equal(dialogs,0);
 });
 await check(report,'Existing H2 and H4 identify one student and keep one attendance record and first time',async()=>{
  const r=await page.evaluate(async()=>{const s=getSubject();await processNameQr(HathirNameQR.encode('أحمد'),'scan');const date=currentLectureKey(s),before=JSON.stringify(s.attendance[date]);await processNameQr(HathirNameQR.encodeScoped('أحمد',s.departmentId,s.stageId),'scan');return {before,after:JSON.stringify(s.attendance[date]),count:s.students.length};});assert.equal(r.before,r.after);assert.equal(r.count,2);assert.equal(dialogs,0);
 });
 await check(report,'Declining legacy enrollment leaves students and attendance unchanged',async()=>{
  approveLegacy=false;
  const r=await page.evaluate(async()=>{const s=getSubject(),before=JSON.stringify(s);const ok=await processNameQr(HathirNameQR.encodePortable('طالب قديم جديد'),'scan');return {ok,same:before===JSON.stringify(s)};});assert(!r.ok);assert(r.same);assert.equal(dialogs,1);
 });
 await check(report,'Approving legacy enrollment once preserves the same internal ID on the next scan',async()=>{
  approveLegacy=true;
  const r=await page.evaluate(async()=>{const s=getSubject();const ok=await processNameQr(HathirNameQR.encodePortable('طالب قديم جديد'),'scan');const student=s.students.find(s=>s.name==='طالب قديم جديد');await processNameQr(HathirNameQR.encode('طالب قديم جديد'),'scan');return {ok,count:s.students.filter(s=>s.name==='طالب قديم جديد').length,id:student?.id};});assert(r.ok);assert.equal(r.count,1);assert(r.id);assert.equal(dialogs,2);
 });
 await check(report,'Matching new H4 automatically enrolls while preserving all previous student IDs and records',async()=>{
  const r=await page.evaluate(async()=>{const s=getSubject(),old=s.students.map(x=>[x.id,x.name]),marks=JSON.parse(JSON.stringify(s.attendance));const ok=await processNameQr(HathirNameQR.encodeScoped('طالب جديد مطابق',s.departmentId,s.stageId),'scan');return {ok,old,retained:s.students.filter(x=>old.some(y=>y[0]===x.id)).map(x=>[x.id,x.name]),recordsRetained:Object.entries(marks).every(([d,rows])=>Object.entries(rows).every(([id,v])=>JSON.stringify(v)===JSON.stringify(s.attendance[d][id])))};});assert(r.ok);assert.deepEqual(r.retained,r.old);assert(r.recordsRetained);assert.equal(dialogs,2);
 });
 await check(report,'Changing subject scope after capture invalidates a delayed scan',async()=>{
  const r=await page.evaluate(async()=>{const s=getSubject(),scope=captureNameQrScope(),before=JSON.stringify(s.attendance),original=s.stageId,p=HathirNameQR.encodeScoped('أحمد',s.departmentId,s.stageId);s.stageId='changed';const ok=await processNameQr(p,'scan',scope);s.stageId=original;return {ok,same:before===JSON.stringify(s.attendance)};});assert(!r.ok);assert(r.same);
 });
 await check(report,'Unresolved fingerprint-only card does not invent a student name',async()=>{
  const r=await page.evaluate(async()=>{const s=getSubject(),before=s.students.length,ok=await processNameQr(HathirNameQR.encode('اسم غير معروف قط'),'scan');return {ok,before,after:s.students.length};});assert(!r.ok);assert.equal(r.before,r.after);
 });
 await check(report,'Real rendered card/PDF canvas decodes H4 at current card size, including long Arabic names',async()=>{
  await page.addScriptTag({path:require('path').join(__dirname,'../netlify_site/vendor/qrcode-generator-1.4.4.js')});
  await page.addScriptTag({path:require('path').join(__dirname,'../netlify_site/vendor/jsQR-1.4.0.min.js')});
  const r=await page.evaluate(async()=>{const s=getSubject(),stats=JSON.stringify([...cumulativeAttendanceStats(s)]),out=[];for(const name of ['أحمد علي حسن',('عبد الرحمن محمد ').repeat(9).trim()]){const c=document.createElement('canvas');c.width=360;c.height=480;await drawStudentQrCard(c.getContext('2d'),{name,id:'synthetic'},0,0,360,480,{subject:s});const data=c.getContext('2d').getImageData(0,0,c.width,c.height),decoded=jsQR(data.data,c.width,c.height);out.push(decoded&&HathirNameQR.decode(decoded.data));}return {out,unchanged:stats===JSON.stringify([...cumulativeAttendanceStats(s)])};});assert(r.unchanged);for(const d of r.out){assert(d?.ok);assert.equal(d.version,4);assert(d.departmentId);assert(d.stageId);}
 });
 await check(report,'Existing calculation function is byte-identical to published release 164',async()=>{
  const fs=require('fs'),path=require('path');const read=p=>fs.readFileSync(p,'utf8');const base=read(path.resolve(__dirname,'../../../hathir-qr-roster-release-20261116/app/netlify_site/index.html')),next=read(path.join(__dirname,'../netlify_site/index.html'));
  const section=s=>s.slice(s.indexOf('    function cumulativeAttendanceStats('),s.indexOf('    function cumulativeAttendanceStats(')+s.slice(s.indexOf('    function cumulativeAttendanceStats(')).indexOf('\n    function ',10));assert.equal(section(base),section(next));
 });
 await check(report,'Historical attendance, lecture metadata and original student IDs remain exact in durable storage',async()=>{
  const saved=await page.evaluate(async()=>{await saveLocalData();const row=await HathirDeviceStore.get(session.uid);return row.data.subjects.qa_live;});
  for(const [date,rows] of Object.entries(historical.attendance)){assert.deepEqual(saved.attendance[date],rows);assert.deepEqual(saved.lectureMeta[date],historical.meta[date]);}
  for(const id of historical.ids)assert(saved.students.some(s=>s.id===id));
 });
 await check(report,'No browser errors',async()=>assert.deepEqual(report.pageErrors,[]));
 }finally{for(const c of clients)await c.context.close();await harness.close();saveReport(report,'department-stage-qr');}
})().catch(e=>{console.error(e);process.exitCode=1;});
