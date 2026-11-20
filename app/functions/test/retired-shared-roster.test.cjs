const {test}=require('node:test'),assert=require('node:assert/strict');
const factory=require('../retired-shared-roster');
for(const role of ['teacher','owner'])for(const action of ['check','preview','apply','previewPublish','publish'])test(`Retired shared roster rejects ${role} ${action} without storage access`,async()=>{
 let authenticated=0;const call=factory({approvedIdentity:async r=>{assert.equal(r.auth.uid,role);authenticated++;},fail:(code,message)=>{throw Object.assign(Error(message),{code});}});
 await assert.rejects(call({auth:{uid:role},data:{action}}),e=>e.code==='failed-precondition'&&e.message.includes('مشاركة'));
 assert.equal(authenticated,1);
});
test('Retired endpoint retains identity validation',async()=>{
 const call=factory({approvedIdentity:async()=>{throw Object.assign(Error('no auth'),{code:'unauthenticated'});},fail:()=>assert.fail('Should authenticate first')});
 await assert.rejects(call({data:{action:'publish'}}),e=>e.code==='unauthenticated');
});
test('Published export uses retirement handler, not legacy publication implementation',()=>{
 const source=require('fs').readFileSync(require('path').join(__dirname,'../index.js'),'utf8');
 assert(!/\["accountPresence", "sharedStudentRoster"/.test(source));
 assert.match(source,/exports\.sharedStudentRoster = onCall\([^\n]+retired-shared-roster/);
});
