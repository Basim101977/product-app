(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.HathirPrivateShareModel=api;})(globalThis,()=>{
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const safeId=x=>typeof x==='string'&&x.length>0&&x.length<=180&&!/[\/.\x00-\x1f]/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
 function object(x){return x&&typeof x==='object'&&!Array.isArray(x);}
 function pick(x,keys){const out={};for(const k of keys)if(x?.[k]!==undefined)out[k]=clone(x[k]);return out;}
 function cleanTree(x,depth=0){if(depth>12)throw Error('بيانات متداخلة أكثر من المسموح.');if(Array.isArray(x)){if(x.length>2000)throw Error('بيانات كبيرة.');x.forEach(v=>cleanTree(v,depth+1));}else if(object(x)){for(const [k,v] of Object.entries(x)){if(['__proto__','constructor','prototype'].includes(k))throw Error('مفتاح غير صالح.');cleanTree(v,depth+1);}}else if(typeof x==='number'&&!Number.isFinite(x))throw Error('قيمة غير صالحة.');}
 function normalize(input){
  if(!object(input))throw Error('بيانات المشاركة غير صالحة.');cleanTree(input);
  const choices={names:true,faces:input.choices?.faces===true,attendance:input.choices?.attendance===true};
  const scope=pick(input.scope,['departmentId','departmentName','stageNumber','studyPeriod']);
  if(!safeId(scope.departmentId)||typeof scope.departmentName!=='string'||scope.departmentName.length>150||!Number.isInteger(scope.stageNumber)||scope.stageNumber<1||scope.stageNumber>6||!['morning','evening'].includes(scope.studyPeriod))throw Error('اختر القسم والمرحلة والدراسة أولاً.');
  if(scope.departmentId==='civil_techniques')throw Error('تم إلغاء قسم التقنيات المدنية القديم.');
  const subject=pick(input.subject,['titleAr','titleEn','totalHours','lectureDurationHours','academicYearStart','absenceSettings','policySnapshot']);
  if(typeof subject.titleAr!=='string'||!subject.titleAr.trim()||subject.titleAr.length>180)throw Error('اسم المادة غير صالح.');
  if(!Array.isArray(input.students)||(!input.students.length&&!(choices.attendance&&input.archivedStudents?.length))||input.students.length>700)throw Error('يمكن مشاركة قائمة من 1 إلى 700 طالب.');
  const ids=new Set();
  function student(row){if(!safeId(row?.id)||typeof row.name!=='string'||!row.name.trim()||row.name.length>150||ids.has(row.id))throw Error('معرّفات الطلبة غير صالحة أو مكررة.');ids.add(row.id);const result={id:row.id,name:row.name};
   if(choices.faces&&row.faceDescriptors?.length){if(!Array.isArray(row.faceDescriptors)||row.faceDescriptors.length>5||row.faceDescriptors.some(d=>!Array.isArray(d)||d.length!==128||d.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>100)))throw Error('بصمة وجه غير متوافقة.');result.faceDescriptors=clone(row.faceDescriptors);}return result;}
  const students=input.students.map(student),archivedStudents=choices.attendance?(input.archivedStudents||[]).map(student):[];
  if(archivedStudents.length>700)throw Error('قائمة الأرشيف كبيرة.');
  const result={schema:1,choices,scope,subject,students,archivedStudents,lectures:[],lectureMeta:{},attendance:{},excuses:{},academicStatuses:{}};
  if(choices.attendance){
   if(!object(input.lectureMeta)||Object.keys(input.lectureMeta).length>500)throw Error('سجل المحاضرات غير صالح أو كبير.');
   for(const [date,raw] of Object.entries(input.lectureMeta)){
    if(!/^\d{4}-\d{2}-\d{2}(?:__[A-Za-z0-9_-]+)?$/.test(date)||!['completed','cancelled','voided'].includes(raw?.status))throw Error('أغلق المحاضرات الجارية قبل مشاركة سجل الحضور.');
    result.lectures.push(date);result.lectureMeta[date]=pick(raw,['date','status','startTime','durationHours','lectureNumber','number','closedAt','completedAt','cancelledAt','startedAt','endTime']);
   }
   for(const kind of ['attendance','excuses'])for(const [date,marks] of Object.entries(input[kind]||{})){
    if(!result.lectureMeta[date]||!object(marks))throw Error('يوجد حضور بلا محاضرة مكتملة.');result[kind][date]={};
    for(const [id,value] of Object.entries(marks)){if(!ids.has(id))throw Error('يوجد سجل لطالب غير موجود في القائمة أو الأرشيف.');if(typeof value!=='string'&&!object(value))throw Error('سجل حضور غير صالح.');result[kind][date][id]=typeof value==='string'?value:pick(value,['studentId','studentName','date','time','attendedMinutes','markedAtMillis','method','source','status','reason','note','excused','minutes']);}
   }
   for(const [id,status]of Object.entries(input.academicStatuses||{})){if(ids.has(id)&&typeof status==='string'&&status.length<=50)result.academicStatuses[id]=status;}
  }
  if(JSON.stringify(result).length>14000000)throw Error('المشاركة أكبر من الحد المسموح.');return result;
 }
 function summary(p){return {title:p.subject.titleAr,scope:p.scope,choices:p.choices,students:p.students.length,archived:p.archivedStudents.length,faces:[...p.students,...p.archivedStudents].filter(x=>x.faceDescriptors?.length).length,lectures:p.lectures.length};}
 function materialize(raw,{id,uid,departmentId,stageId,inviteId}){const p=normalize(raw);return {...p.subject,id,ownerUserId:uid,departmentId,stageId,studyPeriod:p.scope.studyPeriod,section:'',rosterNaming:'name',rosterSource:'subject',rosterLoaded:true,attendanceLoaded:true,faceTemplatesLoaded:true,lectureIndexComplete:true,rosterCohortId:'private_'+inviteId.replace(/-/g,'').padEnd(40,'0').slice(0,40),students:p.students,archivedStudents:p.archivedStudents,lectures:p.lectures,lectureMeta:p.lectureMeta,attendance:p.attendance,excuses:p.excuses,academicStatuses:p.academicStatuses,privateShareSource:inviteId};}
 return {normalize,summary,materialize};
});
