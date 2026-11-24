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
  let enabled = false, root = null, tab = 'today', sub = '', filter = 'all', query = '', level = '';
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
  const record = (subject, key, id) => (subject && key ? getAttendanceRecord(subject, key, id) : null);
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
    if (!subject) return `<button class="suCard suSubject" data-su="setup"><span class="suGrow"><b>${tr('أضف مادة', 'Add a subject')}</b><small>${tr('ابدأ بإنشاء مادتك الأولى', 'Create your first subject')}</small></span></button>`;
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
    return `${subjectCard(subject)}
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
      ${lastName && lastName !== '—' ? `<div class="suCard suLast"><span class="suAvatar" aria-hidden="true">${esc(lastName[0])}</span><span class="suGrow"><small>${tr('آخر تسجيل', 'Last mark')}</small><b>${esc(lastName)}</b></span><small class="suNum">${esc(lastTime || '')}</small></div>` : ''}`;
  }

  function names() {
    const subject = view();
    if (!subject) return subjectCard(null);
    const key = lectureKey(subject), students = subject.students || [];
    const present = students.filter(s => record(subject, key, s.id)).length, q = query.trim().normalize('NFKC');
    const rows = students.filter(s => (!q || String(s.name).normalize('NFKC').includes(q)) && (filter === 'all' || (filter === 'absent') === !record(subject, key, s.id)));
    return `<input class="suSearch" id="suSearch" type="search" placeholder="${tr('ابحث باسم الطالب', 'Search by name')}" value="${esc(query)}" autocomplete="off" aria-label="${tr('بحث', 'Search')}">
      <div class="suChips" role="group" aria-label="${tr('تصفية', 'Filter')}">
        <button class="suChip" data-su-filter="all" aria-pressed="${filter === 'all'}">${tr('الكل', 'All')} ${students.length}</button>
        <button class="suChip" data-su-filter="absent" aria-pressed="${filter === 'absent'}">${tr('غائبون', 'Absent')} ${students.length - present}</button>
        <button class="suChip" data-su-filter="present" aria-pressed="${filter === 'present'}">${tr('حاضرون', 'Present')} ${present}</button>
      </div>
      <p class="suHint">${tr('اضغط مرتين على اسم الغائب لتسجيل حضوره · اضغط مرة على الحاضر لعرض التفاصيل', 'Double-tap an absent name to mark · tap a present name for details')}</p>
      <div class="suList">${rows.map(s => { const r = record(subject, key, s.id); return `<button class="suRow" data-su-student="${esc(s.id)}"><span class="suCheck${r ? ' on' : ''}" aria-hidden="true">${r ? '✓' : ''}</span><span class="suGrow suName">${esc(s.name)}</span><span class="suNum suTime">${r ? esc(displayAttendanceTime(r.time) || '') : ''}</span></button>`; }).join('') || `<p class="suEmpty">${tr('لا يوجد طالب بهذا الاسم.', 'No student with this name.')}</p>`}</div>`;
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
      <div class="suSummary" role="group" aria-label="${tr('مواقف الغياب', 'Absence status')}">${Object.keys(counts).map(k => `<button class="${LEVELS[k][0]}" data-su-level="${k}" aria-pressed="${level === k}"><b>${counts[k]}</b>${labels[k]}</button>`).join('')}</div>${otherNote}
      <div class="suList">${shown.map(({ s, st, cls }) => { const pct = Number(st.absencePercent) || 0; return `<div class="suStudent"><span class="suHead"><b>${esc(s.name)}</b><span class="suTag ${(LEVELS[cls] || LEVELS.ok)[0]}">${esc(absencePolicyLabel(st.policy))}</span></span><span class="suBar"><i style="width:${Math.min(100, pct * 5)}%;background:${(LEVELS[cls] || LEVELS.ok)[1]}"></i></span><small><span>${st.absentMinutes ? tr('غياب', 'Absent') + ' ' + esc(hoursLabel(st.absentMinutes)) : tr('لا غياب', 'No absence')}</span><span class="suNum">${esc(percentLabel(pct))}</span></small></div>`; }).join('') || `<p class="suEmpty">${tr('لا يوجد طلبة في هذا الموقف.', 'No students in this status.')}</p>`}</div>
      <div class="suTools"><button data-su="excel">⤓ Excel</button><button data-su="qr">▦ ${tr('بطاقات QR', 'QR cards')}</button></div>`;
  }

  function records() {
    const subject = view();
    if (!subject) return subjectCard(null);
    const total = (subject.students || []).length;
    const keys = sortedLectureKeys(subject).filter(k => !lectureColumnRemovedAfterUnmark(subject, k)).reverse();
    return `${subjectCard(subject, `${keys.length} ${tr('محاضرة', 'lectures')}`)}
      <div class="suList">${keys.map((k, i) => { const meta = subject.lectureMeta?.[k] || {}, count = Object.keys(subject.attendance?.[k] || {}).length, cancelled = ['cancelled', 'voided'].includes(meta.status); return `<div class="suLec"><span class="suLecNo">${keys.length - i}</span><span class="suGrow"><b>${esc(attendanceColumnDate(k))}${meta.startTime ? ' · <span class="suNum">' + esc(displayAttendanceTime(meta.startTime)) + '</span>' : ''}</b><small>${cancelled ? tr('ملغاة', 'Cancelled') : count + ' ' + tr('من', 'of') + ' ' + total + ' ' + tr('حاضرون', 'present')}</small></span></div>`; }).join('') || `<p class="suEmpty">${tr('لا توجد محاضرات بعد.', 'No lectures yet.')}</p>`}</div>
      <button class="suSecondary" data-su="fullRecord">${tr('افتح السجل الكامل', 'Open full record')}</button>`;
  }

  function more() {
    return `<div class="suList">
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
    const searchFocused = document.activeElement?.id === 'suSearch', caret = searchFocused ? document.activeElement.selectionStart : 0;
    $('suTop').innerHTML = header();
    $('suView').innerHTML = sub === 'names' ? names() : tab === 'students' ? students() : tab === 'records' ? records() : tab === 'more' ? more() : today();
    $('suNav').innerHTML = nav(); $('suNav').hidden = sub === 'names';
    const search = $('suSearch');
    if (search) {
      search.oninput = () => { query = search.value; render(); };
      if (searchFocused) { search.focus(); search.setSelectionRange(caret, caret); }
    }
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
    const layer = $('suLayer');
    layer.innerHTML = `<div class="suScrim"><div class="suSheet" role="dialog" aria-modal="true"><div class="suGrab"></div>${html}</div></div>`;
    layer.firstChild.addEventListener('click', e => { if (e.target === layer.firstChild) closeSheet(); });
    bind?.(layer); layer.querySelector('button')?.focus();
  }
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

  function subjectSheet() {
    const options = [...(els.subjectSelect?.options || [])].filter(o => o.value && !o.value.startsWith('__'));
    if (options.length < 2) { $('teachingSetupBtn')?.click(); return; }
    sheet(`<h2>${tr('اختر المادة', 'Choose a subject')}</h2><div class="suOpts">${options.map(o => `<button class="suOpt" data-value="${esc(o.value)}" aria-pressed="${o.value === els.subjectSelect.value}"><b>${esc(o.textContent)}</b></button>`).join('')}</div>
      <button class="suLink" data-x="setup">${tr('قسم ومرحلة أخرى…', 'Other department or stage…')}</button>`, layer => {
      layer.querySelectorAll('[data-value]').forEach(b => b.onclick = () => {
        closeSheet(); els.subjectSelect.value = b.dataset.value; els.subjectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      layer.querySelector('[data-x="setup"]').onclick = () => { closeSheet(); $('teachingSetupBtn')?.click(); };
    });
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

  function setClassic() {
    try { localStorage.removeItem(KEY); } catch {}
    enabled = false; closeSheet(); render();
  }

  function onClick(event) {
    const t = event.target.closest('button'); if (!t || t.closest('.suToast')) return;
    const d = t.dataset;
    if (d.suTab) { tab = d.suTab; sub = ''; level = ''; render(); $('suView').scrollTop = 0; return; }
    if (d.suFilter) { filter = d.suFilter; render(); return; }
    if (d.suLevel) { level = level === d.suLevel ? '' : d.suLevel; render(); return; }
    if (d.suStudent) { studentTap(d.suStudent, t); return; }
    switch (d.su) {
      case 'back': sub = ''; query = ''; filter = 'all'; render(); break;
      case 'names': sub = 'names'; render(); $('suView').scrollTop = 0; break;
      case 'scan': $('beginnerStartAttendance') ? $('beginnerStartAttendance').click() : startScanner(); queue(); break;
      case 'sync': syncSheet(); break;
      case 'subjects': subjectSheet(); break;
      case 'setup': $('teachingSetupBtn')?.click(); break;
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
