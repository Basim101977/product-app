(()=>{'use strict';
 const $=id=>document.getElementById(id),M=window.HathirPrivateShareModel;let captured=null,busy=false,generation=0,account='';
 let notificationUid='',unreadIds=new Set(),lastCheck=0,checking=false,noticeRevision=0;
 let unsubscribe=null,listeningUid='',listenAttempt=0,signalTimer=0,noticeDirty=false,historyCursor=null,historyLoaded=false,historyQueued=false;
 function stopListening(){unsubscribe?.();unsubscribe=null;listeningUid='';clearTimeout(signalTimer);noticeDirty=false;}
 function scheduleNotice(){noticeDirty=true;clearTimeout(signalTimer);signalTimer=setTimeout(()=>void checkNotices('live'),200);}
 function listen(){
  const uid=ready()&&navigator.onLine&&!document.hidden?session.uid:'';
  if(!uid){stopListening();return;}if(listeningUid===uid)return;
  if(unsubscribe)stopListening();if(Date.now()-listenAttempt<30000)return;listenAttempt=Date.now();
  try{const ref=db?.collection('attendancePrivateShareSignals').doc(uid);if(typeof ref?.onSnapshot!=='function')return;listeningUid=uid;unsubscribe=ref.onSnapshot(()=>{if(listeningUid===uid&&ready()&&session.uid===uid)scheduleNotice();},()=>{if(listeningUid===uid)stopListening();});}catch{stopListening();}
 }
 const unread=row=>row.direction==='received'&&!row.expired&&!row.recipientSeenAt&&['pending','accepted'].includes(row.status);
 function paintNotices(){
  const count=ready()&&notificationUid===session.uid?unreadIds.size:0;
  for(const el of [document.querySelector('.actionMenu summary .btn'),$('privateShareButton'),$('privateShareIncomingTitle')])if(el){el.dataset.shareUnread=String(count>0);el.dataset.shareCount=count>99?'99+':String(count);if(count)el.setAttribute('aria-describedby','privateShareNoticeText');else el.removeAttribute('aria-describedby');}
  const label=$('privateShareNoticeText'),message=count?`لديك ${count} دعوة مشاركة واردة لم تُعاين بعد`:'';if(label&&label.textContent!==message)label.textContent=message;
 }
 function updateNotices(entries){unreadIds=new Set(entries.filter(unread).map(row=>row.id));paintNotices();}
 async function checkNotices(force=false){
  if(!ready()||!navigator.onLine||document.hidden)return;
  if(checking||busy){if(force==='live')noticeDirty=true;return;}
  if(force!=='live'&&Date.now()-lastCheck<(force?10000:60000))return;noticeDirty=false;
  const uid=session.uid,revision=noticeRevision;checking=true;lastCheck=Date.now();
  try{const result=await call('list',{activeOnly:true},uid,20000);if(notificationUid!==uid||revision!==noticeRevision)return;updateNotices(result.entries);if($('privateShareDialog')?.open)renderInbox(result.entries);}catch{/* Optional notification checks never block local work. */}finally{checking=false;if(noticeDirty)scheduleNotice();}
 }
 const text=(id,value)=>{$(id).textContent=value;};
 function ready(){return session?.deviceFirst&&!session.local&&auth?.currentUser?.uid===session.uid;}
 function ensure(uid){if(!ready()||session.uid!==uid)throw Error('تغير الحساب. افتح المشاركة مجدداً.');}
 async function packed(snapshot){
  const json=JSON.stringify(snapshot);if(!window.CompressionStream){if(new TextEncoder().encode(json).length>5500000)throw Error('حدّث المتصفح لمشاركة هذه القائمة الكبيرة مع البصمات.');return {snapshot};}
  const bytes=new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return {snapshotGzip:btoa(binary)};
 }
 async function unpacked(value){
  if(typeof value!=='string'||value.length>8000000||!window.DecompressionStream)throw Error('حدّث المتصفح لاستلام القائمة المضغوطة.');
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0)),reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();let size=0,parts=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16000000){await reader.cancel();throw Error('حجم المشاركة أكبر من الحد المسموح.');}parts.push(value);}
  return JSON.parse(await new Blob(parts).text());
 }
 async function call(action,data={},uid=session?.uid,timeout=120000){const epoch=generation;ensure(uid);if(!navigator.onLine)throw Error('تحتاج المشاركة إلى الإنترنت. الحضور المحلي مستمر.');await loadOptionalLibrary('functions');ensure(uid);const payload={action,...data,...(window.DecompressionStream?{snapshotCompression:'gzip'}:{})};if(action==='send'&&payload.snapshot){Object.assign(payload,await packed(payload.snapshot));if(payload.snapshotGzip)delete payload.snapshot;}const r=(await firebase.app().functions('us-central1').httpsCallable('privateRosterShare',{timeout})(payload)).data;if(r.snapshotGzip){r.snapshot=await unpacked(r.snapshotGzip);delete r.snapshotGzip;}ensure(uid);if(epoch!==generation)throw Error('أُغلقت نافذة المشاركة. راجع الدعوات لمعرفة نتيجة الطلب.');return r;}
 async function run(fn){if(busy)return;busy=true;const uid=session?.uid,gen=generation;try{await fn(uid);}catch(e){if(session?.uid===uid&&generation===gen)text('privateShareStatus',e.message||'تعذر إكمال المشاركة.');}finally{busy=false;if(noticeDirty)scheduleNotice();if(historyQueued){historyQueued=false;if(ready()&&$('privateShareHistory').open)void run(loadHistory);}}}
 function describe(s){return `${s.choices.attendance?s.title+' · ':''}${s.scope.departmentName} · المرحلة ${s.scope.stageNumber} · ${s.scope.studyPeriod==='evening'?'مسائي':'صباحي'} — ${s.students} طالب، ${s.faces} بصمة${s.choices.attendance?'، '+s.lectures+' محاضرة':''}` ;}
 function snapshot(){const s=getSubject();if(!s)throw Error('اختر المادة التي تريد مشاركتها.');if(!requireSingleSection())throw Error('اختر شعبة واحدة.');
  const choices={names:true,faces:$('privateShareFaces').checked,attendance:$('privateShareAttendance').checked};
  if(s.privateShareSource&&(choices.faces||choices.attendance))throw Error('يمكن مشاركة الأسماء فقط من نسخة مستلمة؛ البصمات والحضور المستلمان غير متاحين لإعادة الإرسال.');
  const d=departmentById(s.departmentId),g=stageById(s.stageId);if(!d||!g)throw Error('اختر القسم والمرحلة.');
  const row=x=>({id:x.id,name:x.name,...(choices.faces?{faceDescriptors:getFaceDescriptors(x)}:{})});
  const lectureMeta={};if(choices.attendance)for(const date of new Set([...(s.lectures||[]),...Object.keys(s.lectureMeta||{}),...Object.keys(s.attendance||{}),...Object.keys(s.excuses||{})]))lectureMeta[date]=window.structuredClone(window.lectureMeta?window.lectureMeta(s,date):s.lectureMeta[date]);
  // The global lectureMeta function is shadowed by the local map; legacy metadata
  // has already been hydrated by the local workspace before this action.
  return M.normalize({choices,scope:{departmentId:d.id,departmentName:d.nameAr||d.nameEn,stageNumber:Number(g.sort),studyPeriod:subjectStudyPeriod(s)},subject:s,students:(s.students||[]).map(row),archivedStudents:choices.attendance?(s.archivedStudents||[]).map(row):[],lectureMeta,attendance:s.attendance,excuses:s.excuses,academicStatuses:s.academicStatuses});
 }
 function resetPreview(){captured=null;$('privateShareSend').textContent='إرسال الدعوات';$('privateShareSend').hidden=true;text('privateSharePreview','');}
 function recipientEmails(){
  const values=$('privateShareEmail').value.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,'').split(/[\s,;،؛]+/).filter(Boolean).map(e=>e.toLowerCase());
  const emails=[...new Set(values)];const input=document.createElement('input');input.type='email';
  if(!emails.length||emails.length>20)throw Error('أدخل من بريد واحد إلى 20 بريدًا، مفصولة بفاصلة أو سطر جديد.');
  for(const email of emails){input.value=email;if(!input.checkValidity())throw Error('بريد غير صحيح: '+email);}return emails;
 }
 async function prepare(uid){resetPreview();const data=snapshot(),emails=recipientEmails(),targets=[];
  text('privateShareStatus','جارٍ التحقق من المستلمين…');
  for(const email of emails){try{const target=await call('lookup',{email},uid);targets.push({target,id:crypto.randomUUID(),sent:false,error:''});}catch(e){throw Error(email+': '+e.message);}}
  if(JSON.stringify(recipientEmails())!==JSON.stringify(emails)||JSON.stringify(snapshot())!==JSON.stringify(data))throw Error('تغيرت بيانات المشاركة أثناء التحقق. أعد المعاينة.');
  captured={uid,subjectId:getSubject().id,emails,targets,snapshot:data};
  text('privateSharePreview',targets.map(p=>'المستلم: '+p.target.name+' ('+p.target.email+')').join('\n')+'\n'+describe(M.summary(data))+'\nستصل دعوة مستقلة لكل مستلم داخل حاضر. '+(data.choices.attendance?'تتضمن مادة مستقلة مع سجل الحضور.':'قائمة للقسم والمرحلة والدراسة، دون إنشاء مادة.'));
  $('privateShareSend').hidden=false;text('privateShareStatus','راجع المستلمين والمحتوى ثم أكد الإرسال.');
 }
 async function send(uid){if(!captured||captured.uid!==uid)throw Error('أعد المعاينة.');if(!$('privateShareAuthorized').checked)throw Error('أكد أنك مخوّل بمشاركة البيانات المحددة مع المستلمين.');
  if(getSubject()?.id!==captured.subjectId||JSON.stringify(snapshot())!==JSON.stringify(captured.snapshot)||JSON.stringify(recipientEmails())!==JSON.stringify(captured.emails)){resetPreview();throw Error('تغيرت المادة أو البيانات. أعد المعاينة.');}
  const p=captured;for(const row of p.targets){if(row.sent)continue;try{await call('send',{id:row.id,email:row.target.email,recipientUid:row.target.uid,snapshot:p.snapshot,authorized:true},uid);row.sent=true;row.error='';}catch(e){ensure(uid);if(captured!==p)return;row.error=e.message||'تعذر الإرسال';}
   if(captured!==p)return;text('privateSharePreview',p.targets.map(r=>r.target.email+' — '+(r.sent?'تم الإرسال':r.error||'بانتظار الإرسال')).join('\n'));
  }
  const failed=p.targets.filter(r=>!r.sent).length;$('privateShareSend').hidden=!failed;$('privateShareSend').textContent=failed?'إعادة محاولة الدعوات المتعذرة':'إرسال الدعوات';
  text('privateShareStatus',failed?'أُرسلت بعض الدعوات. يمكنك إعادة محاولة المتعذرة دون تكرار الناجحة.':'تم إرسال جميع الدعوات داخل حاضر. تظهر للمستلمين في المزيد ← مشاركة.');
 }
 function button(label,fn){const b=document.createElement('button');b.type='button';b.className='btn ghost';b.textContent=label;b.onclick=()=>run(fn);return b;}
 async function loadHistory(uid){
  const result=await call('history',{cursor:historyLoaded?historyCursor:null},uid),list=$('privateShareHistoryList');if(!historyLoaded)list.replaceChildren();
  const states={imported:'تم الاستيراد',rejected:'مرفوضة',cancelled:'ملغاة'};
  for(const row of result.entries){if([...list.children].some(e=>e.dataset.historyId===row.id))continue;const p=document.createElement('p');p.className='privateShareHistoryRow';p.dataset.historyId=row.id;p.textContent=`${row.direction==='received'?'من: '+row.senderName:'إلى: '+row.recipientName} — ${describe(row.summary)} — ${row.expired?'منتهية':states[row.status]||row.status}`;list.append(p);}
  historyLoaded=true;historyCursor=result.nextCursor;$('privateShareHistoryMore').hidden=!historyCursor;
  if(!list.childElementCount&&!historyCursor)list.textContent='لا يوجد سجل سابق.';
 }
 async function inbox(uid){resetPreview();$('privateShareReview').replaceChildren();text('privateShareStatus','جارٍ تحميل الدعوات…');const result=await call('list',{activeOnly:true},uid);noticeRevision++;lastCheck=Date.now();updateNotices(result.entries);renderInbox(result.entries);if(unreadIds.size)document.getElementById('privateShareIncomingTitle').scrollIntoView({block:'start'});text('privateShareStatus',result.entries.length?'المشاركة تتم داخل البرنامج، دون إرسال بريد إلكتروني.':'لا توجد دعوات مشاركة.');}
 function renderInbox(entries){const list=$('privateShareInbox'),sent=$('privateShareSent');list.replaceChildren();sent.replaceChildren();
  const states={pending:'بانتظار القبول',accepted:'مقبولة — إكمال الحفظ',imported:'تم الاستيراد',rejected:'مرفوضة',cancelled:'ملغاة'};
  for(const row of entries.filter(row=>!row.expired&&['pending','accepted'].includes(row.status))){const a=document.createElement('article'),p=document.createElement('p');a.className='privateShareItem';a.dataset.shareInvite=row.id;if(unreadIds.has(row.id)){a.classList.add('privateShareItemUnread');const label=document.createElement('span');label.className='privateShareNew';label.textContent='جديدة';a.append(label);}p.textContent=`${row.direction==='received'?'من: '+row.senderName:'إلى: '+row.recipientName} — ${describe(row.summary)} — ${row.expired?'منتهية':states[row.status]||row.status}`;a.append(p);
   if(!row.expired&&row.direction==='received'&&['pending','accepted'].includes(row.status))a.append(button('معاينة واستلام',u=>review(row.id,u)));
   if(!row.expired&&row.direction==='sent'&&row.status==='pending')a.append(button('إلغاء الدعوة',async u=>{await call('cancel',{id:row.id},u);await inbox(u);}));(row.direction==='received'?list:sent).append(a);
  }if(!list.childElementCount)list.textContent='لا توجد دعوات واردة.';if(!sent.childElementCount)sent.textContent='لا توجد دعوات مرسلة.';paintNotices();}
 async function review(id,uid){const data=await call('preview',{id},uid),area=$('privateShareReview');area.replaceChildren();const title=document.createElement('h3'),p=document.createElement('p'),ul=document.createElement('ul');title.textContent='مراجعة النسخة الواردة';p.textContent=`من ${data.senderName} (${data.senderEmail})\n${describe(data.summary)}\n${data.summary.choices.attendance?`سيتم إنشاء مادة مستقلة باسم «${data.summary.title} — نسخة مشتركة». لن تُدمج مع موادك الحالية.`:`ستُضاف القائمة إلى موادك المطابقة للقسم والمرحلة والدراسة، وتتوفر لموادك الجديدة. تبقى سجلات الحضور والبصمات الموجودة محفوظة. لا تُنشأ مادة جديدة.`}`;for(const row of data.names){const li=document.createElement('li');li.textContent=row.name+(row.hasFace?' · بصمة وجه':'');ul.append(li);}ul.className='privateShareNames';
  area.append(title,p,ul,button(data.summary.choices.attendance?'قبول وحفظ كمادة مستقلة':'قبول قائمة القسم والمرحلة والدراسة',u=>accept(id,u)));if(data.status==='pending')area.append(button('رفض',async u=>{await call('reject',{id},u);await inbox(u);}));area.scrollIntoView({block:'nearest'});text('privateShareStatus','راجع القائمة. قبول الدعوة يؤكد أنك مخوّل باستخدام هذه البيانات لتدريس الطلبة.');noticeRevision++;try{await call('seen',{id},uid);unreadIds.delete(id);for(const el of document.querySelectorAll('[data-share-invite]'))if(el.dataset.shareInvite===id){el.classList.remove('privateShareItemUnread');el.querySelector('.privateShareNew')?.remove();}paintNotices();}catch{/* Keep unread until a successful acknowledgement or next refresh. */}}
 async function accept(id,uid){
  const existing=subjects.find(s=>s.privateShareSource===id)||Object.values(localData.scopeRosters||{}).find(r=>r.receivedInvites?.includes(id));if(existing){await call('ack',{id},uid);text('privateShareStatus','هذه المشاركة محفوظة بالفعل في مساحتك.');$('privateShareReview').replaceChildren();return;}
  text('privateShareStatus','جارٍ استلام النسخة وحفظها…');const result=await call('accept',{id,confirmed:true,scopeRosterSupport:true},uid);ensure(uid);
  const payload=M.normalize(result.snapshot),key=id.replace(/-/g,''),subjectId='share_'+key;
  if(localData.subjects[subjectId])throw Error('توجد مادة بهذا المعرف. لن تُستبدل بياناتك.');
  let dept=departments.find(d=>d.id===payload.scope.departmentId||d.privateSourceDepartmentId===payload.scope.departmentId);if(!dept)dept={id:'sharedept_'+key,privateSourceDepartmentId:payload.scope.departmentId,nameAr:payload.scope.departmentName,nameEn:payload.scope.departmentName,active:true};
  let stage=stages.find(g=>g.departmentId===dept.id&&Number(g.sort)===payload.scope.stageNumber);if(!stage)stage={id:'sharestage_'+key,departmentId:dept.id,sort:payload.scope.stageNumber,nameAr:String(payload.scope.stageNumber),nameEn:String(payload.scope.stageNumber),active:true};
  if(payload.choices.attendance){
   const subject=M.materialize(payload,{id:subjectId,uid,departmentId:dept.id,stageId:stage.id,inviteId:id});subject.titleAr+=' — نسخة مشتركة';subject.titleEn=(subject.titleEn||payload.subject.titleAr)+' — Shared copy';
   localData.subjects[subject.id]=subject;
  }else{
   const encoded=new TextEncoder().encode(JSON.stringify([dept.id,stage.id,payload.scope.studyPeriod]));
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded)),n=>n.toString(16).padStart(2,'0')).join('');ensure(uid);
   const planned=HathirPrivateScopeRoster.plan(localData,payload,{id:'scope_'+digest,departmentId:dept.id,stageId:stage.id,inviteId:id});
   localData.scopeRosters||={};localData.scopeRosters[planned.record.id]=planned.record;Object.assign(localData.subjects,planned.subjects);
  }
  localData.departments[dept.id]=dept;localData.stages[stage.id]=stage;
  await saveLocalData();ensure(uid);subjects=Object.values(localData.subjects);departments=Object.values(localData.departments);stages=Object.values(localData.stages);for(const s of subjects){s.faceTemplateDescriptors=new Map((s.students||[]).map(row=>[row.id,getFaceDescriptors(row)]));s.faceTemplatesLoaded=true;}buildStudentCache();renderAll();
  try{await call('ack',{id},uid);text('privateShareStatus',payload.choices.attendance?'تم حفظ النسخة المستقلة. اخترها من قائمة المواد.':'تم حفظ قائمة القسم والمرحلة والدراسة وتطبيقها على موادك المطابقة. ستتوفر أيضاً عند إضافة مادة جديدة في النطاق نفسه.');}catch{text('privateShareStatus','تم الحفظ على جهازك. حدّث الدعوات وأكمل تأكيد الاستلام عند عودة الاتصال؛ لن تُضاف نسخة ثانية.');}$('privateShareReview').replaceChildren();
 }
 function open(){if(busy){notify('الطلب السابق قيد المعالجة؛ يمكنك متابعة الحضور ثم العودة.','warn');return;}if(!ready()){notify('افتح حسابك ونسختك المحلية أولاً.','warn');return;}generation++;account=session.uid;historyLoaded=false;historyCursor=null;$('privateShareHistory').open=false;$('privateShareHistoryList').replaceChildren();resetPreview();$('privateShareInbox').replaceChildren();$('privateShareSent').replaceChildren();$('privateShareReview').replaceChildren();$('privateShareEmail').value='';$('privateShareFaces').checked=false;$('privateShareAttendance').checked=false;$('privateShareAuthorized').checked=false;text('privateShareStatus','');$('privateShareDialog').showModal();void run(inbox);}
 function close(){generation++;resetPreview();$('privateShareDialog').close();}
 function refresh(){if(!$('privateShareButton'))return;const uid=ready()?session.uid:'';if(uid!==notificationUid){stopListening();notificationUid=uid;listenAttempt=0;noticeRevision++;unreadIds.clear();lastCheck=0;}paintNotices();listen();void checkNotices();$('privateShareButton').hidden=!ready();if(account&&(!ready()||account!==session?.uid)){generation++;captured=null;$('privateShareDialog').close();$('privateShareInbox').replaceChildren();$('privateShareSent').replaceChildren();$('privateShareReview').replaceChildren();$('privateSharePreview').textContent='';$('privateShareStatus').textContent='';$('privateShareEmail').value='';account='';}}
 function setup(){if($('privateShareButton'))return;const btn=button('مشاركة',()=>open());btn.onclick=open;btn.id='privateShareButton';const importButton=$('importStudentsQuickBtn');if(importButton?.closest('.actionMenuList'))importButton.after(btn);else document.querySelector('.actionMenuList').prepend(btn);
  const d=document.createElement('dialog');d.id='privateShareDialog';d.setAttribute('aria-labelledby','privateShareTitle');d.dir='rtl';d.innerHTML='<div class="settingsHeader"><h2 id="privateShareTitle">مشاركة مع تدريسيين</h2><button class="btn ghost" id="privateShareClose" type="button">إغلاق</button></div><p>الأسماء والبصمات تُشارك للقسم والمرحلة والدراسة. عند اختيار سجل الحضور، تُشارك مادة مستقلة مع سجلها.</p><label>إيميلات التدريسيين المستلمين<textarea id="privateShareEmail" dir="ltr" rows="3" autocomplete="off" placeholder="teacher1@example.com, teacher2@example.com" aria-describedby="privateShareEmailHelp"></textarea><span id="privateShareEmailHelp" class="small muted">حتى 20 إيميلًا، مفصولة بفاصلة أو سطر جديد. لكل تدريسي دعوة مستقلة، ضمن حد الإرسال الحالي.</span></label><div class="privateShareChoices"><label><input type="checkbox" checked disabled> أسماء الطلبة</label><label><input type="checkbox" id="privateShareFaces"> بصمات الوجه</label><label><input type="checkbox" id="privateShareAttendance"> سجل الحضور بالكامل للمادة</label></div><p class="small muted">تشمل مشاركة الحضور إعدادات المادة وحالات الطلبة وأعذارهم وأرشيفهم. أغلق المحاضرة الجارية قبل مشاركتها.</p><label class="privateShareConsent"><input type="checkbox" id="privateShareAuthorized"> أؤكد أنني مخوّل بمشاركة البيانات المحددة مع التدريسيين المحددين.</label><button type="button" class="btn" id="privateSharePrepare">معاينة المستلم والمحتوى</button><p id="privateSharePreview"></p><button type="button" class="btn" id="privateShareSend" hidden>إرسال الدعوة</button><hr><button type="button" class="btn ghost" id="privateShareRefresh">الدعوات الواردة والمرسلة — تحديث</button><h3 id="privateShareIncomingTitle">الدعوات الواردة</h3><div id="privateShareInbox"></div><h3>الدعوات المرسلة</h3><div id="privateShareSent"></div><details id="privateShareHistory"><summary>السجل السابق</summary><div id="privateShareHistoryList"></div><button class="btn ghost" id="privateShareHistoryMore" type="button">عرض المزيد</button></details><div id="privateShareReview"></div><p id="privateShareStatus" role="status" aria-live="polite"></p>';document.body.append(d);const notice=document.createElement('span');notice.id='privateShareNoticeText';notice.setAttribute('role','status');document.body.append(notice);
  $('privateShareHistory').addEventListener('toggle',()=>{if($('privateShareHistory').open&&!historyLoaded){if(busy)historyQueued=true;else void run(loadHistory);}});$('privateShareHistoryMore').onclick=()=>run(loadHistory);$('privateShareClose').onclick=close;d.addEventListener('cancel',e=>{e.preventDefault();close();});$('privateSharePrepare').onclick=()=>run(prepare);$('privateShareSend').onclick=()=>run(send);$('privateShareRefresh').onclick=()=>run(inbox);for(const id of ['privateShareEmail','privateShareFaces','privateShareAttendance'])$(id).addEventListener('input',resetPreview);auth?.onAuthStateChanged?.(()=>refresh());window.addEventListener('focus',()=>{listen();void checkNotices(true);});window.addEventListener('online',()=>{listenAttempt=0;listen();void checkNotices(true);});window.addEventListener('offline',stopListening);document.addEventListener('visibilitychange',()=>{listen();if(!document.hidden)void checkNotices(true);});setInterval(()=>{listen();void checkNotices();},60000);refresh();
 }
 const priorInit=init;init=()=>{priorInit();setup();};const priorRender=renderAll;renderAll=function(...args){const r=priorRender.apply(this,args);refresh();return r;};
 window.HathirPrivateShare=Object.freeze({open,refresh});
})();
