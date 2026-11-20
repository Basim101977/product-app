(() => {'use strict';
const $=id=>document.getElementById(id);let timer=0,generation=0,lastKey='',busy=false,preview=null,context=null,trigger=null;const checked=new Map();
const kinds={add:'إضافة',rename:'تحديث الاسم',existing:'موجود مسبقاً',editedLocally:'احتفاظ بتعديلك',deletedLocally:'محذوف من مساحتك — لن يعود',conflict:'تشابه أسماء — لم يُغيّر',removedFromPublication:'أزيل من المنشور — يبقى في مساحتك'};
function current(){const s=getSubject();return session&&!session.local&&s?{workspaceId:session.workspaceId,subjectId:s.id,uid:session.uid}:null;}
function same(c){return JSON.stringify(c)===JSON.stringify(current());}
function setStatus(s){$('sharedRosterStatus').textContent=s;}
async function call(action,c,extra={}){if(!same(c))throw Error('تغير الحساب أو المادة. افتح القائمة مجدداً.');if(!navigator.onLine||session.offlineMode)throw Error('تحتاج اتصالاً بالإنترنت للحصول على القوائم المشتركة. قائمتك الحالية محفوظة.');await loadOptionalLibrary('functions');return (await firebase.app().functions('us-central1').httpsCallable('sharedStudentRoster')({...c,action,...extra})).data;}
function close(){generation++;preview=null;context=null;$('sharedRosterDialog').close();trigger?.focus();}
function list(rows){const ul=$('sharedRosterList');ul.replaceChildren();for(const item of rows){const li=document.createElement('li'),name=document.createElement('strong'),note=document.createElement('span');name.textContent=item.name;note.textContent=item.kind?(kinds[item.kind]+(item.oldName?' · '+item.oldName:'')):'اسم فقط';li.append(name,note);ul.append(li);}}
async function open(publish=false){
 if(busy)return;const c=current();if(!c)return;trigger=document.activeElement;context=c;preview=null;const gen=++generation;
 $('sharedRosterTitle').textContent=publish?'مشاركة قائمة الطلبة':'قائمة القسم المشتركة';$('sharedRosterConfirm').hidden=true;$('sharedRosterList').replaceChildren();$('sharedRosterSummary').textContent='';setStatus('جارٍ تجهيز المعاينة…');$('sharedRosterDialog').showModal();
 try{const data=await call(publish?'previewPublish':'preview',c);if(gen!==generation||!same(c))return;
  preview={...data,publish};$('sharedRosterScope').textContent=data.scope.department+' · المرحلة '+data.scope.stage;
  $('sharedRosterSummary').textContent=publish?`${data.count} اسم. ستتاح لجميع مواد وتدريسيي هذا القسم والمرحلة. لن تُشارك حالات الطلبة أو الحضور أو الصور والبصمات.`:`إضافة ${data.added} · تحديث أسماء ${data.renamed}. تبقى حالاتك وحضورك وبصماتك خاصة. لن تُحذف أسماء من قائمتك ولن تُستبدل تعديلاتك الخاصة.`;
  list(publish?data.names.map(name=>({name})):data.changes);setStatus(publish?'رفع قائمة أو تعديلها في مساحتك لا ينشرها تلقائياً. المشاركة تحدث بهذا الزر فقط.':'راجع الأسماء ثم اعتمد التحديث. يمكنك إغلاق النافذة وتأجيله.');
  const b=$('sharedRosterConfirm');b.textContent=publish?(data.revision?'نشر تحديث القائمة':'مشاركة هذه القائمة'):'اعتماد في مساحتي';b.hidden=false;b.disabled=false;
 }catch(e){if(gen===generation)setStatus(e.message||'تعذر تحميل القائمة.');}
}
async function confirm(){if(busy||!preview||!context)return;busy=true;const p=preview,c=context,gen=generation;let committed=false;const b=$('sharedRosterConfirm');b.disabled=true;setStatus(p.publish?'جارٍ نشر الأسماء…':'جارٍ اعتماد التحديث…');
 try{const result=await call(p.publish?'publish':'apply',c,{revision:p.revision,token:p.token});committed=true;if(!same(c))return;
  checked.delete(JSON.stringify(c));
  if(!p.publish){const s=getSubject(),snap=await workspaceRef().collection('subjects').doc(s.id).get();if(!same(c))return;
   const data=snap.data()||{};s.sharedRosterSubscriptionId=data.sharedRosterSubscriptionId;if(Array.isArray(data.students))s.students=data.students;
   subjects.filter(x=>cohortIdForSubject(x)===cohortIdForSubject(s)).forEach(x=>{x.rosterLoaded=false;});await ensureSubjectRosterLoaded(s);if(!same(c))return;buildStudentCache();renderAll();
  }
  if(gen===generation){setStatus(p.publish?(result.unchanged?'هذه القائمة منشورة بالفعل.':'تم نشر القائمة. لن تؤثر تعديلاتك الخاصة عليها إلا عند نشر تحديث جديد.'):'تم اعتماد التحديث في مساحتك.');b.hidden=true;preview=null;}
  check(true);
 }catch(e){if(gen===generation){if(committed){setStatus('تم حفظ العملية على الخادم. اضغط تحديث لإعادة تحميل قائمتك.');b.hidden=true;preview=null;}else{setStatus(e.message||'تعذر إكمال العملية.');b.disabled=false;}}}finally{busy=false;}
}
async function check(force=false){
 const c=current();if(!c||!navigator.onLine||session.offlineMode)return;const k=JSON.stringify(c);if(!force&&Date.now()-(checked.get(k)||0)<300000)return;checked.set(k,Date.now());
 try{const data=await call('check',c);if(!same(c))return;const b=$('sharedRosterAvailable');b.hidden=!data.updateAvailable;b.textContent=data.updateAvailable?(data.accepted?'يتوفر تحديث لقائمة الطلبة — مراجعة':'توجد قائمة طلبة مشتركة لهذا القسم والمرحلة — مراجعة'):'';}catch{/* Optional background check must never block startup or sync. */}
}
function refresh(){if(!$('sharedRosterTools'))return;const c=current(),k=JSON.stringify(c);$('sharedRosterTools').hidden=!c;$('publishSharedRoster').hidden=!c||!canManageRegistration();
 if(k!==lastKey){lastKey=k;$('sharedRosterAvailable').hidden=true;if($('sharedRosterDialog').open)close();}
 clearTimeout(timer);if(c)timer=setTimeout(()=>check(),1600);
}
function setup(){if($('sharedRosterTools'))return;const bar=document.createElement('div');bar.id='sharedRosterTools';bar.className='sharedRosterTools';bar.hidden=true;bar.innerHTML='<div class="miniActions"><button type="button" class="btn ghost" id="viewSharedRoster">قائمة القسم المشتركة</button><button type="button" class="btn" id="publishSharedRoster" hidden>مشاركة قائمة الطلبة</button></div><button type="button" id="sharedRosterAvailable" class="sharedRosterAvailable" hidden></button>';$('studentSearch').parentElement.before(bar);
 const dialog=document.createElement('dialog');dialog.id='sharedRosterDialog';dialog.innerHTML='<div class="settingsHeader"><h2 id="sharedRosterTitle">قائمة الطلبة</h2><button type="button" class="btn ghost" id="sharedRosterClose" aria-label="إغلاق">×</button></div><p id="sharedRosterScope"></p><p id="sharedRosterSummary"></p><ul id="sharedRosterList"></ul><p id="sharedRosterStatus" role="status"></p><button type="button" id="sharedRosterConfirm" class="btn" hidden></button>';dialog.setAttribute('aria-labelledby','sharedRosterTitle');document.body.append(dialog);
 $('viewSharedRoster').onclick=()=>open();$('sharedRosterAvailable').onclick=()=>open();$('publishSharedRoster').onclick=()=>open(true);$('sharedRosterClose').onclick=close;$('sharedRosterConfirm').onclick=confirm;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});window.addEventListener('online',()=>check(true));refresh();}
const previousInit=init;init=()=>{previousInit();setup();};const previousRender=renderAll;renderAll=function(...args){const result=previousRender.apply(this,args);refresh();return result;};
window.HathirSharedRosters=Object.freeze({check,refresh});
})();
