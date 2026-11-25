/* Opt-in simplified interface (preview). It renders a new shell over the
 * existing app and calls the existing attendance, scanner and sync functions;
 * it never writes attendance or storage by itself. Enable with ?ui=simple, or
 * from its own "classic interface" switch. The classic interface stays default. */
(() => {
  'use strict';
  const KEY = 'hathir-simple-ui';
  const $ = id => document.getElementById(id);
  const tr = (ar, en) => (typeof lang !== 'undefined' && lang === 'en' ? en : ar);
  const esc = value => escapeHtml(String(value ?? ''));
  // Weekday, day and month with Western digits, e.g. «الثلاثاء 24 نوفمبر».
  function lectureDate(key) {
    const day = typeof lectureCalendarDate === 'function' ? lectureCalendarDate(key) : String(key).slice(0, 10);
    const date = new Date(day + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return attendanceColumnDate(key);
    return new Intl.DateTimeFormat(tr('ar-u-nu-latn', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  }
  let enabled = false, root = null, tab = 'today', sub = '', filter = 'all', query = '', level = '', recordMode = 'names';
  let syncState = null, tapKey = null, tapAt = 0, toastTimer = null, renderQueued = false;

  try {
    const param = new URLSearchParams(location.search).get('ui');
    if (param === 'simple') localStorage.setItem(KEY, '1');
    if (param === 'classic') localStorage.removeItem(KEY);
    enabled = localStorage.getItem(KEY) === '1';
  } catch { enabled = false; }

  // Observe the existing device sync state without changing what it reports.
  const reminder = window.HathirSyncReminder;
  if (reminder) window.HathirSyncReminder = Object.freeze({ update(value) { reminder.update(value); syncState = value; queue(); } });

  const ready = () => enabled && typeof session !== 'undefined' && session && !$('appPage')?.hidden;
  const view = () => (typeof attendanceView === 'function' ? attendanceView() : null);
  const lectureKey = subject => (subject ? currentLectureKey(subject) : '');
  // Attendance is keyed by normalizeId (e.g. upper case), not the roster's raw id.
  const record = (subject, key, id) => (subject && key ? getAttendanceRecord(subject, key, normalizeId(id)) : null);
  const scanning = () => document.body.classList.contains('beginnerScannerVisible') || (typeof cameraStream !== 'undefined' && !!cameraStream);

  function pending() {
    if (syncState && session && syncState.uid === session.uid) return Number(syncState.count) || 0;
    return typeof offlineQueueCount === 'number' ? offlineQueueCount : 0;
  }
  function syncPill() {
    const count = pending(), online = navigator.onLine;
    if (syncState?.error) return `<button class="suPill suWarn" data-su="sync"><span class="suDot"></span>${tr('تحتاج مراجعة', 'Needs review')}</button>`;
    if (count && online) return `<button class="suPill suUp" data-su="sync"><span class="suDot"></span>${tr('جارٍ رفع', 'Uploading')} ${count}</button>`;
    if (count) return `<button class="suPill suWait" data-su="sync"><span class="suDot"></span>${count} ${tr('بانتظار الإنترنت', 'waiting for internet')}</button>`;
    if (!online) return `<button class="suPill suWait" data-su="sync"><span class="suDot"></span>${tr('دون اتصال', 'Offline')}</button>`;
    return `<button class="suPill suOk" data-su="sync"><span class="suDot"></span>${tr('محفوظ ومتزامن', 'Saved and synced')}</button>`;
  }

  function header(subject) {
    if (sub === 'names') return `<div class="suTitle"><button class="suBack" data-su="back" aria-label="${tr('رجوع', 'Back')}">→</button><span>${tr('التسجيل بالاسم', 'Mark by name')}</span></div>${syncPill()}`;
    const titles = { today: tr('حاضر', 'Hathir'), students: tr('الطلبة', 'Students'), records: tr('السجل', 'Record'), more: tr('المزيد', 'More') };
    return `<div class="suBrand"><span class="suMark" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13l5 5L20 6"/></svg></span>${titles[tab]}</div>${syncPill()}`;
  }

  function subjectCard(subject, caption) {
    if (!subject) return `<button class="suCard suSubject" data-su="${canCreateSubject() ? 'create' : 'setup'}"><span class="suGrow"><b>${tr('أضف مادة', 'Add a subject')}</b><small>${tr('ابدأ بإنشاء مادتك الأولى', 'Create your first subject')}</small></span></button>`;
    return `<button class="suCard suSubject" data-su="subjects"><span class="suGrow"><b>${esc(subjectTitle(subject))}</b><small>${esc(caption ?? subjectContext(subject))}</small></span><span class="suChev" aria-hidden="true">⌄</span></button>`;
  }

  function today() {
    const subject = view();
    if (!subject) return subjectCard(null);
    const key = lectureKey(subject), meta = subject.lectureMeta?.[key] || {};
    const active = meta.status === 'active' && !lectureIsComplete(subject, key);
    const students = subject.students || [], total = students.length;
    const present = students.filter(s => record(subject, key, s.id)).length;
    const pct = total ? Math.round(present / total * 100) : 0, C = 2 * Math.PI * 40;
    const time = meta.startTime ? displayAttendanceTime(meta.startTime) : '';
    const lastName = els.lastScanId?.textContent?.trim(), lastTime = els.lastScanTime?.textContent?.trim();
    const state = active ? `<span class="suLive"><span class="suDot"></span>${tr('جارية', 'In progress')}</span>`
      : present ? `<span class="suMuted">${tr('انتهت', 'Closed')}</span>` : `<span class="suMuted">${tr('لم تبدأ', 'Not started')}</span>`;
    const empty = !total && canAddStudents(subject) ? `<section class="suCard suEmptyCard"><b>${tr('لا يوجد طلبة في هذه المادة بعد', 'This subject has no students yet')}</b><p class="suHint suStart">${tr('أضف الأسماء بنفسك، أو امسح بطاقات QR فيُضاف أصحابها تلقائياً.', 'Add names yourself, or scan QR cards to enrol their holders.')}</p><button class="suPrimary" data-su="addStudents">＋ ${tr('أضف الطلبة', 'Add students')}</button></section>` : '';
    return `${subjectCard(subject)}${empty}
      <section class="suCard" aria-label="${tr('محاضرة اليوم', 'Today’s lecture')}">
        <div class="suLecture"><span>${tr('محاضرة اليوم', 'Today’s lecture')}${time ? ` · <span class="suNum">${esc(time)}</span>` : ''}</span>${state}</div>
        <div class="suRing">
          <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="40" fill="none" stroke="var(--su-ok-bg)" stroke-width="11"/><circle cx="48" cy="48" r="40" fill="none" stroke="var(--su-ok)" stroke-width="11" stroke-linecap="round" stroke-dasharray="${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 48 48)"/><text x="48" y="55" text-anchor="middle" font-weight="800" font-size="21" fill="var(--su-ink)">${pct}%</text></svg>
          <div class="suCount"><b data-su-count>${present} ${tr('من', 'of')} ${total}</b>${tr('حاضرون', 'present')}</div>
        </div>
        <div class="suMini"><div>${tr('غائبون', 'Absent')}<b>${total - present}</b></div><div>${tr('بانتظار الرفع', 'Waiting')}<b>${pending()}</b></div><div>${tr('آخر تسجيل', 'Last')}<b class="suNum">${lastName && lastName !== '—' ? esc(lastTime || '') : '—'}</b></div></div>
      </section>
      <button class="suPrimary" data-su="scan"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>${tr('امسح بطاقات الطلبة', 'Scan student cards')}</button>
      <button class="suSecondary" data-su="names">${tr('سجّل بالاسم', 'Mark by name')}</button>
      ${active ? `<button class="suLink suCenter" data-su="endLecture">${tr('إنهاء المحاضرة أو إلغاؤها', 'Close or cancel the lecture')}</button>` : present ? `<p class="suHint">${tr('أول تسجيل جديد يبدأ محاضرة جديدة.', 'The next mark starts a new lecture.')}</p>` : ''}
      ${lastName && lastName !== '—' ? `<div class="suCard suLast"><span class="suAvatar" aria-hidden="true">${esc(lastName[0])}</span><span class="suGrow"><small>${tr('آخر تسجيل', 'Last mark')}</small><b>${esc(lastName)}</b></span><small class="suNum">${esc(lastTime || '')}</small></div>` : ''}`;
  }

  function names() {
    const subject = view();
    if (!subject) return subjectCard(null);
    const key = lectureKey(subject), students = subject.students || [];
    const present = students.filter(s => record(subject, key, s.id)).length, q = query.trim().normalize('NFKC');
    const rows = students.filter(s => (!q || String(s.name).normalize('NFKC').includes(q)) && (filter === 'all' || (filter === 'absent') === !record(subject, key, s.id)));
    return `<div class="suChips" role="group" aria-label="${tr('تصفية', 'Filter')}">
        <button class="suChip" data-su-filter="all" aria-pressed="${filter === 'all'}">${tr('الكل', 'All')} ${students.length}</button>
        <button class="suChip" data-su-filter="absent" aria-pressed="${filter === 'absent'}">${tr('غائبون', 'Absent')} ${students.length - present}</button>
        <button class="suChip" data-su-filter="present" aria-pressed="${filter === 'present'}">${tr('حاضرون', 'Present')} ${present}</button>
      </div>
      <p class="suHint">${tr('اضغط مرتين على اسم الغائب لتسجيل حضوره · اضغط مرة على الحاضر لعرض التفاصيل', 'Double-tap an absent name to mark · tap a present name for details')}</p>
      <div class="suList">${rows.map(s => { const r = record(subject, key, s.id); return `<button class="suRow" data-su-student="${esc(s.id)}"><span class="suCheck${r ? ' on' : ''}" aria-hidden="true">${r ? '✓' : ''}</span><span class="suGrow suName">${esc(s.name)}</span><span class="suNum suTime">${r ? esc(displayAttendanceTime(r.time) || '') : ''}</span></button>`; }).join('') || `<p class="suEmpty">${tr('لا يوجد طالب بهذا الاسم.', 'No student with this name.')}</p>`}</div>`;
  }

  // The search field is created once per visit; background refreshes (live
  // sync, timers) only replace the body below it, so typing is never lost.
  function namesView() {
    return `<input class="suSearch" id="suSearch" type="search" placeholder="${tr('ابحث باسم الطالب', 'Search by name')}" value="${esc(query)}" autocomplete="off" aria-label="${tr('بحث', 'Search')}"><div id="suNamesBody" class="suNamesBody">${names()}</div>`;
  }

  const LEVELS = { ok: ['suOk', 'var(--su-ok)'], warn: ['suWarnTag', 'var(--su-warn)'], danger: ['suAlert', 'var(--su-alert)'], fail: ['suFail', 'var(--su-fail)'], off: ['suOff', 'var(--su-muted)'] };
  function students() {
    const subject = view();
    if (!subject) return subjectCard(null);
    const prepared = subject._sources ? null : cumulativeAttendanceStats(subject);
    const rows = (subject.students || []).map(s => ({ s, st: studentAttendanceStats(subject, s.id, prepared) }))
      .map(r => ({ ...r, cls: r.st.policy?.className || 'ok' }))
      .sort((a, b) => (b.st.absentMinutes || 0) - (a.st.absentMinutes || 0) || String(a.s.name).localeCompare(String(b.s.name), 'ar'));
    const counts = { ok: 0, warn: 0, danger: 0, fail: 0 }, other = rows.filter(r => counts[r.cls] === undefined);
    rows.forEach(r => { if (counts[r.cls] !== undefined) counts[r.cls]++; });
    // Pending review and unconfigured thresholds have no status yet; say so instead of counting them as clear.
    const otherNote = other.length ? `<p class="suHint">${other.length} ${tr('طالباً', 'students')}: ${esc(absencePolicyLabel(other[0].st.policy))}</p>` : '';
    const shown = rows.filter(r => !level || r.cls === level);
    const labels = { ok: tr('سليم', 'Clear'), warn: tr('تنبيه', 'Notice'), danger: tr('إنذار', 'Warning'), fail: tr('راسب', 'Failed') };
    return `${subjectCard(subject, `${(subject.students || []).length} ${tr('طالباً', 'students')} · ${subjectTotalHours(subject)} ${tr('ساعة', 'hours')}`)}
      ${canAddStudents(subject) ? `<button class="suSecondary" data-su="addStudents">＋ ${tr('إضافة طلبة', 'Add students')}</button>` : ''}
      <div class="suSummary" role="group" aria-label="${tr('مواقف الغياب', 'Absence status')}">${Object.keys(counts).map(k => `<button class="${LEVELS[k][0]}" data-su-level="${k}" aria-pressed="${level === k}"><b>${counts[k]}</b>${labels[k]}</button>`).join('')}</div>${otherNote}
      <div class="suList">${shown.map(({ s, st, cls }) => { const pct = Number(st.absencePercent) || 0; return `<button class="suStudent" data-su-card="${esc(s.id)}"><span class="suHead"><b>${esc(s.name)}</b><span class="suTag ${(LEVELS[cls] || LEVELS.ok)[0]}">${esc(absencePolicyLabel(st.policy))}</span></span><span class="suBar"><i style="width:${Math.min(100, pct * 5)}%;background:${(LEVELS[cls] || LEVELS.ok)[1]}"></i></span><small><span>${st.absentMinutes ? tr('غياب', 'Absent') + ' ' + esc(hoursLabel(st.absentMinutes)) : tr('لا غياب', 'No absence')}</span><span class="suNum">${esc(percentLabel(pct))}</span></small></button>`; }).join('') || `<p class="suEmpty">${tr('لا يوجد طلبة في هذا الموقف.', 'No students in this status.')}</p>`}</div>
      <div class="suTools"><button data-su="excel">⤓ Excel</button><button data-su="qr">▦ ${tr('بطاقات QR', 'QR cards')}</button></div>`;
  }

  // Names record: one row per student with a cell per lecture, oldest to newest,
  // replacing the wide classic grid on small screens. Read-only; corrections stay
  // in the full classic record.
  function lectureCell(subject, key, id) {
    const meta = subject.lectureMeta?.[key] || {};
    if (['cancelled', 'voided'].includes(meta.status)) return 'x';
    if (record(subject, key, id)) return 'p';
    // Same rule as cumulativeAttendanceStats: a lecture without activity, or one
    // neither running nor complete, is not counted, so it is not an absence.
    if (meta.restorationInProgress || !lectureHasActivity(subject, key) || (meta.status !== 'active' && !lectureIsComplete(subject, key))) return 'n';
    if (typeof hasExcusedAbsence === 'function' && hasExcusedAbsence(subject, key, normalizeId(id))) return 'e';
    return meta.status === 'active' && !lectureIsComplete(subject, key) ? 'w' : 'a';
  }
  const CELL = { p: ['suCellP', 'حاضر', 'Present'], a: ['suCellA', 'غائب', 'Absent'], e: ['suCellE', 'غائب بعذر', 'Excused'], x: ['suCellX', 'ملغاة', 'Cancelled'], n: ['suCellN', 'لا تُحتسب', 'Not counted'], w: ['suCellW', 'لم يُسجَّل بعد', 'Not marked yet'] };
  const lectureKeys = subject => sortedLectureKeys(subject).filter(k => !lectureColumnRemovedAfterUnmark(subject, k));
  function records() {
    const subject = view();
    if (!subject) return subjectCard(null);
    const students = subject.students || [], keys = lectureKeys(subject);
    const toggle = `<div class="suChips" role="group" aria-label="${tr('طريقة العرض', 'View')}">
        <button class="suChip" data-su-record="names" aria-pressed="${recordMode === 'names'}">${tr('حسب الطالب', 'By student')}</button>
        <button class="suChip" data-su-record="lectures" aria-pressed="${recordMode === 'lectures'}">${tr('حسب المحاضرة', 'By lecture')}</button></div>`;
    let body;
    if (recordMode === 'names') {
      const used = new Set(students.flatMap(s => keys.map(k => lectureCell(subject, k, s.id))));
      const legend = ['p', 'a', 'e', 'x', 'n', 'w'].filter(c => used.has(c)).map(c => `<span><i class="suCell ${CELL[c][0]}"></i>${tr(CELL[c][1], CELL[c][2])}</span>`).join('');
      body = `<p class="suLegend">${legend}</p>
        <div class="suList">${students.map((s, n) => {
          const cells = keys.map(k => lectureCell(subject, k, s.id)), held = cells.filter(c => 'pae'.includes(c)).length, came = cells.filter(c => c === 'p').length;
          return `<button class="suNameRec" data-su-history="${esc(s.id)}"><span class="suHead"><b><span class="suIdx">${n + 1}</span>${esc(s.name)}</b><span class="suNum suMutedSmall">${came}/${held}</span></span><span class="suCells" aria-label="${tr('حضر', 'Present')} ${came} ${tr('من', 'of')} ${held}">${cells.map(c => `<i class="suCell ${CELL[c][0]}"></i>`).join('')}</span></button>`;
        }).join('') || `<p class="suEmpty">${tr('لا يوجد طلبة بعد.', 'No students yet.')}</p>`}</div>`;
    } else {
      const total = students.length;
      body = `<div class="suList">${[...keys].reverse().map((k, i) => { const meta = subject.lectureMeta?.[k] || {}, count = Object.keys(subject.attendance?.[k] || {}).length, cancelled = ['cancelled', 'voided'].includes(meta.status); return `<button class="suLec" data-su-lecture="${esc(k)}"><span class="suLecNo">${keys.length - i}</span><span class="suGrow"><b>${esc(lectureDate(k))}${meta.startTime ? ' · <span class="suNum">' + esc(displayAttendanceTime(meta.startTime)) + '</span>' : ''}</b><small>${cancelled ? tr('ملغاة', 'Cancelled') : count + ' ' + tr('من', 'of') + ' ' + total + ' ' + tr('حاضرون', 'present')}</small></span><span class="suChevSmall" aria-hidden="true">‹</span></button>`; }).join('') || `<p class="suEmpty">${tr('لا توجد محاضرات بعد.', 'No lectures yet.')}</p>`}</div>`;
    }
    return `${subjectCard(subject, `${students.length} ${tr('طالباً', 'students')} · ${keys.length} ${tr('محاضرة', 'lectures')}`)}${toggle}${body}
      <button class="suLink suCenter" data-su="fullRecord">${tr('الجدول الكامل للتعديل والتصحيح', 'Full table for edits and corrections')}</button>`;
  }
  function historySheet(id) {
    const subject = view(); if (!subject) return;
    const student = subject.students?.find(s => normalizeId(s.id) === normalizeId(id)); if (!student) return;
    const keys = lectureKeys(subject).reverse(), st = studentAttendanceStats(subject, student.id);
    sheet(`<h2>${esc(student.name)}</h2><p class="suHint suStart"><span class="suTag ${(LEVELS[st.policy?.className] || LEVELS.ok)[0]}">${esc(absencePolicyLabel(st.policy))}</span> ${st.absentMinutes ? tr('غياب', 'Absent') + ' ' + esc(hoursLabel(st.absentMinutes)) + ' · <span class="suNum">' + esc(percentLabel(st.absencePercent)) + '</span>' : tr('لا غياب', 'No absence')}</p>
      <div class="suList">${keys.map(k => { const c = lectureCell(subject, k, student.id), r = record(subject, k, student.id); return `<div class="suLec"><i class="suCell ${CELL[c][0]}"></i><span class="suGrow"><b>${esc(lectureDate(k))}</b><small>${tr(CELL[c][1], CELL[c][2])}${r?.time ? ' · <span class="suNum">' + esc(displayAttendanceTime(r.time)) + '</span>' : ''}</small></span></div>`; }).join('') || `<p class="suEmpty">${tr('لا توجد محاضرات بعد.', 'No lectures yet.')}</p>`}</div>
      <div class="suBtns"><button data-x="close">${tr('إغلاق', 'Close')}</button></div>`, layer => { layer.querySelector('[data-x="close"]').onclick = closeSheet; });
  }

  function more() {
    return `<div class="suList">
        ${canEditSubject(view()) ? `<button class="suRow" data-su="subjectSettings"><span class="suGrow"><b>${tr('إعدادات المادة', 'Subject settings')}</b><small>${tr('الاسم والساعات وحدود الغياب', 'Name, hours and absence limits')}</small></span><span aria-hidden="true">‹</span></button>` : ''}
        <button class="suRow" data-su="settings"><span class="suGrow"><b>${tr('الإعدادات', 'Settings')}</b></span><span aria-hidden="true">‹</span></button>
        <a class="suRow" href="help.html"><span class="suGrow"><b>${tr('مركز المساعدة', 'Help center')}</b></span><span aria-hidden="true">‹</span></a>
        <button class="suRow" data-su="classic"><span class="suGrow"><b>${tr('الواجهة الكلاسيكية', 'Classic interface')}</b><small>${tr('العودة إلى الواجهة السابقة؛ لا تتأثر البيانات', 'Switch back; data is unaffected')}</small></span><span aria-hidden="true">‹</span></button>
        <button class="suRow" data-su="logout"><span class="suGrow"><b>${tr('تسجيل الخروج', 'Sign out')}</b></span><span aria-hidden="true">‹</span></button>
      </div><p class="suHint">${tr('واجهة تجريبية تستخدم بيانات حاضر نفسها.', 'Preview interface using the same Hathir data.')}</p>`;
  }

  function nav() {
    const tabs = [['today', '◉', tr('اليوم', 'Today')], ['students', '☰', tr('الطلبة', 'Students')], ['records', '▦', tr('السجل', 'Record')], ['more', '⋯', tr('المزيد', 'More')]];
    return tabs.map(([id, icon, label]) => `<button data-su-tab="${id}"${tab === id ? ' aria-current="page"' : ''}><i aria-hidden="true">${icon}</i>${label}</button>`).join('');
  }

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'simpleUi'; root.className = 'suRoot';
    root.innerHTML = '<header class="suTop" id="suTop"></header><main class="suScroll" id="suView"></main><nav class="suNav" id="suNav"></nav><div id="suLayer"></div>';
    document.body.append(root);
    root.addEventListener('click', onClick);
    return root;
  }

  function render() {
    renderQueued = false;
    const on = ready();
    document.body.classList.toggle('simpleUi', !!on);
    document.body.classList.toggle('simpleUiScanning', !!on && scanning());
    if (!on) { if (root) root.hidden = true; return; }
    ensureRoot().hidden = false;
    root.dir = typeof lang !== 'undefined' && lang === 'en' ? 'ltr' : 'rtl';
    $('suTop').innerHTML = header();
    $('suNav').innerHTML = nav(); $('suNav').hidden = sub === 'names';
    if (sub === 'names' && $('suSearch') && $('suNamesBody')) { $('suNamesBody').innerHTML = names(); return; }
    $('suView').innerHTML = sub === 'names' ? namesView() : tab === 'students' ? students() : tab === 'records' ? records() : tab === 'more' ? more() : today();
    const search = $('suSearch');
    if (search) search.oninput = () => { query = search.value; $('suNamesBody').innerHTML = names(); };
  }
  function queue() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(render); } }

  function toast(message, action, fn) {
    clearTimeout(toastTimer);
    root.querySelector('.suToast')?.remove();
    const el = document.createElement('div'); el.className = 'suToast'; el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
    if (action) el.querySelector('button').addEventListener('click', () => { el.remove(); fn(); });
    root.append(el);
    toastTimer = setTimeout(() => el.remove(), action ? 5000 : 2600);
  }
  function sheet(html, bind) {
    clearToast();
    const layer = $('suLayer');
    layer.innerHTML = `<div class="suScrim"><div class="suSheet" role="dialog" aria-modal="true"><div class="suGrab"></div>${html}</div></div>`;
    layer.firstChild.addEventListener('click', e => { if (e.target === layer.firstChild) closeSheet(); });
    bind?.(layer); (layer.querySelector('[data-autofocus]') || layer.querySelector('button'))?.focus();
  }
  function clearToast() { clearTimeout(toastTimer); root?.querySelector('.suToast')?.remove(); }
  function closeSheet() { const layer = $('suLayer'); if (layer) layer.innerHTML = ''; }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && root && !root.hidden) closeSheet(); });

  // unmarkAttendance asks window.confirm before its first await. The simple UI
  // has already obtained an explicit choice (Undo, or its own confirm sheet).
  async function removeMark(id, subject, key) {
    if (!hasAttendanceEditPermission()) { notify(text('noPermission'), 'error'); return false; }
    const owner = studentSubject(id) || subject, original = window.confirm;
    let task;
    window.confirm = () => true;
    try { task = unmarkAttendance(id, key, attendanceCorrectionScope(owner)); } finally { window.confirm = original; }
    const done = await task; queue(); return done;
  }

  async function mark(id) {
    if (!attendanceInputReady()) { notify(tr('جارٍ تجهيز سجل المادة. انتظر ثم أعد المحاولة؛ لم يُسجّل حضور.', 'The subject record is not ready. Wait and retry; no attendance was recorded.'), 'warn'); return; }
    const subject = view(), student = subject?.students?.find(s => normalizeId(s.id) === normalizeId(id));
    const ok = await markAttendance(id, 'manual');
    queue();
    const after = view(), key = lectureKey(after);
    if (ok !== false && record(after, key, id) && student) {
      toast(tr('سُجّل حضور ', 'Marked ') + student.name, tr('تراجع', 'Undo'), () => removeMark(id, after, key));
    }
  }

  function studentTap(id, row) {
    const subject = view(), key = lectureKey(subject), r = record(subject, key, id);
    const student = subject?.students?.find(s => normalizeId(s.id) === normalizeId(id));
    if (!student) return;
    if (r) {
      sheet(`<h2>${esc(student.name)}</h2><dl class="suKv"><dt>${tr('الوقت', 'Time')}</dt><dd class="suNum">${esc(displayAttendanceTime(r.time) || '—')}</dd><dt>${tr('الطريقة', 'Method')}</dt><dd>${r.method === 'scan' ? tr('مسح بطاقة', 'Card scan') : tr('بالاسم', 'By name')}</dd></dl>
        <div class="suBtns"><button data-x="close">${tr('إغلاق', 'Close')}</button><button class="suDanger" data-x="remove">${tr('إزالة التسجيل', 'Remove mark')}</button></div>`, layer => {
        layer.querySelector('[data-x="close"]').onclick = closeSheet;
        layer.querySelector('[data-x="remove"]').onclick = () => {
          const row2 = layer.querySelector('.suBtns');
          row2.innerHTML = `<button data-x="no">${tr('تراجع', 'Keep')}</button><button class="suDanger" data-x="yes">${tr('نعم، أزل الحضور', 'Yes, remove')}</button>`;
          row2.querySelector('[data-x="no"]').onclick = closeSheet;
          row2.querySelector('[data-x="yes"]').onclick = async () => { closeSheet(); await removeMark(id, subject, key); };
          row2.querySelector('[data-x="yes"]').focus();
        };
      });
      return;
    }
    const now = Date.now(), k = JSON.stringify([session?.uid, subject?.id, id]);
    if (tapKey === k && now - tapAt < 500) { tapKey = null; row.classList.remove('armed'); mark(id); return; }
    tapKey = k; tapAt = now;
    root.querySelectorAll('.suRow.armed').forEach(el => el.classList.remove('armed'));
    row.classList.add('armed'); setTimeout(() => row.classList.remove('armed'), 600);
  }

  // All of the teacher's subjects, grouped by department · stage · period. Picking
  // one uses #quickTeachingSubject, the same path as the classic subject menu,
  // which sets the department/stage scope and refreshes.
  function subjectSheet() {
    const list = typeof attendanceAvailableSubjects === 'function' ? attendanceAvailableSubjects() : [];
    const current = view(), canCreate = canCreateSubject();
    if (!list.length) { canCreate ? createSheet() : $('teachingSetupBtn')?.click(); return; }
    const groups = new Map();
    for (const subject of list) {
      const label = [subjectContext(subject), studyPeriodLabel(subject)].filter(Boolean).join(' · ');
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(subject);
    }
    sheet(`<h2>${tr('اختر المادة', 'Choose a subject')}</h2>
      ${[...groups].map(([label, items]) => `<h3 class="suSub">${esc(label)}</h3><div class="suOpts">${items.map(subject => `<button class="suOpt" data-subject="${esc(subject.id)}" aria-pressed="${subject.id === current?.id}"><b>${esc(subjectTitle(subject))}</b><small>${(subject.students || []).length || subject.studentCount || 0} ${tr('طالباً', 'students')}</small></button>`).join('')}</div>`).join('')}
      <div class="suOpts suOptsEnd">
        ${canCreate ? `<button class="suOpt suOptAdd" data-x="create"><b>＋ ${tr('مادة جديدة', 'New subject')}</b><small>${tr('في أي قسم ومرحلة', 'In any department and stage')}</small></button>` : ''}
        ${canEditSubject(current) ? `<button class="suLink" data-x="settings">${tr('إعدادات المادة الحالية', 'Current subject settings')}</button>` : ''}
      </div>`, layer => {
      layer.querySelectorAll('[data-subject]').forEach(button => button.onclick = () => { closeSheet(); chooseSubject(button.dataset.subject); });
      layer.querySelector('[data-x="create"]')?.addEventListener('click', () => { closeSheet(); createSheet(); });
      layer.querySelector('[data-x="settings"]')?.addEventListener('click', () => { closeSheet(); settingsSheet(); });
    });
  }
  function chooseSubject(id) {
    const select = $('quickTeachingSubject');
    if (!select) return;
    if (![...select.options].some(o => o.value === id)) select.insertAdjacentHTML('beforeend', `<option value="${esc(id)}"></option>`);
    select.value = id; select.dispatchEvent(new Event('change', { bubbles: true }));
    sub = ''; queue();
  }
  function syncSheet() {
    const count = pending();
    sheet(`<h2>${tr('حالة الحفظ والرفع', 'Save and upload status')}</h2><dl class="suKv"><dt>${tr('الاتصال', 'Connection')}</dt><dd>${navigator.onLine ? tr('متصل', 'Online') : tr('دون اتصال', 'Offline')}</dd><dt>${tr('بانتظار الرفع', 'Waiting')}</dt><dd>${count}</dd></dl>
      <p class="suHint">${navigator.onLine ? (count ? tr('يُرفع ما تبقى تلقائياً. أبقِ حاضر مفتوحاً.', 'The rest uploads automatically. Keep Hathir open.') : tr('كل شيء مرفوع.', 'Everything is uploaded.')) : tr('استمر بالتسجيل؛ يُرفع تلقائياً عند عودة الإنترنت. لا تمسح بيانات المتصفح.', 'Keep marking; it uploads when the internet returns. Do not clear browser data.')}</p>
      <div class="suBtns"><button data-x="close">${tr('إغلاق', 'Close')}</button><button data-x="details">${tr('التفاصيل', 'Details')}</button></div>`, layer => {
      layer.querySelector('[data-x="close"]').onclick = closeSheet;
      layer.querySelector('[data-x="details"]').onclick = () => { closeSheet(); window.HathirDeviceWorkspace?.active?.() ? window.HathirDeviceWorkspace.details() : $('workspaceSyncReminder')?.click(); };
    });
  }

  // The sheet is the confirmation, so the existing status change runs with
  // confirmed:true and the same in-flight guard as the classic buttons.
  async function lectureStatus(status) {
    if (manualLectureStatusInFlight) return;
    manualLectureStatusInFlight = true;
    try { await setTodayLectureStatus(status, { confirmed: true }); }
    catch (error) { notify(error.message || String(error), 'error'); }
    finally { manualLectureStatusInFlight = false; clearToast(); renderLectureBanner(); queue(); }
  }
  function endSheet() {
    const subject = view(), key = lectureKey(subject), students = subject?.students || [];
    const present = students.filter(s => record(subject, key, s.id)).length;
    const canCancel = hasAttendanceEditPermission();
    sheet(`<h2>${tr('إنهاء محاضرة اليوم؟', 'Close today’s lecture?')}</h2>
      <p class="suHint suStart">${tr('حضر', 'Present:')} ${present} ${tr('من', 'of')} ${students.length}. ${tr('بعد الإنهاء يُحتسب الغياب للباقين، وأول تسجيل جديد يبدأ محاضرة جديدة.', 'Closing counts the rest as absent; the next mark starts a new lecture.')}</p>
      <div class="suOpts">
        <button class="suOpt" data-x="complete"><b>${tr('إنهاء المحاضرة', 'Close lecture')}</b><small>${tr('تُحفظ الساعات والتسجيلات كما هي', 'Hours and marks are kept')}</small></button>
        ${canCancel ? `<button class="suOpt suOptDanger" data-x="cancel"><b>${tr('إلغاء المحاضرة', 'Cancel lecture')}</b><small>${tr('لا تُحسب في الغياب؛ تبقى التسجيلات محفوظة للمراجعة', 'Excluded from absence; marks stay for review')}</small></button>` : ''}
      </div>
      <div class="suBtns"><button data-x="close">${tr('متابعة التسجيل', 'Keep marking')}</button></div>`, layer => {
      layer.querySelector('[data-x="close"]').onclick = closeSheet;
      layer.querySelector('[data-x="complete"]').onclick = () => { closeSheet(); lectureStatus('completed'); };
      layer.querySelector('[data-x="cancel"]')?.addEventListener('click', () => {
        const row = layer.querySelector('.suBtns');
        row.innerHTML = `<button data-x="no">${tr('تراجع', 'Keep')}</button><button class="suDanger" data-x="yes">${tr('نعم، ألغِ المحاضرة', 'Yes, cancel it')}</button>`;
        row.querySelector('[data-x="no"]').onclick = closeSheet;
        row.querySelector('[data-x="yes"]').onclick = () => { closeSheet(); lectureStatus('cancelled'); };
        row.querySelector('[data-x="yes"]').focus();
      });
    });
  }
  function lectureSheet(key) {
    const subject = view(); if (!subject) return;
    const meta = subject.lectureMeta?.[key] || {}, students = subject.students || [];
    const cancelled = ['cancelled', 'voided'].includes(meta.status);
    const present = students.filter(s => record(subject, key, s.id));
    const absent = students.filter(s => !record(subject, key, s.id));
    const status = cancelled ? tr('ملغاة · لا تُحسب في الغياب', 'Cancelled · excluded from absence') : meta.status === 'active' && !lectureIsComplete(subject, key) ? tr('جارية', 'In progress') : tr('مكتملة', 'Closed');
    sheet(`<h2>${esc(lectureDate(key))}${meta.startTime ? ' · <span class="suNum">' + esc(displayAttendanceTime(meta.startTime)) + '</span>' : ''}</h2>
      <dl class="suKv"><dt>${tr('الحالة', 'Status')}</dt><dd>${status}</dd><dt>${tr('الحضور', 'Present')}</dt><dd>${present.length} ${tr('من', 'of')} ${students.length}</dd></dl>
      <h3 class="suSub">${tr('الغائبون', 'Absent')} (${absent.length})</h3>
      <div class="suList">${absent.map(s => `<div class="suLec"><span class="suGrow"><b>${esc(s.name)}</b></span></div>`).join('') || `<p class="suEmpty">${tr('لا غياب في هذه المحاضرة.', 'Nobody was absent.')}</p>`}</div>
      <div class="suBtns"><button data-x="close">${tr('إغلاق', 'Close')}</button></div>`, layer => { layer.querySelector('[data-x="close"]').onclick = closeSheet; });
  }

  const canAddStudents = subject => !!subject && !subject._sources && typeof canManageStudents === 'function' && canManageStudents(subject);
  // Adding uses the existing importParsedStudents / importStudentsFromFile, so
  // validation, numbering and the 700-name limit stay with the current code.
  // A pasted list often keeps its numbering ("1. name", "2) name"); the shared
  // parser only drops a serial in its own column, so strip it here.
  const SERIAL = /^\s*[0-9\u0660-\u0669\u06F0-\u06F9]+\s*[.)\-\u2013:]\s*/;
  function addSheet() {
    const subject = view();
    if (!canAddStudents(subject)) { notify(text('noPermission'), 'error'); return; }
    sheet(`<h2>${tr('إضافة طلبة', 'Add students')}</h2>
      <p class="suHint suStart">${tr('إلى', 'To')} ${esc(subjectTitle(subject))}. ${tr('يأخذ كل طالب رقماً داخلياً تلقائياً.', 'Each student gets an internal number automatically.')}</p>
      <div class="suField"><label for="suOneName">${tr('اسم طالب واحد', 'One student')}</label>
        <div class="suInline"><input id="suOneName" data-autofocus class="suSearch" autocomplete="off" maxlength="150" placeholder="${tr('الاسم الثلاثي أو الرباعي', 'Full name')}"><button class="suGo" data-x="one">${tr('إضافة', 'Add')}</button></div></div>
      <div class="suField"><label for="suManyNames">${tr('أو عدة أسماء: اسم في كل سطر، ويُحذف الترقيم من بدايته', 'Or several names, one per line; leading numbers are removed')}</label>
        <textarea id="suManyNames" class="suSearch" rows="5"></textarea><button class="suGo" data-x="many" disabled>${tr('إضافة الأسماء', 'Add names')}</button></div>
      <div class="suField"><span>${tr('أو من ملف Excel أو CSV فيه عمود الأسماء', 'Or from an Excel or CSV file with a names column')}</span>
        <button class="suSecondary" data-x="file">${tr('اختر ملفاً', 'Choose a file')}</button><input id="suNamesFile" type="file" accept=".xlsx,.xls,.csv,.txt" hidden></div>
      <p class="suStatus" id="suAddStatus" role="status"></p>
      <div class="suBtns"><button data-x="close">${tr('إغلاق', 'Close')}</button></div>`, layer => {
      const one = layer.querySelector('#suOneName'), many = layer.querySelector('#suManyNames'), status = layer.querySelector('#suAddStatus');
      const goOne = layer.querySelector('[data-x="one"]'), goMany = layer.querySelector('[data-x="many"]');
      const say = (message, error = false) => { status.textContent = message; status.dataset.state = error ? 'error' : 'ok'; };
      const parse = () => { const lines = many.value.split(/\r?\n/).filter(l => l.trim()); const parsed = lines.map(l => parseStudentLine(l.replace(SERIAL, ''))).filter(Boolean); return { parsed, skipped: lines.length - parsed.length }; };
      async function run(button, task) {
        const buttons = layer.querySelectorAll('button'); buttons.forEach(b => { b.disabled = true; });
        try { return await task(); }
        catch (error) { say(error.message || String(error), true); return null; }
        finally { buttons.forEach(b => { b.disabled = false; }); goMany.disabled = !parse().parsed.length; }
      }
      async function addOne() {
        const name = one.value.trim().replace(/\s+/g, ' ');
        if (name.length < 3) { say(tr('اكتب اسماً من ثلاثة أحرف على الأقل.', 'Enter a name of at least three letters.'), true); one.focus(); return; }
        const added = await run(goOne, () => importParsedStudents([{ name }], 0));
        if (Array.isArray(added) && added.length) { say(tr('أُضيف: ', 'Added: ') + name); one.value = ''; one.focus(); queue(); }
      }
      layer.querySelector('[data-x="close"]').onclick = closeSheet;
      goOne.onclick = addOne;
      one.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOne(); } });
      many.addEventListener('input', () => { const n = parse().parsed.length; goMany.disabled = !n; goMany.textContent = n ? tr('إضافة ', 'Add ') + n + tr(' اسماً', ' names') : tr('إضافة الأسماء', 'Add names'); });
      goMany.onclick = async () => {
        const { parsed, skipped } = parse();
        if (!parsed.length) return;
        const added = await run(goMany, () => importParsedStudents(parsed, skipped));
        if (Array.isArray(added) && added.length) { closeSheet(); queue(); }
      };
      const file = layer.querySelector('#suNamesFile');
      layer.querySelector('[data-x="file"]').onclick = () => file.click();
      file.addEventListener('change', () => { if (!file.files?.length) return; closeSheet(); Promise.resolve(importStudentsFromFile({ target: file })).finally(queue); });
    });
  }

  // Rename and delete drive the existing profile functions with the profile
  // window kept hidden, so its own permission, offline and sync rules decide:
  // the save button's disabled state and #profileEditReason are read as-is.
  function profileGate(id) {
    openStudentProfile(id);
    els.studentProfileModal.hidden = true;
    return { allowed: !els.saveStudentProfileBtn.disabled, deletable: !els.deleteStudentBtn?.disabled, reason: $('profileEditReason')?.textContent?.trim() || '' };
  }
  async function renameStudent(id, name) {
    const gate = profileGate(id);
    try {
      if (!gate.allowed) throw Error(gate.reason || text('noPermission'));
      els.profileStudentNameInput.value = name;
      await saveStudentProfile();
    } finally { closeStudentProfile(); queue(); }
    const after = view()?.students?.find(s => normalizeId(s.id) === normalizeId(id));
    return after?.name === name;
  }
  async function deleteStudent(id) {
    const gate = profileGate(id);
    if (!gate.deletable) { closeStudentProfile(); throw Error(gate.reason || text('noPermission')); }
    // deleteStudentFromRoster asks window.confirm before its first await; the
    // sheet has already asked.
    const original = window.confirm; let task;
    window.confirm = () => true;
    try { task = deleteStudentFromRoster(); } finally { window.confirm = original; }
    try { await task; } finally { if (activeProfileStudentId) closeStudentProfile(); queue(); }
    return !view()?.students?.some(s => normalizeId(s.id) === normalizeId(id));
  }
  function studentSheet(id) {
    const subject = view(), student = subject?.students?.find(s => normalizeId(s.id) === normalizeId(id));
    if (!student) return;
    const st = studentAttendanceStats(subject, student.id);
    // Ask the classic profile in every case: it also explains a temporary block
    // (offline, sync pending) when canManageStudents is false for that reason.
    const gate = subject._sources ? { allowed: false, deletable: false, reason: '' } : profileGate(student.id);
    if (!subject._sources) closeStudentProfile();
    const manage = gate.allowed || !!gate.reason;
    const history = typeof studentHasHistory === 'function' && studentHasHistory(studentSubject(student.id) || subject, student.id);
    sheet(`<h2>${esc(student.name)}</h2>
      <p class="suHint suStart"><span class="suTag ${(LEVELS[st.policy?.className] || LEVELS.ok)[0]}">${esc(absencePolicyLabel(st.policy))}</span> ${st.absentMinutes ? tr('غياب', 'Absent') + ' ' + esc(hoursLabel(st.absentMinutes)) : tr('لا غياب', 'No absence')}</p>
      ${manage ? `<div class="suField"><label for="suEditName">${tr('الاسم', 'Name')}</label>
        <div class="suInline"><input id="suEditName" class="suSearch" maxlength="150" autocomplete="off" value="${esc(student.name)}"${gate.allowed ? '' : ' disabled'}><button class="suGo" data-x="rename"${gate.allowed ? '' : ' disabled'}>${tr('حفظ', 'Save')}</button></div></div>
        ${gate.allowed ? '' : `<p class="suStatus" data-state="error">${esc(gate.reason || tr('لا يمكن التعديل الآن.', 'Editing is not available now.'))}</p>`}` : ''}
      <p class="suStatus" id="suEditStatus" role="status"></p>
      <div class="suOpts">
        <button class="suOpt" data-x="profile"><b>${tr('الوجه وبطاقة QR', 'Face and QR card')}</b><small>${tr('يفتح ملف الطالب الكامل', 'Opens the full student profile')}</small></button>
        ${manage && gate.deletable ? `<button class="suOpt suOptDanger" data-x="delete"><b>${tr('حذف الطالب', 'Delete student')}</b><small>${history ? tr('له سجل حضور: يُنقل إلى المؤرشفين وتبقى سجلاته', 'Has attendance: moved to archived, records kept') : tr('لا سجل حضور له: يُحذف من القائمة', 'No attendance: removed from the list')}</small></button>` : ''}
      </div>
      <div class="suBtns"><button data-x="close">${tr('إغلاق', 'Close')}</button></div>`, layer => {
      const status = layer.querySelector('#suEditStatus');
      const say = (message, error = false) => { status.textContent = message; status.dataset.state = error ? 'error' : 'ok'; };
      const lock = on => layer.querySelectorAll('button,input').forEach(el => { if (on) { el.dataset.wasDisabled = el.disabled ? '1' : ''; el.disabled = true; } else el.disabled = el.dataset.wasDisabled === '1'; });
      layer.querySelector('[data-x="close"]').onclick = closeSheet;
      layer.querySelector('[data-x="profile"]').onclick = () => { closeSheet(); openStudentProfile(student.id); };
      const input = layer.querySelector('#suEditName'), save = layer.querySelector('[data-x="rename"]');
      async function doRename() {
        const name = input.value.trim().replace(/\s+/g, ' ');
        if (name === student.name) { say(tr('لم يتغير الاسم.', 'The name did not change.')); return; }
        if (name.length < 3) { say(tr('اكتب اسماً من ثلاثة أحرف على الأقل.', 'Enter a name of at least three letters.'), true); return; }
        lock(true);
        try { if (await renameStudent(student.id, name)) { student.name = name; layer.querySelector('h2').textContent = name; say(tr('حُفظ الاسم.', 'Name saved.')); } }
        catch (error) { say(error.message || String(error), true); }
        finally { lock(false); }
      }
      if (save) { save.onclick = doRename; input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doRename(); } }); }
      layer.querySelector('[data-x="delete"]')?.addEventListener('click', () => {
        const row = layer.querySelector('.suBtns');
        row.innerHTML = `<button data-x="no">${tr('تراجع', 'Keep')}</button><button class="suDanger" data-x="yes">${tr('نعم، احذف الطالب', 'Yes, delete')}</button>`;
        row.querySelector('[data-x="no"]').onclick = closeSheet;
        row.querySelector('[data-x="yes"]').onclick = async () => {
          lock(true);
          try { if (await deleteStudent(student.id)) closeSheet(); else { lock(false); say(tr('لم يُحذف الطالب.', 'The student was not deleted.'), true); } }
          catch (error) { lock(false); say(error.message || String(error), true); }
        };
        row.querySelector('[data-x="yes"]').focus();
      });
    });
  }

  const canEditSubject = subject => !!subject && !subject._sources && typeof canManageSubject === 'function' && canManageSubject(subject) && !!window.HathirSubjectTools;
  const THRESHOLDS = ['notice', 'warning', 'fail'];
  // The classic subject editor owns validation and saving (local workspace, or
  // correctSubjectAnnualHours plus the title update). It is opened hidden to
  // read the current values, and again hidden to submit the new ones.
  function openEditorHidden(subject, mode = 'edit') {
    HathirSubjectTools.openEditor(mode, subject?.id);
    const editor = $('subjectEditor');
    if (!editor?.open) return null;
    editor.style.visibility = 'hidden';
    return editor;
  }
  function closeEditorHidden(editor) { if (editor?.open) editor.close(); if (editor) editor.style.visibility = ''; }
  function readSubjectSettings(subject) {
    const editor = openEditorHidden(subject);
    if (!editor) return null;
    try {
      return { name: $('subjectName').value, hours: $('subjectHours').value, duration: $('subjectDuration').value, system: $('subjectSystem').value,
        systems: [...$('subjectSystem').options].map(o => ({ value: o.value, label: o.textContent })),
        limits: Object.fromEntries(THRESHOLDS.map(k => [k, $('subject_' + k).value])) };
    } finally { closeEditorHidden(editor); }
  }
  async function saveSubjectSettings(subject, values, mode = 'edit') {
    const editor = openEditorHidden(subject, mode);
    if (!editor) throw Error(text('noPermission'));
    try {
      if (mode === 'create') {
        $('subjectDept').value = values.dept; $('subjectDept').dispatchEvent(new Event('change'));
        $('subjectStage').value = values.stage; $('subjectPeriod').value = values.period;
      }
      $('subjectName').value = values.name; $('subjectHours').value = values.hours; $('subjectDuration').value = values.duration; $('subjectSystem').value = values.system;
      THRESHOLDS.forEach(k => { $('subject_' + k).value = values.limits[k]; });
      $('subjectEditorError').textContent = '';
      $('subjectEditorForm').requestSubmit();
      const deadline = Date.now() + 60000;
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!editor.open) return true;
        const saving = $('subjectEditorSave')?.disabled, message = $('subjectEditorError')?.textContent?.trim();
        if (!saving && message) throw Error(message);
        if (!saving && !message && editor.open && $('subjectName')?.validity && !$('subjectEditorForm').checkValidity()) throw Error(tr('تحقق من الحقول.', 'Check the fields.'));
        if (Date.now() > deadline) throw Error(tr('انتهت مهلة الحفظ. أعد المحاولة.', 'Saving timed out. Try again.'));
      }
    } finally { closeEditorHidden(editor); }
  }
  const canCreateSubject = () => !!window.HathirSubjectTools && typeof hasPermission === 'function' && hasPermission('classesCreate');
  // Departments, their stages, periods and defaults come from the classic
  // editor in create mode, opened hidden; so do validation and saving.
  function readCreateOptions() {
    const editor = openEditorHidden(null, 'create');
    if (!editor) return null;
    try {
      const dept = $('subjectDept'), stagesByDept = {};
      const initial = { dept: dept.value, stage: $('subjectStage').value };
      for (const option of dept.options) {
        dept.value = option.value; dept.dispatchEvent(new Event('change'));
        stagesByDept[option.value] = [...$('subjectStage').options].map(o => ({ value: o.value, label: o.textContent }));
      }
      return { ...initial, period: $('subjectPeriod').value, hours: $('subjectHours').value, duration: $('subjectDuration').value, system: $('subjectSystem').value,
        departments: [...dept.options].map(o => ({ value: o.value, label: o.textContent })), stagesByDept,
        periods: [...$('subjectPeriod').options].map(o => ({ value: o.value, label: o.textContent })),
        systems: [...$('subjectSystem').options].map(o => ({ value: o.value, label: o.textContent })),
        limits: Object.fromEntries(THRESHOLDS.map(k => [k, $('subject_' + k).value])) };
    } finally { closeEditorHidden(editor); }
  }
  const selectField = (id, label, options, value) => `<label class="suField" for="${id}">${label}<select id="${id}" class="suSearch">${options.map(o => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
  const numberField = (id, label, value, attrs) => `<label class="suField" for="${id}">${label}<input id="${id}" class="suSearch" type="number" inputmode="decimal" value="${esc(value)}" ${attrs}></label>`;
  function createSheet() {
    if (!canCreateSubject()) { notify(text('noPermission'), 'error'); return; }
    const o = readCreateOptions();
    if (!o) return;
    sheet(`<h2>${tr('مادة جديدة', 'New subject')}</h2>
      <label class="suField" for="suNewName">${tr('اسم المادة', 'Subject name')}<input id="suNewName" data-autofocus class="suSearch" maxlength="120" autocomplete="off"></label>
      ${selectField('suNewDept', tr('القسم', 'Department'), o.departments, o.dept)}
      <div class="suGrid2">${selectField('suNewStage', tr('المرحلة', 'Stage'), o.stagesByDept[o.dept] || [], o.stage)}${selectField('suNewPeriod', tr('الدراسة', 'Study period'), o.periods, o.period)}</div>
      <div class="suGrid2">${numberField('suNewHours', tr('مجموع ساعات المادة', 'Total hours'), o.hours, 'min="0.1" step="any"')}${numberField('suNewDuration', tr('مدة المحاضرة (ساعة)', 'Lecture length (hours)'), o.duration, 'min="0.1" max="24" step="any"')}</div>
      <details class="suDetails"><summary>${tr('نظام التدريس وحدود الغياب', 'Teaching system and absence limits')}</summary>
        ${selectField('suNewSystem', tr('نظام التدريس', 'Teaching system'), o.systems, o.system)}
        <div class="suGrid3">${THRESHOLDS.map((k, i) => numberField('suNew_' + k, [tr('تنبيه %', 'Notice %'), tr('إنذار %', 'Warning %'), tr('رسوب %', 'Fail %')][i], o.limits[k], 'min="1" max="100" step="1"')).join('')}</div></details>
      <p class="suHint suStart">${tr('القسم والمرحلة والدراسة لا تتغير بعد الإنشاء.', 'Department, stage and period cannot change after creation.')}</p>
      <p class="suStatus" id="suNewStatus" role="status"></p>
      <div class="suBtns"><button data-x="close">${tr('إلغاء', 'Cancel')}</button><button class="suGoBtn" data-x="save">${tr('إنشاء المادة', 'Create subject')}</button></div>`, layer => {
      const q = id => layer.querySelector('#' + id), status = q('suNewStatus');
      const say = (message, error = false) => { status.textContent = message; status.dataset.state = error ? 'error' : 'ok'; };
      layer.querySelector('[data-x="close"]').onclick = closeSheet;
      q('suNewName').addEventListener('input', () => { if (status.dataset.state === 'error') say(''); });
      q('suNewDept').onchange = () => { q('suNewStage').innerHTML = (o.stagesByDept[q('suNewDept').value] || []).map(s => `<option value="${esc(s.value)}">${esc(s.label)}</option>`).join(''); };
      q('suNewSystem').onchange = () => { const v = typeof defaultAbsenceSettings === 'function' ? defaultAbsenceSettings(q('suNewSystem').value) : null; if (v) THRESHOLDS.forEach(k => { q('suNew_' + k).value = v[k] ?? ''; }); };
      layer.querySelector('[data-x="save"]').onclick = async () => {
        const values = { name: q('suNewName').value.trim(), dept: q('suNewDept').value, stage: q('suNewStage').value, period: q('suNewPeriod').value,
          hours: q('suNewHours').value, duration: q('suNewDuration').value, system: q('suNewSystem').value, limits: Object.fromEntries(THRESHOLDS.map(k => [k, q('suNew_' + k).value])) };
        if (!values.name) { say(tr('اكتب اسم المادة.', 'Enter the subject name.'), true); q('suNewName').focus(); return; }
        const controls = layer.querySelectorAll('button,input,select'); controls.forEach(el => { el.disabled = true; });
        say(tr('جارٍ الإنشاء…', 'Creating…'));
        try { await saveSubjectSettings(null, values, 'create'); closeSheet(); tab = 'today'; sub = ''; queue(); }
        catch (error) { say(error.message || String(error), true); controls.forEach(el => { el.disabled = false; }); }
      };
    });
  }
  function settingsSheet() {
    const subject = view();
    if (!canEditSubject(subject)) { notify(text('noPermission'), 'error'); return; }
    const current = readSubjectSettings(subject);
    if (!current) return;
    const num = (id, label, value, attrs) => `<label class="suField" for="${id}">${label}<input id="${id}" class="suSearch" type="number" inputmode="decimal" value="${esc(value)}" ${attrs}></label>`;
    sheet(`<h2>${tr('إعدادات المادة', 'Subject settings')}</h2>
      <label class="suField" for="suSubName">${tr('اسم المادة', 'Subject name')}<input id="suSubName" class="suSearch" maxlength="120" value="${esc(current.name)}"></label>
      <div class="suGrid2">${num('suSubHours', tr('مجموع ساعات المادة', 'Total hours'), current.hours, 'min="0.1" step="any"')}${num('suSubDuration', tr('مدة المحاضرة (ساعة)', 'Lecture length (hours)'), current.duration, 'min="0.1" max="24" step="any"')}</div>
      <p class="suHint suStart">${tr('تغيير مدة المحاضرة يسري على المحاضرات القادمة فقط.', 'A new lecture length applies to future lectures only.')}</p>
      <label class="suField" for="suSubSystem">${tr('نظام التدريس', 'Teaching system')}<select id="suSubSystem" class="suSearch">${current.systems.map(o => `<option value="${esc(o.value)}"${o.value === current.system ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
      <fieldset class="suFieldset"><legend>${tr('حدود الغياب (% من ساعات المادة)', 'Absence limits (% of subject hours)')}</legend>
        <div class="suGrid3">${THRESHOLDS.map((k, i) => num('suSub_' + k, [tr('تنبيه', 'Notice'), tr('إنذار', 'Warning'), tr('رسوب', 'Fail')][i], current.limits[k], 'min="1" max="100" step="1"')).join('')}</div></fieldset>
      <p class="suHint suStart">${tr('القسم والمرحلة والدراسة ثابتة للحفاظ على ارتباط الطلبة والحضور.', 'Department, stage and study period stay fixed to keep students and attendance linked.')}</p>
      <p class="suStatus" id="suSubStatus" role="status"></p>
      <div class="suBtns"><button data-x="close">${tr('إلغاء', 'Cancel')}</button><button class="suGoBtn" data-x="save">${tr('حفظ', 'Save')}</button></div>`, layer => {
      const status = layer.querySelector('#suSubStatus');
      const say = (message, error = false) => { status.textContent = message; status.dataset.state = error ? 'error' : 'ok'; };
      layer.querySelector('[data-x="close"]').onclick = closeSheet;
      layer.querySelector('#suSubSystem').onchange = event => {
        const values = typeof defaultAbsenceSettings === 'function' ? defaultAbsenceSettings(event.target.value) : null;
        if (values) THRESHOLDS.forEach(k => { layer.querySelector('#suSub_' + k).value = values[k] ?? ''; });
      };
      layer.querySelector('[data-x="save"]').onclick = async () => {
        const values = { name: layer.querySelector('#suSubName').value.trim(), hours: layer.querySelector('#suSubHours').value, duration: layer.querySelector('#suSubDuration').value,
          system: layer.querySelector('#suSubSystem').value, limits: Object.fromEntries(THRESHOLDS.map(k => [k, layer.querySelector('#suSub_' + k).value])) };
        const controls = layer.querySelectorAll('button,input,select'); controls.forEach(el => { el.disabled = true; });
        say(tr('جارٍ الحفظ…', 'Saving…'));
        try { await saveSubjectSettings(subject, values); closeSheet(); queue(); }
        catch (error) { say(error.message || String(error), true); controls.forEach(el => { el.disabled = false; }); }
      };
    });
  }

  function setClassic() {
    try { localStorage.removeItem(KEY); } catch {}
    enabled = false; closeSheet(); render();
  }

  function onClick(event) {
    const t = event.target.closest('button'); if (!t || t.closest('.suToast')) return;
    const d = t.dataset;
    if (d.suTab) { clearToast(); tab = d.suTab; sub = ''; level = ''; render(); $('suView').scrollTop = 0; return; }
    if (d.suFilter) { filter = d.suFilter; render(); return; }
    if (d.suLevel) { level = level === d.suLevel ? '' : d.suLevel; render(); return; }
    if (d.suStudent) { studentTap(d.suStudent, t); return; }
    if (d.suLecture) { lectureSheet(d.suLecture); return; }
    if (d.suHistory) { historySheet(d.suHistory); return; }
    if (d.suCard) { studentSheet(d.suCard); return; }
    if (d.suRecord) { recordMode = d.suRecord; render(); return; }
    switch (d.su) {
      case 'back': sub = ''; query = ''; filter = 'all'; render(); break;
      case 'names': sub = 'names'; render(); $('suView').scrollTop = 0; break;
      case 'scan': $('beginnerStartAttendance') ? $('beginnerStartAttendance').click() : startScanner(); queue(); break;
      case 'sync': syncSheet(); break;
      case 'endLecture': endSheet(); break;
      case 'addStudents': addSheet(); break;
      case 'subjectSettings': settingsSheet(); break;
      case 'subjects': subjectSheet(); break;
      case 'setup': $('teachingSetupBtn')?.click(); break;
      case 'create': createSheet(); break;
      case 'excel': exportExcel(); break;
      case 'qr': exportStudentQrPdf(); break;
      case 'fullRecord': (window.HathirBeginnerUI?.openRecord || (() => {}))(); break;
      case 'settings': window.HathirSettings?.open?.(); break;
      case 'classic': setClassic(); break;
      case 'logout': logout(); break;
    }
  }

  window.HathirSimpleUI = Object.freeze({
    enable() { try { localStorage.setItem(KEY, '1'); } catch {} enabled = true; render(); },
    disable: setClassic,
    enabled: () => enabled,
    render
  });

  const baseRender = renderAll;
  renderAll = function () { const result = baseRender.apply(this, arguments); queue(); return result; };
  const baseStop = stopScanner;
  stopScanner = function () { const result = baseStop.apply(this, arguments); queue(); return result; };
  for (const name of ['online', 'offline', 'focus']) window.addEventListener(name, queue);
  new MutationObserver(queue).observe($('appPage'), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(queue).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  queue();
})();
