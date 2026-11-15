/* Shared, deterministic data model. No network or storage side effects. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.HathirSyncModel=api;})(globalThis,()=>{
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const equal=(a,b)=>stable(a??null)===stable(b??null);
  const key=path=>JSON.stringify(path);
  const transient=/^(?:_|rosterLoaded$|attendanceLoaded$|lectureIndexLoaded$|lectureIndexComplete$|historyPending$|historyError$|liveLoadPending$|liveLoadError$|cachedDisplayOnly$|offlineEpochPending$|loadedLectureDates$|loadedSummaryStudentIds$|faceTemplateDescriptors$|faceTemplatesLoaded$|summaryLoaded$|attendanceSummaries$|attendanceStatsDirty$|rosterSource$)/;
  function purgeRetiredCivil(data){
    let changed=false;const drop=(map,id)=>{if(map&&Object.hasOwn(map,id)){delete map[id];changed=true;}};
    drop(data.departments,'civil_techniques');
    for(const [id,value]of Object.entries(data.stages||{}))if(value.departmentId==='civil_techniques')drop(data.stages,id);
    for(const kind of ['subjects','scopeRosters'])for(const[id,value]of Object.entries(data[kind]||{}))if(value.departmentId==='civil_techniques')drop(data[kind],id);
    return changed;
  }
  function flatten(data){
    data=clone(data);purgeRetiredCivil(data);
    const out={};const put=(path,value)=>{out[key(path)]=clone(value);};
    for(const kind of ['departments','stages'])for(const [id,value] of Object.entries(data[kind]||{}))put([kind,id],value);
    for(const [id,r] of Object.entries(data.scopeRosters||{})){
      const {students=[],...meta}=r;put(['scopeRoster',id],meta);
      for(const student of students)put(['scopeStudent',id,student.id],student);
    }
    for(const [id,s] of Object.entries(data.subjects||{})){
      const meta={};for(const [field,value] of Object.entries(s))if(!transient.test(field)&&!['students','lectures','lectureMeta','attendance','excuses'].includes(field))meta[field]=value;
      put(['subject',id],meta);
      for(const student of s.students||[])put(['student',id,student.id],student);
      for(const [date,meta] of Object.entries(s.lectureMeta||{}))put(['lecture',id,date],meta);
      for(const [field,kind] of [['attendance','mark'],['excuses','excuse']])for(const [date,students] of Object.entries(s[field]||{}))for(const [student,value] of Object.entries(students||{}))put([kind,id,date,student],value);
    }
    return out;
  }
  function parents(path){
    if(path[0]==='scopeStudent')return [['scopeRoster',path[1]]];
    if(['student','lecture'].includes(path[0]))return [['subject',path[1]]];
    if(['mark','excuse'].includes(path[0]))return [['subject',path[1]],['lecture',path[1],path[2]],['student',path[1],path[3]]];
    return [];
  }
  function materialize(values,local){
    const data={workspace:clone(local.workspace),users:clone(local.users||{}),departments:{},stages:{},subjects:{}};
    for(const [k,value] of Object.entries(values))if(value!==null){const p=JSON.parse(k);if(p[0]==='scopeRoster'){data.scopeRosters||={};data.scopeRosters[p[1]]={...clone(value),students:[]};}}
    for(const [k,value] of Object.entries(values))if(value!==null){const p=JSON.parse(k);if(p[0]==='scopeStudent'&&data.scopeRosters?.[p[1]])data.scopeRosters[p[1]].students.push(clone(value));}
    for(const [k,value] of Object.entries(values))if(value!==null){const p=JSON.parse(k);if(['departments','stages'].includes(p[0]))data[p[0]][p[1]]=clone(value);if(p[0]==='subject')data.subjects[p[1]]={...clone(value),students:[],lectures:[],lectureMeta:{},attendance:{},excuses:{}};}
    for(const [k,value] of Object.entries(values))if(value!==null){const p=JSON.parse(k),s=data.subjects[p[1]];if(!s)continue;if(p[0]==='student')s.students.push(clone(value));if(p[0]==='lecture'){s.lectures.push(p[2]);s.lectureMeta[p[2]]=clone(value);}}
    for(const [k,value] of Object.entries(values))if(value!==null){const p=JSON.parse(k),s=data.subjects[p[1]];if(!s||!s.lectureMeta[p[2]])continue;const field=p[0]==='mark'?'attendance':p[0]==='excuse'?'excuses':null;if(field){s[field][p[2]]||={};s[field][p[2]][p[3]]=clone(value);}}
    purgeRetiredCivil(data);return data;
  }
  function diff(before,after,uuid){
    const operations=[];
    for(const k of new Set([...Object.keys(before),...Object.keys(after)]))if(!equal(before[k],after[k]))operations.push({id:uuid(),path:JSON.parse(k),before:before[k]??null,value:after[k]??null});
    // Parent creation precedes child creation; deletions remain durable barriers.
    return operations.sort((a,b)=>parents(a.path).length-parents(b.path).length);
  }
  function overlay(records,queue,conflicts=[]){const values={};for(const [k,r] of Object.entries(records))values[k]=r.value;for(const op of [...queue,...conflicts])values[key(op.path)]=op.value;return values;}
  function lectureId(subjectId,day,previous){
    // Stable successor: two devices starting the next lecture from the same
    // shared predecessor allocate the same ID, without waiting for a network.
    const text=JSON.stringify([subjectId,day,previous]);let hex='';
    for(let salt=0;salt<4;salt++){let n=(2166136261^salt)>>>0;for(let i=0;i<text.length;i++){n^=text.charCodeAt(i);n=Math.imul(n,16777619)>>>0;}hex+=n.toString(16).padStart(8,'0');}return day+'__'+hex;
  }
  return Object.freeze({purgeRetiredCivil,clone,stable,equal,key,flatten,materialize,parents,diff,overlay,lectureId});
});
