const assert = require('assert/strict');

function createHarness({acceptAlreadyClosed=false}={}) {

// No production requests or credentials: exercise the real callable against
// a transactional Firestore double, including the original-existence rules.
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const records = new Map(), reads = [], authChecks = [];
let allowEdit = true, transactionHook = null, clock = 10000, serial = 0;
const ref = path => ({ path, id: path.split('/').at(-1), collection: name => collection(path + '/' + name) });
const snapshot = (path, state = records) => ({ ref: ref(path), id: path.split('/').at(-1), exists: state.has(path), data: () => state.get(path) });
const collection = (path, filters = [], limit = Infinity) => ({
  doc: id => ref(path + '/' + id), limit: n => collection(path, filters, n),
  where: (key, op, value) => collection(path, [...filters, [key, op, value]], limit),
  get: async () => {
    reads.push({ kind: 'query', path });
    const docs = [...records.keys()].filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
      .filter(p => filters.every(([key, op, value]) => op === 'in' ? value.includes(records.get(p)[key]) : records.get(p)[key] === value))
      .slice(0, limit).map(p => snapshot(p));
    return { docs, empty: !docs.length };
  }
});
const db = {
  collection, getAll: async (...refs) => { reads.push({ kind: 'getAll', count: refs.length }); return refs.map(r => snapshot(r.path)); },
  runTransaction: async work => {
    if (transactionHook) { const hook = transactionHook; transactionHook = null; hook(); }
    const initial = new Map(records), writes = []; let writing = false;
    const result = await work({
      getAll: async (...refs) => { assert(!writing, 'all reads must precede writes'); return refs.map(r => snapshot(r.path, initial)); },
      create: (r, data) => { writing = true; assert(!initial.has(r.path), 'create cannot overwrite an existing document'); writes.push([r.path, data]); },
      set: (r, data) => { writing = true; writes.push([r.path, { ...initial.get(r.path), ...data }]); },
      delete: r => { writing = true; writes.push([r.path, null]); }
    });
    writes.forEach(([path, data]) => data === null ? records.delete(path) : records.set(path, data));
    return result;
  }
};
const subjectPath = 'attendanceWorkspaces/owner/subjects/course', cohortPath = 'attendanceWorkspaces/owner/cohorts/private_roster';
const lecturePath = date => subjectPath + '/lectures/' + date;
const markPath = (date, id = 'P1') => lecturePath(date) + '/marks/' + id;
const timestamp = n => ({ toMillis: () => n });
const callable = require('../offline-attendance-batch')({
  acceptAlreadyClosed,
  onCall: (config, handler) => { assert.equal(config.region, 'asia-south1'); return handler; },
  HttpsError, db, Timestamp: { now: () => timestamp(++clock) }, cohortIdForSubject: () => 'private_roster',
  authorisedSubject: async (request, permission, options) => {
    authChecks.push({ permission, options });
    if (request.auth?.uid !== 'owner' || request.data.workspaceId !== 'owner' || request.data.subjectId !== 'course') throw new HttpsError('permission-denied', 'Account or subject mismatch');
    if (options?.edit && !allowEdit) throw new HttpsError('permission-denied', 'No editing permission');
    return { workspaceId: 'owner', subjectId: 'course', subjectRef: ref(subjectPath), subject: records.get(subjectPath) };
  }
}).syncOfflineAttendanceBatch;
const request = operations => ({ auth: { uid: 'owner' }, data: { workspaceId: 'owner', subjectId: 'course', operations } });
const operation = (kind = 'mark', extra = {}) => ({
  id: 'offline-op-' + String(++serial).padStart(12, '0'), protocolVersion: 2,
  uid: 'owner', workspaceId: 'owner', subjectId: 'course', date: '2026-09-16', kind,
  createdAt: Date.now(), preparedAt: 1000, studentId: 'P1', studentName: 'Student P1',
  meta: { startTime: '08:00', durationHours: 2 }, record: { time: '08:05', method: 'manual' },
  expectedTime: kind === 'mark' ? null : '08:05', expectedRevision: null, expectedMarkedAtMillis: null,
  ...extra
});
const reset = () => {
  records.clear(); reads.length = authChecks.length = 0; allowEdit = true; transactionHook = null;
  records.set(subjectPath, { rosterCohortId: 'private_roster' });
  records.set(cohortPath, {});
  for (let n = 1; n <= 85; n++) records.set(cohortPath + '/students/P' + n, { id: 'P' + n, name: 'Student P' + n });
};
const seed = (extra = {}) => {
  records.set(lecturePath('2026-09-16'), { date: '2026-09-16', startTime: '08:00', durationHours: 2, status: 'active', ...extra });
  records.set(markPath('2026-09-16'), { studentId: 'P1', studentName: 'Student P1', time: '08:05', method: 'manual', attendedMinutes: 115, markedAt: timestamp(500), markedBy: 'owner' });
};
const accepted = async ops => {
  const result = await callable(request(ops));
  assert.equal(result.failure, null); assert.deepEqual(result.acceptedOperationIds, ops.map(o => o.id)); return result;
};
const rejected = async (op, code = 'failed-precondition') => {
  const result = await callable(request([op]));
  assert.equal(result.failure?.code, code); assert.deepEqual(result.acceptedOperationIds, []);
  assert(!records.has(subjectPath + '/offlineReceipts/' + op.id)); return result;
};
return { call: callable, callable, records, reads, authChecks, operation, request, reset, seed, accepted, rejected,
  subjectPath, cohortPath, lecturePath, markPath, timestamp,
  get allowEdit() { return allowEdit; }, set allowEdit(value) { allowEdit = value; },
  get transactionHook() { return transactionHook; }, set transactionHook(value) { transactionHook = value; }
};
}

async function run() {
  const h = createHarness();
  const { callable, records, reads, authChecks, operation, request, reset, seed, accepted, rejected,
    subjectPath, cohortPath, lecturePath, markPath, timestamp } = h;
  // One offline chain, one transaction: no partial create/delete may escape.
  reset(); let a = operation(), b = operation('setTime', { expectedRevision: a.id, record: { time: '08:15', method: 'manual' } });
  let c = operation('unmark', { expectedRevision: b.id, expectedTime: '08:15' });
  await accepted([a, b, c]);
  assert(!records.has(markPath(a.date))); assert.equal(records.get(lecturePath(a.date)).markRevisions.P1, c.id);
  assert.equal(records.get(lecturePath(a.date)).hideWhenEmpty, true, 'manual removals allow an empty lecture column to disappear after synchronization');
  assert.equal(records.get(lecturePath(a.date)).status, 'active');
  const count = records.size; await accepted([a, b, c]); assert.equal(records.size, count, 'lost acknowledgements replay exactly');
  assert.equal(records.get(lecturePath(a.date)).markRevisions.P1, c.id, 'receipt replay cannot roll back a newer revision');
  let d = operation('mark', { expectedRevision: c.id, record: { time: '08:25', method: 'qr' } });
  await accepted([d]); assert.equal(records.get(markPath(a.date)).time, '08:25');
  await accepted([a, b, c]); assert.equal(records.get(lecturePath(a.date)).markRevisions.P1, d.id);
  assert(!reads.some(r => r.kind === 'query'), 'canonical correction needs no roster-wide query');

  reset(); a = operation(); b = operation('setTime', { expectedRevision: a.id, record: { time: '08:15', method: 'manual' } });
  c = operation('unmark', { expectedRevision: b.id, expectedTime: '08:15' });
  d = operation('mark', { expectedRevision: c.id, record: { time: '08:30', method: 'face' } });
  await accepted([a, b, c, d]); assert.equal(records.get(markPath(a.date)).time, '08:30');
  assert.equal(records.get(markPath(a.date)).attendedMinutes, 90);
  reset(); seed(); a = operation('unmark'); b = operation('mark', { expectedRevision: a.id, record: { time: '08:20', method: 'manual' } });
  c = operation('setTime', { expectedRevision: b.id, expectedTime: '08:20', record: { time: '08:40', method: 'manual' } });
  await accepted([a, b, c]); assert.equal(records.get(markPath(a.date)).time, '08:40', 'existing delete/recreate/edit is one valid final write');

  // A completed lecture and all unrelated student/date records stay intact.
  reset(); const completedAt = timestamp(20); seed({ status: 'completed', completedAt, endAt: timestamp(9999) });
  const other = { time: '08:10', attendedMinutes: 110 }; records.set(markPath('2026-09-16', 'P2'), other);
  records.set(markPath('2026-09-15'), { time: '09:00' });
  a = operation('setTime', { expectedMarkedAtMillis: 500, record: { time: '08:35', method: 'manual' } });
  await accepted([a]); let lecture = records.get(lecturePath(a.date));
  assert.equal(lecture.status, 'completed'); assert.equal(lecture.completedAt, completedAt);
  assert.equal(lecture.startTime, '08:00'); assert.equal(lecture.durationHours, 2); assert.equal(lecture.summaryState, 'rebuild-pending');
  assert.equal(records.get(markPath(a.date)).attendedMinutes, 85); assert.equal(records.get(markPath(a.date, 'P2')), other);
  assert.equal(records.get(markPath('2026-09-15')).time, '09:00');
  b = operation('unmark', { expectedRevision: a.id, expectedTime: '08:35' }); await accepted([b]);
  assert(!records.has(markPath(a.date))); assert.equal(records.get(lecturePath(a.date)).status, 'completed');
  assert.equal(records.get(markPath(a.date, 'P2')), other);

  // Prefix acknowledgements preserve earlier successes but never apply a
  // later record through an unresolved conflict.
  reset(); a = operation(); b = operation('setTime', { expectedRevision: a.id, expectedTime: '08:04' });
  c = operation('mark', { studentId: 'P2', studentName: 'Student P2' });
  let result = await callable(request([a, b, c])); assert.deepEqual(result.acceptedOperationIds, [a.id]);
  assert.equal(result.failure.operationId, b.id); assert(!records.has(markPath(c.date, 'P2')));
  assert.equal(records.get(markPath(a.date)).time, '08:05');
  await rejected(operation('unmark', { expectedTime: '08:05' }), 'failed-precondition');
  await rejected(operation('setTime', { expectedRevision: a.id, expectedTime: '08:04' }));
  await rejected(operation('mark'), 'failed-precondition');

  // Deletion tombstones block both new and old stale devices; only the known
  // deletion revision authorises an intentional later registration.
  b = operation('unmark', { expectedRevision: a.id }); await accepted([b]);
  await rejected(operation('mark')); await rejected(operation('mark', { protocolVersion: undefined }));
  await rejected(operation('setTime', { expectedRevision: b.id }));
  c = operation('mark', { expectedRevision: b.id }); await accepted([c]);
  await rejected(operation('unmark', { expectedRevision: a.id }), 'failed-precondition');

  // Legacy records can be corrected, but a known server revision or changed
  // legacy markedAt timestamp must never be ignored.
  reset(); seed(); await rejected(operation('unmark', { expectedMarkedAtMillis: 499 }));
  await accepted([operation('setTime', { expectedMarkedAtMillis: 500, record: { time: '08:10', method: 'manual' } })]);
  reset(); seed(); await accepted([operation('unmark')]);
  reset(); seed({ markRevisions: { P1: 'another-device-000001' } });
  await rejected(operation('unmark'));
  await rejected(operation('unmark', { expectedRevision: 'another-device-000001', expectedMarkedAtMillis: 999 }));
  await accepted([operation('unmark', { expectedRevision: 'another-device-000001', expectedMarkedAtMillis: 500 })]);

  // Old mark/close clients and their pending outboxes remain supported.
  reset(); a = operation('mark', { protocolVersion: undefined }); b = operation('mark', { protocolVersion: undefined });
  c = operation('setTime', { expectedRevision: b.id, record: { time: '08:15', method: 'manual' } });
  await accepted([a, b, c]); assert.equal(records.get(lecturePath(a.date)).markRevisions.P1, c.id);
  await accepted([a, b]); assert.equal(records.get(lecturePath(a.date)).markRevisions.P1, c.id);
  await rejected(operation('mark', { protocolVersion: undefined, record: { time: '08:30' } }), 'already-exists');
  d = operation('close', { protocolVersion: undefined }); await accepted([d]);
  assert.equal(records.get(lecturePath(a.date)).status, 'completed');

  // The extra correction permission is checked before any transaction writes.
  reset(); h.allowEdit = false; a = operation(); await accepted([a]);
  assert.equal(authChecks[0].permission, 'attendanceMark'); assert.equal(authChecks[0].options.edit, false);
  await assert.rejects(() => callable(request([operation('unmark', { expectedRevision: a.id })])), e => e.code === 'permission-denied');
  assert.equal(authChecks.at(-1).options.edit, true); assert(records.has(markPath(a.date)));
  h.allowEdit = true;
  await assert.rejects(() => callable({ ...request([operation('unmark')]), auth: { uid: 'other' } }), e => e.code === 'permission-denied');
  await assert.rejects(() => callable(request([operation('unmark', { workspaceId: 'other' })])), e => e.code === 'permission-denied');

  for (const extra of [{ lastRosterResetId: 'new' }, { attendanceClearInProgress: true }, { attendanceClearedAt: timestamp(2000) }]) {
    reset(); seed(); records.set(subjectPath, { ...records.get(subjectPath), ...extra }); await rejected(operation('unmark'));
    assert(records.has(markPath('2026-09-16')));
  }
  for (const extra of [{ status: 'cancelled' }, { startTime: '09:00' }, { durationHours: 3 }]) {
    reset(); seed(extra); await rejected(operation('setTime')); assert(records.has(markPath('2026-09-16')));
  }
  reset(); await rejected(operation('unmark'));
  reset(); seed(); h.transactionHook = () => records.set(cohortPath + '/students/P1', { id: 'P1', name: 'Different Student' });
  await rejected(operation('unmark')); assert(records.has(markPath('2026-09-16')));
  reset(); seed(); h.transactionHook = () => records.set(subjectPath, { rosterCohortId: 'private_new' }); await rejected(operation('unmark'));
  reset(); seed(); for (const record of [{ time: '07:59' }, { time: '10:00' }, { time: '25:00' }]) await rejected(operation('setTime', { record }), record.time === '25:00' ? 'invalid-argument' : 'failed-precondition');
  for (const extra of [{ protocolVersion: undefined }, { expectedRevision: undefined }, { expectedTime: null }, { expectedMarkedAtMillis: NaN }]) {
    await assert.rejects(() => callable(request([operation('unmark', extra)])), e => e.code === 'invalid-argument');
  }
  // Lost acknowledgements are valid even after a later roster reset.
  reset(); seed(); a = operation('unmark'); await accepted([a]); records.set(subjectPath, { rosterCohortId: 'private_roster', lastRosterResetId: 'new' });
  await accepted([a]); assert(!records.has(markPath(a.date)));
  console.log('PASS offline corrections server: FIFO chains, physical deletion/tombstones, re-marking, idempotent acknowledgements, prefix conflicts, timestamp/revision guards, old client compatibility, completed lecture summaries, permissions/reset/account isolation');
}
module.exports = { createHarness, run };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
