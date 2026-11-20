'use strict';
const {launch,makeReport,check,saveReport,assert,path,REPORTS}=require('./offline-harness.cjs'),createShare=require('../functions/test/private-share-fixture.cjs'),createLive=require('../functions/test/live-fixture.cjs');
const report=makeReport('share-notices-ui');
(async()=>{const h=await launch(report),share=createShare(),live=createLive(),clients=[];try{
 async function device(uid,width=390){const client=await h.page({width,fixture:{uid,email:uid+'@example.test',verified:true}});clients.push(client);const p=client.page;await p.waitForFunction(()=>!!window.HathirPrivateShare);await client.context.setOffline(true);
 await p.exposeFunction('shareTransport',d=>share.call(d,uid));await p.exposeFunction('liveTransport',d=>live.call(d,uid));
 await p.evaluate(async uid=>{fixtureAuth.currentUser=fixtureUser();lang='ar';const owner={uid,workspaceId:uid,email:uid+'@example.test',role:'owner',active:true,local:false,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};
 const s={id:'qa_subject',titleAr:'مادة تجريبية',titleEn:'Test',ownerUserId:uid,departmentId:DEFAULT_DEPARTMENT_ID,stageId:DEFAULT_STAGE_ID,studyPeriod:'morning',totalHours:60,lectureDurationHours:2,students:[{id:'A',name:'أحمد علي',faceDescriptors:[Array(128).fill(0.1)]}],archivedStudents:[],lectures:['2026-09-20'],lectureMeta:{'2026-09-20':{date:'2026-09-20',status:'completed',startTime:'08:00',durationHours:2}},attendance:{'2026-09-20':{A:{time:'08:01',source:'face'}}},excuses:{},academicStatuses:{A:'عبور'}};
 const data={workspace:{id:uid,ownerUid:uid},users:{[uid]:owner},departments:Object.fromEntries(defaultDepartments().map(d=>[d.id,d])),stages:Object.fromEntries(defaultStages().map(g=>[g.id,g])),subjects:{qa_subject:s}};
 await HathirDeviceStore.save({uid,session:owner,data,base:null,pendingClose:0,legacyOperations:[]},0);
 firebase.app=()=>({functions:()=>({httpsCallable:name=>async payload=>({data:name==='privateRosterShare'?await shareTransport(payload):name==='deviceLiveSync'?await liveTransport(payload):payload.action==='head'?{revision:null,count:0}:payload.action==='commit'?{revision:payload.revision}:{stored:true}})})});
 const originalDb=db;window.noticeSubscriptions=0;window.noticeUnsubscribed=0;db={...originalDb,collection:name=>name==='attendancePrivateShareSignals'?{doc:id=>({onSnapshot:fn=>{window.noticeSignal=fn;noticeSubscriptions++;return ()=>{noticeUnsubscribed++;};}})}:originalDb.collection(name)};
 enableAudio=async()=>true;beep=async()=>true;vibrate=()=>{};await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
 },uid);await client.context.setOffline(false);await p.evaluate(()=>HathirDeviceWorkspace.runLive());return p;}
 const a=await device('a'),b=await device('b',390),ids=[];
 const snapshot=await a.evaluate(()=>{const s=localData.subjects.qa_subject;return {scope:{departmentId:s.departmentId,departmentName:departmentById(s.departmentId).nameAr,stageNumber:Number(stageById(s.stageId).sort),studyPeriod:'morning'},subject:s,students:s.students,lectureMeta:s.lectureMeta,attendance:s.attendance};});
 for(const choices of [{faces:false,attendance:false},{faces:true,attendance:false},{faces:true,attendance:true}]){const id=require('crypto').randomUUID();ids.push(id);await share.call({action:'send',id,email:'b@example.test',recipientUid:'b',authorized:true,snapshot:{...snapshot,choices}},'a');}
 const advance=async p=>p.evaluate(()=>{window.noticeRealNow||=Date.now;window.noticeOffset=(window.noticeOffset||0)+61000;Date.now=()=>noticeRealNow()+noticeOffset;window.dispatchEvent(new Event('focus'));});
 await check(report,'Incoming invitations of all types raise red dots on More and Share without opening the dialog',async()=>{
  await b.evaluate(()=>noticeSignal());await b.waitForFunction(()=>document.getElementById('privateShareButton').dataset.shareUnread==='true');assert.equal(await b.locator('.actionMenu summary .btn').getAttribute('data-share-unread'),'true');assert((await b.locator('#privateShareNoticeText').textContent()).includes('3'));
  const css=await b.locator('.actionMenu summary .btn').evaluate(e=>({color:getComputedStyle(e,'::after').backgroundColor,shape:getComputedStyle(e,'::after').borderRadius}));assert.equal(css.color,'rgb(215, 45, 54)');assert.equal(css.shape,'999px');assert.equal(await b.locator('#privateShareButton').getAttribute('data-share-count'),'3');
  await b.locator('.actionMenu summary').click();await b.screenshot({path:path.join(REPORTS,'share-notice-more-390.png'),fullPage:true});await advance(a);assert.notEqual(await a.locator('#privateShareButton').getAttribute('data-share-unread'),'true');
 });
 await check(report,'Opening sharing shows unread incoming entries and does not clear their badge',async()=>{
  await b.locator('#privateShareButton').click();await b.waitForFunction(()=>document.querySelectorAll('#privateShareInbox .privateShareItemUnread').length===3);assert.equal(await b.locator('#privateShareIncomingTitle').getAttribute('data-share-unread'),'true');assert.equal(await b.locator('#privateShareInbox .privateShareNew').count(),3);assert.equal(await b.locator('#privateShareSent .privateShareItem').count(),0);await b.screenshot({path:path.join(REPORTS,'share-notice-incoming-390.png')});
 });
 await check(report,'Preview marks only that invitation seen without accepting or importing it; redraw retains remaining badge',async()=>{
  await b.locator(`[data-share-invite="${ids[0]}"] button`).click();await b.waitForFunction(()=>document.querySelectorAll('#privateShareInbox .privateShareNew').length===2);assert((await b.locator('#privateShareNoticeText').textContent()).includes('2'));const entry=(await share.call({action:'list'},'b')).entries.find(r=>r.id===ids[0]);assert(entry.recipientSeenAt);assert.equal(entry.status,'pending');assert.equal(await b.evaluate(()=>subjects.length),1);await b.evaluate(()=>renderAll());assert.equal(await b.locator('.actionMenu summary .btn').getAttribute('data-share-unread'),'true');
 });
 await check(report,'Read state is shared across recipient devices; remaining read/cancelled invitations clear all three indicators',async()=>{
  const other=await device('b',1440);await advance(other);await other.waitForFunction(()=>document.getElementById('privateShareNoticeText').textContent.includes('2'));
  await b.locator(`[data-share-invite="${ids[1]}"] button`).click();await b.waitForFunction(()=>document.querySelectorAll('#privateShareInbox .privateShareNew').length===1);await share.call({action:'cancel',id:ids[2]},'a');await b.locator('#privateShareRefresh').click();await b.waitForFunction(()=>document.getElementById('privateShareIncomingTitle').dataset.shareUnread==='false');assert.equal(await b.locator('#privateShareButton').getAttribute('data-share-unread'),'false');assert.equal(await b.locator('.actionMenu summary .btn').getAttribute('data-share-unread'),'false');await advance(other);await other.waitForFunction(()=>document.getElementById('privateShareButton').dataset.shareUnread==='false');
 });
 await check(report,'Completed history stays collapsed and loads compact pages without hiding active invitations',async()=>{
  assert.equal(await b.locator('#privateShareHistory').evaluate(d=>d.open),false);assert.equal(await b.locator('#privateShareHistoryList').innerText(),'');
  const base=(await share.call({action:'list'},'b')).entries[0];delete base.id;for(let i=0;i<45;i++){const id=require('crypto').randomUUID();share.records.set('attendancePrivateShareMailboxes/b/entries/'+id,{...base,status:'imported',createdAt:1000000100+i});}
  await b.locator('#privateShareHistory summary').click();await b.waitForFunction(()=>document.querySelectorAll('.privateShareHistoryRow').length===20);assert.equal(await b.locator('#privateShareInbox .privateShareItem').count(),2);
  await b.locator('#privateShareHistoryMore').click();await b.waitForFunction(()=>document.querySelectorAll('.privateShareHistoryRow').length===40);
  await b.locator('#privateShareHistoryMore').click();await b.waitForFunction(()=>document.getElementById('privateShareHistoryMore').hidden);assert.equal(await b.locator('.privateShareHistoryRow').count(),46);
 });
 await check(report,'Repeated renders do not poll repeatedly; signing out clears notification identity',async()=>{
  await b.evaluate(()=>{window.notificationCalls=0;const prior=window.shareTransport;window.shareTransport=async d=>{if(d.action==='list')window.notificationCalls++;return prior(d);};for(let i=0;i<20;i++)renderAll();});await b.waitForTimeout(100);assert.equal(await b.evaluate(()=>notificationCalls),0);
  await b.evaluate(()=>{session=null;fixtureAuth.currentUser=null;HathirPrivateShare.refresh();});assert.equal(await b.locator('#privateShareButton').getAttribute('data-share-unread'),'false');assert.equal(await b.locator('#privateShareDialog').evaluate(d=>d.open),false);assert(await b.evaluate(()=>noticeUnsubscribed>0));
 });
 await check(report,'No browser errors',()=>assert.deepEqual(report.pageErrors,[]));
 }finally{for(const c of clients)await c.context.close();await h.close();}})().catch(error=>report.cases.push({label:'Harness',passed:false,error:error.stack})).finally(()=>saveReport(report,'share-notices-ui'));

