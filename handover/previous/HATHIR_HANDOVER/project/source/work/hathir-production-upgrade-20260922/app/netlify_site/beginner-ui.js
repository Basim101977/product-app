(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const tr = (ar, en) => document.documentElement.lang === 'en' ? en : ar;
  let installed = false;
  let recordPlaceholder = null;
  let expandedFromInline = false;
  let recordPrintTimer = 0;

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
    if (stats) hub.insertBefore(stats, $('beginnerSessionActions'));
    $('beginnerSessionActions').append($('cancelLectureBtn'));
    const scanner = document.querySelector('.scannerCard');
    if (scanner) hub.insertBefore(scanner, $('beginnerOpenRecord'));
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
      (actions || recordHead).append(close);
    }
    createRosterDialog();
    createSideMenu();
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
    return `${departmentTitle(department)} · ${stagePickerTitle(stage)} · ${subjectTitle(subject)}`;
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
    $('beginnerOpenRecord')?.focus();
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

  function openRecord(forceDialog = false) {
    const card = $('attendanceRecordCard');
    if (!card) return;
    $('attendanceActions')?.insertBefore($('expandAttendanceRecordBtn'), $('beginnerRecordClose'));
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
    if (document.body.classList.contains('beginnerScannerVisible')) {
      renderLectureBanner();
      $('completeLectureBtn')?.click();
      return;
    }
    const subject = subjectNow();
    if (!subject) return $('teachingSetupBtn')?.click();
    if (!studentsNow(subject).length) return $('beginnerRosterDialog')?.showModal();
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
    $('beginnerChooseSubject').textContent = subjectLabel(active);
    $('beginnerStartAttendance').textContent = document.body.classList.contains('beginnerScannerVisible')
      ? tr('إنهاء المحاضرة', 'End lecture') : tr('ابدأ تسجيل الحضور', 'Start attendance');
    $('beginnerOpenRecord').textContent = tr('سجل الحضور', 'Attendance record');
    for (const option of $('quickTeachingSubject')?.options || []) {
      const subject = (typeof subjects !== 'undefined' ? subjects : []).find(item => item.id === option.value);
      if (subject) option.textContent = typeof subjectTitle === 'function' ? subjectTitle(subject) : (subject.titleAr || subject.titleEn || option.textContent);
    }
    const choices = $('beginnerSubjectChoices');
    choices.replaceChildren();
    for (const subject of (typeof attendanceAvailableSubjects === 'function' ? attendanceAvailableSubjects() : [])) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.subjectId = subject.id;
      button.textContent = subjectLabel(subject);
      button.classList.toggle('active', subject.id === activeSubjectId);
      choices.append(button);
    }
    $('beginnerCreateSubject').textContent = tr('إنشاء مادة جديدة', 'Create a subject');
    $('beginnerEditSubject').textContent = tr('تعديل المادة الحالية', 'Edit current subject');
    $('beginnerEditSubject').hidden = !active;
    $('beginnerAvatar').textContent = initials();
    $('beginnerAvatar').title = session.displayName || session.email || '';
    $('beginnerMenuUser').textContent = session.displayName || session.email || tr('التدريسي', 'Teacher');
    const roleLabels = {
      owner: tr('مالك النظام', 'System owner'), admin: tr('مدير', 'Administrator'), head: tr('رئيس قسم', 'Department head'),
      rapporteur: tr('مقرر', 'Rapporteur'), attendance_admin: tr('مسؤول حضور', 'Attendance administrator'),
      teacher: tr('تدريسي', 'Teacher'), viewer: tr('مشاهد', 'Viewer')
    };
    $('beginnerMenuRole').textContent = roleLabels[session.role] || tr('تدريسي', 'Teacher');
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
        if (expandedFromInline) { closeRecord(); openRecord(); }
        else { document.body.classList.remove('beginnerRecordMaximized'); dialog.classList.remove('recordMaximized'); $('expandAttendanceRecordBtn').setAttribute('aria-expanded', 'false'); }
      } else {
        expandedFromInline = document.body.classList.contains('beginnerInlineRecordVisible');
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
      if (document.body.classList.contains('beginnerSimplified') && document.body.classList.contains('beginnerScannerVisible') && getSubject()) {
        for (const id of ['completeLectureBtn', 'cancelLectureBtn']) { const button = $(id); if (button) button.hidden = false; }
        if (!selectedSubjectGroup().some(subject => subject.lectureMeta?.[currentLectureKey(subject)]?.status === 'active')) {
          $('completeLectureBtn').disabled = !attendanceInputReady() || !hasPermission('attendanceMark');
          $('cancelLectureBtn').disabled = !attendanceInputReady() || !hasAttendanceEditPermission();
        }
      }
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
  window.HathirBeginnerUI = Object.freeze({ render, openRecord, closeRecord, showAttendanceSuccess });
})();
