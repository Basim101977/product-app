'use strict';

// Exercise the shipped synchronizer and real IndexedDB outbox through a strictly
// region-sensitive, in-memory callable. All non-loopback network is blocked by
// the harness. No credentials, cloud requests, or actual student records.
const { assert, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const report = makeReport('sync-transport-offline-browser-regression');
let harness;

async function installWorkspace(page) {
  await page.waitForFunction(() => Boolean(window.HathirPersonal) && typeof syncOfflineAttendance === 'function' &&
    typeof offlineTransportFailureFor === 'function' && typeof wakeOfflineSync === 'function');
  await page.evaluate(async () => {
    lang = 'en'; personalFixture.verified = true; personalFixture.accountStatus = 'approved';
    fixtureAuth.currentUser = fixtureUser();
    session = { uid: personalFixture.uid, workspaceId: personalFixture.uid, email: personalFixture.email,
      displayName: 'Synthetic transport teacher', role: 'owner', active: true, local: false, offlineMode: false,
      permissions: rolePermissions('owner'), departmentIds: [], stageIds: [], subjectIds: [] };
    membersCache = [session]; departments = defaultDepartments(); stages = defaultStages();
    const students = [{ id: 'MI20250001', name: 'طالب اختبار المزامنة', faceDescriptors: [] }];
    subjects = [{ id: 'qa_sync_a', titleAr: 'مادة اختبار المزامنة', titleEn: 'Synthetic Sync Subject',
      departmentId: DEFAULT_DEPARTMENT_ID, stageId: DEFAULT_STAGE_ID, ownerUserId: session.uid, ownerUid: session.uid,
      academicYearStart: 2026, stageNumber: 2, departmentPrefix: 'MI', section: '', academicStatuses: {},
      totalHours: 60, lectureDurationHours: 2, attendanceLocked: false, lectures: [], lectureMeta: {}, excuses: {},
      attendance: {}, archivedStudents: [], attendanceSummaries: {}, students, studentCount: students.length,
      faceTemplatesLoaded: true, faceTemplateDescriptors: new Map(), rosterLoaded: true, attendanceLoaded: true,
      lectureIndexLoaded: true, lectureIndexComplete: true, summaryLoaded: true, historyPending: false,
      historyError: false, liveLoadPending: false, liveLoadError: false, offlinePreparedAt: Date.now(),
      loadedLectureDates: new Set(), loadedSummaryStudentIds: new Set(students.map(student => student.id)) }];
    activeSubjectId = subjects[0].id; compactScope = null;
    cloudDataLoading = false; sectionLoadPending = false; sectionLoadFailed = false;
    scheduleWeeklyAbsenceReview = () => {}; refreshWeeklyAbsenceReview = () => {};
    scheduleAutomaticLectureClose = () => {}; prepareOfflineSubject = async () => {};
    enableAudio = () => Promise.resolve(true); beep = () => Promise.resolve(true); vibrate = () => {};
    offlinePrepared.set(session.uid + ':' + subjects[0].id, true);
    await HathirOfflineStore.save(offlineSnapshot(subjects[0]));
    // Normal failure scenarios must remain stable while their UI is inspected.
    // The retry-specific scenario below restores a short genuine retry timer.
    offlineRetryDelay = 30000;
    window.syncFixture = { calls: [], active: 0, maxActive: 0 };
    window.handleSyncTransport = async payload => ({ acceptedOperationIds: payload.operations.map(operation => operation.id) });
    firebase.app = () => ({ functions(region) { return { httpsCallable(name, options) {
      return async payload => {
        // The optional shared-roster availability check has its own endpoint;
        // it is not a synchronization transport attempt.
        if(name==='sharedStudentRoster'&&region==='us-central1'&&payload.action==='check')return {data:{available:false,updateAvailable:false}};
        syncFixture.calls.push({ region, name, options, payload: structuredClone(payload) });
        syncFixture.active++; syncFixture.maxActive = Math.max(syncFixture.maxActive, syncFixture.active);
        try {
          if (region !== 'asia-south1') throw Object.assign(Error('Synthetic endpoint does not exist in that region'), { code: 'functions/unavailable' });
          if (name !== 'syncOfflineAttendancePreview') throw Error('Unexpected synthetic callable ' + name);
          return { data: await handleSyncTransport(payload) };
        } finally { syncFixture.active--; }
      };
    } }; } });
    window.enqueueSyncFixture = async ({ count = 1, uid = personalFixture.uid, workspaceId = uid, subjectId = 'qa_sync_a' } = {}) => {
      const ids = [], now = Date.now();
      const subject = { ...subjects[0], id: subjectId, ownerUserId: uid, ownerUid: uid };
      const snapshot = { key: HathirOfflineStore.key(uid, subjectId), uid, workspaceId,
        session: { ...session, uid, workspaceId }, departments, stages, subject: JSON.parse(JSON.stringify(subject)), savedAt: now };
      for (let index = 0; index < count; index++) {
        const operation = { id: crypto.randomUUID(), protocolVersion: 3, uid, workspaceId, subjectId,
          date: todayISO(), kind: 'mark', studentId: 'MI20250001', studentName: 'طالب اختبار المزامنة',
          record: { time: '09:05', attendedMinutes: 115, markedBy: uid, method: 'image' },
          expectedLifecycleRevision: null, expectedLifecycleStatus: null, expectedTime: null, expectedRevision: null,
          expectedMarkedAtMillis: null, meta: { status: 'active', startTime: '09:00', durationHours: 2 },
          rosterResetId: '', preparedAt: now, createdAt: now };
        await HathirOfflineStore.enqueue(snapshot, operation); ids.push(operation.id);
      }
      return ids;
    };
    window.readSyncFixture = async () => ({ calls: structuredClone(syncFixture.calls), maxActive: syncFixture.maxActive,
      operations: (await HathirOfflineStore.operations(personalFixture.uid)).sort(offlineOperationOrder),
      failure: offlineTransportFailureFor(session.uid), queueCount: offlineQueueCount,
      label: document.querySelector('#offlineStatus .offlineProgressText')?.textContent || '',
      state: document.getElementById('offlineStatus')?.dataset.state,
      value: document.getElementById('offlineStatus')?.getAttribute('aria-valuenow'),
      writes: personalFixture.writes.slice(), legacyCalls: personalFixture.calls.slice() });
    applyLanguage(); showApp(); renderAll(); buildStudentCache(); await offlineStatus();
  });
}

async function scenario(label, task) {
  await check(report, label, async () => {
    const { page, context } = await harness.page();
    try {
      await installWorkspace(page); await task(page);
      const state = await page.evaluate(() => readSyncFixture());
      assert.equal(state.writes.length, 0, 'No Firestore writes in transport fixtures');
      assert.equal(state.legacyCalls.length, 0, 'Every callable must use the region-sensitive mock');
      assert(state.calls.every(call => call.region === 'asia-south1' && call.name === 'syncOfflineAttendancePreview'));
    } finally { await context.close(); }
  });
}

(async () => {
  harness = await launch(report);

  await scenario('Shipped synchronizer uses the isolated preview asia-south1 endpoint and removes only fully acknowledged operations', async page => {
    const ids = await page.evaluate(() => enqueueSyncFixture({ count: 3 }));
    await page.evaluate(() => syncOfflineAttendance());
    const state = await page.evaluate(() => readSyncFixture());
    assert.equal(state.calls.length, 1); assert.equal(state.calls[0].region, 'asia-south1');
    assert.equal(state.calls[0].payload.workspaceId, 'qa_personal_a'); assert.equal(state.calls[0].payload.subjectId, 'qa_sync_a');
    assert.deepEqual(state.calls[0].payload.operations.map(operation => operation.id), ids);
    assert.equal(state.operations.length, 0); assert.equal(state.failure, null);
    assert.equal(state.value, '100'); assert.match(state.label, /Uploaded|No pending upload/i);
  });

  await scenario('An in-flight callable response cannot acknowledge or delete queued operations early', async page => {
    const ids = await page.evaluate(async () => {
      const ids = await enqueueSyncFixture({ count: 2 });
      handleSyncTransport = payload => new Promise(resolve => { window.releaseSyncResponse = () => resolve({ acceptedOperationIds: payload.operations.map(operation => operation.id) }); });
      window.pendingSync = syncOfflineAttendance(); return ids;
    });
    await page.waitForFunction(() => typeof releaseSyncResponse === 'function');
    assert.deepEqual((await page.evaluate(() => readSyncFixture())).operations.map(operation => operation.id), ids);
    await page.evaluate(async () => { releaseSyncResponse(); await pendingSync; });
    assert.equal((await page.evaluate(() => readSyncFixture())).operations.length, 0);
  });

  await scenario('A valid ordered prefix receipt deletes its prefix and retains the rejected operation and following records', async page => {
    const ids = await page.evaluate(async () => {
      const ids = await enqueueSyncFixture({ count: 3 });
      handleSyncTransport = async payload => ({ acceptedOperationIds: [payload.operations[0].id],
        failure: { operationId: payload.operations[1].id, code: 'failed-precondition', message: 'Synthetic review required.' } });
      await syncOfflineAttendance(); return ids;
    });
    const state = await page.evaluate(() => readSyncFixture());
    assert.equal(state.calls.length, 1); assert.deepEqual(state.operations.map(operation => operation.id), ids.slice(1));
    assert.equal(state.operations[0].error, 'Synthetic review required.'); assert(!state.operations[1].error);
    assert.equal(state.failure, null);
  });

  for (const mode of ['wrong-order', 'duplicate-ids', 'foreign-id', 'partial-without-failure', 'empty-without-failure', 'wrong-failure-id', 'full-with-empty-failure']) {
    await scenario(`Malformed ${mode} receipt preserves the entire outbox without assigning operation errors`, async page => {
      const ids = await page.evaluate(async mode => {
        const ids = await enqueueSyncFixture({ count: 2 });
        handleSyncTransport = async payload => {
          const [first, second] = payload.operations.map(operation => operation.id);
          if (mode === 'wrong-order') return { acceptedOperationIds: [second, first] };
          if (mode === 'duplicate-ids') return { acceptedOperationIds: [first, first] };
          if (mode === 'foreign-id') return { acceptedOperationIds: ['synthetic-unknown-operation'] };
          if (mode === 'partial-without-failure') return { acceptedOperationIds: [first] };
          if (mode === 'empty-without-failure') return { acceptedOperationIds: [] };
          if (mode === 'wrong-failure-id') return { acceptedOperationIds: [first], failure: { operationId: first, code: 'failed-precondition', message: 'Synthetic conflict.' } };
          return { acceptedOperationIds: [first, second], failure: {} };
        };
        await syncOfflineAttendance(); return ids;
      }, mode);
      const state = await page.evaluate(() => readSyncFixture());
      assert.deepEqual(state.operations.map(operation => operation.id), ids); assert(state.operations.every(operation => !operation.error));
      assert.equal(state.calls.length, 1); assert(state.failure); assert.match(state.failure.code, /internal/);
    });
  }

  await scenario('Transient transport failure preserves records, reports pending versus review counts, and does not display Syncing 0%', async page => {
    const ids = await page.evaluate(async () => {
      const ids = await enqueueSyncFixture({ count: 2 });
      handleSyncTransport = async () => { throw Object.assign(Error('Synthetic connection failure'), { code: 'functions/unavailable' }); };
      await syncOfflineAttendance(); return ids;
    });
    const state = await page.evaluate(() => readSyncFixture());
    assert.deepEqual(state.operations.map(operation => operation.id), ids); assert(state.operations.every(operation => !operation.error));
    assert(state.failure); assert.equal(state.failure.uid, 'qa_personal_a'); assert.equal(state.failure.workspaceId, 'qa_personal_a');
    assert.match(state.failure.code, /unavailable/); assert(Number.isFinite(state.failure.at) && state.failure.at > 0);
    assert.match(state.label, /connection|retry|unavailable|server/i); assert.doesNotMatch(state.label, /^syncing\s*0%$/i);
    await page.evaluate(() => showOfflineSyncDetails());
    const details = await page.locator('#offlineSyncDetails').innerText();
    assert.match(details, /awaiting upload:\s*2/i); assert.match(details, /requiring review:\s*0/i);
    assert.match(details, /connection|retry|unavailable|server/i);
  });

  await scenario('A successful later receipt clears upload failure without claiming verified reception', async page => {
    await page.evaluate(async () => {
      await enqueueSyncFixture();
      handleSyncTransport = async () => { throw Object.assign(Error('Synthetic timeout'), { code: 'functions/deadline-exceeded' }); };
      await syncOfflineAttendance();
    });
    assert((await page.evaluate(() => readSyncFixture())).failure);
    await page.evaluate(async () => { handleSyncTransport = async payload => ({ acceptedOperationIds: payload.operations.map(operation => operation.id) }); await syncOfflineAttendance(); });
    const state = await page.evaluate(() => readSyncFixture());
    assert.equal(state.operations.length, 0); assert.equal(state.failure, null); assert.match(state.label, /Uploaded|No pending upload/i);
  });

  await scenario('Single-flight synchronization drains new arrivals after the held response without overlapping calls', async page => {
    const firstIds = await page.evaluate(async () => {
      const ids = await enqueueSyncFixture({ count: 2 }); let first = true;
      handleSyncTransport = async payload => {
        if (first) { first = false; await new Promise(resolve => { window.releaseSyncResponse = resolve; }); }
        return { acceptedOperationIds: payload.operations.map(operation => operation.id) };
      };
      window.syncWaiters = [syncOfflineAttendance(), syncOfflineAttendance(), syncOfflineAttendance()]; return ids;
    });
    await page.waitForFunction(() => typeof releaseSyncResponse === 'function');
    const nextIds = await page.evaluate(() => enqueueSyncFixture());
    assert.equal((await page.evaluate(() => readSyncFixture())).calls.length, 1);
    await page.evaluate(async () => { releaseSyncResponse(); await Promise.all(syncWaiters); });
    const state = await page.evaluate(() => readSyncFixture());
    assert.equal(state.maxActive, 1); assert.equal(state.calls.length, 2); assert.equal(state.operations.length, 0);
    assert.deepEqual(state.calls[0].payload.operations.map(operation => operation.id), firstIds);
    assert.deepEqual(state.calls[1].payload.operations.map(operation => operation.id), nextIds);
  });

  await scenario('More than 25 operations preserve durable FIFO order across sequential batches', async page => {
    const ids = await page.evaluate(async () => { const ids = await enqueueSyncFixture({ count: 28 }); await syncOfflineAttendance(); return ids; });
    const state = await page.evaluate(() => readSyncFixture());
    assert.deepEqual(state.calls.map(call => call.payload.operations.length), [25, 3]);
    assert.deepEqual(state.calls.flatMap(call => call.payload.operations.map(operation => operation.id)), ids);
    assert.equal(state.operations.length, 0); assert.equal(state.maxActive, 1);
  });

  await scenario('A rejected subject queue does not block another subject for the same account', async page => {
    const ids = await page.evaluate(async () => {
      const bad = await enqueueSyncFixture({ count: 2 }), good = await enqueueSyncFixture({ subjectId: 'qa_sync_b' });
      handleSyncTransport = async payload => payload.subjectId === 'qa_sync_a'
        ? { acceptedOperationIds: [], failure: { operationId: payload.operations[0].id, code: 'failed-precondition', message: 'Synthetic subject conflict.' } }
        : { acceptedOperationIds: payload.operations.map(operation => operation.id) };
      await syncOfflineAttendance(); return { bad, good };
    });
    const state = await page.evaluate(() => readSyncFixture());
    assert.equal(state.calls.length, 2); assert.deepEqual(state.operations.map(operation => operation.id), ids.bad);
    assert(state.operations[0].error); assert(!state.operations[1].error);
  });

  for (const reasonMode of ['exact-message', 'structured-reason']) {
    await scenario(`Trusted missing subject via ${reasonMode} preserves records for review, stops retrying that scope and drains other subjects`, async page => {
      const expected = await page.evaluate(async reasonMode => {
        const missing = await enqueueSyncFixture({ count: 2 });
        const valid = await enqueueSyncFixture({ subjectId: 'qa_sync_live' });
        handleSyncTransport = async payload => {
          if (payload.subjectId !== 'qa_sync_a') return { acceptedOperationIds: payload.operations.map(operation => operation.id) };
          throw Object.assign(Error(reasonMode === 'exact-message' ? 'The subject no longer exists.' : 'NOT_FOUND'), {
            code: 'functions/not-found', ...(reasonMode === 'structured-reason' ? { details: { reason: 'subject-not-found' } } : {})
          });
        };
        await syncOfflineAttendance(); return { missing, valid };
      }, reasonMode);
      const first = await page.evaluate(() => readSyncFixture());
      assert.deepEqual(first.operations.map(operation => operation.id), expected.missing, 'Missing-subject operations must remain durable');
      assert(first.operations[0].error, 'First missing-subject operation must require review');
      assert.match(String(first.operations[0].errorCode), /not-found/);
      assert(!first.operations[1].error, 'Following operations must retain their original FIFO state');
      assert.equal(first.failure, null, 'Known missing subject is not a transport failure');
      assert.deepEqual(first.calls.map(call => call.payload.subjectId), ['qa_sync_a', 'qa_sync_live']);
      assert.equal(await page.evaluate(() => offlineRetryTimer), 0, 'Missing subject must not schedule endless transport retries');
      await page.evaluate(() => syncOfflineAttendance());
      const second = await page.evaluate(() => readSyncFixture());
      assert.equal(second.calls.length, first.calls.length, 'An unchanged review-blocked scope must not be resubmitted');
      assert.deepEqual(second.operations.map(operation => operation.id), expected.missing);
      await page.evaluate(() => showOfflineSyncDetails());
      const details = await page.locator('#offlineSyncDetails').innerText();
      assert.match(details, /awaiting upload:\s*2/i); assert.match(details, /requiring review:\s*1/i);
      assert.match(details, /subject[\s\S]*(?:no longer exists|missing|deleted|restor)/i);
      assert.match(details, /backup|recover|restor/i, 'Diagnostics must offer a safe recovery step');
      assert.doesNotMatch(details, /this is a connection error/i);
      assert.doesNotMatch(second.label, /connection failed|retrying/i);
    });
  }

  for (const message of ['NOT_FOUND', 'not-found', 'The subject no longer exists. Unexpected additional detail.']) {
    await scenario(`Unrecognized not-found message ${JSON.stringify(message)} stays transient and cannot mark an operation for review`, async page => {
      const ids = await page.evaluate(async message => {
        const ids = await enqueueSyncFixture({ count: 2 });
        handleSyncTransport = async () => { throw Object.assign(Error(message), { code: 'functions/not-found' }); };
        await syncOfflineAttendance(); return ids;
      }, message);
      const first = await page.evaluate(() => readSyncFixture());
      assert.deepEqual(first.operations.map(operation => operation.id), ids); assert(first.operations.every(operation => !operation.error));
      assert(first.failure); assert.equal(first.failure.code, 'not-found'); assert.equal(first.calls.length, 1);
      await page.evaluate(() => syncOfflineAttendance());
      const second = await page.evaluate(() => readSyncFixture());
      assert.equal(second.calls.length, 2, 'Unknown endpoint errors must remain retryable after deployment or connection recovery');
      assert.deepEqual(second.operations.map(operation => operation.id), ids); assert(second.operations.every(operation => !operation.error));
      await page.evaluate(() => showOfflineSyncDetails());
      const details = await page.locator('#offlineSyncDetails').innerText();
      assert.match(details, /awaiting upload:\s*2/i); assert.match(details, /requiring review:\s*0/i);
      assert.match(details, /connection|retry|service/i);
    });
  }

  await scenario('Synchronizing the signed-in teacher never submits or deletes another account outbox', async page => {
    const expected = await page.evaluate(async () => {
      const a = await enqueueSyncFixture(), b = await enqueueSyncFixture({ uid: 'qa_second_teacher', count: 2 });
      await syncOfflineAttendance(); return { a, b };
    });
    const result = await page.evaluate(async () => ({ state: await readSyncFixture(), others: await HathirOfflineStore.operations('qa_second_teacher') }));
    assert.equal(result.state.operations.length, 0); assert.equal(result.state.calls.length, 1);
    assert(result.state.calls.every(call => call.payload.operations.every(operation => operation.uid === 'qa_personal_a')));
    assert.deepEqual(result.others.sort((a, b) => a.queueOrder - b.queueOrder).map(operation => operation.id), expected.b);
  });

  await scenario('A late failure for the previous account remains invisible to the newly selected account', async page => {
    await page.evaluate(async () => {
      await enqueueSyncFixture(); await enqueueSyncFixture({ uid: 'qa_second_teacher' });
      handleSyncTransport = async () => { await new Promise(resolve => { window.releaseSyncResponse = resolve; }); throw Object.assign(Error('Synthetic late timeout'), { code: 'functions/unavailable' }); };
      window.pendingSync = syncOfflineAttendance();
    });
    await page.waitForFunction(() => typeof releaseSyncResponse === 'function');
    const result = await page.evaluate(async () => {
      session = { ...session, uid: 'qa_second_teacher', workspaceId: 'qa_second_teacher' };
      fixtureAuth.currentUser = { ...fixtureAuth.currentUser, uid: 'qa_second_teacher' };
      releaseSyncResponse(); await pendingSync;
      return { failure: offlineTransportFailureFor('qa_second_teacher'),
        a: await HathirOfflineStore.operations('qa_personal_a'), b: await HathirOfflineStore.operations('qa_second_teacher') };
    });
    assert.equal(result.failure, null); assert.equal(result.a.length, 1); assert.equal(result.b.length, 1);
    assert(!result.a[0].error && !result.b[0].error);
  });

  await scenario('Transport-failure helpers do not expose or clear a different account or workspace failure', async page => {
    const result = await page.evaluate(() => {
      recordOfflineTransportFailure(session.uid, session.workspaceId, Object.assign(Error('Synthetic unavailable'), { code: 'functions/unavailable' }));
      const owner = offlineTransportFailureFor(session.uid), other = offlineTransportFailureFor('qa_second_teacher');
      clearOfflineTransportFailure('qa_second_teacher', 'qa_second_teacher');
      const afterOtherClear = offlineTransportFailureFor(session.uid);
      clearOfflineTransportFailure(session.uid, 'wrong-workspace');
      const afterWrongWorkspaceClear = offlineTransportFailureFor(session.uid);
      clearOfflineTransportFailure(session.uid, session.workspaceId);
      return { owner, other, afterOtherClear, afterWrongWorkspaceClear, cleared: offlineTransportFailureFor(session.uid) };
    });
    assert(result.owner); assert.equal(result.other, null); assert(result.afterOtherClear); assert(result.afterWrongWorkspaceClear); assert.equal(result.cleared, null);
  });

  await scenario('The real retry timer retries a transient failure and drains the retained outbox', async page => {
    await page.evaluate(async () => {
      await enqueueSyncFixture(); offlineRetryDelay = 25; let first = true;
      handleSyncTransport = async payload => {
        if (first) { first = false; throw Object.assign(Error('Synthetic retryable timeout'), { code: 'functions/unavailable' }); }
        return { acceptedOperationIds: payload.operations.map(operation => operation.id) };
      };
      await syncOfflineAttendance();
    });
    await page.waitForFunction(() => syncFixture.calls.length === 2 && !offlineSyncBusy && !offlineSyncTask && !offlineTransportFailureFor(session.uid));
    const state = await page.evaluate(() => readSyncFixture()); assert.equal(state.operations.length, 0);
    assert.equal(state.failure, null, JSON.stringify(state)); assert.equal(state.maxActive, 1);
  });

  await scenario('A pageshow wake retries retained transport failures without waiting for the periodic timer', async page => {
    await page.evaluate(async () => {
      await enqueueSyncFixture();
      handleSyncTransport = async () => { throw Object.assign(Error('Synthetic disconnected endpoint'), { code: 'functions/unavailable' }); };
      await syncOfflineAttendance(); clearTimeout(offlineRetryTimer); offlineRetryTimer = 0;
      handleSyncTransport = async payload => ({ acceptedOperationIds: payload.operations.map(operation => operation.id) });
      window.dispatchEvent(new Event('pageshow'));
    });
    await page.waitForFunction(() => syncFixture.calls.length === 2 && !offlineSyncBusy && !offlineSyncTask);
    const state = await page.evaluate(() => readSyncFixture()); assert.equal(state.operations.length, 0); assert.equal(state.failure, null);
  });

  await scenario('A hidden-page visibility event does not sync; returning to the foreground wakes synchronization', async page => {
    await page.evaluate(async () => {
      await enqueueSyncFixture(); Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange')); await new Promise(resolve => setTimeout(resolve, 50));
    });
    assert.equal((await page.evaluate(() => readSyncFixture())).calls.length, 0);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => syncFixture.calls.length === 1 && !offlineSyncBusy && !offlineSyncTask);
    assert.equal((await page.evaluate(() => readSyncFixture())).operations.length, 0);
  });

  await scenario('An offline wake retains data until an online event makes synchronization eligible', async page => {
    await page.evaluate(async () => {
      await enqueueSyncFixture(); Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      await wakeOfflineSync();
    });
    assert.equal((await page.evaluate(() => readSyncFixture())).calls.length, 0);
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')); });
    await page.waitForFunction(() => syncFixture.calls.length === 1 && !offlineSyncBusy && !offlineSyncTask);
    assert.equal((await page.evaluate(() => readSyncFixture())).operations.length, 0);
  });

  await check(report, 'No uncaught browser errors across synthetic transport regressions', () => assert.deepEqual(report.pageErrors, []));
})().catch(error => { report.cases.push({ label: 'Browser harness execution', passed: false, error: error.stack }); })
  .finally(async () => { if (harness) await harness.close(); saveReport(report, 'sync-transport-regression'); });
