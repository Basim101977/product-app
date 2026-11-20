'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPersonalService,OWNER_UID,OWNER_EMAIL}=require('../personal-workspace');
function fixture(){
 const rows=Array.from({length:235},(_,i)=>({id:'teacher_'+String(i).padStart(3,'0'),data:()=>({email:'teacher'+i+'@example.test',status:i%2?'approved':'pending',createdAt:{toMillis:()=>1000-i}})}));
 let active=0,maximum=0,userReads=0;
 const query=(start=0,limit=Infinity,filter=false)=>({
  orderBy:(field,direction)=>{assert.equal(field,'createdAt');assert.equal(direction,'desc');return query(start,limit,filter);},
  startAfter:doc=>query(rows.findIndex(row=>row.id===doc.id)+1,limit,filter),limit:n=>query(start,n,filter),
  where:(field,op,value)=>{assert.deepEqual([field,op,value],['status','==','pending']);return query(start,limit,true);},
  count:()=>({get:async()=>({data:()=>({count:rows.filter(row=>row.data().status==='pending').length})})}),
  doc:id=>({get:async()=>({...rows.find(row=>row.id===id),exists:rows.some(row=>row.id===id)})}),
  get:async()=>({docs:rows.filter(row=>!filter||row.data().status==='pending').slice(start,start+limit)})
 });
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const auth={getUser:async id=>{if(id===OWNER_UID)return {uid:id,email:OWNER_EMAIL,emailVerified:true};userReads++;active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));active--;return {uid:id,email:'teacher'+Number(id.slice(8))+'@example.test',emailVerified:true};}};
 const service=createPersonalService({db:{collection:name=>{assert.equal(name,'attendanceIndividualRequests');return query();}},auth,HttpsError,FieldValue:{serverTimestamp:()=>0}});
 const request=data=>({auth:{uid:OWNER_UID,token:{email:OWNER_EMAIL,email_verified:true}},data});
 return {service,request,stats:()=>({maximum,userReads})};
}
test('Owner pagination reaches every account once and bounds auth concurrency',async()=>{
 const f=fixture(),ids=[];let cursor;
 do{const page=await f.service.listPersonalRegistrations(f.request({cursor}));assert(page.requests.length<=100);assert(page.requests.every(row=>row.emailVerified));ids.push(...page.requests.map(row=>row.uid));cursor=page.nextCursor;}while(cursor);
 assert.equal(ids.length,235);assert.equal(new Set(ids).size,235);assert(f.stats().maximum<=10);assert.equal(f.stats().userReads,235);
});
test('Badge count includes pending accounts beyond first page without auth fan-out',async()=>{
 const f=fixture();assert.deepEqual(await f.service.listPersonalRegistrations(f.request({countOnly:true})),{pendingCount:118});assert.equal(f.stats().userReads,0);
});
test('Invalid and deleted pagination cursors fail explicitly',async()=>{
 const f=fixture();await assert.rejects(f.service.listPersonalRegistrations(f.request({cursor:'bad/path'})),e=>e.code==='invalid-argument');
 await assert.rejects(f.service.listPersonalRegistrations(f.request({cursor:'missing'})),e=>e.code==='failed-precondition');
});
