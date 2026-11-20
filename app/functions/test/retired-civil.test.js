const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),M=require('../device-sync-model'),fixture=require('./live-fixture.cjs');
test('Retirement removes only old civil data, retaining branches and other student history',()=>{
 const data={departments:{civil_techniques:{id:'civil_techniques'},civil_building:{id:'civil_building'},civil_roads:{id:'civil_roads'}},stages:{old:{departmentId:'civil_techniques'},new:{departmentId:'civil_roads'}},subjects:{old:{departmentId:'civil_techniques',students:[{faceDescriptors:[[1,2]]}],attendance:{x:{a:1}}},new:{departmentId:'civil_building',students:[{id:'keep'}],attendance:{day:{keep:'09:00'}}}},scopeRosters:{old:{departmentId:'civil_techniques'},new:{departmentId:'civil_roads'}}};
 const keep=JSON.stringify(data.subjects.new);assert(M.purgeRetiredCivil(data));assert(!data.departments.civil_techniques&&!data.subjects.old&&!data.scopeRosters.old);assert.equal(JSON.stringify(data.subjects.new),keep);assert(data.departments.civil_roads&&data.departments.civil_building);assert.equal(M.purgeRetiredCivil(data),false);
});
test('Server rejects stale department, stage, subject and roster creation from old devices',async()=>{
 const f=fixture();await f.call({action:'bootstrap'});
 for(const [path,value]of [[['departments','civil_techniques'],{id:'civil_techniques'}],[['stages','civil_techniques_stage_2'],{departmentId:'civil_techniques'}],[['subject','old'],{departmentId:'civil_techniques'}],[['scopeRoster','old'],{departmentId:'civil_techniques'}]]){
 const r=await f.call({action:'push',operations:[{id:crypto.randomUUID(),path,value,before:null,expected:0}]});assert.equal(r.results[0].reason,'retired-department');}
 assert(!(await f.call({action:'pull',cursor:0})).records.length);
 for(const r of f.records.values())if(r.payloadJson)assert.equal(JSON.parse(r.payloadJson).operation.value,null);
});
test('Old child payloads cannot reintroduce names or faces through receipts after parent deletion',async()=>{
 const f=fixture();await f.call({action:'bootstrap'});const id=crypto.randomUUID();
 const result=await f.call({action:'push',operations:[{id,path:['student','deleted_subject','old_student'],value:{name:'PRIVATE-OLD-NAME',faceDescriptors:[[1,2,3]]},before:null,expected:0}]});
 assert.equal(result.results[0].reason,'parent-deleted');
 assert(!JSON.stringify([...f.records.values()]).includes('PRIVATE-OLD-NAME'));
 assert(!JSON.stringify([...f.records.values()]).includes('faceDescriptors'));
});
