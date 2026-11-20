/* Exact-column attendance removal; uses the existing durable device save/queue. */
(() => {
  'use strict';
  let dialog, target, busy = false;
  const valid = scope => attendanceCorrectionScopeValid(scope) &&
    selectedSubjectGroup().length === 1 && subjects.includes(scope.subject);
  function setup() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.id = 'lectureColumnActions'; dialog.dir = 'rtl';
    dialog.setAttribute('aria-labelledby', 'lectureColumnActionsTitle');
    dialog.innerHTML = '<h3 id="lectureColumnActionsTitle"></h3><p>مسح الحضور يشمل جميع الطلبة في هذه المحاضرة، حتى المخفيين بالفلتر. تبقى أسماء الطلبة وبصماتهم والأعذار وبقية المحاضرات محفوظة.</p><button type="button" class="btn danger" id="clearLectureColumn">مسح حضور هذه المحاضرة</button> <button type="button" class="btn ghost" id="dismissLectureColumn">إلغاء</button><p role="status" id="lectureColumnMessage"></p>';
    document.body.append(dialog);
    document.getElementById('dismissLectureColumn').onclick = () => dialog.close();
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    document.getElementById('clearLectureColumn').onclick = clear;
  }
  async function clear() {
    if (busy || !target) return;
    const {scope, date} = target, subject = scope.subject;
    const message = document.getElementById('lectureColumnMessage');
    if (!valid(scope)) { dialog.close(); return; }
    if (!window.HathirDeviceWorkspace?.active()) { message.textContent = 'افتح النسخة المحلية الحديثة للمادة قبل مسح حضور المحاضرة.'; return; }
    if (!confirm('هل تريد مسح حضور جميع الطلبة في المحاضرة المحددة: ' + attendanceColumnDate(date) + '؟ لا يشمل ذلك المحاضرات الأخرى في اليوم نفسه.')) return;
    busy = true;
    for (const b of dialog.querySelectorAll('button')) b.disabled = true;
    try {
      const saved = await withAttendanceMutation(subject, async () => {
        if (!valid(scope)) return false;
        const previous = subject.attendance?.[date];
        if (!previous || !Object.keys(previous).length) return false;
        const meta = lectureMeta(subject, date), oldHide = meta.hideWhenEmpty;
        subject.attendance[date] = {};
        meta.hideWhenEmpty = true;
        subject.summaryLoaded = false; subject.attendanceStatsDirty = true;
        try { await HathirDeviceWorkspace.save({recovery:true}); }
        catch (error) { subject.attendance[date] = previous; meta.hideWhenEmpty = oldHide; throw error; }
        if (typeof lastDisplayedReading !== 'undefined' && lastDisplayedReading?.subjectId === subject.id && lastDisplayedReading.date === date) lastDisplayedReading = null;
        return true;
      });
      dialog.close(); renderAll();
      notify(saved ? 'تم مسح حضور المحاضرة وحفظ التغيير على الجهاز.' : 'لا يوجد حضور لمسحه في هذه المحاضرة.');
    } catch (error) { message.textContent = 'لم يكتمل المسح: ' + error.message; }
    finally { busy = false; for (const b of dialog.querySelectorAll('button')) b.disabled = false; }
  }
  function open(button) {
    if (!button || busy) return;
    const group = selectedSubjectGroup();
    if (group.length !== 1) { notify('اختر مادة واحدة أولًا لمسح حضور محاضرة.', 'warn'); return; }
    const scope = attendanceCorrectionScope(group[0]), date = button.dataset.deviceLecture;
    if (!valid(scope) || !isLectureKey(date)) return;
    setup(); target = {scope,date};
    document.getElementById('lectureColumnActionsTitle').textContent = 'المحاضرة: ' + button.textContent.trim();
    document.getElementById('lectureColumnMessage').textContent = '';
    dialog.showModal();
  }
  window.HathirLectureColumnActions = Object.freeze({open});
})();
