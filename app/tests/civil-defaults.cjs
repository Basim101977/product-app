const {assert,makeReport,check,saveReport,launch}=require('./offline-harness.cjs');
const report=makeReport('civil-defaults');
(async()=>{const h=await launch(report);try{const {page:p,context}=await h.page();
 await check(report,'Old device workspace receives branches durably and removes retired department/student/history',async()=>{
  await p.evaluate(async()=>{
   personalFixture.verified=true;personalFixture.accountStatus='approved';fixtureAuth.currentUser=fixtureUser();
   const uid=personalFixture.uid,owner={uid,workspaceId:uid,role:'owner',active:true,local:false,permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[]};
   const data={workspace:{id:uid,ownerUid:uid},users:{[uid]:owner},departments:{civil_techniques:{id:'civil_techniques',nameAr:'قسم محفوظ',active:true}},stages:{civil_building_stage_2:{id:'civil_building_stage_2',departmentId:'civil_building',nameAr:'مرحلة محفوظة',sort:2,keep:true}},subjects:{saved:{id:'saved',departmentId:'civil_techniques',stageId:'old',titleAr:'مادة محفوظة',students:[{id:'one',name:'طالب محفوظ'}],attendance:{'2026-10-01':{one:{time:'09:00',method:'manual'}}},lectures:['2026-10-01'],lectureMeta:{'2026-10-01':{status:'completed',durationHours:2}},excuses:{}}}};
   window.civilOriginal=JSON.stringify(data.subjects.saved.attendance);
   await HathirDeviceStore.save({uid,session:owner,data,base:null,pendingClose:0,legacyOperations:[]},0);
   await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);
  });
  await p.waitForFunction(async()=>{const d=(await HathirDeviceStore.get(personalFixture.uid))?.data;return !!d?.departments?.civil_roads;});
  const r=await p.evaluate(async()=>{const d=(await HathirDeviceStore.get(personalFixture.uid)).data;return {names:['civil_building','civil_roads'].map(id=>d.departments[id].nameAr),old:!!d.departments.civil_techniques,history:!!d.subjects.saved,stages:Object.values(d.stages).length,protected:d.stages.civil_building_stage_2.keep};});
  assert.deepEqual(r.names,['التقنيات المدنية-بناء','التقنيات المدنية-طرق']);assert.equal(r.old,false);assert.equal(r.history,false);assert(r.protected);assert.equal(r.stages,10);
 });
 await check(report,'Repeated installation retains custom branch name and never duplicates stages',async()=>{
  const r=await p.evaluate(async()=>{const saved=await HathirDeviceStore.get(personalFixture.uid);saved.data.departments.civil_roads.nameAr='اسم مخصص';await HathirDeviceStore.save(saved,saved.revision);await HathirDeviceWorkspace.restoreLocal(fixtureAuth.currentUser);return {name:departments.find(d=>d.id==='civil_roads').nameAr,count:stages.filter(s=>['civil_building','civil_roads'].includes(s.departmentId)).length};});assert.equal(r.name,'اسم مخصص');assert.equal(r.count,10);
 });await context.close();}finally{await h.close();}saveReport(report,'civil-defaults');})().catch(e=>{console.error(e);process.exitCode=1;});
