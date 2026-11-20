'use strict';
// Advisory presence only: never participates in attendance writes or conflicts.
module.exports = ({db, approvedIdentity, ownerIdentity, fail, now = Date.now}) => async request => {
  const data = request.data || {}, collection = db.collection('attendanceAccountPresence');
  if (data.action === 'beat') {
    const {user} = await approvedIdentity(request);
    await collection.doc(user.uid).set({lastSeen: now()});
    return {ok: true};
  }
  if (data.action === 'list') {
    await ownerIdentity(request);
    if (!Array.isArray(data.uids) || data.uids.length > 100 || data.uids.some(uid => typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) fail('invalid-argument', 'Invalid account list.');
    const serverNow = now();
    const accounts = await Promise.all([...new Set(data.uids)].map(async uid => {
      const snap = await collection.doc(uid).get(), lastSeen = snap.exists ? Number(snap.data().lastSeen) || 0 : 0;
      return {uid, lastSeen, online: lastSeen > 0 && lastSeen <= serverNow && serverNow - lastSeen < 180000};
    }));
    return {serverNow, accounts};
  }
  fail('invalid-argument', 'Unknown presence action.');
};
