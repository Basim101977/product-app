const vm=require('node:vm');
const {fs,path,assert,launch,makeReport,check,saveReport}=require('./offline-harness.cjs');
const source=fs.readFileSync(path.join(__dirname,'sync-transport-regression.cjs'),'utf8');
const {installWorkspace}=vm.runInNewContext(source.slice(source.indexOf('async function installWorkspace'),source.indexOf('async function scenario'))+';({installWorkspace})');
const report=makeReport('live-attendance');
let harness;
(async()=>{
 harness=await launch(report);
 await check(report,'Two devices receive 4→9 server marks while a failed local close remains intact',async()=>{
  const devices=await Promise.all([harness.page({width:390}),harness.page({width:1440})]);
  const data={},reads=[]; let readGate=null, releaseRead=null, readStarted=null;
  try {
   for(const {page} of devices){
    await installWorkspace(page);
    await page.exposeFunction('__serverRead',async(p,options)=>{assert.equal(options.source,'server');reads.push(p);if(readGate){const gate=readGate;readGate=null;readStarted();await gate;}return {doc:data[p]||null,children:Object.entries(data).filter(([k])=>k.startsWith(p+'/')&&k.split('/').length===p.split('/').length+1)};});
    await page.evaluate(async()=>{
     offlineSyncEligible=()=>false;
     window.__liveCallbacks=[];
     const snap=(p,v)=>({id:p.split('/').at(-1),exists:!!v,data:()=>v});
     const ref=p=>({path:p,doc:id=>ref(p+'/'+id),collection:n=>ref(p+'/'+n),orderBy:()=>ref(p),limit:()=>ref(p),
      get:async(options)=>{const v=await __serverRead(p,options);if(p.split('/').length%2===0)return snap(p,v.doc);const docs=v.children.map(([k,d])=>snap(k,d));return {docs,forEach:fn=>docs.forEach(fn),docChanges:()=>docs.map(doc=>({doc})),metadata:{fromCache:false,hasPendingWrites:false}};},
      onSnapshot:(options,callback,error)=>{const fn=()=>ref(p).get({source:'server'}).then(callback,error);__liveCallbacks.push(fn);return ()=>{__liveCallbacks=__liveCallbacks.filter(f=>f!==fn)};}});
     workspaceRef=()=>ref('attendanceWorkspaces/'+session.workspaceId);
     window.__emitLive=async()=>{for(const fn of __liveCallbacks)await fn()};
     await HathirOfflineStore.save(offlineSnapshot(subjects[0]));
    });
   }
   const details=await devices[0].page.evaluate(()=>({root:'attendanceWorkspaces/'+session.workspaceId+'/subjects/qa_sync_a',date:todayISO()}));
   data[details.root]={lastRosterResetId:''};
   const lecture=details.root+'/lectures/'+details.date;
   data[lecture]={date:details.date,status:'active',startTime:'09:00',durationHours:2};
   const markBase=Date.now()-30000;
   const add=n=>{for(let i=1;i<=n;i++)data[lecture+'/marks/P'+i]={studentId:'P'+i,studentName:'Synthetic '+i,time:'09:05',attendedMinutes:115,markedAtMillis:markBase+i*1000};};
   add(4);
   for(const {page} of devices)await page.evaluate(()=>HathirLiveSync.refresh());
   for(const {page} of devices){
    assert.equal(await page.evaluate(()=>Object.keys(subjects[0].attendance[todayISO()]).length),4);
    assert.equal(await page.locator('#lastScanId').textContent(),'Synthetic 4');
    assert.equal(await page.locator('#lastScanTime').textContent(),'09:05');
   }
   const pending=await devices[1].page.evaluate(async()=>{
    const op={id:crypto.randomUUID(),uid:session.uid,workspaceId:session.workspaceId,subjectId:subjects[0].id,date:todayISO(),kind:'close',protocolVersion:3,
     meta:{startTime:'09:00',durationHours:2,status:'completed'},rosterResetId:'',preparedAt:Date.now(),createdAt:Date.now(),error:'Lecture state changed on another device; review required.'};
    await HathirOfflineStore.enqueue(offlineSnapshot(subjects[0]),op);return op.id;
   });
   add(9);
   for(const {page} of devices)await page.evaluate(()=>__emitLive());
   for(const {page} of devices){
    await page.waitForFunction(()=>Object.keys(subjects[0].attendance[todayISO()]||{}).length===9);
    // Listener pulls persist to IndexedDB before renderAll(); wait for the render.
    await page.waitForFunction(()=>document.getElementById('lastScanId').textContent==='Synthetic 9');
    assert.equal(await page.locator('#lastScanTime').textContent(),'09:05');
   }
   const second=await devices[1].page.evaluate(async()=>({ids:(await HathirOfflineStore.operations(session.uid)).map(o=>o.id),status:subjects[0].lectureMeta[todayISO()].status}));
   assert.deepEqual(second.ids,[pending]);assert.equal(second.status,'completed');
   const saved=await devices[0].page.evaluate(async()=>Object.keys((await HathirOfflineStore.subject(session.uid,subjects[0].id)).subject.attendance[todayISO()]).length);
   assert.equal(saved,9,'Received records persist for subsequent offline opening');
   let started; const waiting = new Promise(resolve=>{started=resolve});readStarted=started;
   readGate=new Promise(resolve=>{releaseRead=resolve});
   await devices[0].page.evaluate(()=>{window.__refreshInFlight=HathirLiveSync.refresh();return true});
   await waiting;
   await devices[0].page.evaluate(async()=>{
     const s=subjects[0],op={id:crypto.randomUUID(),uid:session.uid,workspaceId:session.workspaceId,subjectId:s.id,date:todayISO(),kind:'mark',protocolVersion:3,
       studentId:'P10',record:{studentName:'Synthetic local tenth',time:'09:06'},meta:{startTime:'09:00',durationHours:2,status:'active'},rosterResetId:'',preparedAt:Date.now(),createdAt:Date.now()};
     await HathirOfflineStore.enqueue(offlineSnapshot(s),op);
   });
   releaseRead();await devices[0].page.evaluate(()=>__refreshInFlight);
   assert.equal(await devices[0].page.evaluate(()=>Object.keys(subjects[0].attendance[todayISO()]).length),10,'A server read racing a local mark must retain both');
   await devices[1].page.evaluate(async()=>{const ops=await HathirOfflineStore.operations(session.uid);await HathirOfflineStore.acknowledgeMany(ops.map(o=>o.id));await HathirLiveSync.refresh()});
   assert.equal(await devices[1].page.evaluate(()=>subjects[0].lectureMeta[todayISO()].lifecycleRevision),null,'Authoritative null revisions must replace stale acknowledged local revisions');
   // An older writer can update marks without touching the lecture document.
   // No listener callback is emitted here: the periodic server verification
   // must still bring the computer up to date.
   data[lecture+'/marks/P11']={studentId:'P11',studentName:'Synthetic 11',time:'09:07',attendedMinutes:113,markedAtMillis:Date.now()};
   await devices[0].page.waitForFunction(()=>Boolean(subjects[0].attendance[todayISO()]?.P11),null,{timeout:45000});
   assert.equal(await devices[0].page.evaluate(()=>Boolean(subjects[0].attendance[todayISO()]?.P10)),true,'An unsent local mark remains visible after server verification');
   // Leaving an account invalidates an in-flight reception and releases subscriptions.
   await devices[0].page.evaluate(()=>{session=null;HathirLiveSync.reconcile()});
   assert.equal(await devices[0].page.evaluate(()=>__liveCallbacks.length),0);
   assert(reads.length>0);
  } finally {for(const {context} of devices)await context.close();}
 });
})().catch(error=>report.cases.push({label:'setup',passed:false,error:error.stack})).finally(async()=>{if(harness)await harness.close();saveReport(report,'live-attendance')});
