const {launch,makeReport,saveReport}=require('./offline-harness.cjs'); const report=makeReport('sync-controls-layout');
(async()=>{
 const b=await launch(report);
 try{
  for(const width of [320,390,673,1440]){
   const client=await b.page({width}),p=client.page;
   await p.evaluate(()=>{
    fixtureAuth.currentUser=fixtureUser();session={uid:personalFixture.uid,workspaceId:personalFixture.uid,role:'owner',active:true,local:true,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};
    departments=defaultDepartments();stages=defaultStages();
    const subject={id:'sync_layout',titleAr:'محاضرة اختبار',titleEn:'Test lecture',ownerUserId:session.uid,departmentId:DEFAULT_DEPARTMENT_ID,stageId:DEFAULT_STAGE_ID,students:[],attendance:{},lectureMeta:{},lectures:[],excuses:{},archivedStudents:[],rosterLoaded:true};
    subjects=[subject];activeSubjectId=subject.id;
    localData={workspace:{id:session.uid},users:{},subjects:{[subject.id]:subject},departments:Object.fromEntries(departments.map(d=>[d.id,d])),stages:Object.fromEntries(stages.map(s=>[s.id,s]))};
    showApp();HathirSyncReminder.update({uid:session.uid,count:3,ready:true,busy:true,percent:65,preview:true,unit:'changes'});
   });
   await p.waitForFunction(()=>document.querySelector('#workspaceSyncReminder .workspaceSyncPercent'));
   for(const language of ['ar','en']){
    await p.evaluate(language=>{lang=language;document.documentElement.lang=language;document.documentElement.dir=language==='ar'?'rtl':'ltr';renderAll();els.completeLectureBtn.hidden=false;els.cancelLectureBtn.hidden=false;HathirSyncReminder.update({uid:session.uid,count:3,ready:true,busy:true,percent:65,preview:true,unit:'changes'});},language);
    const a=await p.locator('#completeLectureBtn').boundingBox(),c=await p.locator('#cancelLectureBtn').boundingBox();
    if(!a||!c||Math.abs(a.y-c.y)>1||Math.abs(a.height-c.height)>1)throw Error(JSON.stringify({width,language,a,c}));
    const m=await p.evaluate(()=>{
     const value=document.querySelector('.workspaceSyncPercent'),text=document.querySelector('.workspaceSyncMessage'),v=value.getBoundingClientRect(),t=text.getBoundingClientRect();
     return {value:value.textContent,big:parseFloat(getComputedStyle(value).fontSize)>parseFloat(getComputedStyle(text).fontSize),gap:Math.max(v.left-t.right,t.left-v.right)};
    });
    if(m.value!=='65%'||!m.big||m.gap<13)throw Error(JSON.stringify({width,language,m}));
   }
   for(const [count,busy,error,percent,expected] of [[3,false,false,0,'0%'],[3,true,false,42,'42%'],[0,false,false,0,'100%'],[3,false,true,70,'0%']]){
    await p.evaluate(s=>HathirSyncReminder.update({uid:session.uid,ready:true,preview:true,unit:'changes',...s}),{count,busy,error,percent});
    const actual=await p.locator('.workspaceSyncPercent').innerText();if(actual!==expected)throw Error(actual+' expected '+expected);
   }
   if(width===390||width===1440){
    await p.evaluate(()=>{lang='ar';document.documentElement.lang='ar';document.documentElement.dir='rtl';renderAll();els.completeLectureBtn.hidden=false;els.cancelLectureBtn.hidden=false;HathirSyncReminder.update({uid:session.uid,count:3,ready:true,busy:true,percent:65,preview:true,unit:'changes'});});
    await p.screenshot({path:require('path').join(__dirname,'../reports/sync-controls-'+width+'.png')});
   }
   report.cases.push({label:width+'px Arabic/English controls and progress states',passed:true});
   await p.close();
  }
 }finally{await b.close();saveReport(report,'sync-controls-layout');}
})().catch(e=>{console.error(e);process.exitCode=1;});

