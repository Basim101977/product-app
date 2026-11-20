'use strict';
// Read only. Count the authoritative cloud representation, never sum a live
// workspace and its retained backup (which would count the same lecture twice).
const usable=value=>value && !value.deleted && !value.restorationInProgress && !['cancelled','voided','deleted'].includes(value.status);
const countSubjects=subjects=>Object.values(subjects||{}).reduce((total,s)=>{
 if(!usable(s))return total;
 const dates=new Set([...(s.lectures||[]),...Object.keys(s.lectureMeta||{})]);
 return total+[...dates].filter(id=>usable(s.lectureMeta?.[id]||{})).length;
},0);
async function countOwnerLectures(db,uid){
 const root=db.collection('attendanceDeviceSync').doc(uid),state=await root.get();
 if(state.data()?.ready){
  // Project paths first so student portraits/descriptors and attendance marks
  // are never downloaded just to count lectures.
  const paths=await root.collection('records').select('path').get();
  const refs=paths.docs.filter(d=>['subject','lecture'].includes(d.data().path?.[0])).map(d=>d.ref);
  const records=[];for(let i=0;i<refs.length;i+=100)records.push(...await db.getAll(...refs.slice(i,i+100)));
  const subjects=new Set(),lectures=[];
  for(const d of records){if(!d.exists)continue;const r=d.data(),v=Object.hasOwn(r,'valueJson')?JSON.parse(r.valueJson):r.value;if(!usable(v))continue;if(r.path[0]==='subject')subjects.add(r.path[1]);else lectures.push(r.path);}
  if((await root.get()).data()?.seq!==state.data().seq)throw Error('Workspace changed; refresh the count');
  return {lectureCount:new Set(lectures.filter(p=>subjects.has(p[1])).map(p=>JSON.stringify(p))).size,source:'live',cloudOnly:true};
 }
 const copy=db.collection('attendanceDeviceCopies').doc(uid),head=await copy.get();
 if(head.data()?.revision){
  const h=head.data();if(!Number.isInteger(h.count)||h.count<1||h.count>512)throw Error('Invalid cloud copy');
  const version=copy.collection('versions').doc(h.revision),manifest=await version.get();if(!manifest.data()?.committed)throw Error('Incomplete cloud copy');
  const texts=[];for(let i=0;i<h.count;i+=8){const docs=await Promise.all(Array.from({length:Math.min(8,h.count-i)},(_,j)=>version.collection('chunks').doc(String(i+j)).get()));for(const d of docs){if(!d.exists)throw Error('Incomplete cloud copy');texts.push(d.data().text);}}
  const payload=JSON.parse(texts.join(''));if(payload.uid!==uid||payload.data?.workspace?.id!==uid)throw Error('Cloud copy identity mismatch');
  return {lectureCount:countSubjects(payload.data.subjects),source:'copy',cloudOnly:true};
 }
 const subjects=await db.collection('attendanceWorkspaces').doc(uid).collection('subjects').get();let total=0;
 for(const doc of subjects.docs){if(!usable(doc.data()))continue;const dates=new Map();for(const id of doc.data().lectures||[])dates.set(id,doc.data().lectureMeta?.[id]||{});for(const [id,m] of Object.entries(doc.data().lectureMeta||{}))dates.set(id,m);const rows=await doc.ref.collection('lectures').get();for(const row of rows.docs)dates.set(row.id,row.data());total+=[...dates.values()].filter(usable).length;}
 return {lectureCount:total,source:'legacy',cloudOnly:true};
}
module.exports={countOwnerLectures,countSubjects};
