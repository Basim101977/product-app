'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const site=path.join(__dirname,'../netlify_site');
function extract(file,name){const source=fs.readFileSync(path.join(site,file),'utf8');const start=source.indexOf('    function '+name+'(');const indent=start<0?'  ':'    ';const at=start<0?source.indexOf(indent+'function '+name+'('):start;assert(at>=0);const end=source.indexOf('\n'+indent+'function ',at+1);assert(end>at);return source.slice(at,end);}
for(const online of [true,false])test(`Sync label follows the third visible lecture, not stored lecture 14 (online=${online})`,()=>{
 const keys=Array.from({length:14},(_,i)=>'2026-10-05__'+String(i+1).padStart(2,'0'));
 const visible=[keys[0],keys[5],keys[13]];
 const subject={id:'test',lectures:keys,lectureMeta:Object.fromEntries(keys.map(key=>[key,{startTime:'08:35',status:'completed'}]))};
 const before=JSON.stringify(subject);
 const sandbox={window:{HathirBeginnerUI:{selectedLectureDate:()=>keys[13]}},getSubject:()=>subject,visibleRosterLectures:()=>visible,currentLectureKey:()=>keys[13],lectureKey:(id,key)=>id+key,sortedLectureKeys:()=>keys,lectureColumnRemovedAfterUnmark:(_s,k)=>!visible.includes(k),firstAttendanceTime:()=>'',attendanceColumnDate:()=> '05.10.26',displayAttendanceTime:x=>x,lang:'ar',liveEnabled:()=>true,row:{live:{initialized:true,queue:[]}},navigator:{onLine:online},liveError:'',closed:()=>true};
 vm.createContext(sandbox);
 vm.runInContext(extract('index.html','lectureColumnParts')+extract('index.html','lectureColumnLabel')+extract('device-workspace.js','lectureState'),sandbox);
 const result=vm.runInContext('lectureState()',sandbox);
 assert.match(result.message,/م\(3\)/);assert.doesNotMatch(result.message,/م\(14\)/);
 assert.equal(result.date,keys[13]);assert.equal(result.state,online?'synced':'offline');
 assert.equal(JSON.stringify(subject),before);
});
