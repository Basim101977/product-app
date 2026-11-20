const test=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./offline-corrections-server.test.cjs');
test('Name-based student keys and duplicate suffixes synchronize independently without numeric student codes',async()=>{
 const h=createHarness();h.reset();
 const rows=[{id:'أحمدعلي',name:'أحمد علي'},{id:'أحمدعلي2',name:'أحمد علي 2'}];
 for(const row of rows)h.records.set(h.cohortPath+'/students/'+row.id,row);
 const operations=rows.map(row=>h.operation('mark',{studentId:row.id,studentName:row.name}));
 await h.accepted(operations);
 for(const row of rows){const mark=h.records.get(h.markPath(operations[0].date,row.id));assert.equal(mark.studentName,row.name);assert.equal(mark.studentId,row.id);}
});
