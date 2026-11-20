const create=require('../private-roster-share');
module.exports=()=>{
 const records=new Map(),users=new Map(['a','b','c'].map(uid=>[uid,{uid,email:uid+'@example.test',displayName:'Teacher '+uid,emailVerified:true}]));let clock=1000000000,queue=Promise.resolve();
 const snap=path=>({id:path.split('/').at(-1),exists:records.has(path),data:()=>structuredClone(records.get(path))});
 const ref=path=>({path,collection:name=>collection(path+'/'+name),get:async()=>snap(path)});
 const collection=(path,limit=Infinity,filter=null,cursor=null)=>({doc:id=>ref(path+'/'+id),orderBy:()=>collection(path,limit,filter,cursor),where:(field,op,values)=>collection(path,limit,{field,values},cursor),startAfter:s=>collection(path,limit,filter,s.id),limit:n=>collection(path,n,filter,cursor),get:async()=>{let docs=[...records.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1).map(snap).filter(s=>!filter||filter.values.includes(s.data()[filter.field])).sort((a,b)=>(b.data().createdAt||0)-(a.data().createdAt||0)||b.id.localeCompare(a.id));if(cursor)docs=docs.slice(docs.findIndex(s=>s.id===cursor)+1);return {docs:docs.slice(0,limit)};}});
 const db={collection,runTransaction:fn=>{const run=queue.catch(()=>{}).then(async()=>{const writes=[];const result=await fn({get:async r=>{if(writes.length)throw Error('read after write');return snap(r.path);},set:(r,d)=>writes.push([r.path,structuredClone(d)]),delete:r=>writes.push([r.path,null])});for(const[p,d]of writes)d===null?records.delete(p):records.set(p,d);return result;});queue=run;return run;}};
 const approvedIdentity=async r=>{const user=users.get(r.auth?.uid);if(!user||user.disabled)throw Object.assign(Error('denied'),{code:'permission-denied'});return {user};};
 const handler=create({db,auth:{getUserByEmail:async email=>{const u=[...users.values()].find(u=>u.email===email);if(!u)throw Error('missing');return u;}},approvedIdentity,fail:(code,message)=>{throw Object.assign(Error(message),{code});},now:()=>clock});
 return {records,users,call:(data,uid='a')=>handler({auth:{uid},data}),advance:n=>clock+=n};
};
