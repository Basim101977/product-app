'use strict';
const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs');
const report=makeReport('device-first-closed-lecture-regression');
(async()=>{
  const harness=await launch(report);
  try {
    let uploadedCopy;
    const {page,context}=await harness.page();
    await page.evaluate(()=>{window.HathirSyncModel=null;});
    await page.clock.setFixedTime(new Date('2026-09-27T06:05:00Z'));
    page.on('dialog',dialog=>dialog.accept());
    await page.evaluate(async()=>{
      personalFixture.verified=true;personalFixture.accountStatus='approved';fixtureAuth.currentUser=fixtureUser();lang='ar';
      const uid=personalFixture.uid;
      const owner={uid,workspaceId:uid,role:'owner',active:true,local:false,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[],displayName:'Synthetic owner'};
      const data={workspace:{id:uid,ownerUid:uid},users:{[uid]:owner},departments:Object.fromEntries(defaultDepartments().map(d=>[d.id,d])),stages:Object.fromEntries(defaultStages().map(s=>[s.id,s])),subjects:{}};
      data.subjects.qa_local={id:'qa_local',titleAr:'اختبار محلي',titleEn:'Local QA',ownerUserId:uid,departmentId:DEFAULT_DEPARTMENT_ID,stageId:DEFAULT_STAGE_ID,totalHours:60,lectureDurationHours:2,students:[{id:'MI20250001',name:'طالب اختبار'}],attendance:{},lectures:[],lectureMeta:{},excuses:{},archivedStudents:[]};
      await HathirDeviceStore.save({uid,session:owner,data,base:null,pendingClose:0,legacyOperations:[]},0);
      await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
      window.deviceCalls=[];window.failDeviceUpload=false;window.uploadChunks={};
      firebase.app=()=>({functions:region=>({httpsCallable:name=>async payload=>{
        deviceCalls.push({region,name,...payload});
        if(failDeviceUpload)throw Object.assign(Error('Synthetic transport failure'),{code:'functions/unavailable'});
        if(name!=='closedLectureWorkspace')throw Error('Unexpected cloud call '+name);
        if(payload.action==='write'){(uploadChunks[payload.revision]||=[])[payload.index]=payload.text;return {data:{stored:true}};}
        if(payload.action==='commit'){if(window.holdCommit)await new Promise(resolve=>window.releaseCommit=resolve);return {data:{revision:payload.revision}};}
        if(payload.action==='head')return {data:{revision:null,count:0}};
        throw Error('Unexpected action');
      }})});
      enableAudio=async()=>true;beep=async()=>true;vibrate=()=>{};
    });
    await check(report,'Offline roster additions are durable and cause no cloud writes',async()=>{
      await context.setOffline(true);
      const result=await page.evaluate(async()=>{
        const rows=await HathirDeviceWorkspace.importNames(['طالب جديد']);
        const saved=await HathirDeviceStore.get(session.uid);
        return {added:rows.length,stored:saved.data.subjects.qa_local.students.length,calls:deviceCalls.filter(call=>['write','commit'].includes(call.action)).length,editable:canManageStudents(getSubject()),deletable:canDeleteSubject(getSubject())};
      });assert.deepEqual(result,{added:1,stored:2,calls:0,editable:true,deletable:true});
    });
    await check(report,'Attendance and corrections save locally without uploading an open lecture',async()=>{
      const result=await page.evaluate(async()=>{
        await markAttendance('MI20250001','manual');
        const subject=getSubject(),date=currentLectureKey(subject);window.qaDate=date;
        await updateAttendanceTime('MI20250001',date,'09:15');
        const saved=await HathirDeviceStore.get(session.uid);
        return {time:saved.data.subjects.qa_local.attendance[date]?.MI20250001?.time,calls:deviceCalls.filter(call=>['write','commit'].includes(call.action)).length,pending:saved.pendingClose};
      });assert.equal(result.time,'09:15');assert.equal(result.calls,0);assert.equal(result.pending,0);
    });
    await check(report,'Editing a student profile is local even without Internet',async()=>{
      const result=await page.evaluate(async()=>{
        activeProfileStudentId='MI20250001';studentProfileMode='edit';
        renderStudentProfile();
        els.profileStudentNameInput.value='اسم محلي معدل';els.profileStudentCodeInput.value='MI20250001';
        await saveStudentProfile();
        return {name:(await HathirDeviceStore.get(session.uid)).data.subjects.qa_local.students.find(s=>s.id==='MI20250001').name,calls:deviceCalls.filter(call=>['write','commit'].includes(call.action)).length};
      });assert.deepEqual(result,{name:'اسم محلي معدل',calls:0});
    });
    await check(report,'A failed local transaction rolls back the edit and never reports it as stored',async()=>{
      const result=await page.evaluate(async()=>{
        const original=window.HathirDeviceStore,before=getSubject().students.length;
        window.HathirDeviceStore={...original,save:async()=>{throw Error('Synthetic disk full');}};let rejected=false;
        try{await HathirDeviceWorkspace.importNames(['يجب ألا يحفظ']);}catch{rejected=true;}finally{window.HathirDeviceStore=original;}
        return {rejected,before,after:getSubject().students.length,stored:(await original.get(session.uid)).data.subjects.qa_local.students.length};
      });assert(result.rejected);assert.equal(result.before,result.after);assert.equal(result.before,result.stored);
    });
    await check(report,'Closing offline records a durable upload request and leaves management enabled',async()=>{
      const result=await page.evaluate(async()=>{
        await setTodayLectureStatus('completed',{confirmed:true});
        const saved=await HathirDeviceStore.get(session.uid);
        return {status:saved.data.subjects.qa_local.lectureMeta[qaDate].status,pending:!!saved.pendingClose,calls:deviceCalls.filter(call=>['write','commit'].includes(call.action)).length,editable:canManageStudents(getSubject())};
      });assert.deepEqual(result,{status:'completed',pending:true,calls:0,editable:true});
    });
    await check(report,'Upload failure preserves local edits and does not lock deletion or correction',async()=>{
      await page.evaluate(()=>{failDeviceUpload=true;});await context.setOffline(false);
      const result=await page.evaluate(async()=>{
        await HathirDeviceWorkspace.upload().catch(()=>{});
        await updateAttendanceTime('MI20250001',qaDate,'09:20');
        const saved=await HathirDeviceStore.get(session.uid);
        return {time:saved.data.subjects.qa_local.attendance[qaDate].MI20250001.time,pending:!!saved.pendingClose,editable:canManageStudents(getSubject()),deletable:canDeleteSubject(getSubject())};
      });assert.deepEqual(result,{time:'09:20',pending:true,editable:true,deletable:true});
    });
    await check(report,'Publication strips every open lecture while retaining closed attendance',async()=>{
      const result=await page.evaluate(()=>{
        const data=structuredClone(localData),s=data.subjects.qa_local;s.lectureMeta.open={status:'active'};s.attendance.open={MI20250001:{time:'10:00'}};s.lectures.push('open');
        const published=HathirDeviceWorkspace.publication(data).subjects.qa_local;
        return {open:published.attendance.open,closed:published.attendance[qaDate].MI20250001.time,localOpen:s.attendance.open.MI20250001.time};
      });assert.equal(result.open,undefined);assert.equal(result.closed,'09:20');assert.equal(result.localOpen,'10:00');
    });
    await check(report,'Retry keeps its receipt and never replaces a newer local correction',async()=>{
      const result=await page.evaluate(async()=>{
        const before=(await HathirDeviceStore.get(session.uid)).uploadTicket.id;
        failDeviceUpload=false;await HathirDeviceWorkspace.upload();
        const acknowledged=(await HathirDeviceStore.get(session.uid)).base;
        await HathirDeviceWorkspace.upload();
        const saved=await HathirDeviceStore.get(session.uid);
        const remote=JSON.parse(uploadChunks[saved.base].join(''));
        return {base:acknowledged,id:before,time:saved.data.subjects.qa_local.attendance[qaDate].MI20250001.time,pending:saved.pendingClose,remoteTime:remote.data.subjects.qa_local.attendance[qaDate].MI20250001.time};
      });assert.equal(result.base,result.id);assert.equal(result.time,'09:20');assert.equal(result.remoteTime,'09:20');assert.equal(result.pending,0);
      uploadedCopy=await page.evaluate(async()=>{const saved=await HathirDeviceStore.get(session.uid);return {revision:saved.base,chunks:uploadChunks[saved.base]};});
    });
    await check(report,'Manual upload recovers after a failed save without another local edit',async()=>{
      const result=await page.evaluate(async()=>{
        const original=HathirDeviceStore,before=getSubject().students.length;
        window.HathirDeviceStore={...original,save:async()=>{throw Error('Synthetic local write failure');}};
        try{await HathirDeviceWorkspace.importNames(['اسم غير محفوظ']);}catch{}finally{window.HathirDeviceStore=original;}
        await HathirDeviceWorkspace.upload({manual:true});
        const saved=await original.get(session.uid);
        return {before,after:saved.data.subjects.qa_local.students.length,uploaded:!!saved.lastUploadedAt,ticket:saved.uploadTicket};
      });assert.equal(result.before,result.after);assert(result.uploaded);assert.equal(result.ticket,null);
    });
    await check(report,'Closed lecture corrections retry automatically and backups have no upload button',async()=>{
      await page.setViewportSize({width:390,height:844});
      await page.locator('#beginnerMenuButton').click();
      await page.locator('#settingsBtn').click();
      await page.locator('#deviceBackupsSection button').click();
      assert(await page.locator('#deviceCloudDialog').isVisible());
      assert(await page.locator('#settingsModal').isHidden());
      assert.equal(await page.locator('#deviceCloudUpload').count(),0);
      assert.equal(await page.locator('.deviceCloudOptions button').count(),3);
      assert(await page.evaluate(()=>document.getElementById('deviceCloudDialog').scrollWidth<=document.getElementById('deviceCloudDialog').clientWidth));
      await page.locator('.deviceCloudClose').click();
      await page.evaluate(async()=>{failDeviceUpload=true;await updateAttendanceTime('MI20250001',qaDate,'09:25');});
      await page.waitForFunction(()=>HathirDeviceWorkspace.lectureState().state==='error');
      await page.evaluate(()=>{failDeviceUpload=false;});
      await page.waitForFunction(()=>HathirDeviceWorkspace.lectureState().state==='synced',null,{timeout:20000});
      const remoteTime=await page.evaluate(async()=>{const saved=await HathirDeviceStore.get(session.uid);return JSON.parse(uploadChunks[saved.base].join('')).data.subjects.qa_local.attendance[qaDate].MI20250001.time;});
      assert.equal(remoteTime,'09:25');
      await page.locator('#attendanceRecordCard').scrollIntoViewIfNeeded();
      assert(await page.locator('#workspaceSyncReminder').isVisible());
      assert.match(await page.locator('#workspaceSyncReminder').innerText(),/تمت المزامنة/);
      assert(await page.locator('#workspaceSyncReminder').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().height>0));
      await page.screenshot({path:require('node:path').resolve(__dirname,'../reports/auto-lecture-mobile.png')});
      await page.setViewportSize({width:1440,height:1000});
      await page.screenshot({path:require('node:path').resolve(__dirname,'../reports/auto-lecture-desktop.png')});
    });
    await check(report,'Progress waits for server acknowledgement and does not confirm newer local edits',async()=>{
      await page.evaluate(async()=>{holdCommit=true;await updateAttendanceTime('MI20250001',qaDate,'09:26');});
      await page.waitForFunction(()=>Boolean(window.releaseCommit));
      assert.deepEqual(await page.evaluate(()=>({state:HathirDeviceWorkspace.lectureState().state,percent:HathirDeviceWorkspace.lectureState().percent})),{state:'uploading',percent:95});
      await page.evaluate(async()=>{await updateAttendanceTime('MI20250001',qaDate,'09:27');holdCommit=false;releaseCommit();releaseCommit=null;});
      assert.notEqual(await page.evaluate(()=>HathirDeviceWorkspace.lectureState().state),'synced');
      await page.waitForFunction(()=>HathirDeviceWorkspace.lectureState().state==='synced');
      assert.equal(await page.evaluate(async()=>{const saved=await HathirDeviceStore.get(session.uid);return JSON.parse(uploadChunks[saved.base].join('')).data.subjects.qa_local.attendance[qaDate].MI20250001.time;}),'09:27');
    });
    await check(report,'Selecting a lecture shows its own saved or waiting state inside the record',async()=>{
      await context.setOffline(true);
      await page.evaluate(async()=>{await markAttendance('MI20250001','manual');window.qaOpenDate=currentLectureKey(getSubject());});
      assert.equal(await page.evaluate(()=>HathirDeviceWorkspace.lectureState().state),'waiting');
      await page.locator('#attendanceRecordCard').scrollIntoViewIfNeeded();
      const closedDate=await page.evaluate(()=>qaDate),openDate=await page.evaluate(()=>qaOpenDate);
      assert.notEqual(closedDate,openDate);
      await page.locator('[data-device-lecture="'+closedDate+'"]').click();
      assert.equal(await page.locator('#deviceRecordStatus').getAttribute('data-state'),'synced');
      await page.locator('[data-device-lecture="'+openDate+'"]').click();
      assert.equal(await page.locator('#deviceRecordStatus').getAttribute('data-state'),'waiting');
      
    });
    await check(report,'Student deletion and attendance clearing work offline with recovery retained',async()=>{
      await context.setOffline(true);
      const result=await page.evaluate(async()=>{
        activeProfileStudentId='MI20250001';studentProfileMode='edit';
        await deleteStudentFromRoster();
        await clearAttendance();
        const saved=await HathirDeviceStore.get(session.uid);
        return {student:saved.data.subjects.qa_local.students.some(s=>s.id==='MI20250001'),lectures:saved.data.subjects.qa_local.lectures.length,recovery:(await HathirDeviceStore.recoveries(session.uid)).length};
      });assert.equal(result.student,false);assert.equal(result.lectures,0);assert(result.recovery>=2);
    });
    await check(report,'Account isolation and stale-tab CAS prevent silent overwrites',async()=>{
      const result=await page.evaluate(async()=>{
        const saved=await HathirDeviceStore.get(session.uid);let rejected=false;
        try{await HathirDeviceStore.save({...saved,data:{...saved.data}},saved.revision-1);}catch{rejected=true;}
        return {rejected,other:await HathirDeviceStore.get('another-account')};
      });assert.deepEqual(result,{rejected:true,other:null});
    });
    await check(report,'Reload restores the local source without reviving deleted records',async()=>{
      await context.setOffline(false);await page.reload();
      await page.waitForFunction(()=>Boolean(window.HathirDeviceWorkspace));
      const result=await page.evaluate(async()=>{
        window.HathirSyncModel=null;fixtureAuth.currentUser=fixtureUser();await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
        return {local:session.deviceFirst,students:getSubject().students.length,lectures:getSubject().lectures.length,editable:canManageStudents(getSubject())};
      });assert.deepEqual(result,{local:true,students:1,lectures:0,editable:true});
    });
    await check(report,'Clearing a roster and deleting its subject are local and persist across reload',async()=>{
      const result=await page.evaluate(async()=>{
        await HathirDeviceWorkspace.clearRoster(getSubject());
        const empty=(await HathirDeviceStore.get(session.uid)).data.subjects.qa_local.students.length;
        managedSubjectId='qa_local';await deleteClass();
        return {empty,subjects:Object.keys((await HathirDeviceStore.get(session.uid)).data.subjects).length};
      });assert.deepEqual(result,{empty:0,subjects:0});
    });
    await check(report,'Another device opens the last uploaded closed-lecture copy',async()=>{
      const other=await harness.page();await other.page.evaluate(()=>{window.HathirSyncModel=null;});
      await other.page.evaluate(()=>{window.HathirSyncModel=null;});
      await other.page.clock.setFixedTime(new Date('2026-09-27T06:05:00Z'));
      try{
        const result=await other.page.evaluate(async cloud=>{
          fixtureAuth.currentUser=fixtureUser();const uid=personalFixture.uid;
          session={uid,workspaceId:uid,role:'owner',active:true,local:false,permissions:rolePermissions('owner')};
          firebase.app=()=>({functions:()=>({httpsCallable:()=>async payload=>({data:payload.action==='head'?{revision:cloud.revision,count:cloud.chunks.length}:{text:cloud.chunks[payload.index]}})})});
          await HathirDeviceWorkspace.restoreCloud(fixtureAuth.currentUser);
          const s=getSubject();return {local:session.deviceFirst,students:s.students.length,closed:s.lectureMeta[s.lectures[0]].status,time:s.attendance[s.lectures[0]].MI20250001.time};
        },uploadedCopy);
        assert.deepEqual(result,{local:true,students:2,closed:'completed',time:'09:20'});
      }finally{await other.context.close();}
    });
    await check(report,'An existing second device receives newer cloud attendance and preserves its open lecture',async()=>{
      const other=await harness.page();await other.page.evaluate(()=>{window.HathirSyncModel=null;});
      try{
        const result=await other.page.evaluate(async cloud=>{
          fixtureAuth.currentUser=fixtureUser();const uid=personalFixture.uid;
          session={uid,workspaceId:uid,role:'owner',active:true,local:false,permissions:rolePermissions('owner')};
          const next=JSON.parse(cloud.chunks.join('')),date=next.data.subjects.qa_local.lectures[0];
          next.data.subjects.qa_local.attendance[date].MI20250001.time='09:40';
          const newer=crypto.randomUUID();let latest=false;
          firebase.app=()=>({functions:()=>({httpsCallable:()=>async payload=>({data:payload.action==='head'?{revision:latest?newer:cloud.revision,count:1}:{text:payload.revision===newer?JSON.stringify(next):cloud.chunks[payload.index]}})})});
          await HathirDeviceWorkspace.restoreCloud(fixtureAuth.currentUser);
          const subject=getSubject(),open='2026-09-29';subject.lectureMeta[open]={status:'active',startTime:'11:00'};subject.attendance[open]={MI20250001:{time:'11:05'}};subject.lectures.push(open);await HathirDeviceWorkspace.save();
          latest=true;await HathirDeviceWorkspace.checkIncoming();
          const saved=await HathirDeviceStore.get(uid);
          return {time:saved.data.subjects.qa_local.attendance[date].MI20250001.time,open:saved.data.subjects.qa_local.attendance[open].MI20250001.time,base:saved.base===newer,recovery:(await HathirDeviceStore.recoveries(uid)).length};
        },uploadedCopy);
        assert.deepEqual(result,{time:'09:40',open:'11:05',base:true,recovery:1});
      }finally{await other.context.close();}
    });
    await check(report,'Incoming copies cannot overwrite local deletion or an unbased local workspace',async()=>{
      const other=await harness.page();await other.page.evaluate(()=>{window.HathirSyncModel=null;});
      try{
        const result=await other.page.evaluate(async cloud=>{
          fixtureAuth.currentUser=fixtureUser();const uid=personalFixture.uid;
          session={uid,workspaceId:uid,role:'owner',active:true,local:false,permissions:rolePermissions('owner')};
          let latest=false;const newer=crypto.randomUUID();
          firebase.app=()=>({functions:()=>({httpsCallable:()=>async payload=>({data:payload.action==='head'?{revision:latest?newer:cloud.revision,count:1}:{text:cloud.chunks[payload.index]}})})});
          await HathirDeviceWorkspace.restoreCloud(fixtureAuth.currentUser);
          delete localData.subjects.qa_local;subjects=[];await HathirDeviceWorkspace.save();latest=true;
          await HathirDeviceWorkspace.checkIncoming();
          let saved=await HathirDeviceStore.get(uid);const removed=!saved.data.subjects.qa_local;
          await HathirDeviceStore.save({...saved,base:null,pendingClose:0},saved.revision);
          await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);await HathirDeviceWorkspace.checkIncoming();
          saved=await HathirDeviceStore.get(uid);
          return {removed,stillRemoved:!saved.data.subjects.qa_local,base:saved.base,notice:document.getElementById('offlineStatus').textContent.includes('نسخة أحدث')};
        },uploadedCopy);
        assert.deepEqual(result,{removed:true,stillRemoved:true,base:null,notice:true});
      }finally{await other.context.close();}
    });
    await check(report,'Migration preserves the legacy outbox and overlays matching records without uploading',async()=>{
      const migrated=await harness.page();
      await migrated.page.evaluate(()=>{window.HathirSyncModel=null;});
      await migrated.page.clock.setFixedTime(new Date('2026-09-27T06:05:00Z'));
      try{
        const result=await migrated.page.evaluate(async()=>{
          fixtureAuth.currentUser=fixtureUser();const uid=personalFixture.uid;
          session={uid,workspaceId:uid,role:'owner',active:true,local:false,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};
          departments=defaultDepartments();stages=defaultStages();
          const subject={id:'legacy',titleAr:'ترحيل',ownerUserId:uid,departmentId:DEFAULT_DEPARTMENT_ID,stageId:DEFAULT_STAGE_ID,students:[{id:'MI20250001',name:'اختبار قديم'}],attendance:{},lectures:[],lectureMeta:{},excuses:{},archivedStudents:[],rosterLoaded:true,rosterSource:'embedded',lectureIndexLoaded:true,lectureIndexComplete:true,attendanceLoaded:true,loadedLectureDates:new Set(),faceTemplatesLoaded:true,faceTemplateDescriptors:new Map(),totalHours:60,lectureDurationHours:2};
          subjects=[subject];activeSubjectId=subject.id;compactScope=null;
          const op={id:crypto.randomUUID(),uid,workspaceId:uid,subjectId:subject.id,date:todayISO(),kind:'mark',studentId:'MI20250001',record:{time:'09:05',markedBy:uid,method:'manual'},meta:{status:'active',startTime:'09:00',durationHours:2},preparedAt:Date.now(),createdAt:Date.now(),rosterResetId:''};
          await HathirOfflineStore.enqueue({key:uid+':legacy',uid,workspaceId:uid,session,departments,stages,subject:JSON.parse(JSON.stringify(subject))},op);
          const before=JSON.stringify(await HathirOfflineStore.operations(uid));
          await HathirDeviceWorkspace.prepare(fixtureAuth.currentUser);
          const saved=await HathirDeviceStore.get(uid);await syncOfflineAttendance();
          return {same:before===JSON.stringify(await HathirOfflineStore.operations(uid)),legacy:saved.legacyOperations.length,time:saved.data.subjects.legacy.attendance[op.date].MI20250001.time,mode:session.deviceFirst,pending:saved.pendingClose};
        });assert.deepEqual(result,{same:true,legacy:1,time:'09:05',mode:true,pending:0});
      }finally{await migrated.context.close();}
    });
    await check(report,'No uncaught browser errors',()=>assert.deepEqual(report.pageErrors,[]));
  }finally{await harness.close();saveReport(report,'device-workspace-regression');}
})().catch(error=>{console.error(error);process.exitCode=1;});
