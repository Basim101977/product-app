'use strict';
// Validate new/changed known fields, not historical snapshots. Unknown extension
// fields remain subject to the envelope's JSON/depth/byte limits.
const model=require('./device-sync-model');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const string=max=>v=>typeof v==='string'&&v.length<=max;
const number=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v));
const nonnegative=v=>number(v)&&Number(v)>=0;
const optional=check=>v=>v===null||check(v);
const names={name:string(150),titleAr:string(4096),titleEn:string(4096)};
const scope={departmentId:string(180),stageId:string(180),section:string(180)};
const times={time:string(64),startTime:string(64)};
const fields={
 departments:{...names},stages:{...names,...scope,sort:number},
 scopeRoster:{...names,...scope},scopeStudent:{...names},
 subject:{...names,...scope,totalHours:nonnegative,lectureDurationHours:nonnegative},
 student:{...names,faceDescriptor:Array.isArray,faceDescriptors:Array.isArray,faceDescriptorMap:object,faceTemplateCount:nonnegative},
 lecture:{...times,status:string(64),durationHours:nonnegative,hideWhenEmpty:v=>typeof v==='boolean'},
 mark:{...times,attendedMinutes:nonnegative,method:string(128)},
 excuse:{reason:string(4096),time:string(64)}
};
module.exports=function validRecord(path,value,before){
 if(value===null)return true; // Existing records can always be removed.
 const kind=path[0];
 if(kind==='mark'&&typeof value==='string')return value.length<=64;
 if(kind==='excuse'&&typeof value==='boolean')return true;
 if(!object(value))return false;
 for(const [field,check]of Object.entries(fields[kind]||{})){
  if(!Object.hasOwn(value,field))continue;
  if(object(before)&&Object.hasOwn(before,field)&&model.equal(value[field],before[field]))continue;
  if(!optional(check)(value[field]))return false;
 }
 return true;
};
