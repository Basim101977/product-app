(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const tr = (ar, en) => document.documentElement.lang === 'en' ? en : ar;
  let installed = false;
  let recordPlaceholder = null;
  let expandedFromInline = false;
  let recordPrintTimer = 0;
  let selectedLecture = null;

  function lectureScope() {
    return JSON.stringify([session?.uid, session?.workspaceId, subjectNow()?.id,
      selectedSubjectGroup().map(s => s.id).sort()]);
  }
  function selectedLectureDate() {
    if (!selectedLecture) return null;
    const view = attendanceView();
    if (selectedLecture.scope !== lectureScope() || !view || !visibleRosterLectures(view).includes(selectedLecture.date)) {
      selectedLecture = null;
      return null;
    }
    return selectedLecture.date;
  }

  function renderSelectedReading(subject, date) {
    const sources = selectedSubjectGroup().map(attendanceDisplaySubject);
    const pending = sources.some(s => !usesLocalWorkspace(session) && s.historyPending && !s.loadedLectureDates?.has(date));
    if (pending) {
      $('presentCount').textContent = '—'; $('lastScanId').textContent = '—';
      $('lastScanTime').textContent = tr('جارٍ تحميل المحاضرة…', 'Loading lecture…');
      $('lastScanTime').hidden = false;
      return;
    }
    const marks = new Map();
    let latest = null;
    for (const source of sources) for (const [id, raw] of Object.entries(source.attendance?.[date] || {})) {
      marks.set(normalizeId(id), raw);
      const record = typeof raw === 'string' ? {time:raw} : raw || {};
      const time = displayAttendanceTime(record.time);
      if (!time) continue;
      const name = record.studentName || source.students?.find(s => normalizeId(s.id) === normalizeId(id))?.name
        || source.archivedStudents?.find(s => normalizeId(s.id) === normalizeId(id))?.name || id;
      const at = Number(record.markedAtMillis || record.markedAt?.toMillis?.() || 0)
        || Date.parse(`${lectureCalendarDate(date)}T${time}:00+03:00`) || 0;
      if (!latest || at > latest.at) latest = {name,time,at};
    }
    // Historical cohort snapshots are not stored: retain the current roster total.
    $('studentCount').title = tr('إجمالي قائمة الطلبة الحالية للمادة', 'Current subject roster total');
    $('presentCount').textContent = String(marks.size);
    $('lastScanId').textContent = latest?.name || '—';
    $('lastScanTime').textContent = latest?.time || '';
    $('lastScanTime').hidden = !latest;
  }

  function subjectNow() {
    try { return typeof getSubject === 'function' ? getSubject() : null; }
    catch { return null; }
  }
  function studentsNow(subject) {
    if (!subject) return [];
    try { return typeof attendanceView === 'function' ? (attendanceView()?.students || subject.students || []) : (subject.students || []); }
    catch { return subject.students || []; }
  }

  function createRosterDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'beginnerRosterDialog';
    dialog.className = 'beginnerRosterDialog';
    dialog.innerHTML = `<div class="beginnerRosterBody">
      <div class="beginnerDialogHead"><div><h2 id="beginnerRosterTitle"></h2><p id="beginnerRosterHelp"></p></div><button id="beginnerRosterClose" type="button" aria-label="إغلاق">×</button></div>
      <button id="beginnerRosterImport" class="beginnerRosterChoice" type="button"><strong></strong><span></span></button>
      <button id="beginnerRosterSingle" class="beginnerRosterChoice" type="button"><strong></strong><span></span></button>
    </div>`;
    document.body.append(dialog);
  }

  function createSideMenu() {
    if ($('beginnerMenuButton')) return;
    const account = document.querySelector('#appPage .accountArea');
    const toggle = document.createElement('button');
    toggle.id = 'beginnerMenuButton';
    toggle.className = 'beginnerMenuButton';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'beginnerSideMenu');
    toggle.setAttribute('aria-label', 'فتح القائمة');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    document.querySelector('#appPage .head')?.append(toggle);

    const avatar = document.createElement('div');
    avatar.id = 'beginnerAvatar';
    avatar.className = 'beginnerAvatar';
    account?.prepend(avatar);

    const shade = document.createElement('button');
    shade.id = 'beginnerMenuShade';
    shade.className = 'beginnerMenuShade';
    shade.type = 'button';
    shade.hidden = true;
    shade.setAttribute('aria-label', 'إغلاق القائمة');
    const menu = document.createElement('aside');
    menu.id = 'beginnerSideMenu';
    menu.className = 'beginnerSideMenu';
    menu.setAttribute('aria-label', 'قائمة البرنامج');
    menu.innerHTML = `<div class="beginnerMenuHead"><strong id="beginnerMenuTitle"></strong><button id="beginnerMenuClose" type="button" aria-label="إغلاق">×</button></div><nav id="beginnerMenuItems"></nav><div class="beginnerMenuIdentity"><div id="beginnerMenuAccount"><strong id="beginnerMenuUser"></strong></div><span id="beginnerMenuRole"></span><small id="beginnerMenuVersion"></small></div>`;
    document.body.append(shade, menu);

    const items = $('beginnerMenuItems');
    for (const id of ['settingsBtn', 'syncBtn', 'tourReplay', 'logoutBtn']) {
      const button = $(id);
      if (button) (id === 'logoutBtn' ? $('beginnerMenuAccount') : items).append(button);
    }
  }

  function createHub() {
    const view = $('attendanceView');
    if (!view || $('beginnerHub')) return;
    document.body.classList.add('beginnerSimplified');
    const hub = document.createElement('section');
    hub.id = 'beginnerHub';
    hub.className = 'beginnerHub';
    hub.innerHTML = `<div class="beginnerSubjectChooser">
      <button id="beginnerChooseSubject" class="beginnerMainButton beginnerSubjectToggle" type="button" aria-haspopup="menu" aria-expanded="false"></button>
      <div id="beginnerSubjectMenu" class="beginnerSubjectMenu" role="menu" hidden><div id="beginnerSubjectChoices"></div><div class="beginnerSubjectCommands"><button id="beginnerCreateSubject" type="button"></button><button id="beginnerEditSubject" type="button"></button></div></div>
      <div id="beginnerSubjectSlot" hidden></div>
    </div>
    <div id="beginnerSessionActions"><button id="beginnerStartAttendance" class="beginnerMainButton" type="button"></button></div>
    <button id="beginnerOpenRecord" class="beginnerMainButton" type="button"></button>`;
    view.insertBefore(hub, view.querySelector('.stats'));
    const stats = view.querySelector('.stats');
    const summary = document.createElement('section');
    summary.id = 'beginnerLectureSummary';
    summary.innerHTML = '<div id="beginnerLectureState" role="status"></div><div id="beginnerLectureDetails"></div>';
    $('beginnerSessionActions').after(summary);
    if (stats) summary.append(stats);
    $('beginnerSessionActions').append($('completeLectureBtn'), $('cancelLectureBtn'));
    const controls = document.createElement('section');
    controls.id = 'beginnerAttendanceControls';
    hub.prepend(controls);
    controls.append(hub.querySelector('.beginnerSubjectChooser'), $('beginnerSessionActions'));
    const scanner = document.querySelector('.scannerCard');
    if (scanner) controls.append(scanner);
    const quickSubject = $('quickTeachingSubject');
    if (quickSubject) $('beginnerSubjectSlot').append(quickSubject);
    const recordHead = $('attendanceRecordCard')?.querySelector('.cardHeader');
    if (recordHead && !$('beginnerRecordClose')) {
      const close = document.createElement('button');
      close.id = 'beginnerRecordClose';
      close.className = 'beginnerRecordClose';
      close.type = 'button';
      close.textContent = '×';
      close.setAttribute('aria-label', 'إغلاق سجل الحضور');
      const actions = $('attendanceActions');
      recordHead.append(close);
    }
    createRosterDialog();
    createSideMenu();
    // Keep the existing status elements/handlers; only change their presentation location.
    const sync = document.createElement('div');
    sync.id = 'beginnerSyncStatus';
    summary.append(sync);
    sync.append($('syncStatusHost'));
    if ($('deviceRecordStatus')) sync.append($('deviceRecordStatus'));
  }

  function setMenu(open) {
    document.body.classList.toggle('beginnerMenuOpen', open);
    $('beginnerMenuShade').hidden = !open;
    $('beginnerMenuButton').setAttribute('aria-expanded', String(open));
    if (open) $('beginnerMenuClose')?.focus();
    else $('beginnerMenuButton')?.focus();
  }

  function setSubjectMenu(open) {
    $('beginnerSubjectMenu').hidden = !open;
    $('beginnerChooseSubject').setAttribute('aria-expanded', String(open));
  }

  function initials() {
    const email = String(session?.email || '').split('@')[0];
    const parts = email.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    const value = parts[0] || String(session?.displayName || 'U');
    return value.slice(0, 2).toUpperCase();
  }

  function subjectLabel(subject) {
    if (!subject) return tr('اختيار المادة الدراسية', 'Choose subject');
    const department = departmentById(subjectDepartmentId(subject));
    const stage = stageById(subjectStageId(subject));
    return `${subjectTitle(subject)} · ${departmentTitle(department)} · ${stagePickerTitle(stage)} · ${studyPeriodLabel(subject)}`;
  }

  function subjectCaption(element, subject) {
    element.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = subject ? subjectTitle(subject) : tr('اختيار المادة الدراسية', 'Choose subject');
    element.append(title);
    if (subject) {
      const subtitle = document.createElement('small');
      subtitle.textContent = `· ${departmentTitle(departmentById(subjectDepartmentId(subject))).replace(/^قسم\s+/, '')} · ${stagePickerTitle(stageById(subjectStageId(subject)))} · ${studyPeriodLabel(subject)}`;
      element.append(subtitle);
    }
    element.title = element.textContent;
  }

  function renderLectureSummary(subject) {
    const box = $('beginnerLectureSummary');
    box.hidden = !subject;
    if (!subject) return;
    const selected = selectedLectureDate();
    const key = selected || currentLectureKey(subject);
    const source = selected ? selectedSubjectGroup().find(s => s.lectureMeta?.[key]) || subject : subject;
    const meta = source.lectureMeta?.[key];
    const scanning = document.body.classList.contains('beginnerScannerVisible');
    let state = 'ready', label = tr('بانتظار بدء المحاضرة', 'Waiting to start');
    if (meta?.status === 'cancelled' || meta?.status === 'voided') { state = 'cancelled'; label = tr('أُلغيت المحاضرة', 'Lecture cancelled'); }
    else if (meta?.status === 'completed' || (meta && lectureIsComplete(source, key))) {
      state = meta.closeReason === 'manual' ? 'ended' : 'closed';
      label = state === 'ended' ? tr('أُنهيت المحاضرة', 'Lecture ended') : tr('أُغلقت المحاضرة', 'Lecture closed');
    } else if ((selected ? meta?.status === 'active' : selectedSubjectGroup().some(currentLectureIsRunning)) || (!selected && scanning)) { state = 'active'; label = tr('جارية الآن', 'In progress'); }
    const status = $('beginnerLectureState');
    status.dataset.state = state;
    status.textContent = '';
    status.setAttribute('aria-label', label);
    status.title = label;
    const details = $('beginnerLectureDetails');
    details.replaceChildren();
    // Match the table: emptied lectures hidden from the roster must not shift
    // the selected lecture's display number in the summary.
    const keys = visibleRosterLectures(attendanceView() || subject);
    // Rendering must not invent the next lecture before one has actually begun.
    const displayLecture = keys.includes(key) && (Boolean(selected) || (state === 'active' && meta?.status === 'active'));
    const fields = displayLecture ? [[tr('محاضرة:', 'Lecture:'), String(lectureColumnParts(attendanceView() || subject, key).number)]] : [];
    fields.push(['', attendanceColumnDate(displayLecture ? key : todayISO())]);
    details.classList.toggle('noLecture', !displayLecture);
    for (const [name, value] of fields) {
      const item = document.createElement('div'), caption = document.createElement('span'), content = document.createElement('strong');
      caption.textContent = name; content.textContent = value;
      if (name) item.append(caption);
      item.append(content); details.append(item);
    }
    if (selected) renderSelectedReading(subject, selected);
    document.querySelectorAll('[data-device-lecture]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.deviceLecture === (selected || key))));
  }

  function closeRecord() {
    expandedFromInline = false;
    document.body.classList.remove('beginnerRecordMaximized');
    $('beginnerRecordDialog')?.classList.remove('recordMaximized');
    $('expandAttendanceRecordBtn')?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('beginnerRecordVisible', 'beginnerInlineRecordVisible');
    const pipVideo = $('beginnerScannerPipVideo');
    if (pipVideo) { pipVideo.pause(); pipVideo.srcObject = null; }
    $('beginnerScannerPip')?.remove();
    const dialog = $('beginnerRecordDialog');
    if (dialog?.open) dialog.close();
    const card = $('attendanceRecordCard');
    if (card && recordPlaceholder?.parentNode) recordPlaceholder.parentNode.insertBefore(card, recordPlaceholder.nextSibling);
    card?.querySelector('.cardHeader')?.append($('expandAttendanceRecordBtn'));
    recordPlaceholder?.remove();
    recordPlaceholder = null;
    clearTimeout(recordPrintTimer);
    if ($('printBtn')) $('printBtn').disabled = false;
    if (typeof rosterPrintMode !== 'undefined') { rosterPrintMode = false; renderRoster(); }
    $('expandAttendanceRecordBtn')?.focus();
    if (typeof cameraStream !== 'undefined' && cameraStream) document.querySelector('.scannerCard')?.scrollIntoView({ block: 'start' });
  }

  function showAttendanceSuccess(name) {
    const result = $('scannerHudResult');
    if (!result) return;
    result.className = 'scannerHudResult visible attendanceSuccess';
    result.replaceChildren();
    const tick = document.createElement('span');
    tick.className = 'attendanceSuccessTick';
    tick.setAttribute('aria-hidden', 'true');
    tick.textContent = '✓';
    const label = document.createElement('strong');
    label.textContent = name;
    result.append(tick, label);
  }

  function showAttendanceNotice(kind) {
    const labels={duplicate:['تم التسجيل مسبقًا','Already recorded'],missing:['الطالب غير موجود في القائمة','Student not in this roster'],face:['عدم تطابق بصمة الوجه','Face does not match']};
    const result=$('scannerHudResult');if(!result||!labels[kind])return;
    result.className='scannerHudResult visible attendanceNotice '+(kind==='duplicate'?'attendanceDuplicate':'attendanceRejected');
    result.replaceChildren();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 80 80');svg.setAttribute('aria-hidden','true');
    const shape=document.createElementNS(svg.namespaceURI,kind==='duplicate'?'path':'circle');
    if(kind==='duplicate')shape.setAttribute('d','M40 6 L75 70 Q77 74 72 74 H8 Q3 74 5 70 Z');
    else {shape.setAttribute('cx','40');shape.setAttribute('cy','40');shape.setAttribute('r','35');}
    shape.setAttribute('fill','currentColor');svg.append(shape);
    const mark=document.createElementNS(svg.namespaceURI,'path');mark.setAttribute('d',kind==='duplicate'?'M40 29 V48 M40 59 V60':'M27 27 L53 53 M53 27 L27 53');mark.setAttribute('stroke',kind==='duplicate'?'#422006':'white');mark.setAttribute('stroke-width','6');mark.setAttribute('stroke-linecap','round');svg.append(mark);
    const label=document.createElement('strong');label.textContent=labels[kind][document.documentElement.lang==='en'?1:0];result.append(svg,label);
  }

  function openRecord(forceDialog = false) {
    const card = $('attendanceRecordCard');
    if (!card) return;
    card.querySelector('.cardHeader')?.insertBefore($('expandAttendanceRecordBtn'), $('beginnerRecordClose'));
    if (forceDialog !== true && typeof cameraStream !== 'undefined' && cameraStream) {
      document.body.classList.add('beginnerRecordVisible', 'beginnerInlineRecordVisible');
      if (typeof rosterPrintMode !== 'undefined') { rosterPrintMode = true; renderRoster(); }
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    let dialog = $('beginnerRecordDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'beginnerRecordDialog';
      dialog.className = 'beginnerRecordDialog';
      dialog.addEventListener('cancel', event => { event.preventDefault(); closeRecord(); });
      document.body.append(dialog);
    }
    if (card.parentNode !== dialog) {
      recordPlaceholder = document.createComment('attendance-record-home');
      card.parentNode.insertBefore(recordPlaceholder, card);
      dialog.append(card);
    }
    document.body.classList.add('beginnerRecordVisible');
    if (!dialog.open) dialog.showModal();
    if (typeof rosterPrintMode !== 'undefined') { rosterPrintMode = true; renderRoster(); }
    if ($('printBtn')) {
      $('printBtn').disabled = true;
      clearTimeout(recordPrintTimer);
      recordPrintTimer = setTimeout(() => { if ($('printBtn')) $('printBtn').disabled = false; }, 800);
    }
    setTimeout(() => $('beginnerRecordClose')?.focus(), 0);
  }

  function startAttendance() {
    selectedLecture = null;
    if (document.body.classList.contains('beginnerScannerVisible')) {
      stopScanner();
      renderLectureBanner();
      render();
      return;
    }
    const subject = subjectNow();
    if (!subject) return $('teachingSetupBtn')?.click();

    document.body.classList.add('beginnerScannerVisible');
    render();
    renderLectureBanner();
    $('startCameraBtn')?.click();
    document.querySelector('.scannerCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function render() {
    if (!$('beginnerHub') || typeof session === 'undefined' || !session || $('appPage').hidden) return;
    const active = subjectNow();
    const stats = $('beginnerHub').querySelector('.stats');
    if (stats) stats.hidden = !active;
    $('cancelLectureBtn').textContent = tr('إلغاء المحاضرة', 'Cancel lecture');
    $('completeLectureBtn').textContent = tr('إنهاء المحاضرة', 'Close lecture');
    subjectCaption($('beginnerChooseSubject'), active);
    const scanning = document.body.classList.contains('beginnerScannerVisible');
    const start = $('beginnerStartAttendance');
    start.replaceChildren();
    if (!scanning) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 64 48'); icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<path d="M7 11h12l5-7h16l5 7h12a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4Z"/><circle cx="32" cy="27" r="12"/><circle cx="51" cy="19" r="2"/>';
      start.append(icon);
    }
    const startLabel = document.createElement('span');
    startLabel.textContent = scanning ? tr('إغلاق الكاميرا', 'Close camera') : tr('ابدأ تسجيل الحضور', 'Start attendance');
    start.append(startLabel);
    renderLectureSummary(active);
    const presentLabel = $('beginnerLectureSummary').querySelector('[data-i18n="presentToday"]');
    if (presentLabel) presentLabel.textContent = tr('الحضور', 'Present');
    $('lastScanTime').hidden = $('lastScanTime').textContent === text('noScanYet');
    // The local-first client has its own richer status; show exactly one status bar.
    $('syncStatusHost').hidden = Boolean($('deviceRecordStatus'));
    $('beginnerOpenRecord').textContent = tr('سجل الحضور', 'Attendance record');
    for (const option of $('quickTeachingSubject')?.options || []) {
      const subject = (typeof subjects !== 'undefined' ? subjects : []).find(item => item.id === option.value);
      if (subject) option.textContent = typeof subjectTitle === 'function' ? subjectTitle(subject)+' · '+studyPeriodLabel(subject) : (subject.titleAr || subject.titleEn || option.textContent);
    }
    const choices = $('beginnerSubjectChoices');
    choices.replaceChildren();
    for (const subject of (typeof attendanceAvailableSubjects === 'function' ? attendanceAvailableSubjects() : [])) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.subjectId = subject.id;
      subjectCaption(button, subject);
      button.classList.toggle('active', subject.id === activeSubjectId);
      const row = document.createElement('div');
      row.className = 'subjectChoiceRow';
      const actions = document.createElement('div');
      actions.className = 'subjectChoiceActions';
      for (const [action,label,allowed] of [['edit',tr('تعديل','Edit'),canManageSubject(subject)],['delete',tr('حذف','Delete'),canDeleteSubject(subject)]]) {
        const control = document.createElement('button');
        control.type = 'button'; control.title = label;
        control.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (action === 'edit'
          ? '<path d="m14 5 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/>'
          : '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>') + '</svg>';
        control.dataset.subjectAction = action; control.dataset.targetSubject = subject.id;
        control.disabled = !allowed; control.setAttribute('aria-label',label+' '+subjectTitle(subject));
        actions.append(control);
      }
      row.append(button,actions); choices.append(row);
    }
    $('beginnerCreateSubject').textContent = tr('إنشاء مادة جديدة', 'Create a subject');
    $('beginnerEditSubject').textContent = tr('إدارة المادة', 'Manage subject');
    $('beginnerEditSubject').hidden = true;
    $('beginnerAvatar').textContent = initials();
    $('beginnerAvatar').title = session.displayName || session.email || '';
    $('beginnerMenuUser').textContent = session.displayName || session.email || tr('التدريسي', 'Teacher');
    const roleLabels = {
      owner: tr('مالك النظام', 'System owner'), admin: tr('مدير', 'Administrator'), head: tr('رئيس قسم', 'Department head'),
      rapporteur: tr('مقرر', 'Rapporteur'), attendance_admin: tr('مسؤول حضور', 'Attendance administrator'),
      teacher: tr('تدريسي', 'Teacher'), viewer: tr('مشاهد', 'Viewer')
    };
    $('beginnerMenuRole').textContent = isPlatformOwnerEmail(session.email) ? roleLabels.owner : tr('تدريسي', 'Teacher');
    $('beginnerMenuTitle').textContent = tr('القائمة', 'Menu');
    const help = $('tourReplay');
    if (help) { help.textContent = tr('دعم', 'Support'); help.title = tr('الدعم والفيديوهات', 'Support and videos'); }
    $('beginnerRosterTitle').textContent = tr('لا توجد أسماء طلبة', 'No student names');
    $('beginnerRosterHelp').textContent = tr('أضف أسماء الطلبة أولًا، ثم ابدأ تسجيل الحضور.', 'Add student names first, then start attendance.');
    $('beginnerRosterImport').querySelector('strong').textContent = tr('رفع قائمة الطلبة', 'Upload student list');
    $('beginnerRosterImport').querySelector('span').textContent = tr('استيراد ملف Excel أو CSV', 'Import an Excel or CSV file');
    $('beginnerRosterSingle').querySelector('strong').textContent = tr('إضافة طالب', 'Add a student');
    $('beginnerRosterSingle').querySelector('span').textContent = tr('إضافة اسم واحد يدويًا', 'Add one name manually');
    const version = $('appVersion');
    if (version) { version.hidden = false; $('beginnerMenuVersion').textContent = version.textContent; }
  }

  function bind() {
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-device-lecture]');
      if (!button || !$('attendanceRecordCard')?.contains(button)) return;
      selectedLecture = {scope:lectureScope(), date:button.dataset.deviceLecture};
      renderSummary();
      render();
    }, true);
    $('beginnerChooseSubject').addEventListener('click', () => {
      if (!$('tourPanel')?.hidden) return $('teachingSetupBtn')?.click();
      setSubjectMenu($('beginnerSubjectMenu').hidden);
    });
    $('beginnerSubjectChoices').addEventListener('click', event => {
      const button = event.target.closest('[data-subject-id]');
      if (!button) return;
      const select = $('quickTeachingSubject');
      select.value = button.dataset.subjectId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      setSubjectMenu(false);
    });
    $('beginnerCreateSubject').addEventListener('click', () => { setSubjectMenu(false); $('teachingSetupBtn')?.click(); });
    $('beginnerEditSubject').addEventListener('click', () => { setSubjectMenu(false); $('teachingSetupBtn')?.click(); });
    $('beginnerStartAttendance').addEventListener('click', startAttendance);
    for (const id of ['completeLectureBtn', 'cancelLectureBtn']) $(id)?.addEventListener('click', event => {
      if (!document.body.classList.contains('beginnerSimplified') || !document.body.classList.contains('beginnerScannerVisible')) return;
      if (selectedSubjectGroup().some(subject => subject.lectureMeta?.[currentLectureKey(subject)]?.status === 'active')) return;
      // Before the first attendance mark there is only a scanner session, not a saved lecture.
      event.preventDefault(); event.stopImmediatePropagation();
      stopScanner(); renderLectureBanner();
      notify(id === 'cancelLectureBtn' ? tr('أُلغيت جلسة التسجيل.', 'Attendance session cancelled.') : tr('أُغلقت جلسة التسجيل.', 'Attendance session closed.'), 'ok');
    }, true);
    $('beginnerOpenRecord').addEventListener('click', openRecord);
    $('beginnerRecordClose')?.addEventListener('click', closeRecord);
    $('expandAttendanceRecordBtn')?.addEventListener('click', event => {
      if (!document.body.classList.contains('beginnerSimplified')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const dialog = $('beginnerRecordDialog');
      if (dialog?.classList.contains('recordMaximized')) {
        if (expandedFromInline) { closeRecord(); }
        else { document.body.classList.remove('beginnerRecordMaximized'); dialog.classList.remove('recordMaximized'); $('expandAttendanceRecordBtn').setAttribute('aria-expanded', 'false'); }
      } else {
        expandedFromInline = !dialog?.open || document.body.classList.contains('beginnerInlineRecordVisible');
        openRecord(true);
        $('beginnerRecordDialog').classList.add('recordMaximized');
        document.body.classList.add('beginnerRecordMaximized');
        $('expandAttendanceRecordBtn').setAttribute('aria-expanded', 'true');
      }
      const label = tr('تكبير سجل الحضور', 'Expand attendance record');
      const collapse = tr('تصغير سجل الحضور', 'Restore attendance record');
      const button = $('expandAttendanceRecordBtn');
      button.title = button.getAttribute('aria-expanded') === 'true' ? collapse : label;
      button.setAttribute('aria-label', button.title);
    }, true);
    $('beginnerMenuButton').addEventListener('click', () => setMenu(!document.body.classList.contains('beginnerMenuOpen')));
    $('beginnerMenuClose').addEventListener('click', () => setMenu(false));
    $('beginnerMenuShade').addEventListener('click', () => setMenu(false));
    $('beginnerMenuItems').addEventListener('click', event => { if (event.target.closest('button')) setMenu(false); });
    $('logoutBtn').addEventListener('click', () => setMenu(false));
    document.addEventListener('pointerdown', event => { if (!$('beginnerSubjectMenu').hidden && !event.target.closest('.beginnerSubjectChooser')) setSubjectMenu(false); });
    $('beginnerRosterClose').addEventListener('click', () => $('beginnerRosterDialog').close());
    $('beginnerRosterImport').addEventListener('click', () => { $('beginnerRosterDialog').close(); $('importStudentsQuickBtn')?.click(); });
    $('beginnerRosterSingle').addEventListener('click', () => { $('beginnerRosterDialog').close(); $('addStudentQuickBtn')?.click(); });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (document.body.classList.contains('beginnerMenuOpen')) setMenu(false);
      else if (document.body.classList.contains('beginnerRecordVisible')) closeRecord();
    });
  }


  function install() {
    if (installed) return;
    installed = true;
    createHub();
    bind();
    const baseBanner = renderLectureBanner;
    renderLectureBanner = function () {
      const result = baseBanner.apply(this, arguments);
      renderLectureSummary(subjectNow());
      return result;
    };
    const baseRender = renderAll;
    renderAll = function () { const result = baseRender.apply(this, arguments); render(); return result; };
    const baseLanguage = applyLanguage;
    applyLanguage = function () { const result = baseLanguage.apply(this, arguments); render(); return result; };
    new MutationObserver(render).observe($('appPage'), { attributes: true, attributeFilter: ['hidden'] });
    render();
  }

  const baseInit = init;
  init = function () { const result = baseInit.apply(this, arguments); install(); return result; };
  window.HathirBeginnerUI = Object.freeze({ render, openRecord, closeRecord, showAttendanceSuccess, showAttendanceNotice, selectedLectureDate });
})();


