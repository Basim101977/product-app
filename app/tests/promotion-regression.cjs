'use strict';

// LOCAL ONLY: original shipped storage code -> same-origin candidate navigation.
// All accounts, records, callables and video inputs are synthetic. No credentials
// are loaded and the shared harness blocks every external network request.
const { APP, SITE, assert, fs, path, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const report = makeReport('production-promotion-local-regression');
const OLD_SITE = require('./previous-worker-fixture.cjs')(SITE);
const UID = 'qa_promotion_legacy', EMAIL = 'qa-promotion-legacy@example.invalid';
let harness;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

async function ready(page) {
  await page.waitForFunction(() => Boolean(window.HathirPersonal && window.HathirOfflineStore && window.HathirNameQR));
}

async function workspace(page) {
  await ready(page);
  await page.evaluate(({ uid, email }) => {
    personalFixture.uid = uid; personalFixture.email = email; personalFixture.verified = true;
    fixtureAuth.currentUser = fixtureUser();
    session = { uid, workspaceId: uid, email, displayName: 'مدرس ترقية اصطناعي', role: 'owner', active: true,
      local: false, offlineMode: true, permissions: rolePermissions('owner'), departmentIds: [], stageIds: [], subjectIds: [] };
    membersCache = [session]; departments = defaultDepartments(); stages = defaultStages();
    window.makePromotionSubject = (id, students = []) => ({ id, titleAr: 'مادة قديمة اصطناعية', titleEn: 'Synthetic original subject',
      ownerUserId: uid, ownerUid: uid, departmentId: DEFAULT_DEPARTMENT_ID, stageId: DEFAULT_STAGE_ID, section: '',
      rosterSchemaVersion: 1, totalHours: 60, lectureDurationHours: 2, attendanceLocked: false,
      students, archivedStudents: [], attendance: {}, excuses: {}, lectures: [], lectureMeta: {}, attendanceSummaries: {},
      studentCount: students.length, rosterLoaded: true, faceTemplatesLoaded: true, faceTemplateDescriptors: new Map(),
      attendanceLoaded: true, lectureIndexLoaded: true, lectureIndexComplete: true, summaryLoaded: true,
      historyPending: false, historyError: false, liveLoadPending: false, liveLoadError: false,
      offlinePreparedAt: Date.now(), loadedLectureDates: new Set(), loadedSummaryStudentIds: new Set(students.map(row => row.id)) });
    subjects = [makePromotionSubject('qa_original_subject', [
      { id: 'OLD-0007', name: 'فاطمة عبد الله أحمد', faceDescriptors: [] },
      { id: 'OLD-0088', name: 'سارة محمد علي', faceDescriptors: [] }
    ])];
    activeSubjectId = subjects[0].id; compactScope = null;
    cloudDataLoading = false; sectionLoadPending = false; sectionLoadFailed = false;
    window.promotionFeedback = [];
    beep = value => { promotionFeedback.push(value); return Promise.resolve(true); };
    enableAudio = () => Promise.resolve(true); vibrate = () => {};
    scheduleWeeklyAbsenceReview = () => {}; scheduleAutomaticLectureClose = () => {};
    prepareOfflineSubject = async () => {}; syncOfflineAttendance = async () => {};
    applyLanguage(); showApp(); renderAll(); buildStudentCache();
  }, { uid: UID, email: EMAIL });
}

async function scenario(label, task, prepare = workspace) {
  await check(report, label, async () => {
    const { page, context } = await harness.page({ fixture: { uid: UID, email: EMAIL } });
    try { await prepare(page); await task(page, context); }
    finally { await context.close(); }
  });
}

async function noWrites(page) {
  const state = await page.evaluate(() => ({ writes: personalFixture.writes, calls: personalFixture.calls }));
  assert.deepEqual(state.writes, []); assert.deepEqual(state.calls, []);
}

async function noAttendance(page) {
  const state = await page.evaluate(async () => ({ operations: await HathirOfflineStore.operations(session.uid),
    success: promotionFeedback.includes('ok'), anyMark: subjects.some(subject => Object.values(subject.attendance).some(marks => Object.keys(marks).length)) }));
  assert.deepEqual(state, { operations: [], success: false, anyMark: false });
  await noWrites(page);
}

async function prepareLegacyScope(page, resultMode = 'success') {
  return page.evaluate(async resultMode => {
    const subject = subjects[0], date = '2026-09-19';
    // Scope setup is an online management action; prepared attendance remains
    // available offline, but canManageStudents intentionally gates this control.
    session.offlineMode = false;
    subject.rosterCohortId = 'private_' + 'b'.repeat(40); subject.rosterSource = 'cohort';
    subject.attendance[date] = { 'OLD-0007': { time: '08:10', method: 'scan', studentName: 'فاطمة عبد الله أحمد' } };
    subject.lectures = [date]; subject.lectureMeta[date] = { status: 'completed', startTime: '08:00', durationHours: 2, lifecycleRevision: 'qa-preserved-history' };
    subject.excuses[date] = { 'OLD-0088': { reason: 'عذر اصطناعي' } };
    window.promotionScopeFacts = () => ({ subjectId: subject.id, students: structuredClone(subject.students),
      attendance: structuredClone(subject.attendance), lectures: structuredClone(subject.lectures), lectureMeta: structuredClone(subject.lectureMeta),
      excuses: structuredClone(subject.excuses), archivedStudents: structuredClone(subject.archivedStudents), cohortId: cohortIdForSubject(subject) });
    const before = promotionScopeFacts();
    await HathirOfflineStore.enqueue(offlineSnapshot(subject), { id: 'qa-preserved-scope-outbox', protocolVersion: 3,
      uid: session.uid, workspaceId: session.workspaceId, subjectId: subject.id, studentId: 'OLD-0007', date, kind: 'mark',
      record: { ...subject.attendance[date]['OLD-0007'] }, meta: { ...subject.lectureMeta[date] }, preparedAt: subject.offlinePreparedAt,
      rosterResetId: '', createdAt: subject.offlinePreparedAt });
    window.promotionScopeConfirms = [];
    window.confirm = message => { promotionScopeConfirms.push(message); return resultMode !== 'cancel'; };
    window.fixtureInvoke = async (name, data) => {
      personalFixture.calls.push({ name, data: structuredClone(data) });
      if (name !== 'configureLegacySubjectScope') throw Error('Unexpected legacy setup callable: ' + name);
      if (resultMode === 'hold') await new Promise(resolve => { window.releasePromotionScope = resolve; });
      return { configured: resultMode !== 'not-confirmed', academicYearStart: resultMode === 'wrong-year' ? 2025 : data.academicYearStart,
        stageNumber: resultMode === 'wrong-stage' ? 3 : data.stageNumber, departmentPrefix: 'MD',
        cohortId: resultMode === 'wrong-pointer' ? 'personal_2026_medical_devices_2' : subject.rosterCohortId };
    };
    renderSubjectSelect(); document.getElementById('teachingSetupModal').hidden = false;
    return { before, pending: await HathirOfflineStore.operations(session.uid), snapshot: await HathirOfflineStore.subject(session.uid, subject.id),
      yearFields: document.querySelectorAll('#personalAcademicYear,#legacyImportStageNumber,#configureLegacyImportBtn').length };
  }, resultMode);
}

async function preservedLegacyScope(page, initial) {
  const after = await page.evaluate(async () => ({ facts: promotionScopeFacts(), pending: await HathirOfflineStore.operations(personalFixture.uid),
    snapshot: await HathirOfflineStore.subject(personalFixture.uid, 'qa_original_subject') }));
  assert.deepEqual(after.facts, initial.before); assert.deepEqual(after.pending, initial.pending); assert.deepEqual(after.snapshot, initial.snapshot);
}

(async () => {
  await check(report, 'The original installed PWA identity, start URL and scope survive promotion', () => {
    const old = readJson(path.join(OLD_SITE, 'manifest.webmanifest')), current = readJson(path.join(SITE, 'manifest.webmanifest'));
    assert.equal(old.id, '/');
    for (const field of ['id', 'start_url', 'scope']) assert.equal(current[field], old[field], field);
  });
  harness = await launch(report, {legacyCloud:true});

  await scenario('Original shipped IndexedDB outbox and snapshots survive same-origin navigation into the upgrade unchanged', async (page, context) => {
    await context.route(harness.origin + '/__promotion-old.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic old storage</title>' }));
    await page.goto(harness.origin + '/__promotion-old.html');
    await page.addScriptTag({ content: fs.readFileSync(path.join(OLD_SITE, 'offline-store.js'), 'utf8') });
    const seeded = await page.evaluate(async ({ uid, email }) => {
      const date = '2026-09-20', preparedAt = 1789900000000;
      const student = { id: 'OLD-0007', name: 'فاطمة عبد الله أحمد', faceDescriptors: [] };
      const snapshot = { key: HathirOfflineStore.key(uid, 'qa_original_subject'), uid, workspaceId: uid,
        session: { uid, workspaceId: uid, email, displayName: 'Original synthetic teacher', role: 'owner', active: true, local: false,
          permissions: {}, departmentIds: [], stageIds: [], subjectIds: [] }, departments: [], stages: [], savedAt: preparedAt,
        subject: { id: 'qa_original_subject', titleAr: 'مادة قديمة', titleEn: 'Original subject', ownerUserId: uid,
          departmentId: 'medical_devices', stageId: 'medical_devices_1', section: '', rosterSchemaVersion: 1,
          students: [student], archivedStudents: [], attendance: { [date]: { 'OLD-0007': { time: '08:05', method: 'scan', studentName: student.name } } },
          lectures: [date], lectureMeta: { [date]: { status: 'completed', startTime: '08:00', durationHours: 2 } },
          excuses: {}, attendanceSummaries: {}, rosterLoaded: true, attendanceLoaded: true, faceTemplatesLoaded: true,
          totalHours: 60, lectureDurationHours: 2, offlinePreparedAt: preparedAt, attendanceServerReadAt: preparedAt } };
      const base = { uid, workspaceId: uid, subjectId: snapshot.subject.id, studentId: student.id, date,
        preparedAt, rosterResetId: '', studentName: student.name, protocolVersion: 3,
        expectedLifecycleRevision: null, expectedLifecycleStatus: null, expectedMarkedAtMillis: null,
        meta: { status: 'completed', startTime: '08:00', durationHours: 2 } };
      for (const [index, kind, time] of [[0, 'mark', '08:00'], [1, 'setTime', '08:05']]) {
        snapshot.subject.lectureMeta[date].markRevisions = { [student.id]: 'qa-original-outbox-' + index };
        await HathirOfflineStore.enqueue(snapshot, { ...base, id: 'qa-original-outbox-' + index, kind, createdAt: preparedAt + index,
          record: { time, method: 'scan', studentName: student.name }, expectedTime: index ? '08:00' : null,
          expectedRevision: index ? 'qa-original-outbox-0' : null });
      }
      const otherUid = 'qa_promotion_other';
      const other = { ...snapshot, uid: otherUid, workspaceId: otherUid, key: HathirOfflineStore.key(otherUid, snapshot.subject.id),
        session: { ...snapshot.session, uid: otherUid, workspaceId: otherUid } };
      await HathirOfflineStore.enqueue(other, { ...base, uid: otherUid, workspaceId: otherUid, id: 'qa-other-outbox', kind: 'mark', createdAt: preparedAt });
      const local = JSON.stringify({ users: { old_local: { name: 'Local legacy teacher' } }, subjects: { original: { students: [student] } }, untouchedMarker: 'preserve-exact-bytes' });
      localStorage.setItem('student_qr_attendance_admin_local_v1', local);
      return { operations: await HathirOfflineStore.operations(uid), snapshots: await HathirOfflineStore.subjects(uid),
        otherOperations: await HathirOfflineStore.operations(otherUid), local };
    }, { uid: UID, email: EMAIL });
    await page.goto(harness.origin); await ready(page);
    const upgraded = await page.evaluate(async uid => ({ operations: await HathirOfflineStore.operations(uid),
      snapshots: await HathirOfflineStore.subjects(uid), otherOperations: await HathirOfflineStore.operations('qa_promotion_other'),
      local: localStorage.getItem('student_qr_attendance_admin_local_v1'), databases: await indexedDB.databases() }), UID);
    for (const field of ['operations', 'snapshots', 'otherOperations', 'local']) assert.deepEqual(upgraded[field], seeded[field], field);
    assert.deepEqual(upgraded.databases.filter(db => db.name.startsWith('hathir-offline')).map(db => ({ name: db.name, version: db.version })), [{ name: 'hathir-offline-v1', version: 1 }]);
    await noWrites(page);
    const restored = await page.evaluate(async ({ uid, email }) => {
      personalFixture.uid = uid; personalFixture.email = email; fixtureAuth.currentUser = fixtureUser();
      scheduleWeeklyAbsenceReview = () => {}; scheduleAutomaticLectureClose = () => {}; prepareOfflineSubject = async () => {};
      syncOfflineAttendance = async () => {};
      const ok = await restoreOfflineSession(fixtureAuth.currentUser);
      return { ok, uid: session?.uid, workspaceId: session?.workspaceId, offline: session?.offlineMode,
        ids: subjects[0].students.map(student => student.id), operations: await HathirOfflineStore.operations(uid),
        localLoginAllowed: loadLocalSession() };
    }, { uid: UID, email: EMAIL });
    assert.equal(restored.ok, true); assert.equal(restored.uid, UID); assert.equal(restored.workspaceId, UID); assert.equal(restored.offline, true);
    assert.deepEqual(restored.ids, ['OLD-0007']); assert.deepEqual(restored.operations, seeded.operations); assert.equal(restored.localLoginAllowed, false);
    await noWrites(page);
    // Acknowledgement itself is tested locally, never fabricated as server success.
    const retained = await page.evaluate(async uid => {
      await HathirOfflineStore.acknowledgeMany(['qa-original-outbox-0']);
      return { own: (await HathirOfflineStore.operations(uid)).map(op => op.id), other: (await HathirOfflineStore.operations('qa_promotion_other')).map(op => op.id) };
    }, UID);
    assert.deepEqual(retained, { own: ['qa-original-outbox-1'], other: ['qa-other-outbox'] });
  }, ready);

  await scenario('An obsolete ID QR is rejected without queuing attendance or renumbering students', async page => {
    assert.equal(await page.evaluate(() => processNameQr('OLD-0007', 'scan')), false);
    const state = await page.evaluate(async () => ({ ids: subjects[0].students.map(row => row.id), operations: await HathirOfflineStore.operations(session.uid) }));
    assert.deepEqual(state.ids, ['OLD-0007', 'OLD-0088']); assert.equal(state.operations.length, 0);
    await noWrites(page);
  });

  for (const kind of ['same-roster', 'selected-sections', 'partial-roster', 'changed-scope']) {
    await scenario(`Original ID QR fails closed for ${kind}`, async page => {
      const result = await page.evaluate(async kind => {
        let scope = captureNameQrScope();
        if (kind === 'same-roster') subjects[0].students.push({ id: 'OLD-0007', name: 'طالب آخر' });
        if (kind === 'selected-sections') {
          subjects[0].section = 'A';
          subjects.push(makePromotionSubject('qa_second_original', [{ id: 'OLD-0007', name: 'طالب آخر' }])); subjects[1].section = 'B';
          compactScope = { departmentId: DEFAULT_DEPARTMENT_ID, stageId: DEFAULT_STAGE_ID, section: 'A', sections: ['A', 'B'] };
          scope = captureNameQrScope();
        }
        if (kind === 'partial-roster') subjects[0].rosterLoaded = false;
        if (kind === 'changed-scope') session = { ...session };
        return processNameQr('OLD-0007', 'scan', scope);
      }, kind);
      assert.equal(result, false); await noAttendance(page);
    });
  }

  await scenario('Malformed compact/name protocol values cannot fall back to a coincident legacy ID', async page => {
    const result = await page.evaluate(async () => {
      const values = ['H2:BAD', 'HATHIR-NAME:1:%ZZ', 'HATHIR-NAME:2:UNKNOWN', 'UNKNOWN-999'];
      subjects[0].students.push(...values.slice(0, 3).map(id => ({ id, name: 'اسم اصطناعي مختلف' })));
      return Promise.all(values.map(value => processNameQr(value, 'image')));
    });
    assert.deepEqual(result, [false, false, false, false]); await noAttendance(page);
  });

  await scenario('New compact-name QR resolves the original immutable ID without migrating its old roster', async page => {
    assert.equal(await page.evaluate(() => processNameQr(HathirNameQR.encode('فاطمه عبدالله احمد'), 'image')), true);
    assert.deepEqual(await page.evaluate(async () => (await HathirOfflineStore.operations(session.uid)).map(op => op.studentId)), ['OLD-0007']);
    await noWrites(page);
  });

  for (const source of ['cohort', 'cohort-orphan-children', 'private-pointer', 'subcollection', 'embedded', 'authoritative-empty', 'cleared-attendance', 'roster-reset']) {
    await scenario(`Original ${source} roster is read in place with no ID changes or migration writes`, async page => {
      const state = await page.evaluate(async source => {
        const subject = subjects[0], base = 'attendanceWorkspaces/' + session.uid;
        session.offlineMode = false; subject.rosterLoaded = false; subject.students = [];
        const rows = [{ id: 'OLD-0007', name: 'فاطمة عبد الله أحمد' }, { id: 'OLD-0088', name: 'سارة محمد علي' }];
        if (source === 'private-pointer') subject.rosterCohortId = 'private_' + 'a'.repeat(40);
        if (source === 'cleared-attendance') subject.attendanceClearedAtMillis = Date.now();
        if (source === 'roster-reset') subject.lastRosterResetId = 'qa-original-reset';
        const cohortId = cohortIdForSubject(subject), cohort = base + '/cohorts/' + cohortId, original = base + '/subjects/' + subject.id;
        personalFixture.records[original] = { id: subject.id, ...(subject.rosterCohortId ? { rosterCohortId: subject.rosterCohortId } : {}),
          ...(subject.lastRosterResetId ? { lastRosterResetId: subject.lastRosterResetId } : {}), students: rows };
        if (source === 'cohort' || source === 'private-pointer' || source === 'authoritative-empty') personalFixture.records[cohort] = { rosterVersion: 1 };
        if (['cohort', 'cohort-orphan-children', 'private-pointer'].includes(source)) rows.forEach((row, index) => { personalFixture.records[cohort + '/students/saved_doc_' + index] = row; });
        if (source === 'subcollection') rows.forEach((row, index) => { personalFixture.records[original + '/students/saved_doc_' + index] = row; });
        const before = JSON.stringify(personalFixture.records);
        await ensureSubjectRosterLoaded(subject);
        return { cohortId, source: subject.rosterSource, ids: subject.students.map(row => row.id),
          loaded: subject.rosterLoaded, reads: personalFixture.reads, recordsUnchanged: before === JSON.stringify(personalFixture.records),
          documentIds: subject._rosterDocumentIds };
      }, source);
      assert.equal(state.loaded, true); assert(state.recordsUnchanged);
      assert.deepEqual(state.ids.slice().sort(), ['authoritative-empty', 'roster-reset'].includes(source) ? [] : ['OLD-0007', 'OLD-0088']);
      assert.equal(state.source, ['private-pointer', 'authoritative-empty', 'cohort-orphan-children'].includes(source) ? 'cohort'
        : ['cleared-attendance', 'roster-reset'].includes(source) ? 'embedded' : source);
      if (source === 'private-pointer') assert.equal(state.cohortId, 'private_' + 'a'.repeat(40));
      else assert(state.cohortId.startsWith('cohort_'));
      if (['cohort', 'cohort-orphan-children', 'private-pointer', 'subcollection'].includes(source)) assert.equal(state.documentIds['OLD-0007'], 'saved_doc_0');
      if (source === 'authoritative-empty') assert(!state.reads.some(value => value.includes('/subjects/')));
      await noWrites(page);
    });
  }

  await scenario('Two old subject-local rosters in the same department/stage never merge during load', async page => {
    const state = await page.evaluate(async () => {
      session.offlineMode = false;
      subjects = [makePromotionSubject('qa_local_a'), makePromotionSubject('qa_local_b')]; activeSubjectId = subjects[0].id;
      for (const [index, subject] of subjects.entries()) {
        subject.rosterLoaded = false;
        personalFixture.records[`attendanceWorkspaces/${session.uid}/subjects/${subject.id}`] = { id: subject.id,
          students: [{ id: index ? 'OLD-0088' : 'OLD-0007', name: index ? 'سارة محمد علي' : 'فاطمة عبد الله أحمد' }] };
      }
      await ensureSubjectRosterLoaded(subjects[0]); await ensureSubjectRosterLoaded(subjects[1]); syncSharedRostersInMemory();
      return subjects.map(subject => ({ id: subject.id, ids: subject.students.map(row => row.id), source: subject.rosterSource }));
    });
    assert.deepEqual(state, [{ id: 'qa_local_a', ids: ['OLD-0007'], source: 'embedded' }, { id: 'qa_local_b', ids: ['OLD-0088'], source: 'embedded' }]);
    await noWrites(page);
  });

  await scenario('Duplicate saved roster IDs are rejected before a complete-roster claim', async page => {
    const state = await page.evaluate(async () => {
      session.offlineMode = false; const subject = subjects[0]; subject.students = []; subject.rosterLoaded = false;
      const base = `attendanceWorkspaces/${session.uid}/cohorts/${cohortIdForSubject(subject)}/students/`;
      personalFixture.records[base + 'a'] = { id: 'OLD-0007', name: 'فاطمة عبد الله أحمد' };
      personalFixture.records[base + 'b'] = { id: 'OLD-0007', name: 'سارة محمد علي' };
      let failed = false; try { await ensureSubjectRosterLoaded(subject); } catch { failed = true; }
      return { failed, loaded: subject.rosterLoaded, ids: subject.students.map(row => row.id) };
    });
    assert.deepEqual(state, { failed: true, loaded: false, ids: [] }); await noWrites(page);
  });

  await scenario('Opening an existing department preserves its issued prefix and does not seed replacement organization records', async page => {
    const state = await page.evaluate(async () => {
      const base = 'attendanceWorkspaces/' + session.uid;
      personalFixture.records[base + '/departments/medical_devices'] = { id: 'medical_devices', nameAr: 'تقنيات الأجهزة الطبية', nameEn: 'Legacy department', codePrefix: 'MD' };
      personalFixture.records[base + '/stages/medical_devices_1'] = { id: 'medical_devices_1', departmentId: 'medical_devices', nameAr: 'المرحلة الأولى', sort: 1 };
      await loadCloudOrganization();
      return { prefix: departments.find(row => row.id === 'medical_devices')?.codePrefix, ids: subjects[0].students.map(row => row.id) };
    });
    assert.equal(state.prefix, 'MD'); assert.deepEqual(state.ids, ['OLD-0007', 'OLD-0088']); await noWrites(page);
  });

  for (const source of ['subcollection', 'embedded']) {
    await scenario(`Editing one original ${source} student targets only its original source and ID`, async page => {
      const state = await page.evaluate(async source => {
        session.offlineMode = false; const subject = subjects[0]; subject.students = []; subject.rosterLoaded = false;
        const root = `attendanceWorkspaces/${session.uid}/subjects/${subject.id}`;
        const rows = [{ id: 'OLD-0007', name: 'فاطمة عبد الله أحمد' }, { id: 'OLD-0088', name: 'سارة محمد علي' }];
        personalFixture.records[root] = { id: subject.id, students: rows };
        if (source === 'subcollection') rows.forEach((row, index) => { personalFixture.records[root + '/students/original_doc_' + index] = row; });
        await ensureSubjectRosterLoaded(subject);
        window.fixtureInvoke = async (name, data) => {
          personalFixture.calls.push({ name, data: structuredClone(data) });
          if (name !== 'updateLegacyEmbeddedRoster') throw Error('Unexpected source-edit callable');
          return { updated: data.updates.length };
        };
        const changed = subject.students.map(row => row.id === 'OLD-0007' ? { ...row, name: 'فاطمة عبد الله علي' } : row);
        await persistCohortRoster(subject, changed);
        return { calls: personalFixture.calls, writes: personalFixture.writes, originalRoot: root,
          ids: changed.map(row => row.id).sort(), other: personalFixture.records[root + '/students/original_doc_1'] || null };
      }, source);
      assert.deepEqual(state.ids, ['OLD-0007', 'OLD-0088']);
      if (source === 'embedded') {
        assert.deepEqual(state.writes, []); assert.equal(state.calls.length, 1);
        assert.equal(state.calls[0].name, 'updateLegacyEmbeddedRoster');
        assert.equal(state.calls[0].data.workspaceId, UID); assert.equal(state.calls[0].data.subjectId, 'qa_original_subject');
        assert.deepEqual(state.calls[0].data.removedIds, []);
        assert.deepEqual(state.calls[0].data.updates.map(row => ({ studentId: row.studentId, name: row.name })), [{ studentId: 'OLD-0007', name: 'فاطمة عبد الله علي' }]);
        assert(!Object.hasOwn(state.calls[0].data, 'students'), 'Never submit a replacement full embedded array');
      } else {
        assert.deepEqual(state.calls, []); assert.equal(state.writes.length, 1);
        assert.equal(state.writes[0].path, state.originalRoot + '/students/original_doc_0');
        assert.equal(state.writes[0].value.name, 'فاطمة عبد الله علي');
        assert(!Object.hasOwn(state.writes[0].value, 'id')); assert(!Object.hasOwn(state.writes[0].value, 'faceDescriptors'));
        assert.deepEqual(state.other, { id: 'OLD-0088', name: 'سارة محمد علي' });
      }
    });
  }

  await scenario('Retiring legacy year fields preserves old roster, attendance and pending operations', async page => {
    const initial=await prepareLegacyScope(page);
    assert.equal(initial.yearFields,0);
    await preservedLegacyScope(page,initial);await noWrites(page);
  });

  for (const test of [
    { label: 'grandfathered approved unverified account', status: 'approved', verified: false, required: false, allowed: true },
    { label: 'new approved unverified account', status: 'approved', verified: false, required: true, allowed: false },
    { label: 'unverified account without explicit server exemption', status: 'approved', verified: false, allowed: false },
    { label: 'formerly approved but now rejected account', status: 'rejected', verified: false, required: false, allowed: false },
    { label: 'pending account even with an exemption flag', status: 'pending', verified: false, required: false, allowed: false },
    { label: 'new verified approved account', status: 'approved', verified: true, required: true, allowed: true }
  ]) {
    await scenario(`Server status gates ${test.label}`, async page => {
      const state = await page.evaluate(async test => {
        personalFixture.verified = test.verified; fixtureAuth.currentUser = fixtureUser();
        // A forged cached flag must not override the callable's current status.
        localStorage.setItem('attendanceLegacyAccess', JSON.stringify({ uid: personalFixture.uid, emailVerificationRequired: false, approvedAtCutover: true }));
        loadCloudData = async () => {}; hydrateActiveSubjectAttendance = async () => {};
        window.fixtureInvoke = async (name, data) => {
          personalFixture.calls.push({ name, data: structuredClone(data) });
          if (name === 'getPersonalAccountStatus') return { status: test.status, emailVerified: test.verified, isPlatformOwner: false,
            ...(test.required === undefined ? {} : { emailVerificationRequired: test.required }), fullName: 'مدرس ترقية اصطناعي' };
          if (name === 'openIndividualWorkspace') {
            personalFixture.records['attendanceUserWorkspaces/' + personalFixture.uid] = { uid: personalFixture.uid, workspaceId: personalFixture.uid, active: true };
            return { workspaceId: personalFixture.uid };
          }
          throw Error('Unexpected promotion callable: ' + name);
        };
        const allowed = await initializeCloudSession(fixtureAuth.currentUser);
        return { allowed, appVisible: !document.getElementById('appPage').hidden, sessionUid: session?.uid || '',
          names: personalFixture.calls.map(call => call.name), writes: personalFixture.writes,
          authCalls: personalFixture.authCalls, reads: personalFixture.reads };
      }, test);
      assert.equal(state.allowed, test.allowed); assert.equal(state.appVisible, test.allowed);
      assert.equal(state.sessionUid, test.allowed ? UID : '');
      assert.deepEqual(state.names, test.allowed ? ['getPersonalAccountStatus', 'openIndividualWorkspace'] : ['getPersonalAccountStatus']);
      assert.deepEqual(state.writes, []); assert.deepEqual(state.authCalls, []);
      if (!test.allowed) assert.deepEqual(state.reads, []);
    }, ready);
  }

  for (const authorized of [true, false]) {
    await scenario(`Unverified pinned-owner controls ${authorized ? 'require the current server owner exemption' : 'reject a forged cached owner exemption'}`, async page => {
      const state = await page.evaluate(async authorized => {
        // This is the in-memory mock identity, never a sign-in to the real owner.
        personalFixture.uid = HATHIR_RUNTIME_CONFIG.ownerUid; personalFixture.email = HATHIR_RUNTIME_CONFIG.ownerEmail;
        personalFixture.verified = false; fixtureAuth.currentUser = fixtureUser();
        session = { uid: personalFixture.uid, workspaceId: personalFixture.uid, local: false };
        localStorage.setItem('attendanceLegacyAccess', JSON.stringify({ isPlatformOwner: true, approvedAtCutover: true, emailVerificationRequired: false }));
        const before = canManageRegistration();
        loadCloudData = async () => {}; hydrateActiveSubjectAttendance = async () => {};
        window.fixtureInvoke = async (name, data) => {
          personalFixture.calls.push({ name, data: structuredClone(data) });
          if (name === 'getPersonalAccountStatus') return { status: authorized ? 'unregistered' : 'approved', emailVerified: false,
            isPlatformOwner: authorized, emailVerificationRequired: false, fullName: 'مالك اصطناعي محلي' };
          if (name === 'openIndividualWorkspace') {
            personalFixture.records['attendanceUserWorkspaces/' + personalFixture.uid] = { uid: personalFixture.uid, workspaceId: personalFixture.uid, active: true };
            return { workspaceId: personalFixture.uid };
          }
          if (name === 'listPersonalRegistrations') return { requests: [] };
          throw Error('Unexpected local owner callable: ' + name);
        };
        await initializeCloudSession(fixtureAuth.currentUser);
        const after = canManageRegistration();
        fixtureAuth.currentUser = { ...fixtureAuth.currentUser, uid: 'qa_promotion_different' };
        return { before, after, afterAccountChange: canManageRegistration(), writes: personalFixture.writes, authCalls: personalFixture.authCalls };
      }, authorized);
      assert.equal(state.before, false); assert.equal(state.after, authorized); assert.equal(state.afterAccountChange, false);
      assert.deepEqual(state.writes, []); assert.deepEqual(state.authCalls, []);
    }, ready);
  }

  await check(report, 'No uncaught browser errors across synthetic promotion checks', () => assert.deepEqual(report.pageErrors, []));
})().catch(error => { report.cases.push({ label: 'Promotion harness execution', passed: false, error: error.stack }); })
  .finally(async () => { if (harness) await harness.close(); saveReport(report, 'promotion-regression'); });
