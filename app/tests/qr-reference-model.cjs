const assert=require('node:assert/strict'),M=require('../netlify_site/consolidation-model.js'),qr=require('../netlify_site/name-qr.js');
const meta={department:'التقنيات الإلكترونية',stage:'2',period:'morning',year:'2026-2027'};
const course={id:'course',meta:{...meta,title:'دوائر',totalHours:60,referenceMinutes:240,notice:5,warning:7,fail:10},students:[{name:'أحمد علي',attended:120,absent:120,percent:120/3600*100,flag:'سليم'}]};
const ref={id:'ref',kind:'reference',allRequired:true,meta:{...meta,title:'القائمة المرجعية الكاملة'},students:[{name:'احمد  علي'},{name:'سارة حسن'},{name:'طالب لم يحضر مطلقا'}]};
let g=M.groups([course,ref])[0];
assert.equal(g.courses.length,1);assert.equal(g.students.length,3);
const missing=g.students.find(s=>s.name==='سارة حسن').values.course;
assert.equal(missing.attended,0);assert.equal(missing.absent,240);assert.equal(missing.percent,240/3600*100);assert.equal(missing.flag,'تنبيه');assert(missing.inferred);
assert.equal(g.students.find(s=>M.key(s.name)===M.key('أحمد علي')).values.course.attended,120);
assert.equal(M.groups([course])[0].students.length,1);
assert.throws(()=>M.groups([course,{...ref,allRequired:false}]));
g=M.groups([course,{...ref,meta:{...ref.meta,period:'evening'}}]);
assert.equal(g.length,2);assert.equal(g.find(x=>x.meta.period==='morning').students.length,1);
const old={...course,meta:{...meta,title:'قديم'}};
g=M.groups([old,ref])[0];assert.equal(g.students.find(s=>s.name==='سارة حسن').values.course.absent,null);
const noPolicy={...course,meta:{...meta,title:'بلا حدود',totalHours:60,referenceMinutes:120}};
assert.equal(M.groups([noPolicy,ref])[0].students.find(s=>s.name==='سارة حسن').values.course.flag,'حدود الغياب غير محددة');
const rows=[['القسم',meta.department],['المرحلة','الثانية'],['الدراسة','صباحي'],['السنة الدراسية','2026-2027'],[],['اسم الطالب'],['أحمد علي'],['سارة حسن']];
const parsed=M.parse(rows,{reference:true});assert.equal(parsed.kind,'reference');assert.equal(parsed.students.length,2);assert.throws(()=>M.validate(parsed));parsed.allRequired=true;M.validate(parsed);
for(const name of ['أحمد محمد حسن','Alice Smith','سارة  علي']){
 const payload=qr.encodePortable(name),decoded=qr.decode(payload);assert(decoded.ok&&decoded.version===3);assert.equal(qr.normalizeName(decoded.name),qr.normalizeName(name));
 assert.equal(qr.match(payload,[{subject:{id:'s'},student:{id:'A',name}}]).status,'match');
}
for(const v of ['H3:%00','H3:%E0%A4','H3:123','H3:https%3A%2F%2Fexample.com'])assert.equal(qr.decode(v).ok,false);
assert.equal(qr.decode(qr.encode('أحمد علي')).version,2);
console.log('PASS reference inference, absent-ever students, scope isolation, incomplete old reports, policy boundaries, reference confirmation, portable QR and legacy QR');
