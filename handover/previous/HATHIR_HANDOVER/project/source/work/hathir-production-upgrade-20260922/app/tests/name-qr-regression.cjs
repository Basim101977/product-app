'use strict';

// Browser tests use only synthetic students, the loopback-only Firebase mock,
// and a fresh private browser context per case. No cloud calls or credentials.
const { APP, REPORTS, assert, fs, path, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const report = makeReport('name-qr-offline-browser-regression');
let harness;
const vendorRoot = path.resolve(APP, '../../hathir-staging-20260921/source-export/Hathir-Test/netlify_site/assets/vendor');
const qrLibrary = process.env.NAME_QR_GENERATOR_JS || path.join(APP, 'netlify_site/vendor/qrcode-generator-1.4.4.js');
const decoderLibrary = process.env.NAME_QR_DECODER_JS || path.join(APP, 'netlify_site/vendor/jsQR-1.4.0.min.js');

async function installWorkspace(page) {
  await page.waitForFunction(() => Boolean(window.HathirPersonal && window.HathirNameQR) && typeof processNameQr === 'function');
  await page.evaluate(async () => {
    lang = 'ar'; personalFixture.verified = true; personalFixture.accountStatus = 'approved';
    fixtureAuth.currentUser = fixtureUser();
    session = { uid: personalFixture.uid, workspaceId: personalFixture.uid, email: personalFixture.email,
      displayName: 'مدرس اختبار محلي', role: 'owner', active: true, local: false, offlineMode: true,
      permissions: rolePermissions('owner'), departmentIds: [], stageIds: [], subjectIds: [] };
    membersCache = [session]; departments = defaultDepartments(); stages = defaultStages();
    const makeSubject = (id, title, students) => ({ id, titleAr: title, titleEn: title,
      departmentId: DEFAULT_DEPARTMENT_ID, stageId: DEFAULT_STAGE_ID, ownerUserId: session.uid, ownerUid: session.uid,
      academicYearStart: 2026, stageNumber: 2, departmentPrefix: 'MI', section: '', academicStatuses: {},
      totalHours: 60, lectureDurationHours: 2, attendanceLocked: false, lectures: [], lectureMeta: {}, excuses: {},
      attendance: {}, archivedStudents: [], attendanceSummaries: {}, students, studentCount: students.length,
      faceTemplatesLoaded: true, faceTemplateDescriptors: new Map(), rosterLoaded: true, attendanceLoaded: true,
      lectureIndexLoaded: true, lectureIndexComplete: true, summaryLoaded: true, historyPending: false,
      historyError: false, liveLoadPending: false, liveLoadError: false, offlinePreparedAt: Date.now(),
      loadedLectureDates: new Set(), loadedSummaryStudentIds: new Set(students.map(student => student.id)) });
    subjects = [
      makeSubject('qa_name_a', 'مادة الأسماء الأولى', [
        { id: 'MI20250001', name: 'فاطمه عبدالله احمد', faceDescriptors: [] },
        { id: 'MI20250002', name: 'سارة محمد علي', faceDescriptors: [] }
      ]),
      makeSubject('qa_name_b', 'مادة الأسماء الثانية', [
        { id: 'MI20250099', name: 'فاطمة عبد الله أحمد', faceDescriptors: [] }
      ])
    ];
    activeSubjectId = subjects[0].id; compactScope = null;
    cloudDataLoading = false; sectionLoadPending = false; sectionLoadFailed = false;
    window.nameQrFeedback = [];
    beep = type => { nameQrFeedback.push(type); return Promise.resolve(true); };
    enableAudio = () => Promise.resolve(true); vibrate = () => {};
    scheduleWeeklyAbsenceReview = () => {}; scheduleAutomaticLectureClose = () => {};
    prepareOfflineSubject = async () => {}; syncOfflineAttendance = async () => {};
    for (const subject of subjects) {
      offlinePrepared.set(session.uid + ':' + subject.id, true);
      await HathirOfflineStore.save(offlineSnapshot(subject));
    }
    applyLanguage(); showApp(); renderAll(); buildStudentCache();
    // Construct the shipped v1 wire format explicitly; encode() now emits v2.
    window.legacyNameQrPayload = name => 'HATHIR-NAME:1:' + encodeURIComponent(HathirNameQR.normalizeName(name));
  });
}

async function currentState(page) {
  return page.evaluate(async () => ({
    operations: await HathirOfflineStore.operations(personalFixture.uid),
    attendance: subjects.map(subject => ({ id: subject.id, attendance: subject.attendance })),
    feedback: nameQrFeedback.slice(), mockWrites: personalFixture.writes.slice(), mockCalls: personalFixture.calls.slice()
  }));
}

async function rejectWithoutMark(page, expression, message) {
  const result = await page.evaluate(expression);
  assert.equal(result, false, message);
  const state = await currentState(page);
  assert.equal(state.operations.length, 0, message + ': must not enqueue attendance');
  assert(state.attendance.every(subject => Object.values(subject.attendance).every(marks => Object.keys(marks).length === 0)), message + ': no memory mark');
  assert(!state.feedback.includes('ok'), message + ': no success feedback');
}

async function scenario(label, task, options) {
  await check(report, label, async () => {
    const { page, context } = await harness.page(options);
    try {
      await installWorkspace(page);
      await task(page, context);
      const state = await currentState(page);
      assert.equal(state.mockWrites.length, 0, 'No Firestore writes may be attempted by these QR tests');
      assert.equal(state.mockCalls.length, 0, 'No cloud callable may be attempted by these QR tests');
    } finally { await context.close(); }
  });
}

async function installQrLibraries(page) {
  assert(fs.existsSync(qrLibrary), 'Cached generator missing; set NAME_QR_GENERATOR_JS to a local file.');
  assert(fs.existsSync(decoderLibrary), 'Cached decoder missing; set NAME_QR_DECODER_JS to a local file.');
  await page.addScriptTag({ content: fs.readFileSync(qrLibrary, 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(decoderLibrary, 'utf8') });
  await page.evaluate(() => {
    window.nameQrRasterFacts = (canvas, moduleCount) => {
      const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let mixedPixels = 0, minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
      for (let index = 0; index < image.data.length; index += 4) {
        const [r, g, b, a] = image.data.subarray(index, index + 4);
        if (a !== 255 || r !== g || g !== b || r !== 0 && r !== 255) mixedPixels++;
        if (r === 0 && g === 0 && b === 0) {
          const x = index / 4 % canvas.width, y = Math.floor(index / 4 / canvas.width);
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      const modulePixels = Math.floor(canvas.width / (moduleCount + 8));
      return { width: canvas.width, height: canvas.height, mixedPixels, modulePixels,
        darkWidth: maxX - minX + 1, darkHeight: maxY - minY + 1,
        quietPixels: Math.min(minX, minY, canvas.width - maxX - 1, canvas.height - maxY - 1),
        decoded: jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data || '' };
    };
  });
}

(async () => {
  harness = await launch(report);

  await scenario('Normalized QR marks only the correct immutable ID in the selected subject and durable offline outbox', async page => {
    const result = await page.evaluate(() => processNameQr(HathirNameQR.encode('فَاطِمَة عبد الله أَحْمَد'), 'image'));
    assert.equal(result, true);
    const state = await currentState(page);
    assert.equal(state.operations.length, 1);
    assert.equal(state.operations[0].kind, 'mark');
    assert.equal(state.operations[0].subjectId, 'qa_name_a');
    assert.equal(state.operations[0].studentId, 'MI20250001');
    assert.equal(state.operations[0].record.method, 'image');
    assert.equal(state.operations[0].uid, 'qa_personal_a');
    assert(!JSON.stringify(state.operations[0]).includes('HATHIR-NAME:1:'), 'QR contents are not internal record keys');
    assert.equal(Object.keys(state.attendance[1].attendance).length, 0);
    assert.equal(state.feedback.filter(value => value === 'ok').length, 1);
    const snapshot = await page.evaluate(() => HathirOfflineStore.subject(session.uid, subjects[0].id));
    assert(Object.values(snapshot.subject.attendance).some(marks => marks.MI20250001));
  });

  await scenario('One portable QR selects the second subject own internal ID without touching the first', async page => {
    const result = await page.evaluate(async () => {
      activeSubjectId = subjects[1].id; buildStudentCache();
      return processNameQr(HathirNameQR.encode('فاطمة عبد الله أحمد'), 'image');
    });
    assert.equal(result, true);
    const state = await currentState(page);
    assert.equal(state.operations.length, 1); assert.equal(state.operations[0].subjectId, 'qa_name_b');
    assert.equal(state.operations[0].studentId, 'MI20250099');
    assert.equal(Object.keys(state.attendance[0].attendance).length, 0);
  });

  await scenario('Normalized duplicate names are blocked without success feedback or an outbox operation', async page => {
    await page.evaluate(() => { subjects[0].students.push({ id: 'MI20250003', name: 'فاطمة عبد الله أَحْمَد' }); buildStudentCache(); });
    await rejectWithoutMark(page, () => processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد')), 'Ambiguous name');
  });

  await scenario('True v1 name QR still matches normalized names and retains the internal attendance ID', async page => {
    assert.equal(await page.evaluate(() => processNameQr(legacyNameQrPayload('فَاطِمَة عبد الله أَحْمَد'), 'image')), true);
    const state = await currentState(page);
    assert.equal(state.operations.length, 1); assert.equal(state.operations[0].studentId, 'MI20250001');
    assert.equal(state.operations[0].subjectId, 'qa_name_a');
  });

  await scenario('True v1 name QR rejects normalized duplicate names without marking attendance', async page => {
    await page.evaluate(() => { subjects[0].students.push({ id: 'MI20250003', name: 'فاطمة عبد الله أَحْمَد' }); buildStudentCache(); });
    await rejectWithoutMark(page, () => processNameQr(legacyNameQrPayload('فاطمة عبد الله احمد')), 'Ambiguous legacy name');
  });

  await scenario('Missing full names do not match partial names or historical students', async page => {
    await page.evaluate(() => { subjects[0].archivedStudents.push({ id: 'ARCHIVED', name: 'مريم احمد علي' }); });
    for (const name of ['فاطمة', 'فاطمة عبد الله', 'مريم احمد علي']) {
      const result = await page.evaluate(name => processNameQr(HathirNameQR.encode(name)), name);
      assert.equal(result, false, name);
    }
    assert.equal((await currentState(page)).operations.length, 0);
  });

  await scenario('Old ID-only cards are rejected even if an existing student has that ID', async page => {
    await rejectWithoutMark(page, () => processNameQr('MI20250001', 'scan'), 'Old ID card');
    await rejectWithoutMark(page, () => processNameQr('2A0001', 'image'), 'Old short code');
  });

  await scenario('Matching names across selected sections are ambiguous even when student IDs coincide', async page => {
    await page.evaluate(() => {
      subjects[0].section = 'A'; subjects[1].section = 'B';
      subjects[1].titleAr = subjects[0].titleAr; subjects[1].titleEn = subjects[0].titleEn;
      subjects[1].students[0].id = subjects[0].students[0].id;
      compactScope = { departmentId: DEFAULT_DEPARTMENT_ID, stageId: DEFAULT_STAGE_ID, section: 'A', sections: ['A', 'B'] };
      buildStudentCache();
    });
    assert.equal(await page.evaluate(() => selectedSubjectGroup().length), 2);
    await rejectWithoutMark(page, () => processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد')), 'Across selected sections');
  });

  await scenario('A partial offline roster cannot establish uniqueness', async page => {
    await page.evaluate(() => {
      subjects[0].rosterLoaded = false; window.unexpectedOfflineRosterReads = 0;
      // A default Firestore get can return a partial cache while disconnected.
      // Such a singleton must never become proof that a name is unique.
      ensureSubjectRosterLoaded = async subject => { unexpectedOfflineRosterReads++; subject.rosterLoaded = true; };
    });
    await rejectWithoutMark(page, () => processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد')), 'Incomplete offline roster');
    assert.equal(await page.evaluate(() => unexpectedOfflineRosterReads), 0);
  });

  await scenario('A failed authoritative roster load never falls back to a cached partial match', async page => {
    await page.evaluate(() => {
      subjects[0].rosterLoaded = false; session.offlineMode = false;
      ensureSubjectRosterLoaded = async () => { throw Error('Synthetic roster unavailable'); };
    });
    await rejectWithoutMark(page, () => processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد')), 'Failed roster load');
  });

  await scenario('Completing a partial roster discovers a duplicate before any attendance write', async page => {
    await page.evaluate(() => {
      subjects[0].rosterLoaded = false; session.offlineMode = false;
      ensureSubjectRosterLoaded = async subject => {
        subject.students.push({ id: 'MI20250003', name: 'فاطمة عبد الله أحمد' }); subject.rosterLoaded = true;
      };
    });
    await rejectWithoutMark(page, () => processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد')), 'Duplicate after roster completion');
  });

  await scenario('Switching active subject invalidates an already captured QR scope', async page => {
    await rejectWithoutMark(page, () => {
      const captured = captureNameQrScope(); activeSubjectId = subjects[1].id; buildStudentCache();
      return processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد'), 'image', captured);
    }, 'Changed active subject');
  });

  await scenario('Switching account invalidates an already captured QR scope', async page => {
    await rejectWithoutMark(page, () => {
      const captured = captureNameQrScope();
      session = { ...session, uid: 'qa_second_teacher', workspaceId: 'qa_second_teacher' };
      return processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد'), 'image', captured);
    }, 'Changed account');
  });

  await scenario('Replacing the session object for the same account invalidates its captured scope', async page => {
    await rejectWithoutMark(page, () => {
      const captured = captureNameQrScope(); session = { ...session };
      return processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد'), 'image', captured);
    }, 'Replaced same-account session');
  });

  await scenario('Changing selection during an awaited roster load does not mark either subject', async page => {
    await page.evaluate(() => {
      subjects[0].rosterLoaded = false; session.offlineMode = false;
      ensureSubjectRosterLoaded = async subject => {
        await new Promise(resolve => { window.releaseNameRoster = resolve; }); subject.rosterLoaded = true;
      };
      window.pendingNameScan = processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد'));
    });
    await page.waitForFunction(() => typeof releaseNameRoster === 'function');
    await rejectWithoutMark(page, async () => {
      activeSubjectId = subjects[1].id; buildStudentCache(); releaseNameRoster(); return await pendingNameScan;
    }, 'Changed selection while loading');
  });

  for (const mutation of ['rename', 'collision', 'roster-reset', 'attendance-clear']) {
    await scenario(`Queued name attendance revalidates ${mutation} before writing`, async page => {
      await page.evaluate(() => {
        const key = JSON.stringify([session.uid, session.workspaceId, subjects[0].id]);
        attendanceMutationTails.set(key, new Promise(resolve => { window.releaseNameMutation = resolve; }));
        window.pendingNameScan = processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد'));
      });
      await page.waitForFunction(() => attendanceMarkInFlight.size > 0);
      await page.evaluate(mutation => {
        if (mutation === 'rename') subjects[0].students[0].name = 'مريم عبد الله احمد';
        if (mutation === 'collision') subjects[0].students.push({ id: 'MI20250003', name: 'فاطمة عبد الله أحمد' });
        if (mutation === 'roster-reset') subjects[0].lastRosterResetId = 'synthetic-reset';
        if (mutation === 'attendance-clear') subjects[0].attendanceClearedAtMillis = Date.now();
        releaseNameMutation();
      }, mutation);
      await rejectWithoutMark(page, () => pendingNameScan, 'Changed roster/epoch while queued');
    });
  }

  await scenario('Name uniqueness is checked again after the awaited automatic lecture-close operation', async page => {
    await page.evaluate(() => {
      const subject = subjects[0], date = todayISO();
      subject.lectures = [date]; subject.lectureMeta[date] = { status: 'active', startTime: '00:00', durationHours: 1 };
      const originalComplete = lectureIsComplete;
      lectureIsComplete = (s, key, current) => key === date || originalComplete(s, key, current);
      const originalQueue = queueOfflineAttendance;
      queueOfflineAttendance = async (...args) => {
        if (args[4] === 'close') await new Promise(resolve => { window.releaseNameLectureClose = resolve; });
        return originalQueue(...args);
      };
      window.pendingNameScan = processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد'));
    });
    await page.waitForFunction(() => typeof releaseNameLectureClose === 'function');
    const result = await page.evaluate(async () => {
      subjects[0].students.push({ id: 'MI20250003', name: 'فاطمة عبد الله أحمد' });
      releaseNameLectureClose(); return pendingNameScan;
    });
    assert.equal(result, false);
    const state = await currentState(page);
    assert.equal(state.operations.length, 1); assert.equal(state.operations[0].kind, 'close');
    assert(state.attendance.every(subject => Object.values(subject.attendance).every(marks => Object.keys(marks).length === 0)));
    assert(!state.feedback.includes('ok'));
  });

  await scenario('Stopping or replacing the camera invalidates a camera-owned scope', async page => {
    await rejectWithoutMark(page, () => {
      cameraStream = { getTracks: () => [] }; const captured = captureNameQrScope({ camera: true });
      cameraStream = { getTracks: () => [] };
      return processNameQr(HathirNameQR.encode('فاطمة عبد الله احمد'), 'scan', captured);
    }, 'Replaced camera stream');
  });

  await scenario('Rejected and debounced QR frames are handled and never fall through to face attendance', async page => {
    const result = await page.evaluate(async () => {
      cameraStream = { getTracks: () => [] }; scanBusy = false; lastScanValue = ''; lastScanAt = 0;
      Object.defineProperty(els.qrVideo, 'readyState', { configurable: true, value: 4 });
      decodeCurrentVideoFrame = () => ({ data: 'UNKNOWN-LEGACY-ID-999' });
      window.syntheticFaceFallbacks = 0; scanFaceFrameAuto = async () => { syntheticFaceFallbacks++; return false; };
      const first = await scanCurrentFrame(false); const repeated = await scanCurrentFrame(false);
      scheduleScanLoop(); await new Promise(resolve => setTimeout(resolve, 290));
      if (scanLoopTimer) clearTimeout(scanLoopTimer); scanLoopTimer = null; cameraStream = null;
      return { first, repeated, faceFallbacks: syntheticFaceFallbacks };
    });
    assert.deepEqual(result, { first: true, repeated: true, faceFallbacks: 0 });
    assert.equal((await currentState(page)).operations.length, 0);
  });

  await scenario('Concurrent camera and image scans remain one durable internal-ID attendance mark', async page => {
    const result = await page.evaluate(() => {
      const payload = HathirNameQR.encode('فاطمة عبد الله احمد');
      return Promise.all([processNameQr(payload, 'scan'), processNameQr(payload, 'image')]);
    });
    assert(result.every(Boolean)); const state = await currentState(page);
    assert.equal(state.operations.length, 1); assert.equal(state.operations[0].studentId, 'MI20250001');
  });

  await scenario('ID-only manual and face entry still use existing internal IDs', async page => {
    const result = await page.evaluate(async () => [await markAttendance('MI20250001', 'manual'), await markAttendance('MI20250002', 'face')]);
    assert.deepEqual(result, [true, true]);
    const state = await currentState(page);
    assert.deepEqual(state.operations.map(operation => operation.studentId).sort(), ['MI20250001', 'MI20250002']);
    assert.deepEqual(state.operations.map(operation => operation.record.method).sort(), ['face', 'manual']);
  });

  await scenario('Manual full-name input accepts normalization and clears only after successful attendance', async page => {
    const remaining = await page.evaluate(async () => {
      els.manualId.value = 'فَاطِمَة عبد الله أَحْمَد'; await markManual(); return els.manualId.value;
    });
    assert.equal(remaining, '');
    const state = await currentState(page); assert.equal(state.operations.length, 1);
    assert.equal(state.operations[0].studentId, 'MI20250001'); assert.equal(state.operations[0].record.method, 'manual');
  });

  await scenario('Manual full-name input rejects ambiguity and preserves the entered name for correction', async page => {
    const result = await page.evaluate(async () => {
      subjects[0].students.push({ id: 'MI20250003', name: 'فاطمة عبد الله أحمد' });
      els.manualId.value = 'فاطمه عبدالله احمد'; await markManual(); return els.manualId.value;
    });
    assert.equal(result, 'فاطمه عبدالله احمد'); const state = await currentState(page);
    assert.equal(state.operations.length, 0); assert(!state.feedback.includes('ok'));
  });

  await scenario('A newer manual name typed while attendance waits is not erased by the earlier completion', async page => {
    await page.evaluate(() => {
      const key = JSON.stringify([session.uid, session.workspaceId, subjects[0].id]);
      attendanceMutationTails.set(key, new Promise(resolve => { window.releaseManualName = resolve; }));
      els.manualId.value = 'فاطمة عبد الله أحمد'; window.pendingManualName = markManual();
    });
    await page.waitForFunction(() => attendanceMarkInFlight.size > 0);
    const remaining = await page.evaluate(async () => {
      els.manualId.value = 'سارة محمد علي'; releaseManualName(); await pendingManualName; return els.manualId.value;
    });
    assert.equal(remaining, 'سارة محمد علي'); const state = await currentState(page);
    assert.equal(state.operations.length, 1); assert.equal(state.operations[0].studentId, 'MI20250001');
  });

  await scenario('Face enrollment resolves a normalized full name to its immutable target ID', async page => {
    const result = await page.evaluate(async () => {
      session.offlineMode = false; window.syntheticFaceSaves = [];
      captureFaceDescriptor = async () => Array(128).fill(0.1);
      saveStudentFaceDescriptor = async (subject, student, descriptor) => {
        syntheticFaceSaves.push({ subjectId: subject.id, studentId: student.id, length: descriptor.length });
      };
      els.manualId.value = 'فاطمة عبد الله أحمد'; await enrollFaceForStudent();
      return { saves: syntheticFaceSaves, busy: faceBusy };
    });
    assert.deepEqual(result, { saves: [{ subjectId: 'qa_name_a', studentId: 'MI20250001', length: 128 }], busy: false });
    assert.equal((await currentState(page)).operations.length, 0, 'Enrollment must not mark attendance');
  });

  for (const mutation of ['collision', 'selection']) {
    await scenario(`Face enrollment rechecks ${mutation} after delayed synthetic face capture`, async page => {
      await page.evaluate(() => {
        session.offlineMode = false; window.syntheticFaceSaves = [];
        captureFaceDescriptor = async () => { await new Promise(resolve => { window.releaseSyntheticFace = resolve; }); return Array(128).fill(0.1); };
        saveStudentFaceDescriptor = async (subject, student) => { syntheticFaceSaves.push({ subjectId: subject.id, studentId: student.id }); };
        els.manualId.value = 'فاطمة عبد الله أحمد'; window.pendingFaceEnrollment = enrollFaceForStudent();
      });
      await page.waitForFunction(() => typeof releaseSyntheticFace === 'function');
      const result = await page.evaluate(async mutation => {
        if (mutation === 'collision') subjects[0].students.push({ id: 'MI20250003', name: 'فاطمه عبدالله احمد' });
        if (mutation === 'selection') { activeSubjectId = subjects[1].id; buildStudentCache(); }
        releaseSyntheticFace(); await pendingFaceEnrollment; return { saves: syntheticFaceSaves, busy: faceBusy };
      }, mutation);
      assert.deepEqual(result, { saves: [], busy: false });
      const state = await currentState(page); assert.equal(state.operations.length, 0); assert(!state.feedback.includes('ok'));
    });
  }

  await scenario('Actual v2 and v1 generator rasters round-trip short and 150-character names through actual jsQR', async page => {
    await installQrLibraries(page);
    const rows = await page.evaluate(async () => {
      const result = [];
      const original = qrcode;
      try {
        for (const version of [2, 1]) for (const name of ['فَاطِمَة عبد الله أَحْمَد', 'أحمد عبد الرحمن محمد علي', 'ا'.repeat(150)]) {
          let generation;
          qrcode = (type, correction) => {
            const qr = original(type, correction), add = qr.addData.bind(qr);
            generation = { type, correction, qr };
            qr.addData = (value, mode) => { generation.mode = mode || 'Byte'; return add(value, mode); };
            return qr;
          };
          const payload = version === 2 ? HathirNameQR.encode(name) : legacyNameQrPayload(name);
          const canvas = await makeQrCanvas(payload, 720), modules = generation.qr.getModuleCount();
          const facts = nameQrRasterFacts(canvas, modules), decoded = HathirNameQR.decode(facts.decoded);
          result.push({ version, payload, modules, generation: { type: generation.type, correction: generation.correction, mode: generation.mode },
            facts, key: decoded.key, expected: version === 2 ? HathirNameQR.fingerprint(name) : HathirNameQR.normalizeName(name) });
        }
      } finally {
        qrcode = original;
      }
      return result;
    });
    assert.equal(rows.length, 6);
    for (const row of rows) {
      assert.equal(row.facts.decoded, row.payload); assert.equal(row.key, row.expected);
      assert.equal(row.facts.mixedPixels, 0); assert(row.facts.modulePixels > 0);
      assert(row.facts.quietPixels >= row.facts.modulePixels * 4, 'Four complete white modules surround each raster');
      if (row.version === 2) {
        assert.match(row.payload, /^H2:[A-F0-9]{32}$/); assert.equal(row.payload.length, 35);
        assert.equal(row.modules, 25, 'V2 module count does not grow with name length');
        assert.deepEqual(row.generation, { type: 0, correction: 'M', mode: 'Alphanumeric' });
      } else {
        assert(row.payload.startsWith('HATHIR-NAME:1:'));
        assert.deepEqual(row.generation, { type: 0, correction: 'H', mode: 'Byte' });
      }
    }
    return { cachedGenerator: qrLibrary, cachedDecoder: decoderLibrary };
  });

  await scenario('Compact QR survives controlled 132px and 99px browser downscales without a physical-camera claim', async page => {
    await installQrLibraries(page);
    const rows = await page.evaluate(async () => {
      const result = [];
      for (const name of ['فاطمة عبد الله أحمد', 'ا'.repeat(150)]) {
        const payload = HathirNameQR.encode(name), source = await makeQrCanvas(payload, 660);
        for (const size of [132, 99]) {
          const target = document.createElement('canvas'); target.width = target.height = size;
          const ctx = target.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(source, 0, 0, size, size);
          result.push({ size, payload, ...nameQrRasterFacts(target, 25) });
        }
      }
      return result;
    });
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.decoded, row.payload, `Controlled ${row.size}px scan`);
      assert.equal(row.width, row.size); assert.equal(row.height, row.size);
      assert(row.quietPixels >= 4 * row.modulePixels);
    }
  });

  await scenario('Alternate generator configuration retains four quiet modules and version-specific correction', async page => {
    await installQrLibraries(page);
    const calls = await page.evaluate(async () => {
      const original = qrcode, alternate = window.QRCode, calls = [];
      qrcode = undefined;
      window.QRCode = { toCanvas: async (canvas, content, options) => { calls.push({ content, options }); } };
      try {
        await makeQrCanvas(HathirNameQR.encode('فاطمة عبد الله احمد'), 330);
        await makeQrCanvas(legacyNameQrPayload('فاطمة عبد الله احمد'), 660);
      } finally { qrcode = original; window.QRCode = alternate; }
      return calls;
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.options.margin), [4, 4]);
    assert.deepEqual(calls.map(call => call.options.errorCorrectionLevel), ['M', 'H']);
    assert.deepEqual(calls.map(call => call.options.width), [330, 660]);
  });

  await scenario('Too-small QR canvases are rejected instead of silently rendering a blank code', async page => {
    await installQrLibraries(page);
    assert.equal(await page.evaluate(async () => {
      try { await makeQrCanvas(HathirNameQR.encode('فاطمة عبد الله احمد'), 32); return false; }
      catch (error) { return error.message === 'QR canvas is too small for this payload.'; }
    }), true);
  });

  await scenario('Student QR-card creation passes the name protocol instead of the internal student ID', async page => {
    await installQrLibraries(page);
    const payloads = await page.evaluate(async () => {
      const original = makeQrCanvas; const captured = [];
      makeQrCanvas = async (value, size) => { captured.push(value); return original(value, size); };
      try { const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1000;
        await drawStudentQrCard(canvas.getContext('2d'), subjects[0].students[0], 0, 0, 800, 1000);
      } finally { makeQrCanvas = original; }
      return { captured, expected: HathirNameQR.encode(subjects[0].students[0].name) };
    });
    assert.deepEqual(payloads.captured, [payloads.expected]); assert(!payloads.expected.includes('MI20250001'));
  });

  for (const [variant, fullName] of [
    ['normal', 'فاطمة عبد الله أحمد'],
    ['long', 'عبد الرحمن عبد الكريم محمد عبد الله محمود عبد العزيز حسين عبد الرزاق جعفر عبد القادر علي أحمد حسن محمد صالح'],
    ['unspaced', 'عبدالله'.repeat(20)],
    ['maximum150', 'ا'.repeat(150)]
  ]) {
    await scenario(`${variant} QR card preserves its entire name within card bounds and draws no internal ID`, async page => {
      await installQrLibraries(page);
      const result = await page.evaluate(async ({ fullName }) => {
        const canvas = document.createElement('canvas'); canvas.id = 'nameQrVisualCard'; canvas.width = 800; canvas.height = 700;
        canvas.style.cssText = 'display:block!important;position:fixed;left:0;top:0;z-index:2147483647;width:800px;height:700px;'; document.body.append(canvas);
        const ctx = canvas.getContext('2d'), original = ctx.fillText.bind(ctx), originalImage = ctx.drawImage.bind(ctx), drawn = [], images = [];
        let qrSourcePixels;
        ctx.fillStyle = '#eef3f7'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillText = (value, x, y, maxWidth) => {
          const text = String(value), metrics = ctx.measureText(text);
          drawn.push({ text, x, y, maxWidth, measuredWidth: metrics.width,
            left: x - metrics.actualBoundingBoxLeft, right: x + metrics.actualBoundingBoxRight,
            top: y - metrics.actualBoundingBoxAscent, bottom: y + metrics.actualBoundingBoxDescent });
          return maxWidth === undefined ? original(value, x, y) : original(value, x, y, maxWidth);
        };
        ctx.drawImage = (image, ...args) => {
          const transform = ctx.getTransform();
          images.push({ sourceWidth: image.width, sourceHeight: image.height, args,
            smoothing: ctx.imageSmoothingEnabled, transform: [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f] });
          qrSourcePixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
          return originalImage(image, ...args);
        };
        const card = { x: 30, y: 30, width: 740, height: 640 };
        const student = { id: 'SYNTHETIC-INTERNAL-ID-DO-NOT-PRINT', name: fullName };
        await drawStudentQrCard(ctx, student, card.x, card.y, card.width, card.height);
        ctx.fillText = original; ctx.drawImage = originalImage;
        const placement = images[0];
        const [qrX, qrY, qrWidth = placement.sourceWidth, qrHeight = placement.sourceHeight] = placement.args;
        const crop = document.createElement('canvas'); crop.width = qrWidth; crop.height = qrHeight;
        crop.getContext('2d').putImageData(ctx.getImageData(qrX, qrY, qrWidth, qrHeight), 0, 0);
        const cropPixels = crop.getContext('2d').getImageData(0, 0, crop.width, crop.height).data;
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { drawn, card, internalId: student.id, expected: HathirNameQR.normalizeName(fullName),
          reconstructed: HathirNameQR.normalizeName(drawn.map(line => line.text).join('')),
          images, raster: nameQrRasterFacts(crop, 25), payload: HathirNameQR.encode(fullName),
          identicalQrPixels: qrSourcePixels.length === cropPixels.length && qrSourcePixels.every((value, index) => value === cropPixels[index]),
          cardDecoded: jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data || '' };
      }, { fullName });
      assert(result.drawn.length > 0);
      assert.equal(result.reconstructed, result.expected, 'Every name character must survive line wrapping');
      assert(result.drawn.every(line => !line.text.includes(result.internalId)), 'No internal ID text may be drawn');
      assert.equal(result.images.length, 1, 'The actual card draws exactly one QR canvas');
      const placement = result.images[0], [qrX, qrY, qrWidth = placement.sourceWidth, qrHeight = placement.sourceHeight] = placement.args;
      assert([2, 4].includes(placement.args.length), 'Only a whole QR canvas may be drawn');
      assert([qrX, qrY, qrWidth, qrHeight].every(Number.isInteger), 'QR placement and size must land on integer pixels');
      assert.equal(qrWidth, placement.sourceWidth, 'QR must not be resampled into the card');
      assert.equal(qrHeight, placement.sourceHeight, 'QR must not be resampled into the card');
      assert.deepEqual(placement.transform, [1, 0, 0, 1, 0, 0], 'QR draw must use identity transform');
      assert(result.identicalQrPixels, 'Every source QR pixel must survive unchanged in the actual card');
      assert.equal(result.raster.mixedPixels, 0, 'The actual card QR area must retain pure black/white pixels');
      assert.equal(result.raster.darkWidth, result.raster.modulePixels * 25);
      assert.equal(result.raster.darkHeight, result.raster.modulePixels * 25);
      assert(result.raster.quietPixels >= result.raster.modulePixels * 4, 'The actual card retains a four-module quiet zone');
      assert.equal(result.raster.decoded, result.payload);
      assert.equal(result.cardDecoded, result.payload, 'Decode the complete actual card, not only its generator source');
      for (const line of result.drawn) {
        assert(line.measuredWidth <= line.maxWidth + 1, 'Name line must fit its available width without truncation');
        assert(line.left >= result.card.x - 1 && line.right <= result.card.x + result.card.width + 1, 'Horizontal text bounds');
        assert(line.top >= result.card.y - 1 && line.bottom <= result.card.y + result.card.height + 1, 'Vertical text bounds');
      }
      if (variant === 'long' || variant === 'unspaced' || variant === 'maximum150') assert(result.drawn.length > 1, 'Long names should wrap');
      if (variant === 'normal' || variant === 'long') {
        fs.mkdirSync(REPORTS, { recursive: true });
        const screenshot = path.join(REPORTS, 'name-qr-card-' + variant + '.png');
        await page.locator('#nameQrVisualCard').screenshot({ path: screenshot, animations: 'disabled' }); report.screenshots.push(screenshot);
      }
    });
  }

  await scenario('All six cards in the actual PDF-page canvas decode their own compact name payload', async page => {
    await installQrLibraries(page);
    const result = await page.evaluate(async () => {
      const original = drawStudentQrCard, cards = [];
      const names = ['فاطمة عبد الله أحمد', 'سارة محمد علي', 'ا'.repeat(150), 'عبدالله'.repeat(20), 'مريم احمد علي', 'أحمد عبد الرحمن محمد علي'];
      const students = names.map((name, index) => ({ id: 'SYNTHETIC-PDF-INTERNAL-' + index, name }));
      drawStudentQrCard = async (ctx, student, x, y, width, height, options) => {
        await original(ctx, student, x, y, width, height, options);
        const image = ctx.getImageData(x, y, width, height);
        cards.push({ x, y, width, height, payload: HathirNameQR.encode(student.name),
          decoded: jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data || '' });
      };
      try {
        const canvas = await renderQrPdfPageCanvas(subjects[0], students, 0, 1);
        return { width: canvas.width, height: canvas.height, cards };
      } finally { drawStudentQrCard = original; }
    });
    assert.equal(result.width, 1680); assert.equal(result.height, 2376); assert.equal(result.cards.length, 6);
    for (const card of result.cards) {
      assert.equal(card.width, 740); assert.equal(card.height, 640);
      assert.equal(card.decoded, card.payload, `Actual PDF card at ${card.x},${card.y}`);
    }
  });

  for (const version of [2, 1]) for (const duplicate of [false, true]) {
    await scenario(`Real v${version} PNG image decoding ${duplicate ? 'rejects duplicate names' : 'queues the selected internal ID'}`, async page => {
      await installQrLibraries(page);
      await page.evaluate(async ({ version, duplicate }) => {
        if (duplicate) { subjects[0].students.push({ id: 'MI20250003', name: 'فاطمه عبدالله احمد' }); buildStudentCache(); }
        const name = 'فاطمة عبد الله أَحْمَد';
        const payload = version === 2 ? HathirNameQR.encode(name) : legacyNameQrPayload(name);
        const canvas = await makeQrCanvas(payload, 720);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const original = URL.revokeObjectURL.bind(URL); window.completedNameImage = false;
        URL.revokeObjectURL = url => { original(url); completedNameImage = true; };
        await scanImage({ target: { files: [new File([blob], `synthetic-name-v${version}.png`, { type: 'image/png' })], value: 'synthetic' } });
      }, { version, duplicate });
      // Completion follows both the actual decoder and any IndexedDB write.
      await page.waitForFunction(() => completedNameImage);
      const state = await currentState(page);
      assert.equal(state.operations.length, duplicate ? 0 : 1);
      if (duplicate) {
        assert(!state.feedback.includes('ok'));
        assert(state.attendance.every(subject => Object.values(subject.attendance).every(marks => Object.keys(marks).length === 0)));
      } else {
        assert.equal(state.operations[0].studentId, 'MI20250001');
        assert.equal(state.operations[0].record.method, 'image');
      }
    });

    await scenario(`Actual video/canvas/jsQR v${version} path ${duplicate ? 'rejects duplicate names' : 'queues one camera mark'}`, async page => {
      await installQrLibraries(page);
      const result = await page.evaluate(async ({ version, duplicate }) => {
        if (duplicate) { subjects[0].students.push({ id: 'MI20250003', name: 'فاطمه عبدالله احمد' }); buildStudentCache(); }
        const name = 'فاطمة عبد الله أَحْمَد';
        const payload = version === 2 ? HathirNameQR.encode(name) : legacyNameQrPayload(name);
        const qr = await makeQrCanvas(payload, 528), frame = document.createElement('canvas');
        frame.width = 960; frame.height = 720;
        const ctx = frame.getContext('2d');
        const redraw = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, frame.width, frame.height); ctx.drawImage(qr, 216, 96); };
        redraw();
        const stream = frame.captureStream(30), video = els.qrVideo;
        const pump = setInterval(redraw, 30);
        try {
          cameraStream = stream; video.muted = true; video.playsInline = true; video.srcObject = stream;
          scanBusy = false; lastScanValue = ''; lastScanAt = 0;
          await video.play();
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(Error('Synthetic video frame unavailable')), 4000);
            video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve(); }); redraw();
          });
          scanAttempts = 0; const full = decodeCurrentVideoFrame(false)?.data || '';
          const fullDimensions = [els.qrCanvas.width, els.qrCanvas.height];
          scanAttempts = 1; const crop = decodeCurrentVideoFrame(false)?.data || '';
          const cropDimensions = [els.qrCanvas.width, els.qrCanvas.height];
          const first = await scanCurrentFrame(true), repeated = await scanCurrentFrame(true);
          return { payload, full, crop, fullDimensions, cropDimensions, first, repeated,
            sourceDimensions: [video.videoWidth, video.videoHeight], ready: video.readyState >= 2 };
        } finally {
          clearInterval(pump); stream.getTracks().forEach(track => track.stop());
          cameraStream = null; video.srcObject = null;
          if (scanLoopTimer) clearTimeout(scanLoopTimer); scanLoopTimer = null;
        }
      }, { version, duplicate });
      assert(result.ready); assert.deepEqual(result.sourceDimensions, [960, 720]);
      assert.deepEqual(result.fullDimensions, [640, 480]); assert.deepEqual(result.cropDimensions, [640, 640]);
      assert.equal(result.full, result.payload); assert.equal(result.crop, result.payload);
      assert.equal(result.first, true); assert.equal(result.repeated, true);
      const state = await currentState(page);
      assert.equal(state.operations.length, duplicate ? 0 : 1);
      if (duplicate) {
        assert(!state.feedback.includes('ok'));
        assert(state.attendance.every(subject => Object.values(subject.attendance).every(marks => Object.keys(marks).length === 0)));
      } else {
        assert.equal(state.operations[0].studentId, 'MI20250001');
        assert.equal(state.operations[0].record.method, 'scan');
      }
    });
  }

  await scenario('Image-file scanning captures selection before an awaited decoder-library load', async page => {
    await installQrLibraries(page);
    await page.evaluate(async () => {
      const canvas = await makeQrCanvas(HathirNameQR.encode('فاطمة عبد الله احمد'), 720);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const originalLibrary = loadOptionalLibrary, originalRevoke = URL.revokeObjectURL.bind(URL);
      window.nameImageCleanups = 0;
      URL.revokeObjectURL = url => { nameImageCleanups++; originalRevoke(url); };
      loadOptionalLibrary = async name => {
        if (name === 'jsqr') await new Promise(resolve => { window.releaseImageDecoder = resolve; });
        return originalLibrary(name);
      };
      window.pendingImageScan = scanImage({ target: { files: [new File([blob], 'delayed-name.png', { type: 'image/png' })], value: 'synthetic' } });
    });
    await page.waitForFunction(() => typeof releaseImageDecoder === 'function');
    await page.evaluate(async () => { activeSubjectId = subjects[1].id; buildStudentCache(); releaseImageDecoder(); await pendingImageScan; });
    await page.waitForFunction(() => nameImageCleanups > 0);
    const state = await currentState(page); assert.equal(state.operations.length, 0);
    assert(!state.feedback.includes('ok'));
  });

  await check(report, 'No uncaught browser exceptions in isolated name-QR regressions', () => assert.deepEqual(report.pageErrors, []));
})().catch(error => { report.cases.push({ label: 'Browser harness execution', passed: false, error: error.stack }); })
  .finally(async () => { if (harness) await harness.close(); saveReport(report, 'name-qr-regression'); });
