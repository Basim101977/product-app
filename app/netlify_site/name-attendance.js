/* A single tap reveals the name. Double activation marks or confirms removal. */
(() => {
  'use strict';
  const selector = '.rosterFullName[data-name-attendance]';
  const inFlight = new Set();
  let press = null, lastTap = null, lastActivation = null;
  function target(event) {
    const button = event.target.closest(selector);
    return button && button.closest('#rosterRows, .rosterNameRail') ? button : null;
  }
  function scope(button) {
    return JSON.stringify([session?.uid, session?.workspaceId, getSubject()?.id, button.dataset.nameAttendance]);
  }
  async function register(button) {
    // Keep the action discoverable while loading, but never bypass readiness.
    // A rejected attempt must not consume the duplicate-activation cooldown.
    if (!attendanceInputReady()) {
      const failed=sectionLoadFailed&&!sectionLoadPending || selectedSubjectGroup().some(s=>s.liveLoadError);
      return notify(lang==='ar'
        ? failed?'تعذر تجهيز سجل المادة. اختر المادة مجددًا لإعادة المحاولة؛ لم يُسجّل حضور.':'جارٍ تجهيز سجل المادة أو إكمال العملية الحالية. انتظر ثم أعد المحاولة؛ لم يُسجّل حضور.'
        : failed?'The subject record could not load. Select the subject again to retry; no attendance was recorded.':'The subject record or current operation is not ready. Wait and retry; no attendance was recorded.', 'warn');
    }
    const key = scope(button), now = Date.now();
    if (inFlight.has(key) || lastActivation?.key === key && now - lastActivation.at < 700) return;
    lastActivation = { key, at: now };
    inFlight.add(key);
    try {
      const id = button.dataset.nameAttendance;
      const subject = studentSubject(id), date = subject && currentLectureKey(subject);
      if (subject && date && getAttendanceRecord(subject, date, id)) {
        if (!hasAttendanceEditPermission()) return notify(text('noPermission'), 'error');
        await unmarkAttendance(id, date, attendanceCorrectionScope(subject));
      } else await markAttendance(id, 'manual');
    }
    catch (error) { notify(error.message || String(error), 'error'); }
    finally { inFlight.delete(key); }
  }
  document.addEventListener('dblclick', event => {
    const button = target(event);
    if (button) { event.preventDefault(); register(button); }
  });
  document.addEventListener('pointerdown', event => {
    const button = event.pointerType === 'touch' && target(event);
    press = button ? { key: scope(button), x: event.clientX, y: event.clientY } : null;
  }, { passive: true });
  document.addEventListener('pointerup', event => {
    if (event.pointerType !== 'touch') return;
    const button = target(event), start = press;
    press = null;
    if (!button || !start || scope(button) !== start.key ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
      lastTap = null; return;
    }
    const now = Date.now();
    if (lastTap?.key === start.key && now - lastTap.at < 500) {
      lastTap = null; register(button);
    } else lastTap = { key: start.key, at: now };
  }, { passive: true });
  document.addEventListener('pointercancel', () => { press = null; lastTap = null; });
})();
