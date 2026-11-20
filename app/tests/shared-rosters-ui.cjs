'use strict';
const {launch,makeReport,check,saveReport,assert,fs,path,APP,REPORTS}=require('./offline-harness.cjs');const vm=require('vm');
const src=fs.readFileSync(path.join(APP,'tests/personal-ui-regression.cjs'),'utf8');
const fixture=vm.runInNewContext(src.slice(src.indexOf('async function installCallables'),src.indexOf('const row ='))+';({installWorkspace})');
const report=makeReport('shared-rosters-ui');
async function setup(p,owner){await p.waitForFunction(()=>!!window.HathirSharedRosters);await fixture.installWorkspace(p);await p.evaluate(owner=>{
 const s=subjects[0],root='attendanceWorkspaces/'+session.uid;personalFixture.records[root+'/subjects/'+s.id]={id:s.id,departmentId:s.departmentId,stageId:s.stageId,academicYearStart:s.academicYearStart,stageNumber:s.stageNumber,departmentPrefix:s.departmentPrefix};const cohort=root+'/cohorts/'+cohortIdForSubject(s);personalFixture.records[cohort]={rosterVersion:1};s.students.forEach(x=>personalFixture.records[cohort+'/students/'+x.id]={...x});
 canManageRegistration=()=>owner;window.sharedCalls=[];window.sharedVersion=1;
 const prior=fixtureInvoke;fixtureInvoke=async(name,data)=>{if(name!=='sharedStudentRoster')return prior(name,data);sharedCalls.push(data);const scope={department:'تقنيات الأجهزة الطبية',stage:'الثانية'};
 if(data.action==='check')return {scope,available:true,revision:sharedVersion,accepted:0,count:2,updateAvailable:true};
 if(data.action==='previewPublish')return {scope,revision:sharedVersion,token:'test',count:2,names:['طالب تجريبي أول','طالب تجريبي ثان']};
 if(data.action==='publish')return {published:true,revision:++sharedVersion};
 if(data.action==='preview')return {scope,revision:sharedVersion,token:'test',count:2,added:1,renamed:0,changes:[{kind:'add',name:'طالب جديد'},{kind:'editedLocally',name:'تعديل الأستاذ'}]};
 if(data.action==='apply'){personalFixture.records[cohort+'/students/new_shared']={id:'new_shared',name:'طالب جديد'};personalFixture.records[root+'/subjects/'+s.id].sharedRosterSubscriptionId='test_subscription';return {applied:true,added:1};}};renderAll();
 },owner);}
(async()=>{const h=await launch(report);try{
 for(const width of [390,1440])await check(report,`${width}px owner explicitly previews and publishes names-only; draft viewing never publishes`,async()=>{
 const {page:p,context:c}=await h.page({width});try{await setup(p,true);await p.locator('#expandAttendanceRecordBtn').click();assert.equal(await p.locator('#beginnerRecordDialog').evaluate(dialog=>dialog.open),true);await p.locator('#publishSharedRoster').click();assert.equal(await p.locator('#sharedRosterDialog').evaluate(dialog=>dialog.open),true);await p.locator('#sharedRosterConfirm').waitFor({state:'visible'});assert((await p.locator('#sharedRosterSummary').textContent()).includes('لن تُشارك حالات'));assert.equal(await p.evaluate(()=>sharedCalls.some(x=>x.action==='publish')),false);
 await p.screenshot({path:path.join(REPORTS,`shared-owner-${width}.png`)});const box=await p.locator('#sharedRosterDialog').boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);
 await p.locator('#sharedRosterConfirm').click();await p.waitForFunction(()=>document.getElementById('sharedRosterStatus').textContent.includes('تم نشر'));assert.equal(await p.evaluate(()=>sharedCalls.filter(x=>x.action==='publish').length),1);await p.locator('#sharedRosterClose').click();assert.equal(await p.locator('#beginnerRecordDialog').evaluate(dialog=>dialog.open&&dialog.contains(document.getElementById('attendanceRecordCard'))),true);await p.locator('#beginnerRecordClose').click();
 }finally{await c.close();}});
 await check(report,'Teacher receives notification, cannot see publish action, reviews and cancels without writes',async()=>{
 const {page:p,context:c}=await h.page({width:390});try{await setup(p,false);assert.equal(await p.locator('#publishSharedRoster').isVisible(),false);await p.evaluate(()=>HathirSharedRosters.check(true));await p.locator('#sharedRosterAvailable').click();await p.locator('#sharedRosterConfirm').waitFor({state:'visible'});assert((await p.locator('#sharedRosterList').textContent()).includes('احتفاظ بتعديلك'));await p.screenshot({path:path.join(REPORTS,'shared-teacher-390.png')});await p.locator('#sharedRosterClose').click();assert.equal(await p.evaluate(()=>sharedCalls.some(x=>x.action==='apply')),false);
 }finally{await c.close();}});
 await check(report,'Teacher explicitly applies reviewed update and the private roster remains usable',async()=>{
 const {page:p,context:c}=await h.page({width:390});try{await setup(p,false);await p.locator('#viewSharedRoster').click();await p.locator('#sharedRosterConfirm').waitFor({state:'visible'});await p.locator('#sharedRosterConfirm').click();await p.waitForFunction(()=>document.getElementById('sharedRosterStatus').textContent.includes('تم اعتماد'));assert.equal(await p.evaluate(()=>sharedCalls.filter(x=>x.action==='apply').length),1);assert((await p.locator('#rosterRows').textContent()).includes('طالب جديد'));assert.equal(await p.evaluate(()=>subjects[0].academicStatuses.MI20250002),'مستوفي');await p.locator('#sharedRosterClose').click();assert(await p.locator('#rosterRows tr').count()>0);
 }finally{await c.close();}});
 await check(report,'Offline shared action fails clearly without blocking the existing roster',async()=>{
 const {page:p,context:c}=await h.page({width:390});try{await setup(p,false);await p.evaluate(()=>{session.offlineMode=true;});await p.locator('#viewSharedRoster').click();await p.waitForFunction(()=>document.getElementById('sharedRosterStatus').textContent.includes('تحتاج اتصالاً'));assert.equal(await p.locator('#sharedRosterConfirm').isVisible(),false);await p.locator('#sharedRosterClose').click();assert(await p.locator('#rosterRows tr').count()>0);
 }finally{await c.close();}});
 await check(report,'Repeated renders reuse background result and a workspace switch closes stale preview',async()=>{
 const {page:p,context:c}=await h.page({width:390});try{await setup(p,false);await p.evaluate(()=>HathirSharedRosters.check(true));await p.evaluate(()=>{for(let i=0;i<8;i++)renderAll();});await p.waitForTimeout(1900);assert.equal(await p.evaluate(()=>sharedCalls.filter(x=>x.action==='check').length),1);
 await p.locator('#viewSharedRoster').click();await p.locator('#sharedRosterConfirm').waitFor({state:'visible'});await p.evaluate(()=>{session=null;HathirSharedRosters.refresh();});assert.equal(await p.locator('#sharedRosterDialog').isVisible(),false);
 }finally{await c.close();}});
 }finally{await h.close();}saveReport(report,'shared-rosters-ui');if(!report.passed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
