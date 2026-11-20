(function () {
  'use strict';
  let state = null, banner = null;
  let confirmedUid = '', confirmed = false, confirmedAt = 0;
  const tr = (ar, en) => document.documentElement.lang === 'en' ? en : ar;
  function render() {
    const anchor = document.getElementById('beginnerHub') || document.getElementById('attendanceRecordCard');
    if (!anchor) return;
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'workspaceSyncReminder';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      const message = document.createElement('span');
      message.className = 'workspaceSyncMessage';
      const percentage = document.createElement('strong');
      percentage.className = 'workspaceSyncPercent';
      percentage.dir = 'ltr';
      banner.append(message, percentage);
    }
    if (banner.parentElement !== anchor.parentElement || banner.nextElementSibling !== anchor) anchor.before(banner);
    banner.hidden = !state || !session || session.uid !== state.uid || session.local && !state.preview;
    if (banner.hidden) return;
    const count = Number(state.count) || 0;
    const pending = count > 0;
    const background = !pending && state.busy && confirmed && !state.error && navigator.onLine;
    const unit = state.unit === 'lectures'
      ? tr('محاضرة بانتظار المزامنة', 'lecture(s) awaiting sync')
      : tr('تغيير بانتظار المزامنة', 'change(s) awaiting sync');
    let message;
    if (state.error) message = tr('المزامنة تحتاج متابعة', 'Sync needs attention');
    else if (!navigator.onLine) message = tr('غير متصل', 'Offline');
    else if (state.busy && pending) message = tr('جارٍ المزامنة تلقائيًا', 'Synchronizing automatically');
    else if (pending) message = tr('المزامنة تلقائية عند الاتصال', 'Syncs automatically when connected');
    else if (background) message = tr('تمت المزامنة', 'Synced');
    else if (state.busy) message = tr('جارٍ التحقق من التغييرات الواردة', 'Checking incoming changes');
    else message = state.ready ? tr('تمت المزامنة', 'Synced') : tr('جارٍ التحقق من المزامنة', 'Checking sync');
    if (pending) message += ' · ' + count + ' ' + unit;
    const synced = background || (!pending && !state.busy && state.ready && !state.error && navigator.onLine);
    const checking = !synced && !pending && !state.error && navigator.onLine && (state.busy || !state.ready);
    const percent = synced ? 100 : checking ? null : !state.error && navigator.onLine && state.busy && pending && Number.isFinite(state.percent)
      ? Math.max(0, Math.min(99, Math.floor(state.percent))) : 0;
    if (state.preview) message = tr('مثال توضيحي · ', 'Demo · ') + message;
    banner.dataset.state = state.error ? 'error' : !navigator.onLine ? 'pending' : pending && state.busy ? 'busy' : synced ? 'synced' : 'pending';
    banner.dataset.backgroundCheck=String(background);
    const messageNode=banner.querySelector('.workspaceSyncMessage'),percentNode=banner.querySelector('.workspaceSyncPercent');
    if(messageNode.textContent!==message)messageNode.textContent=message;
    const percentText=percent===null?'…':percent+'%';
    if(percentNode.textContent!==percentText)percentNode.textContent=percentText;
    banner.setAttribute('aria-label', message + (percent === null ? '' : ' · ' + percent + '%'));
    banner.style.setProperty('--sync-progress', (percent || 0) + '%');
    banner.dataset.progress = String(percent !== null);
    banner.setAttribute('role', state.busy && pending && percent !== null ? 'progressbar' : 'status');
    for (const name of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow']) banner.removeAttribute(name);
    if (state.busy && pending && percent !== null) {
      banner.setAttribute('aria-valuemin', '0');
      banner.setAttribute('aria-valuemax', '100');
      banner.setAttribute('aria-valuenow', String(percent));
    }
    banner.title = tr('حالة مزامنة جميع المواد على هذا الجهاز. أبقِ حاضر مفتوحًا عند الاتصال حتى تكتمل المزامنة.', 'Sync status for all subjects on this device. Keep Hathir open and connected until sync completes.');
    if(background)banner.title+=' '+tr('فحص التغييرات في الخلفية.','Checking for changes in the background.');
    if(confirmedAt)banner.title+=' '+tr('آخر تحقق ناجح: ','Last successful check: ')+new Date(confirmedAt).toLocaleTimeString();
  }
  window.HathirSyncReminder = Object.freeze({ update(value) {
    state=value;
    if(confirmedUid!==value?.uid){confirmedUid=value?.uid||'';confirmed=false;confirmedAt=0;}
    if(!value||value.error||Number(value.count)>0||!navigator.onLine)confirmed=false;
    else if(value.ready&&!value.busy){confirmed=true;confirmedAt=value.lastCheckedAt||Date.now();}
    render();
  } });
  window.addEventListener('beforeunload', event => {
    if (state?.count > 0 && session?.uid === state.uid && !session.local) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  for (const event of ['online', 'offline', 'focus', 'pageshow']) window.addEventListener(event, () => {
    render();
    if (typeof offlineStatus === 'function') offlineStatus().catch(() => {});
  });
})();
