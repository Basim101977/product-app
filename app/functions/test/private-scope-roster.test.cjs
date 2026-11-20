const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('crypto');
const R=require('../../netlify_site/private-scope-roster'),M=require('../device-sync-model'),live=require('./live-fixture.cjs'),sharing=require('./private-share-fixture.cjs');
const row={id:'A',name:'أحمد علي',faceDescriptors:[Array(128).fill(.1)]};
const p={choices:{faces:true,attendance:false},scope:{studyPeriod:'morning'},students:[row]};
const config={id:'scope_one',departmentId:'d',stageId:'g',inviteId:'invite1'};
const subject=(id,extra={})=>({id,departmentId:'d',stageId:'g',students:[],attendance:{day:{X:{time:'08:00'}}},...extra});
test('Local names seed a new course without a scope registry and repair peer gaps on addition',()=>{
 const data={subjects:{a:subject('a',{students:[row]}),b:subject('b'),night:subject('night',{studyPeriod:'evening'}),other:subject('other',{stageId:'g2'}),copy:subject('copy',{privateShareSource:'x'}),reset:subject('reset',{rosterCohortId:'device_reset'})}},before=structuredClone(data);
 assert.equal(R.seed(subject('new'),data).students.length,1);
 const result=R.distribute(data,data.subjects.a,[{id:'B',name:'طالب جديد'}]);assert.deepEqual(Object.keys(result.subjects),['a','b']);assert.equal(result.subjects.b.students.length,2);assert.deepEqual(result.subjects.b.attendance,before.subjects.b.attendance);assert.deepEqual(data,before);
});
test('Propagation keeps local identifiers and never restores archived students or deliberately cleared courses',()=>{
 const data={subjects:{a:subject('a',{students:[row]}),b:subject('b',{students:[{id:'local',name:'احمد علي'}]}),c:subject('c',{archivedStudents:[row]})}};
 const result=R.distribute(data,data.subjects.a,[{id:'B',name:'طالب جديد'}]);assert.equal(result.subjects.b.students[0].id,'local');assert.equal(result.subjects.c.students.some(s=>s.id==='A'),false);
 assert.equal(R.seed(subject('reset',{rosterCohortId:'device_x'}),data).students.length,0);
 assert.equal(R.distribute(data,data.subjects.a,[{id:'remote',name:'احمد علي'}]).accepted[0].id,'A');
});
test('Scope import targets matching courses only and leaves history copies, other stages, departments and evenings unchanged',()=>{
 const data={subjects:{a:subject('a'),b:subject('b'),c:subject('c',{studyPeriod:'evening'}),d:subject('d',{stageId:'g2'}),e:subject('e',{departmentId:'d2'}),f:subject('f',{privateShareSource:'old'})}},before=structuredClone(data);
 const plan=R.plan(data,p,config);assert.deepEqual(Object.keys(plan.subjects),['a','b']);assert.equal(plan.subjects.a.students.length,1);assert.deepEqual(plan.subjects.a.attendance,before.subjects.a.attendance);assert.deepEqual(data,before);
});
test('Accept with no courses stores scope roster without inventing a subject; future correct course is seeded',()=>{
 const data={subjects:{}},plan=R.plan(data,p,config);assert.deepEqual(plan.subjects,{});data.scopeRosters={[config.id]:plan.record};assert.deepEqual(R.seed(subject('new'),data).students,[row]);assert.deepEqual(R.seed(subject('night',{studyPeriod:'evening'}),data).students,[]);
});
test('Existing names, faces and extra fields are preserved while incoming templates join the private scope',()=>{
 const local={...row,faceDescriptors:[Array(128).fill(.5)],custom:'keep'},data={subjects:{a:subject('a',{students:[local]})}};const plan=R.plan(data,p,config);assert.equal(plan.subjects.a.students[0].custom,'keep');assert.deepEqual(plan.subjects.a.students[0].faceDescriptors.map(d=>d[0]),[.5,.1]);assert.deepEqual(plan.record.students[0].faceDescriptors.map(d=>d[0]),[.5,.1]);
 const empty=R.plan({subjects:{a:subject('a',{students:[{id:'A',name:row.name,custom:'keep'}]})}},p,config);assert.equal(empty.subjects.a.students[0].faceDescriptors[0][0],.1);assert.equal(empty.subjects.a.students[0].custom,'keep');
});
test('Same ID different name and archived student prevent partial import',()=>{
 for(const extra of [{students:[{id:'A',name:'شخص آخر'}]},{archivedStudents:[row]}]){const data={subjects:{a:subject('a'),b:subject('b',extra)}},before=structuredClone(data);assert.throws(()=>R.plan(data,p,config));assert.deepEqual(data,before);}
});

test('Share matches restricted spelling variants while retaining recipient IDs, names and attendance',()=>{
 for(const [local,incoming] of [['إبراهيم محمد مزهر كاظم','ابراهيم  محمد مزهر كاظم'],['فاطمة علي','فاطمه على'],['آمنة مُؤيد','امنه مويد'],['رائد عـلي','رايد علي']]){
  const original={id:'local',name:local,custom:'keep'},data={subjects:{a:subject('a',{students:[original],attendance:{day:{local:{present:true}}}})}},before=structuredClone(data);
  const payload={...p,students:[{...row,id:'remote',name:incoming}]};const result=R.plan(data,payload,config);
  assert.equal(result.subjects.a.students.length,1);assert.equal(result.subjects.a.students[0].id,'local');assert.equal(result.subjects.a.students[0].name,local);assert.equal(result.subjects.a.students[0].custom,'keep');assert.equal(result.subjects.a.students[0].faceDescriptors[0][0],.1);assert.deepEqual(result.subjects.a.attendance,before.subjects.a.attendance);assert.deepEqual(data,before);
  data.subjects=result.subjects;data.scopeRosters={[config.id]:result.record};assert.equal(R.plan(data,payload,config).record.students.length,1);
 }
});
test('Spelling matching refuses ambiguous lists and archived equivalent names without mutation',()=>{
 for(const data of [{subjects:{a:subject('a',{students:[{id:'x',name:'فاطمة علي'},{id:'y',name:'فاطمه علي'}]})}},{subjects:{a:subject('a',{archivedStudents:[{id:'old',name:'فاطمه علي'}]})}}]){const before=structuredClone(data);assert.throws(()=>R.plan(data,{...p,students:[{...row,name:'فاطمة علي'}]},config));assert.deepEqual(data,before);}
 assert.throws(()=>R.merge([],[{id:'x',name:'فاطمة علي'},{id:'y',name:'فاطمه علي'}]));
 assert.equal(R.merge([{id:'x',name:'حسن علي'}],[{id:'y',name:'حسين علي'}]).length,2);
});
test('Differently identified local records keep their faces and history during name-equivalent acceptance',()=>{
 const a={id:'local-a',name:row.name,faceDescriptors:[Array(128).fill(.4)]},b={id:'local-b',name:'احمد علي',faceDescriptors:[Array(128).fill(.6)]};
 const data={subjects:{a:subject('a',{students:[a]}),b:subject('b',{students:[b]})}};const result=R.plan(data,p,config);
 assert.equal(result.subjects.a.students[0].id,a.id);assert.equal(result.subjects.b.students[0].id,b.id);assert.deepEqual(result.subjects.a.students[0].faceDescriptors,a.faceDescriptors);assert.deepEqual(result.subjects.b.students[0].faceDescriptors,b.faceDescriptors);
});
test('Retry is idempotent and scope records survive flatten/materialize with per-student bounded records',()=>{
 const data={workspace:{id:'owner'},subjects:{}},plan=R.plan(data,p,config);data.scopeRosters={[config.id]:plan.record};const again=R.plan(data,p,config);assert.equal(again.record.receivedInvites.length,1);assert.equal(again.record.students.length,1);
 const values=M.flatten(data),round=M.materialize(values,data);assert.deepEqual(round.scopeRosters,data.scopeRosters);assert(!values[M.key(['scopeRoster',config.id])].students);assert.deepEqual(M.parents(['scopeStudent','scope_one','A']),[['scopeRoster','scope_one']]);
});
test('300 students / 1500 face templates use small sync operations and round trip through real handler',async()=>{
 const f=live();await f.call({action:'bootstrap'});const students=Array.from({length:300},(_,i)=>({id:'s'+i,name:'طالب '+i,faceDescriptors:Array.from({length:5},()=>Array(128).fill(.123456789))}));
 const data={workspace:{id:'owner'},subjects:{},scopeRosters:{scope_one:{...config,students}}},ops=M.diff({},M.flatten(data),randomUUID);assert.equal(ops.length,301);assert(ops.every(op=>Buffer.byteLength(JSON.stringify(op))<300000));
 for(let i=0;i<ops.length;i+=20){const r=await f.call({action:'push',operations:ops.slice(i,i+20).map(o=>({...o,expected:0}))});assert(r.results.every(x=>x.status==='accepted'));}
 let cursor=0,values={};for(;;){const r=await f.call({action:'pull',cursor});for(const x of r.records)values[M.key(x.path)]=x.value;cursor=r.cursor;if(!r.more)break;}
 assert.deepEqual(M.materialize(values,data).scopeRosters,data.scopeRosters);
});
test('Old clients cannot accept a scope invitation as a material; new client can',async()=>{
 const f=sharing(),id=randomUUID(),snapshot={...p,scope:{departmentId:'d',departmentName:'قسم',stageNumber:1,studyPeriod:'morning'},subject:{titleAr:'مادة'}};
 await f.call({action:'send',id,email:'b@example.test',recipientUid:'b',authorized:true,snapshot});await assert.rejects(f.call({action:'accept',id,confirmed:true},'b'),e=>e.code==='failed-precondition');assert.equal((await f.call({action:'list'},'b')).entries[0].status,'pending');
 assert.equal((await f.call({action:'accept',id,confirmed:true,scopeRosterSupport:true},'b')).status,'accepted');
});

test('Local enrollment spans same scope only, preserving fields and history; no absent student is created',()=>{
 const data={subjects:{a:subject('a',{students:[{...row,custom:1}]}),b:subject('b',{students:[{id:'A',name:row.name,custom:2}]}),empty:subject('empty'),night:subject('night',{studyPeriod:'evening',students:[row]}),copy:subject('copy',{privateShareSource:'x',students:[row]})}};
 const before=structuredClone(data),plan=R.enroll(data,data.subjects.a,row,[Array(128).fill(.4)],'scope_local');assert.deepEqual(data,before);assert.deepEqual(Object.keys(plan.subjects),['a','b','empty']);assert.equal(plan.subjects.b.students[0].custom,2);assert.equal(plan.subjects.b.students[0].faceDescriptors[0][0],.4);assert.equal(plan.subjects.empty.students.length,0);assert.deepEqual(plan.subjects.a.attendance,before.subjects.a.attendance);assert.equal(plan.record.faceRegistryOnly,true);
});
test('Ambiguous same-ID/different-name and same-name/different-ID templates are never projected or enrolled',()=>{
 for(const other of [{id:'A',name:'different'},{id:'B',name:row.name}]){const data={subjects:{a:subject('a',{students:[row]}),b:subject('b',{students:[other]})}};R.project(data);assert.equal(data.subjects.b.students[0].faceDescriptors,undefined);assert.throws(()=>R.enroll(data,data.subjects.a,row,[Array(128).fill(.4)],'scope_local'),/هوية/);}
});
test('Canonical deletion overrides old material templates and survives sync serialization',()=>{
 const data={workspace:{id:'owner'},subjects:{a:subject('a',{students:[structuredClone(row)]}),b:subject('b',{students:[structuredClone(row)]})}};const plan=R.enroll(data,data.subjects.a,row,[],'scope_local');data.scopeRosters={[plan.record.id]:plan.record};const restored=M.materialize(M.flatten(data),data);R.project(restored);assert.equal(restored.subjects.a.students[0].faceDescriptors.length,0);assert.equal(restored.subjects.b.students[0].faceDescriptors.length,0);assert.equal(R.seed(subject('new'),data).students.length,1);assert.equal(R.seed(subject('new'),data).students[0].faceDescriptors.length,0);
});
test('Received names/faces promote a local face registry and later enrollment reaches future materials',()=>{
 const data={subjects:{a:subject('a',{students:[row]})}};const local=R.enroll(data,data.subjects.a,row,[Array(128).fill(.4)],config.id);data.scopeRosters={[config.id]:local.record};const received=R.plan(data,p,config);assert.equal(received.record.faceRegistryOnly,undefined);assert.equal(received.record.students[0].faceDescriptors[0][0],.4);data.scopeRosters[config.id]=received.record;const next=R.seed(subject('new'),data);assert.equal(next.students[0].faceDescriptors[0][0],.4);assert.equal(next.students[0].sharedFaces,undefined);
});
test('Canonical empty face is not resurrected by a later names-only invitation',()=>{
 const data={subjects:{a:subject('a',{students:[row]})}},deleted=R.enroll(data,data.subjects.a,row,[],config.id);data.scopeRosters={[config.id]:deleted.record};const received=R.plan(data,{...p,choices:{faces:false,attendance:false},students:[{id:row.id,name:row.name}]},config);assert.equal(received.subjects.a.students[0].faceDescriptors.length,0);
});

test('Projection updates each scanner cache even when two materials share the same student object',()=>{
 const shared=structuredClone(row),old=new Map([['A',row.faceDescriptors]]),data={subjects:{a:subject('a',{students:[shared],faceTemplateDescriptors:old}),b:subject('b',{students:[shared],faceTemplateDescriptors:new Map(old)})},scopeRosters:{scope_one:{...config,students:[{...row,sharedFaces:true,faceDescriptors:[Array(128).fill(.9)]}]}}};R.project(data);assert.notEqual(data.subjects.a.faceTemplateDescriptors,old);for(const s of Object.values(data.subjects))assert.equal(s.faceTemplateDescriptors.get('A')[0][0],.9);
});
