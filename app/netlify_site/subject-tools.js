(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = (ar,en) => lang === 'en' ? en : ar;
  const esc = value => escapeHtml(String(value ?? ''));
  let editor, editingId = '', editingSession = null, busy = false, applied = '', queued = false;
  const key = () => session?.uid ? 'hathir.weekly-subject.v1:' + JSON.stringify([session.uid,session.workspaceId || 'local']) : '';
  const dayStamp = date => [date.getFullYear(),date.getMonth(),date.getDate()].join('-');
  function preferences() { try { return JSON.parse(localStorage.getItem(key()) || '{}') || {}; } catch { return {}; } }
  function writePreferences(value) { try { localStorage.setItem(key(),JSON.stringify(value)); return true; } catch { return false; } }
  function slots(date) {
    const saved=preferences()[date.getDay()];
    // Retain old weekday-only preferences until a timed selection replaces them.
    if(typeof saved==='string')return [{id:saved,minute:0,legacy:true}];
    return (Array.isArray(saved)?saved:[]).filter(s=>s&&typeof s.id==='string'&&Number.isInteger(s.minute)&&s.minute>=0&&s.minute<1440).sort((a,b)=>a.minute-b.minute);
  }
  function scheduled(date) {
    const available=new Set(attendanceAvailableSubjects().map(s=>s.id));
    const list=slots(date).filter(s=>available.has(s.id));
    const minute=date.getHours()*60+date.getMinutes();
    return list.filter(s=>s.minute<=minute).at(-1) || list[0] || null;
  }
  const scheduleStamp=date=>key()+dayStamp(date)+':'+JSON.stringify(scheduled(date));
  function remember(id, date = new Date()) {
    if (!key() || !attendanceAvailableSubjects().some(s=>s.id===id)) return;
    const value = preferences(), minute=date.getHours()*60+date.getMinutes();
    value[date.getDay()] = [...slots(date).filter(s=>!s.legacy&&s.minute!==minute),{id,minute}].sort((a,b)=>a.minute-b.minute);
    if (!writePreferences(value)) notify(t('تعذّر حفظ تفضيل اليوم على هذا الجهاز.','Could not save this day’s preference on this device.'),'warn');
    applied = scheduleStamp(date); renderHint(date);
  }
  function renderHint(date = new Date()) {
    if (!$('subjectWeeklyHint')) return;
    const slot=scheduled(date), subject = attendanceAvailableSubjects().find(s=>s.id===slot?.id);
    const time=slot&&!slot.legacy?String(Math.floor(slot.minute/60)).padStart(2,'0')+':'+String(slot.minute%60).padStart(2,'0'):'';
    const day = date.toLocaleDateString(lang==='en'?'en':'ar-IQ',{weekday:'long'});
    $('subjectWeeklyText').textContent = subject
      ? t('موعد '+day+' '+time+': '+subjectTitle(subject)+' — على هذا الجهاز','Scheduled '+day+' '+time+': '+subjectTitle(subject)+' — on this device')
      : '';
    $('subjectWeeklyHint').hidden=!subject;
    $('subjectForgetDay').hidden = !subject;
    $('subjectForgetDay').textContent = t('مسح مواعيد اليوم','Forget today’s schedule');
  }
  function applyDefault(date = new Date()) {
    if (!key() || $('appPage').hidden || cloudDataLoading || !attendanceAvailableSubjects().length) return false;
    const stamp = scheduleStamp(date);
    if (applied === stamp) return false;
    // Never switch underneath an active scanner, live lecture or form.
    if (editor?.open || document.querySelector('.modalBackdrop:not([hidden])') || document.body.classList.contains('beginnerScannerVisible') ||
        attendanceAvailableSubjects().some(s=>Object.values(s.lectureMeta || {}).some(m=>m.status==='active'))) return false;
    const id = scheduled(date)?.id, subject = attendanceAvailableSubjects().find(s=>s.id===id);
    applied = stamp;
    if (!subject || subject.id === activeSubjectId) return false;
    compactScope = {departmentId:subjectDepartmentId(subject),stageId:subjectStageId(subject),studyPeriod:subjectStudyPeriod(subject),section:subjectSection(subject)};
    activeSubjectId = subject.id;
    compactRefresh().catch(error=>notify(error.message || String(error),'error'));
    return true;
  }
  function field(id,label,type='text',value='') {
    return `<label class="subjectField" for="${id}">${label}<input id="${id}" type="${type}" value="${esc(value)}" required ${type==='number'?'min="0.1" step="any" inputmode="decimal"':''}></label>`;
  }
  function fillStages(selected) {
    const dept = $('subjectDept').value;
    const candidates = stages.filter(s=>s.departmentId===dept);
    const list = candidates.length ? candidates.slice() : defaultStagesForDepartment(dept);
    const legacy = subjects.find(s=>s.departmentId===dept && s.stageId===selected);
    if (selected && !list.some(s=>s.id===selected) && legacy) list.push({id:selected,label:stageTitle(stageById(selected))});
    $('subjectStage').innerHTML = list.map(s=>`<option value="${esc(s.id)}">${esc(s.label || stageNameBySort(s.sort))}</option>`).join('');
    if (list.some(s=>s.id===selected)) $('subjectStage').value = selected;
  }
  function openEditor(mode, subjectId = activeSubjectId) {
    const subject = mode==='edit' ? subjects.find(s=>s.id===subjectId) : null;
    if (mode==='edit' ? !canManageSubject(subject) : !hasPermission('classesCreate')) return notify(text('noPermission'),'warn');
    if (busy) return;
    stopScanner();
    editingId = subject?.id || ''; editingSession = session;
    const current = subject || getSubject(), scope = compactScope || {};
    const settings = subject?.absenceSettings || {system:'traditional-annual',...defaultAbsenceSettings('traditional-annual')};
    editor.innerHTML = `<form id="subjectEditorForm"><header><h2>${t(subject?'تعديل المادة':'مادة جديدة',subject?'Edit subject':'New subject')}</h2><button type="button" id="subjectEditorClose" class="btn ghost" aria-label="${t('إغلاق','Close')}">×</button></header>
      ${field('subjectName',t('اسم المادة','Subject name'),'text',subject?subjectTitle(subject):'')}
      <div class="subjectFormGrid"><label class="subjectField">${t('القسم','Department')}<select id="subjectDept" ${subject?'disabled':''}>${departments.filter(d=>d.active!==false || d.id===subjectDepartmentId(current)).map(d=>`<option value="${esc(d.id)}">${esc(departmentTitle(d))}</option>`).join('')}</select></label>
      <label class="subjectField">${t('المرحلة','Stage')}<select id="subjectStage" ${subject?'disabled':''}></select></label>
      <label class="subjectField">${t('الدراسة','Study period')}<select id="subjectPeriod" ${subject?'disabled':''}><option value="morning">${t('صباحي','Morning')}</option><option value="evening">${t('مسائي','Evening')}</option></select></label></div>
      ${subject?`<p class="subjectHelp">${t('القسم والمرحلة والدراسة ثابتة للحفاظ على ارتباط الطلبة والحضور.','Department, stage and study period stay fixed to preserve roster and attendance links.')}</p>`:`<p class="subjectHelp">${t('تُضاف أسماء الطلبة الموجودة لنفس القسم والمرحلة والدراسة تلقائيًا.','Existing students in the same department, stage and study period are added automatically.')}</p>`}
      <div class="subjectFormGrid">${field('subjectHours',t('مجموع ساعات المادة','Total subject hours'),'number',subject?subjectTotalHours(subject):60)}${field('subjectDuration',t('مدة المحاضرة القادمة (ساعة)','Future lecture duration (hours)'),'number',subject?subjectLectureDurationHours(subject):2)}</div>
      <label class="subjectField">${t('نظام التدريس','Teaching system')}<select id="subjectSystem"><option value="traditional-annual">${t('تقليدي سنوي','Traditional annual')}</option><option value="traditional-semester">${t('تقليدي فصلي','Traditional semester')}</option><option value="bologna">${t('مسار بولونيا','Bologna')}</option></select></label>
      <details><summary>${t('إعدادات الغياب','Absence settings')}</summary><div class="subjectFormGrid">${['notice','warning','fail'].map((k,i)=>field('subject_'+k,t(['تنبيه (%)','إنذار (%)','رسوب (%)'][i],['Notice (%)','Warning (%)','Fail (%)'][i]),'number',settings[k]??'')).join('')}</div></details>
      <p class="subjectHelp">${t('تغيير مدة المحاضرة لا يغيّر مدد المحاضرات السابقة.','Changing lecture duration does not change previous lectures.')}</p>
      <p id="subjectEditorError" role="alert"></p><footer><button class="btn" id="subjectEditorSave" type="submit">${t(subject?'حفظ التعديلات':'إنشاء المادة',subject?'Save changes':'Create subject')}</button><button class="btn ghost" type="button" id="subjectEditorCancel">${t('إلغاء','Cancel')}</button></footer></form>`;
    $('subjectDept').value = current ? subjectDepartmentId(current) : scope.departmentId || departments[0]?.id || '';
    fillStages(current ? subjectStageId(current) : scope.stageId);
    $('subjectPeriod').value = current ? subjectStudyPeriod(current) : subjectStudyPeriod(scope);
    $('subjectDuration').max = '24';
    $('subjectSystem').value = settings.system || 'traditional-annual';
    for (const k of ['notice','warning','fail']) { const input=$('subject_'+k);input.required=false;input.min='1';input.max='100';input.step='1'; }
    $('subjectDept').onchange = () => fillStages();
    $('subjectSystem').onchange = () => {const values=defaultAbsenceSettings($('subjectSystem').value);for(const k of ['notice','warning','fail']) $('subject_'+k).value=values[k];};
    $('subjectEditorClose').onclick = $('subjectEditorCancel').onclick = () => {if(!busy)editor.close();};
    $('subjectEditorForm').onsubmit = save;
    editor.showModal(); $('subjectName').focus();document.dispatchEvent(new Event('hathir-subject-editor'));
  }
  async function save(event) {
    event.preventDefault(); if(busy || editingSession!==session)return;
    const subject = editingId ? subjects.find(s=>s.id===editingId) : null;
    let rollback = null;
    try {
      if (editingId ? !canManageSubject(subject) : !hasPermission('classesCreate')) throw Error(text('noPermission'));
      const title=$('subjectName').value.trim(), dept=$('subjectDept').value,stage=$('subjectStage').value,period=$('subjectPeriod').value;
      const hours=Number($('subjectHours').value),duration=Number($('subjectDuration').value);
      if(!title || !dept || !stage || !(hours>0) || !Number.isFinite(hours) || !(duration>0 && duration<=24)) throw Error(t('تحقق من الاسم والقسم والمرحلة والساعات.','Check name, department, stage and hours.'));
      const absenceSettings={system:$('subjectSystem').value}; let previous=0;
      for(const k of ['notice','warning','fail']){const raw=$('subject_'+k).value,value=raw===''?null:Number(raw);if(value!==null && (!Number.isInteger(value)||value<=previous||value>100))throw Error(text('invalidThresholds'));absenceSettings[k]=value;if(value!==null)previous=value;}
      busy=true;$('subjectEditorSave').disabled=true; $('subjectEditorError').textContent=t('جارٍ الحفظ…','Saving…');
      const id=subject?.id || 'subject_'+crypto.randomUUID();
      if(usesLocalWorkspace(session)) {
        const originalSession=session, originals={...localData.subjects};
        const snapshots=Object.fromEntries(Object.entries(originals).map(([key,s])=>[key,{...s,lectureMeta:structuredClone(s.lectureMeta||{}),policySnapshot:s.policySnapshot?{...s.policySnapshot}:s.policySnapshot}]));
        rollback=()=>{if(session!==originalSession)return;localData.subjects=originals;for(const [key,s] of Object.entries(originals)){for(const field of Object.keys(s))delete s[field];Object.assign(s,snapshots[key]);}subjects=Object.values(originals);};
        if(subject){
          // Freeze historical durations with the existing normalization before editing defaults.
          for(const date of new Set([...(subject.lectures||[]),...Object.keys(subject.lectureMeta||{})]))lectureMeta(subject,date);
          Object.assign(subject,{titleAr:title,titleEn:title,totalHours:hours,lectureDurationHours:duration,absenceSettings,summaryLoaded:false});
          if(subject.policySnapshot)subject.policySnapshot.totalHours=hours;
        }else{
          const created={id,rosterCohortId:'device_qr_'+crypto.randomUUID().replaceAll('-',''),titleAr:title,titleEn:title,departmentId:dept,stageId:stage,studyPeriod:period,section:'',ownerUserId:session.uid,rosterNaming:'name',totalHours:hours,lectureDurationHours:duration,absenceSettings,students:[],attendance:{},lectures:[],lectureMeta:{},excuses:{},archivedStudents:[],rosterLoaded:true,attendanceLoaded:true,lectureIndexLoaded:true,lectureIndexComplete:true,loadedLectureDates:new Set()};
          const planned=HathirPrivateScopeRoster.distribute(localData,created);
          for(const [key,value] of Object.entries(planned.subjects)){if(localData.subjects[key])Object.assign(localData.subjects[key],value);else localData.subjects[key]=value;}
        }
        await saveLocalData();rollback=null;subjects=Object.values(localData.subjects);
      }else{
        if(subject){
          await loadOptionalLibrary('functions');
          await firebase.app().functions('us-central1').httpsCallable('correctSubjectAnnualHours')({workspaceId:session.workspaceId,subjectId:id,totalHours:hours,lectureDurationHours:duration,absenceSettings});
          await workspaceRef().collection('subjects').doc(id).update({titleAr:title,titleEn:title,updatedAt:serverTimestamp()});
        }else{
          await workspaceRef().collection('subjects').doc(id).set({id,titleAr:title,titleEn:title,departmentId:dept,stageId:stage,studyPeriod:period,section:'',ownerUserId:session.uid,rosterNaming:'name',totalHours:hours,lectureDurationHours:duration,absenceSettings,lectures:[],lectureMeta:{},excuses:{},archivedStudents:[],createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        }
        await loadCloudData({hydrateActiveAttendance:false,loadActiveRoster:false});
      }
      if(editingSession!==session)return;
      activeSubjectId=id;compactScope={departmentId:dept,stageId:stage,studyPeriod:period,section:subject?subjectSection(subject):''};
      applied=scheduleStamp(new Date());editor.close();await compactRefresh();notify(t('تم حفظ المادة.','Subject saved.'),'ok');
    }catch(error){rollback?.();$('subjectEditorError').textContent=error.message || String(error);}
    finally{busy=false;if($('subjectEditorSave'))$('subjectEditorSave').disabled=false;}
  }
  function install() {
    if(!$('beginnerSubjectMenu') || $('subjectEditor'))return;
    const chooser=$('beginnerSubjectMenu').parentElement, commands=chooser.querySelector('.beginnerSubjectCommands');
    // Capture old buttons so their legacy setup-modal handlers cannot also run.
    commands.addEventListener('click',event=>{
      if(event.target.closest('#beginnerCreateSubject')){event.stopImmediatePropagation();$('beginnerSubjectMenu').hidden=true;$('beginnerChooseSubject').setAttribute('aria-expanded','false');openEditor('create');}
    },true);
    chooser.insertAdjacentHTML('beforeend','<div id="subjectWeeklyHint"><span id="subjectWeeklyText"></span><button id="subjectForgetDay" type="button"></button></div>');
    $('beginnerSubjectChoices').addEventListener('click',async event=>{
      const control=event.target.closest('[data-subject-action]');if(!control)return;
      event.stopImmediatePropagation();
      const subject=subjects.find(s=>s.id===control.dataset.targetSubject);if(!subject)return;
      if(control.dataset.subjectAction==='edit') {openEditor('edit',subject.id);return;}
      if(!canDeleteSubject(subject))return;
      // Keep the established delete pipeline and its confirmation.
      managedSubjectId=subject.id;
      try {await deleteClass(t('حذف «'+subjectTitle(subject)+'»؟\n'+subjectContext(subject)+' · '+studyPeriodLabel(subject)+'\nسيُحذف سجل هذه المادة وحضورها. لا تُحذف سجلات المواد الأخرى.','Delete “'+subjectTitle(subject)+'”?\n'+subjectContext(subject)+' · '+studyPeriodLabel(subject)+'\nThis subject and its attendance will be deleted. Other subjects are kept.'));render();}
      catch(error){notify(error.message || String(error),'error');}
    },true);
    $('subjectForgetDay').onclick=()=>{const value=preferences();delete value[new Date().getDay()];writePreferences(value);renderHint();};
    editor=document.createElement('dialog');editor.id='subjectEditor';editor.className='subjectEditor';document.body.append(editor);
    editor.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    editor.addEventListener('click',event=>{if(event.target===editor&&!busy){const r=editor.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)editor.close();}});
    $('quickTeachingSubject').addEventListener('change',event=>remember(event.target.value),true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('beginnerSubjectMenu').hidden=true;$('beginnerChooseSubject').setAttribute('aria-expanded','false');}});
    render();
  }
  function render(){
    if(!$('subjectEditor')||!session)return;
    $('beginnerCreateSubject').textContent=t('إنشاء مادة جديدة','Create a subject');$('beginnerCreateSubject').disabled=!hasPermission('classesCreate');
    $('beginnerEditSubject').hidden=true;
    renderHint();
    if(!queued){queued=true;queueMicrotask(()=>{queued=false;applyDefault();});}
  }
  const baseInit=init;init=function(){const result=baseInit.apply(this,arguments);install();return result;};
  const baseRender=renderAll;renderAll=function(){const result=baseRender.apply(this,arguments);render();return result;};
  window.addEventListener('focus',()=>{render();});
  // Pick the next remembered time while the app stays open, without interrupting work.
  setInterval(()=>{if(!document.hidden)render();},30000);
  window.HathirSubjectTools=Object.freeze({openEditor,remember,applyDefault,render,preferences});
})();
