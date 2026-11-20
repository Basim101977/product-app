'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRebuilder}=require('../cumulative-attendance');
function fixture(changeBeforePublish=false){
 const root='attendanceWorkspaces/qa/subjects/s',cohort='attendanceWorkspaces/qa/cohorts/c';
 const rows=new Map([[root,{rosterCohortId:'c'}],[cohort,{rosterVersion:1}],[cohort+'/students/A',{id:'A',name:'Synthetic A'}]]);
 for(let d=1;d<=9;d++){const path=root+'/lectures/2026-01-'+String(d).padStart(2,'0');rows.set(path,{status:'completed',startTime:'09:00',durationMinutes:120});rows.set(path+'/marks/A',{attendedMinutes:100});}
 let active=0,max=0,transactions=0,historyReads=0;
 const ref=(path,isCollection=false)=>({path,id:path.split('/').at(-1),get parent(){return ref(path.split('/').slice(0,-1).join('/'),!isCollection);},collection:name=>ref(path+'/'+name,true),doc:id=>ref(path+'/'+id),get:()=>read(ref(path,isCollection)),isCollection});
 const snapshot=r=>({id:r.id,ref:r,exists:rows.has(r.path),data:()=>structuredClone(rows.get(r.path)),updateTime:{isEqual:()=>true}});
 async function read(r){
  if(!r.isCollection)return snapshot(r);
  const history=/\/(marks|excuses)$/.test(r.path);
  if(history){active++;historyReads++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,r.path.includes('01-01')?4:1));active--;}
  return {docs:[...rows.keys()].filter(key=>key.startsWith(r.path+'/')&&key.split('/').length===r.path.split('/').length+1).reverse().map(key=>snapshot(ref(key)))};
 }
 const db={collection:name=>ref(name,true),runTransaction:async work=>{
  transactions++;if(changeBeforePublish&&transactions===3)rows.set(root+'/lectures/2026-01-01/marks/A',{attendedMinutes:5});
  const writes=[];const result=await work({get:r=>{assert.equal(writes.length,0);return read(r);},getAll:(...refs)=>Promise.all(refs.map(read)),set:(r,data)=>writes.push(()=>rows.set(r.path,{...rows.get(r.path),...data}))});writes.forEach(write=>write());return result;
 }};
 const rebuild=createRebuilder({db,Timestamp:{now:()=>123},HttpsError:Error,cohortIdForSubject:()=> 'c',policyForSubject:()=>({version:1}),absenceStatus:()=> 'ok',attendanceMinutes:()=>100,baghdadParts:()=>({date:'2026-09-23'}),now:()=>Date.parse('2026-09-23T12:00:00Z')});
 return {rebuild,rows,root,stats:()=>({max,historyReads})};
}
test('Bounded concurrent summary reads keep all lectures and cumulative totals',async()=>{
 const f=fixture(),result=await f.rebuild('qa','s');assert(result.applied);assert.equal(result.lectures,9);assert.equal(result.referenceMinutes,900);
 assert(f.stats().max>2&&f.stats().max<=8);assert.equal(f.stats().historyReads,36);assert.equal(f.rows.get(f.root).summaryState,'ready');
});
test('A history change before final publication retains the pending summary fence',async()=>{
 const f=fixture(true),result=await f.rebuild('qa','s');assert(result.queued);assert.equal(f.rows.get(f.root).summaryState,'pending');assert(!f.rows.get(f.root).summarySourceFingerprint);
});
