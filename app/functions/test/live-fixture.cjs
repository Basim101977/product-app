'use strict';
const assert=require('node:assert/strict');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
module.exports=()=>{
 const validate=(value,inArray=false)=>{if(Array.isArray(value)){assert(!inArray,'Firestore rejects nested arrays');value.forEach(v=>validate(v,true));}else if(value&&typeof value==='object')Object.values(value).forEach(v=>validate(v,false));};
 const records=new Map();let gate=Promise.resolve(),allowed=true;
 const snap=path=>({exists:records.has(path),id:path.split('/').at(-1),data:()=>structuredClone(records.get(path))});
 const ref=path=>({path,id:path.split('/').at(-1),collection:name=>collection(path+'/'+name),get:async()=>snap(path)});
 const collection=(path,filter=null,limit=Infinity)=>({doc:id=>ref(path+'/'+id),where:(field,operator,value)=>collection(path,{field,value},limit),orderBy:()=>collection(path,filter,limit),limit:n=>collection(path,filter,n),get:async()=>{const docs=[...records.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1).map(snap).filter(s=>!filter||s.data()[filter.field]>filter.value).sort((a,b)=>a.data().seq-b.data().seq).slice(0,limit);return {docs,empty:!docs.length,size:docs.length};}});
 const db={collection,runTransaction:fn=>{const run=gate.catch(()=>{}).then(async()=>{const staged=[];let wrote=false;const result=await fn({get:async r=>{assert(!wrote,'All reads precede writes');return snap(r.path);},set:(r,d)=>{validate(d);wrote=true;staged.push([r.path,d]);}});staged.forEach(([p,d])=>records.set(p,structuredClone(d)));return result;});gate=run;return run;}};
 const handler=require('../device-live-sync')({db,onCall:(_,fn)=>fn,HttpsError,authorisedWorkspaceOwner:async()=>{if(!allowed)throw new HttpsError('permission-denied','Disabled');}}).deviceLiveSync;
 const call=(data,uid='owner')=>handler({auth:uid?{uid}:null,data:{workspaceId:uid,...data}});
 return {records,call,disable:()=>allowed=false};
};
