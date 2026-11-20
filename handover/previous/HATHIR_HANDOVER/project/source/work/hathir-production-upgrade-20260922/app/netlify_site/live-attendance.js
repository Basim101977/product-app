/* Server reception is independent of the durable upload queue. */
(() => {
  'use strict';
  const watchers = new Map();
  let scope = '', generation = 0;
  function eligible() { return typeof session !== 'undefined' && session && !session.local && !session.offlineMode && session.active && navigator.onLine && auth?.currentUser?.uid === session.uid; }
  function key() { return eligible() ? session.uid + ':' + session.workspaceId : ''; }
  function state() {
    const entries = [...watchers.values()];
    return { connected: eligible(), loading: entries.some(e => e.running || !e.receivedAt), error: entries.some(e => e.error),
      receivedAt: entries.length && entries.every(e => e.receivedAt) ? Math.min(...entries.map(e => e.receivedAt)) : 0 };
  }
  function receiveMeta(subject, date, data) {
    subject.lectureMeta ||= {}; delete subject.lectureMeta[date];
    mergeLectureMetadata(subject, date, data);
  }
  function notify() { if (typeof scheduleOfflineStatus === 'function') scheduleOfflineStatus(); }
  async function pull(entry, dates = []) {
    dates.forEach(date => entry.dates.add(date));
    if (entry.running) { entry.again = true; return entry.running; }
    const token = generation;
    const valid = () => token === generation && key() === scope && watchers.get(entry.subject.id) === entry && subjects.includes(entry.subject);
    entry.running = (async () => {
      do {
        entry.again = false;
        const batchDates = [...entry.dates]; entry.dates.clear();
        if (!valid()) return;
        const subject = entry.subject, ref = workspaceRef().collection('subjects').doc(subject.id);
        let savedRevision;
        await readAttendanceWithoutLocalRace(subject, async () => {
          const [parent, index] = await Promise.all([ref.get({ source: 'server' }), ref.collection('lectures').orderBy('date', 'desc').limit(12).get({ source: 'server' })]);
          if (!parent.exists || (parent.data().lastRosterResetId || '') !== (subject.lastRosterResetId || '')) throw Error('Roster changed; refresh the subject before receiving attendance.');
          if (parent.data().attendanceClearInProgress || Number(parent.data().attendanceClearedAt?.toMillis?.() || 0) > Number(subject.attendanceClearedAtMillis || 0)) throw Error('Attendance reset requires a subject refresh.');
          const wanted = new Set([...batchDates, currentLectureKey(subject)]);
          if (!entry.receivedAt) index.docs.slice(0, 2).forEach(doc => wanted.add(doc.id));
          const records = await mapWithConcurrency([...wanted].filter(isLectureKey), 3, async date => {
            const lectureRef = ref.collection('lectures').doc(date);
            const [lecture, marks, excuses] = await Promise.all([lectureRef.get({source:'server'}), lectureRef.collection('marks').get({source:'server'}), lectureRef.collection('excuses').get({source:'server'})]);
            return { date, lecture, marks, excuses };
          });
          return { index, records };
        }, ({index, records}, pending) => {
          if (!valid()) return;
          index.forEach(doc => { if (isLectureKey(doc.id)) receiveMeta(subject, doc.id, doc.data()); });
          subject.attendance ||= {}; subject.excuses ||= {}; subject.loadedLectureDates ||= new Set();
          for (const {date, lecture, marks, excuses} of records) {
            if (lecture.exists) receiveMeta(subject, date, lecture.data());
            else { delete subject.lectureMeta[date]; subject.lectures = subject.lectures.filter(d => d !== date); }
            subject.attendance[date] = {}; subject.excuses[date] = {};
            marks.forEach(doc => { const m = doc.data(); subject.attendance[date][normalizeId(m.studentId || doc.id)] = {...m, markedAtMillis:Number(m.markedAt?.toMillis?.() || m.markedAtMillis || 0)}; });
            excuses.forEach(doc => { subject.excuses[date][normalizeId(doc.id)] = doc.data(); });
            subject.loadedLectureDates.add(date);
          }
          applyOfflineAttendanceOverlay(subject, pending);
          subject.attendanceStatsDirty = true; subject.summaryLoaded = false;
          savedRevision = pending.revision;
          entry.receivedAt = Date.now(); entry.error = '';
        });
        if (valid()) { await HathirOfflineStore.saveReceived(offlineSnapshot(subject), savedRevision); renderAll(); }
      } while (entry.again && valid());
    })().catch(error => { if (valid()) entry.error = String(error.message || error); throw error; })
      .finally(() => { entry.running = null; notify(); });
    notify(); return entry.running;
  }
  function reconcile() {
    const next = key();
    if (next !== scope) { generation++; watchers.forEach(e => e.unsubscribe?.()); watchers.clear(); scope = next; }
    if (!next || cloudDataLoading) return;
    const selected = selectedSubjectGroup();
    for (const [id,e] of watchers) if (!selected.includes(e.subject)) { e.unsubscribe?.(); watchers.delete(id); }
    for (const subject of selected) {
      if (watchers.has(subject.id) || !subject.rosterLoaded || subject.cachedDisplayOnly) continue;
      const query = workspaceRef().collection('subjects').doc(subject.id).collection('lectures').orderBy('date','desc').limit(12);
      if (typeof query.onSnapshot !== 'function') continue;
      const entry = {subject, dates:new Set(), receivedAt:0, error:'', running:null}; watchers.set(subject.id, entry);
      entry.unsubscribe = query.onSnapshot({includeMetadataChanges:true}, snapshot => {
        if (snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) return;
        const dates = snapshot.docChanges().map(change => change.doc.id);
        if (dates.length || !entry.receivedAt) pull(entry, dates).catch(() => {});
      }, error => { entry.error = String(error.message || error); entry.listenerFailed = true; notify(); });
    }
  }
  async function refresh() { reconcile(); await Promise.all([...watchers.values()].map(e => pull(e))); return state(); }
  window.HathirLiveSync = Object.freeze({refresh, state, reconcile});
  setInterval(() => {
    for (const [id,e] of watchers) if (e.listenerFailed && !e.running) { e.unsubscribe?.(); watchers.delete(id); }
    reconcile(); for (const e of watchers.values()) if (e.error && !e.running) pull(e).catch(()=>{});
  }, 5000);
  // A mark can be written after the lecture document (or by an older client
  // without updating it). Such subcollection changes do not trigger the
  // lecture query. Periodically verify the selected record from the server.
  setInterval(() => {
    if (document.hidden || !eligible() || cloudDataLoading) return;
    reconcile();
    for (const e of watchers.values()) if (!e.running && Date.now() - e.receivedAt >= 30000) pull(e).catch(()=>{});
  }, 10000);
  for (const event of ['online','focus']) window.addEventListener(event, () => refresh().catch(()=>{}));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().catch(()=>{}); });
})();
