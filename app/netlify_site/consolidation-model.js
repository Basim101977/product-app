(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.HathirConsolidationModel=api;})(globalThis,()=>{
 'use strict';
 const text=v=>String(v??'').normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,'').replace(/\s+/g,' ').trim();
 const key=v=>text(v).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/\s/g,'');
 const digits=v=>text(v).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/٫/g,'.');
 const fields={name:['الطالب','اسم الطالب','الاسم','الاسم الكامل','student','student name','full name','name'],attended:['ساعات الحضور','attended hours','attendance hours'],absent:['ساعات الغياب','absent hours','absence hours'],percent:['نسبة الغياب','absence %','absence percent','absence percentage'],flag:['موقف الغياب','absence status','absence flag']};
 const metadata={department:['القسم','department'],stage:['المرحلة','stage'],title:['المادة الحالية','المادة','active class','subject','course'],teacher:['مدرس المادة','class teacher','teacher'],period:['الدراسة','نوع الدراسة','study period'],year:['السنة الدراسية','academic year'],totalHours:['مجموع ساعات المادة','Total class hours'],reviewState:['حالة اعتماد الغياب','Absence assessment state'],referenceMinutes:['مرجع الغياب بالدقائق','Absence reference minutes'],referenceHours:['مرجع الغياب في آخر اعتماد أسبوعي (بالساعات)','Absence reference at last weekly approval (hours)'],notice:['حد التنبيه','Notice threshold'],warning:['حد الإنذار','Warning threshold'],fail:['حد الرسوب','Failure threshold']};
 const lookup=(v,dict)=>Object.keys(dict).find(k=>dict[k].some(s=>key(s)===key(v)));
 function stage(v){const n=digits(v),names=['الاولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة'];const k=key(n).replace(/^المرحله/,'');const i=names.findIndex(s=>key(s)===k);if(i>=0)return String(i+1);const match=n.match(/\b([1-6])(?:st|nd|rd|th)?\b/i);return match?match[1]:'';}
 function period(v){const k=key(v);return /مسائ|evening/.test(k)?'evening':/صباح|morning/.test(k)?'morning':'';}
 function year(v){const ns=digits(v).match(/(?:19|20|21)\d{2}/g);return ns?.length===2&&Number(ns[1])===Number(ns[0])+1?ns.join('-'):'';}
 function hours(v){if(v===null||v===undefined||text(v)===''||['—','–','-'].includes(text(v)))return null;const s=digits(v);if(/^\d+:\d{2}$/.test(s)){const [h,m]=s.split(':').map(Number);if(m<60&&h<=10000)return h*60+m;}const n=Number(s);if(s!==''&&Number.isFinite(n)&&n>=0&&n<=10000)return Math.round(n*60);throw Error('قيمة ساعات غير صالحة: '+text(v));}
 function percent(v){if(v===null||v===undefined||text(v)===''||['—','–','-'].includes(text(v)))return null;const s=digits(v).replace(/[٪%]/g,'');const n=Number(s);if(!Number.isFinite(n)||n<0||n>100)throw Error('نسبة غياب غير صالحة: '+text(v));return n;}
 function parse(rows,options={}){
  if(!Array.isArray(rows)||rows.length>10000)throw Error('الملف أكبر من الحد المسموح: 10000 صف.');
  let header=-1,map={};const meta={};
  for(let i=0;i<Math.min(rows.length,100);i++){const row=rows[i]||[],found={};row.forEach((v,c)=>{const f=lookup(v,fields);if(f)found[f]=c;});if(found.name!==undefined&&(Object.keys(found).length>1||options.reference)){header=i;map=found;break;}const f=lookup(row[0],metadata);if(f&&meta[f]===undefined)meta[f]=text(row[1]);}
  if(header<0)throw Error('لم يُعثر على أعمدة الاسم والحضور أو الغياب. استخدم ملف تصدير Excel من حاضر.');
  const students=[],errors=[];
  for(let i=header+1;i<rows.length;i++){const r=rows[i]||[],name=text(r[map.name]);if(!name&&r.every(v=>!text(v)))continue;if(!name){errors.push('الصف '+(i+1)+': اسم الطالب فارغ');continue;}if(name.length>150){errors.push('الصف '+(i+1)+': الاسم طويل');continue;}
   try{students.push({name,attended:map.attended===undefined?null:hours(r[map.attended]),absent:map.absent===undefined?null:hours(r[map.absent]),percent:map.percent===undefined?null:percent(r[map.percent]),flag:map.flag===undefined?'':text(r[map.flag]),row:i+1});}catch(e){errors.push('الصف '+(i+1)+': '+e.message);}
  }
  if(errors.length)throw Error(errors.slice(0,8).join('\n')+(errors.length>8?'\nوأخطاء أخرى: '+(errors.length-8):''));
  if(!students.length)throw Error('الملف لا يحتوي على طلبة.');
  const extra={};
  for(const field of ['totalHours','referenceMinutes','notice','warning','fail'])if(meta[field]!==undefined&&meta[field]!==''){
    const number=Number(digits(meta[field]));
    if(!Number.isFinite(number)||number<0||(field==='totalHours'&&(number===0||number>10000))||(field==='referenceMinutes'&&(!Number.isInteger(number)||number>600000))||(['notice','warning','fail'].includes(field)&&number>100))throw Error('بيانات ساعات المادة أو حدود الغياب غير صالحة.');
    extra[field]=number;
  }
  let previous=0;for(const field of ['notice','warning','fail'])if(extra[field]>0){if(extra[field]<=previous)throw Error('حدود الغياب يجب أن تكون تصاعدية.');previous=extra[field];}
  if(meta.reviewState!==undefined){if(!['pending','ready'].includes(meta.reviewState))throw Error('حالة اعتماد الغياب غير صالحة.');extra.reviewState=meta.reviewState;}
  if(extra.referenceMinutes===undefined&&meta.referenceHours!==undefined)extra.referenceMinutes=hours(meta.referenceHours);
  return {...(options.reference?{kind:'reference',allRequired:false}:{}),meta:{department:meta.department||'',stage:stage(meta.stage),title:options.reference?'القائمة المرجعية الكاملة':meta.title||'',teacher:meta.teacher||'',period:period(meta.period),year:year(meta.year),...extra},students};
 }
 function validate(source){const m=source.meta;
  if(source.kind==='reference'&&(!source.allRequired||!['morning','evening'].includes(m.period)))throw Error('أكد أن القائمة المرجعية تشمل جميع الطلبة المطلوب حضورهم في مواد المجموعة، وحدد الدراسة في الملف.');
for(const f of ['department','title'])if(!text(m[f])||text(m[f]).length>150)throw Error('القسم أو اسم المادة غير موجود في الملف؛ استخدم تقرير حضور يحتوي على بيانات المادة.');if(!/^[1-6]$/.test(m.stage))throw Error('المرحلة غير موجودة أو غير صالحة في الملف.');if((m.period&&!['morning','evening'].includes(m.period))||(m.year&&!year(m.year)))throw Error('بيانات الدراسة أو السنة الدراسية غير صالحة في الملف.');m.department=text(m.department);m.title=text(m.title);m.teacher=text(m.teacher);m.period=m.period||'';m.year=year(m.year);
  const seen=new Map(),duplicates=[];for(const s of source.students){if(s.excluded)continue;const k=key(s.name);if(!k)throw Error('يوجد اسم فارغ.');if(seen.has(k))duplicates.push([seen.get(k),s]);else seen.set(k,s);}if(duplicates.length)throw Error('أسماء متطابقة أو متشابهة داخل المادة نفسها؛ ميّز الاسم أو استبعد الصف المكرر.');if(!seen.size)throw Error('اختر طالبًا واحدًا على الأقل.');return source;
 }
 const groupKey=m=>JSON.stringify([key(m.department),m.stage,m.period,m.year]);
 const courseKey=s=>JSON.stringify([groupKey(s.meta),s.kind==='reference'?'reference':'course',s.kind==='reference'?'':key(s.meta.title)]);
 function duplicates(source){const map=new Map();for(const s of source.students){if(s.excluded)continue;const k=key(s.name);if(!map.has(k))map.set(k,[]);map.get(k).push(s);}return [...map.values()].filter(a=>a.length>1).flat();}
 function missingAttendance(source){
  const m=source.meta,absent=m.referenceMinutes;
  if(!Number.isFinite(absent))return {name:'',attended:0,absent:null,percent:null,flag:'بيانات الغياب غير مكتملة',inferred:true};
  const percent=m.totalHours>0?absent/(m.totalHours*60)*100:null;
  let flag=percent===null?'مجموع ساعات المادة غير محدد':'حدود الغياب غير محددة';
  if(percent!==null&&['notice','warning','fail'].some(k=>m[k]>0)){
    flag='سليم';
    for(const [field,label] of [['fail','راسب بالغياب'],['warning','إنذار'],['notice','تنبيه']])if(m[field]>0&&percent>=m[field]){flag=label;break;}
  }
  if(m.reviewState==='pending')flag='قيد الاحتساب';
  return {name:'',attended:0,absent,percent,flag,inferred:true};
 }
 function groups(sources,query=''){
  const out=new Map();
  for(const source of sources){
    validate(source);const k=groupKey(source.meta);
    if(!out.has(k))out.set(k,{id:k,meta:source.meta,courses:[],references:[],students:new Map()});
    const g=out.get(k),list=source.kind==='reference'?g.references:g.courses;
    if(list.some(c=>courseKey(c)===courseKey(source)))throw Error('تقرير المادة أو القائمة المرجعية مكرر.');
    list.push(source);
    for(const s of source.students){
      if(s.excluded)continue;const id=key(s.name);
      if(!g.students.has(id))g.students.set(id,{name:text(s.name),values:{}});
      if(source.kind!=='reference')g.students.get(id).values[source.id]=s;
    }
  }
  for(const g of out.values()){
    const expected=new Set(g.references.flatMap(r=>r.students.filter(s=>!s.excluded).map(s=>key(s.name))));
    for(const [id,student] of g.students)if(expected.has(id))for(const course of g.courses){
      if(!student.values[course.id])student.values[course.id]={...missingAttendance(course),name:student.name};
    }
  }
  return [...out.values()].map(g=>({...g,students:[...g.students.values()].filter(s=>!query||key(s.name).includes(key(query))).sort((a,b)=>a.name.localeCompare(b.name,'ar'))}));
 }
 function csv(content){const rows=[];let row=[],cell='',quoted=false;const input=String(content).replace(/^\uFEFF/,'');const delimiter=(input.split(/\r?\n/)[0].match(/;/g)||[]).length>(input.split(/\r?\n/)[0].match(/,/g)||[]).length?';':',';
  for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else if(!cell||quoted)quoted=!quoted;else cell+=c;}else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}if(quoted)throw Error('صيغة CSV غير مكتملة.');if(cell||row.length){row.push(cell);rows.push(row);}return rows;
 }
 const flagLabel=v=>text(v).replace(/راسب بسبب الغياب/g,'راسب بالغياب');
 function status(v){const k=key(v);if(/راسب|fail/.test(k))return 'fail';if(/انذار|تحذير|warning/.test(k))return 'danger';if(/تنبيه|notice/.test(k))return 'warn';if(/سليم|clear|^ok$/.test(k))return 'ok';return 'off';}
 function duration(v){return Math.floor(v/60)+':'+String(Math.round(v)%60).padStart(2,'0');}
 return Object.freeze({text,key,stage,period,year,hours,percent,parse,validate,duplicates,groupKey,courseKey,groups,csv,flagLabel,status,duration});
});
