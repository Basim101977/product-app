/* Account-scoped local source of truth. Never modifies the legacy outbox. */
window.HathirDeviceStore = (() => {
  'use strict';
  let opening;
  const clone = value => JSON.parse(JSON.stringify(value));
  async function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('hathir-device-workspaces-v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('workspaces', {keyPath:'uid'});
        request.result.createObjectStore('recovery', {keyPath:'id'});
      };
      request.onsuccess = () => {request.result.onversionchange = () => {request.result.close(); opening = null;}; resolve(request.result);};
      request.onerror = () => {opening = null; reject(request.error);};
    });
    return opening;
  }
  async function transact(stores, mode, work) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode); let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.deviceError || tx.error || Error('Local save failed'));
      work(tx, value => {result = value;});
    });
  }
  const get = uid => transact(['workspaces'], 'readonly', (tx, done) => {
    const request = tx.objectStore('workspaces').get(uid); request.onsuccess = () => done(request.result || null);
  });
  async function save(row, expectedRevision, {recovery=false}={}) {
    const captured = clone(row);
    if (!captured.uid || captured.session?.uid !== captured.uid || captured.data?.workspace?.id !== captured.uid) throw Error('Local account mismatch');
    return transact(['workspaces','recovery'], 'readwrite', (tx, done) => {
      const store = tx.objectStore('workspaces'), request = store.get(captured.uid);
      request.onsuccess = () => {
        const prior = request.result;
        if ((prior?.revision || 0) !== expectedRevision) {
          tx.deviceError = Error('تغيّرت النسخة في تبويب آخر. أعد فتح الصفحة قبل التعديل.'); tx.abort(); return;
        }
        if (recovery && prior) tx.objectStore('recovery').put({id:crypto.randomUUID(), uid:prior.uid, savedAt:Date.now(), row:prior});
        captured.revision = expectedRevision + 1; captured.savedAt = Date.now();
        store.put(captured); done(captured);
      };
    });
  }
  const recoveries=uid=>transact(['recovery'],'readonly',(tx,done)=>{
    const request=tx.objectStore('recovery').getAll();request.onsuccess=()=>done(request.result.filter(item=>item.uid===uid).sort((a,b)=>b.savedAt-a.savedAt));
  });
  return Object.freeze({get,save,clone,recoveries});
})();
