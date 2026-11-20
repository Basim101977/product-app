'use strict';

const { REPORTS, assert, fs, path, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const report = makeReport('personal-offline-browser-regression');
let harness;
async function ready(page) { await page.waitForFunction(() => Boolean(window.HathirPersonal && document.getElementById('personalSupportBtn'))); }
async function screenshot(page, label) {
  fs.mkdirSync(REPORTS, { recursive: true });
  const file = path.join(REPORTS, 'personal-' + label + '.png');
  await page.screenshot({ path: file, animations: 'disabled' }); report.screenshots.push(file);
}
async function signupFields(page, overrides = {}) {
  const fields = { authFirstName: 'عبد الرحمن', authFatherName: 'محمد', authGrandfatherName: 'أحمد',
    authEmail: 'qa-personal-a@example.test', authPassword: 'TestPass!2026Safe', authPasswordConfirm: 'TestPass!2026Safe', ...overrides };
  for (const [id, value] of Object.entries(fields)) await page.locator('#' + id).fill(value);
}
async function installCallables(page) {
  await page.evaluate(() => {
    window.fixtureInvoke = async (name, data) => {
      personalFixture.calls.push({ name, data: structuredClone(data) });
      if (personalFixture.failNext === name) { personalFixture.failNext = ''; throw Object.assign(Error('Synthetic unavailable'), { code: 'unavailable' }); }
      if (personalFixture.holdNext === name) { personalFixture.holdNext = ''; await new Promise(resolve => { personalFixture.releaseCall = resolve; }); }
      if (name === 'submitPersonalRegistration') return { status: 'pending', fullName: Object.values(data).join(' ') };
      if (name === 'getPersonalAccountStatus') return { status: personalFixture.accountStatus, emailVerified: personalFixture.verified,
        isPlatformOwner: false, workspaceId: personalFixture.uid, email: personalFixture.email, fullName: 'عبد الرحمن محمد أحمد' };
      if (name === 'openIndividualWorkspace') {
        personalFixture.records['attendanceUserWorkspaces/' + personalFixture.uid] = { uid: personalFixture.uid,
          workspaceId: personalFixture.uid, active: true, displayName: 'عبد الرحمن محمد أحمد' };
        return { workspaceId: personalFixture.uid };
      }
      if (name === 'setPersonalAcademicStatus') return { studentId: data.studentId, status: data.status };
      if (name === 'importPersonalStudents') {
        const cohortId='personal_2026_medical_devices_2',root='attendanceWorkspaces/'+data.workspaceId+'/cohorts/'+cohortId;
        const students=data.names.map((name,index)=>({id:'MI2025'+String(10+index).padStart(4,'0'),name}));
        personalFixture.records[root]={rosterVersion:1};
        for(const student of subjects.find(subject=>subject.id===data.subjectId)?.students || [])personalFixture.records[root+'/students/'+student.id]={...student};
        for(const student of students)personalFixture.records[root+'/students/'+student.id]={...student};
        return {cohortId,added:students.length,students};
      }
      if(name==='approvePersonalAccount'){const row=personalFixture.requests.find(r=>r.uid===data.uid);if(data.status==='deleted')personalFixture.requests=personalFixture.requests.filter(r=>r.uid!==data.uid);else Object.assign(row,{status:data.status,adminEmailApproved:!!data.allowUnverified});return {uid:data.uid,status:data.status};}
      if (name === 'listPersonalRegistrations') return { requests: personalFixture.requests || [] };
      throw Error('Unexpected callable during regression: ' + name);
    };
  });
}
async function installWorkspace(page) {
  await installCallables(page);
  await page.evaluate(() => {
    lang = 'ar';
    personalFixture.verified = true; personalFixture.accountStatus = 'approved';
    fixtureAuth.currentUser = fixtureUser();
    session = { uid: personalFixture.uid, workspaceId: personalFixture.uid, email: personalFixture.email,
      displayName: 'مدرس اختبار محلي', role: 'owner', active: true, local: false,
      permissions: rolePermissions('owner'), departmentIds: [], stageIds: [], subjectIds: [] };
    membersCache = [session]; departments = defaultDepartments(); stages = defaultStages();
    const students = [
      { id: 'MI20250001', name: 'طالب بدون حالة', faceDescriptors: [] },
      { id: 'MI20250002', name: 'طالب مستوفي', faceDescriptors: [] },
      { id: 'MI20250003', name: 'طالب غير مستوفي', faceDescriptors: [] },
      { id: 'MI20250004', name: 'طالب محمل', faceDescriptors: [] }
    ];
    const base = { titleAr: 'مادة الاختبار الشخصية', titleEn: 'Personal QA Subject', departmentId: DEFAULT_DEPARTMENT_ID,
      stageId: DEFAULT_STAGE_ID, ownerUserId: session.uid, ownerUid: session.uid,
      academicYearStart: 2026, stageNumber: 2, departmentPrefix: 'MI', section: '',
      totalHours: 60, lectureDurationHours: 2, attendanceLocked: false, lectures: [], lectureMeta: {}, excuses: {},
      attendance: {}, archivedStudents: [], attendanceSummaries: {}, students, studentCount: students.length,
      rosterLoaded: true, attendanceLoaded: true, lectureIndexLoaded: true, lectureIndexComplete: true, summaryLoaded: true,
      historyPending: false, historyError: false, liveLoadPending: false, liveLoadError: false,
      loadedLectureDates: new Set(), loadedSummaryStudentIds: new Set(students.map(student => student.id)) };
    subjects = [{ ...base, id: 'qa_subject_a', academicStatuses: { MI20250002: 'مستوفي', MI20250003: 'غير مستوفي', MI20250004: 'محمل' } },
      { ...base, id: 'qa_subject_b', titleAr: 'مادة مستقلة ثانية', academicStatuses: { MI20250001: 'محمل' } }];
    activeSubjectId = 'qa_subject_a'; compactScope = null;
    // Suppress background refresh timers unrelated to this synthetic UI fixture.
    scheduleWeeklyAbsenceReview = () => {}; prepareOfflineSubject = async () => {};
    applyLanguage(); showApp(); renderAll(); document.body.classList.add('beginnerRecordVisible');
  });
}
const row = (page, id) => page.locator(`#rosterRows tr[data-student-id="${id}"]`);

(async () => {
  harness = await launch(report);
  for (const width of [390, 1440]) {
    const { page, context } = await harness.page({ width });
    await ready(page);
    await check(report, `${width}px Arabic login is RTL, responsive, and explicitly personal`, async () => {
      assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
      assert(await page.locator('#loginPage').isVisible());
      assert((await page.title()).includes('الشخصي') || /personal/i.test(await page.title()));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page must not horizontally overflow');
      assert.equal(await page.locator('#personalBuildNotice').count(),0);
      await screenshot(page, 'login-' + width);
    });
    await context.close();
  }

  {
    const { page, context } = await harness.page(); await ready(page); await installCallables(page);
    await page.locator('#signupTab').click();
    await check(report, 'Three separate name fields reject missing, titled, numeric, and punctuated names', async () => {
      for (const overrides of [{ authFirstName: '' }, { authFatherName: '' }, { authGrandfatherName: '' },
        { authFirstName: 'دكتور' }, { authFatherName: 'محمد123' }, { authGrandfatherName: 'أحمد!' }]) {
        await signupFields(page, overrides); await page.locator('#emailAuthBtn').click();
        assert.equal(await page.evaluate(() => personalFixture.authCalls.length), 0);
        assert.equal(await page.evaluate(() => personalFixture.calls.length), 0);
        assert((await page.locator('#authStatus').innerText()).length > 0);
      }
    });
    await check(report, 'Email, six-character minimum, and confirmation are validated before account creation', async () => {
      for (const overrides of [{ authEmail: 'not-an-email' }, { authPassword: 'short', authPasswordConfirm: 'short' },
        { authPasswordConfirm: 'DifferentPass!2026' }]) {
        await signupFields(page, overrides); await page.locator('#emailAuthBtn').click();
        assert.equal(await page.evaluate(() => personalFixture.authCalls.length), 0);
        assert.equal(await page.evaluate(() => personalFixture.calls.length), 0);
      }
    });
    await check(report, 'Valid compound-name signup sends verification and retains one pending account without private reads', async () => {
      await signupFields(page); await page.locator('#emailAuthBtn').click();
      await page.waitForFunction(() => personalFixture.calls.some(call => call.name === 'getPersonalAccountStatus'));
      assert(await page.locator('#personalPendingActions').isVisible());
      assert(await page.locator('#appPage').isHidden());
      const result = await page.evaluate(() => ({ calls: personalFixture.calls, auth: personalFixture.authCalls, reads: personalFixture.reads,
        currentUid: fixtureAuth.currentUser?.uid, sessionExists: Boolean(session) }));
      assert.equal(result.auth.filter(call => call.name === 'createUserWithEmailAndPassword').length, 1);
      assert.equal(result.auth.filter(call => call.name === 'sendEmailVerification').length, 1);
      assert.deepEqual(result.calls.find(call => call.name === 'submitPersonalRegistration').data,
        { firstName: 'عبد الرحمن', fatherName: 'محمد', grandfatherName: 'أحمد' });
      assert(!result.calls.some(call => call.name === 'openIndividualWorkspace'));
      assert(!result.reads.some(name => /attendanceWorkspaces|attendanceUserWorkspaces/.test(name)));
      assert.equal(result.currentUid, 'qa_personal_a'); assert.equal(result.sessionExists, false);
      await screenshot(page, 'pending-verification');
    });
    await check(report, 'Approval without email verification still cannot open private workspace', async () => {
      await page.evaluate(() => { personalFixture.accountStatus = 'approved'; });
      await page.locator('#checkApprovalBtn').click(); await page.waitForFunction(() => !document.getElementById('checkApprovalBtn').disabled);
      assert(await page.locator('#appPage').isHidden());
      assert.equal(await page.evaluate(() => personalFixture.calls.filter(call => call.name === 'openIndividualWorkspace').length), 0);
    });
    await check(report, 'Verified but pending account remains gated without recreating signup', async () => {
      await page.evaluate(() => { personalFixture.accountStatus = 'pending'; personalFixture.verified = true; });
      await page.locator('#checkApprovalBtn').click(); await page.waitForFunction(() => !document.getElementById('checkApprovalBtn').disabled);
      assert(await page.locator('#appPage').isHidden()); assert(await page.locator('#resendVerificationBtn').isHidden());
      assert.equal(await page.evaluate(() => personalFixture.authCalls.filter(call => call.name === 'createUserWithEmailAndPassword').length), 1);
      assert.equal(await page.evaluate(() => personalFixture.calls.filter(call => call.name === 'openIndividualWorkspace').length), 0);
    });
    await check(report, 'Only verified and approved identity opens its UID-scoped workspace', async () => {
      await page.evaluate(() => { personalFixture.accountStatus = 'approved'; });
      await page.locator('#checkApprovalBtn').click(); await page.waitForFunction(() => !document.getElementById('checkApprovalBtn').disabled);
      assert(await page.locator('#appPage').isVisible());
      assert.equal(await page.evaluate(() => session?.workspaceId), 'qa_personal_a');
      const reads = await page.evaluate(() => personalFixture.reads.filter(name => name.startsWith('attendanceWorkspaces/')));
      assert(reads.every(name => name === 'attendanceWorkspaces/qa_personal_a' || name.startsWith('attendanceWorkspaces/qa_personal_a/')));
      assert.equal(await page.evaluate(() => departments.find(department => department.id === 'medical_devices')?.codePrefix), 'MI');
      assert(await page.evaluate(() => personalFixture.writes.some(write => write.path === 'attendanceWorkspaces/qa_personal_a/departments/medical_devices' && write.value.codePrefix === 'MI')),
        'First private workspace must persist usable department prefixes');
    });
    await context.close();
  }

  {
    const { page, context } = await harness.page(); await ready(page); await installCallables(page);
    await check(report, 'Partially failed registration preserves its Auth identity and retries without creating another account', async () => {
      await page.locator('#signupTab').click(); await signupFields(page);
      await page.evaluate(() => { personalFixture.failNext = 'submitPersonalRegistration'; personalFixture.accountStatus = 'unregistered'; });
      await page.locator('#emailAuthBtn').click();
      await page.waitForFunction(() => !document.getElementById('emailAuthBtn').disabled && personalFixture.calls.some(call => call.name === 'getPersonalAccountStatus'));
      assert(await page.locator('#personalPendingActions').isVisible()); assert(await page.locator('#appPage').isHidden());
      assert.equal(await page.evaluate(() => fixtureAuth.currentUser?.uid), 'qa_personal_a');
      await page.evaluate(() => { personalFixture.accountStatus = 'pending'; });
      await page.locator('#emailAuthBtn').click();
      await page.waitForFunction(() => !document.getElementById('emailAuthBtn').disabled && personalFixture.calls.filter(call => call.name === 'submitPersonalRegistration').length === 2);
      assert.equal(await page.evaluate(() => personalFixture.authCalls.filter(call => call.name === 'createUserWithEmailAndPassword').length), 1);
      assert(await page.locator('#personalPendingActions').isVisible());
    });
    await context.close();
  }

  for (const width of [390, 1440]) {
    const { page, context } = await harness.page({ width }); await ready(page); await installWorkspace(page);
    await check(report, `${width}px private workspace has no central/member grant UI and no overflow`, async () => {
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      for (const locator of ['[data-view="usersView"]', '#usersView', '[data-org-tab]', '#orgModal', '#invitePanel'])
        for (const element of await page.locator(locator).all()) assert(await element.isHidden(), 'Visible forbidden control: ' + locator);
      assert.equal(await page.evaluate(() => canManageRegistration()), false);
      await screenshot(page, 'workspace-' + width);
    });
    await check(report, `${width}px academic status is truly blank by default and every nonblank status is light red`, async () => {
      const blank = page.locator('[data-personal-status="MI20250001"]');
      assert.equal(await blank.inputValue(), '');
      assert.equal(await blank.locator('option[value=""]').textContent(), '');
      assert.equal(await row(page, 'MI20250001').evaluate(element => element.classList.contains('personalStatusSet')), false);
      for (const id of ['MI20250002', 'MI20250003', 'MI20250004']) {
        assert.equal(await row(page, id).evaluate(element => element.classList.contains('personalStatusSet')), true);
        const color = await row(page, id).locator('td').nth(1).evaluate(element => getComputedStyle(element).backgroundColor);
        assert(['rgb(255, 240, 240)', 'rgb(255, 230, 230)'].includes(color), 'Expected light-red, got ' + color);
      }
      assert.deepEqual(await blank.locator('option').evaluateAll(options => options.map(option => option.value)), ['', 'مستوفي', 'غير مستوفي', 'محمل']);
      await page.locator('#rosterHead').scrollIntoViewIfNeeded();
      await screenshot(page, 'academic-statuses-' + width);
    });
    await check(report, `${width}px status change and clearing affect only the selected subject; failure restores value`, async () => {
      const selector = '[data-personal-status="MI20250001"]';
      for (const value of ['مستوفي', 'غير مستوفي', 'محمل', '']) {
        await page.locator(selector).selectOption(value);
        await page.waitForFunction(value => (subjects[0].academicStatuses.MI20250001 || '') === value && !document.querySelector('[data-personal-status="MI20250001"]').disabled, value);
        assert.equal(await row(page, 'MI20250001').evaluate(element => element.classList.contains('personalStatusSet')), Boolean(value));
        assert.equal(await page.evaluate(() => subjects[1].academicStatuses.MI20250001), 'محمل');
      }
      await page.evaluate(() => { personalFixture.failNext = 'setPersonalAcademicStatus'; });
      await page.locator(selector).selectOption('محمل');
      await page.waitForFunction(() => !document.querySelector('[data-personal-status="MI20250001"]').disabled);
      assert.equal(await page.locator(selector).inputValue(), '');
      assert.equal(await page.evaluate(() => subjects[0].academicStatuses.MI20250001 || ''), '');
    });
    await check(report, `${width}px names-only CSV/Excel parser strips headers and ignores supplied codes`, async () => {
      const parsed = await page.evaluate(() => ({ rows: parseStudentRows([['اسم الطالب'], ['أحمد محمد علي', 'EXTERNAL-999'], ['سارة خالد عمر'], ['']]),
        line: parseStudentLine('"عبد الرحمن محمد أحمد",FOREIGN-CODE'), header: parseStudentLine('اسم الطالب') }));
      assert.deepEqual(parsed.rows.parsed, [{ name: 'أحمد محمد علي' }, { name: 'سارة خالد عمر' }]);
      assert.deepEqual(parsed.line, { name: 'عبد الرحمن محمد أحمد' }); assert.equal(parsed.header, null);
      assert(parsed.rows.parsed.every(student => !Object.hasOwn(student, 'id')));
    });
    await check(report, `${width}px status save stays locked through rerender and rejects duplicate changes`, async () => {
      const selector = '[data-personal-status="MI20250001"]';
      const before = await page.evaluate(() => personalFixture.calls.filter(call => call.name === 'setPersonalAcademicStatus').length);
      await page.evaluate(() => { personalFixture.holdNext = 'setPersonalAcademicStatus'; });
      await page.locator(selector).selectOption('محمل');
      await page.waitForFunction(() => typeof personalFixture.releaseCall === 'function');
      try {
        await page.evaluate(() => renderRoster());
        assert(await page.locator(selector).isDisabled(), 'Rerendered dropdown must stay locked while its request is pending');
        await page.locator(selector).evaluate(element => { element.value = 'مستوفي'; element.dispatchEvent(new Event('change', { bubbles: true })); });
        assert.equal(await page.evaluate(() => personalFixture.calls.filter(call => call.name === 'setPersonalAcademicStatus').length), before + 1);
      } finally {
        await page.evaluate(() => { const release = personalFixture.releaseCall; delete personalFixture.releaseCall; release(); });
        await page.waitForFunction(() => (subjects[0].academicStatuses.MI20250001 || '') === 'محمل');
      }
    });
    await check(report, `${width}px attendance export is name-only with subject-specific academic statuses`, async () => {
      const exported = await page.evaluate(() => {
        const result = buildAttendanceExportRows(subjects[0]);
        return { rows: result.rows, studentHeader: text('student'), codeHeader: text('studentId') };
      });
      const header = exported.rows.find(cells => cells.includes(exported.studentHeader));
      assert(header, 'Export must include student name header');
      assert(!header.includes(exported.codeHeader), 'Student ID must not be exported');
      assert.equal(header.at(-1), 'الحالة');
      const nameIndex = header.indexOf(exported.studentHeader);
      assert.equal(exported.rows.find(cells => cells[nameIndex] === 'طالب مستوفي').at(-1), 'مستوفي');
      assert.equal(exported.rows.find(cells => cells[nameIndex] === 'طالب غير مستوفي').at(-1), 'غير مستوفي');
      assert(!JSON.stringify(exported.rows).includes('MI2025000'));
    });
    await check(report, `${width}px import sends only names and private scope; server-generated codes populate roster`, async () => {
      await page.evaluate(() => importParsedStudents([{ name: 'اسم طالب جديد', id: 'MUST-NOT-BE-SENT' }], 0));
      const result = await page.evaluate(() => ({ call: personalFixture.calls.filter(call => call.name === 'importPersonalStudents').at(-1),
        student: subjects[0].students.find(student => student.name === 'اسم طالب جديد') }));
      assert.deepEqual(result.call.data.names, ['اسم طالب جديد']);
      assert.equal(result.call.data.workspaceId, 'qa_personal_a'); assert.equal(result.call.data.subjectId, 'qa_subject_a');
      assert(!JSON.stringify(result.call.data).includes('MUST-NOT-BE-SENT'));
      assert.match(result.call.data.operationId, /^[a-f0-9-]{36}$/);
      assert.equal(result.student.id, 'MI20250010');
    });
    await check(report, `${width}px university support and help center are available`, async () => {
      await page.evaluate(() => HathirSettings.open()); await page.locator('#personalSupportBtn').click();
      assert(await page.locator('#personalSupportModal').isVisible());
      assert.equal(await page.locator('#personalSupportEmail').getAttribute('href'), 'mailto:redacted@example.invalid');
      assert.equal(await page.locator('#personalSupportUnavailable').count(), 0);
      assert.equal(await page.locator('#personalSupportModal a[href="/help.html"]').count(), 1);
      await screenshot(page, 'support-' + width);
    });
    await context.close();
  }

  {
    const { page, context } = await harness.page(); await ready(page);
    await check(report, 'Private offline snapshots and pending operations stay isolated by account UID', async () => {
      const result = await page.evaluate(async () => {
        for (const uid of ['qa_a', 'qa_b']) {
          const snapshot = { key: HathirOfflineStore.key(uid, 'same_subject'), uid, workspaceId: uid,
            subject: { id: 'same_subject', students: [{ id: uid + '_student', name: uid + ' synthetic' }], attendance: {}, lectures: [] } };
          await HathirOfflineStore.save(snapshot);
          await HathirOfflineStore.enqueue(snapshot, { id: crypto.randomUUID(), uid, workspaceId: uid, subjectId: 'same_subject', kind: 'qa_only' });
        }
        return { a: await HathirOfflineStore.subjects('qa_a'), b: await HathirOfflineStore.subjects('qa_b'),
          opsA: await HathirOfflineStore.operations('qa_a'), opsB: await HathirOfflineStore.operations('qa_b'),
          none: await HathirOfflineStore.subject('qa_unknown', 'same_subject') };
      });
      assert.equal(result.a.length, 1); assert.equal(result.b.length, 1);
      assert.equal(result.a[0].uid, 'qa_a'); assert.equal(result.b[0].uid, 'qa_b');
      assert.equal(result.opsA.length, 1); assert.equal(result.opsB.length, 1);
      assert(result.opsA.every(op => op.uid === 'qa_a')); assert(result.opsB.every(op => op.uid === 'qa_b')); assert.equal(result.none, null);
    });
    await context.close();
  }
  {
    const { page, context } = await harness.page(); await ready(page); await installWorkspace(page);
    await check(report, 'Registration owner controls require reserved UID, exact email, and verified current Auth identity', async () => {
      const results = await page.evaluate(() => {
        const ownerUid = HATHIR_RUNTIME_CONFIG.ownerUid, ownerEmail = HATHIR_RUNTIME_CONFIG.ownerEmail;
        return [
          { uid: 'impostor', email: ownerEmail, emailVerified: true },
          { uid: ownerUid, email: 'wrong@example.test', emailVerified: true },
          { uid: ownerUid, email: ownerEmail, emailVerified: false },
          { uid: ownerUid, email: ownerEmail, emailVerified: true }
        ].map(user => { session.uid = user.uid; session.workspaceId = user.uid; fixtureAuth.currentUser = user; return canManageRegistration(); });
      });
      assert.deepEqual(results, [false, false, false, true]);
    });
    await check(report, 'Owner approval UI offers explicit administrative approval and account deletion', async () => {
      await page.evaluate(async () => {
        personalFixture.requests = [
          { uid: 'qa_unverified', fullName: 'اسم اختبار أول', email: 'unverified@example.test', status: 'pending', emailVerified: false },
          { uid: 'qa_verified', fullName: 'اسم اختبار ثان', email: 'verified@example.test', status: 'pending', emailVerified: true }
        ];
        await loadOwnerRequests();
      });
      assert(await page.locator('[data-request-id="qa_unverified"][data-request-decision="approved"]').isEnabled());
      assert(await page.locator('[data-request-id="qa_verified"][data-request-decision="approved"]').isEnabled());
      assert(await page.locator('[data-request-id="qa_unverified"][data-request-decision="deleted"]').isEnabled());
      await page.evaluate(()=>{document.getElementById('ownerRegistrationModal').hidden=false;window.confirm=window.prompt=()=>{throw Error('Native browser dialog must not be used');};});
      await page.locator('[data-request-id="qa_unverified"][data-request-decision="approved"]').click();
      assert(await page.locator('#ownerActionDialog').isVisible());
      await page.locator('#ownerActionCancel').click();
      await page.locator('[data-request-id="qa_unverified"][data-request-decision="deleted"]').click();
      await page.locator('#ownerActionEmailInput').fill('wrong@example.test');await page.locator('#ownerActionSubmit').click();
      assert.match(await page.locator('#ownerActionError').innerText(),/غير مطابق/);
      await page.locator('#ownerActionCancel').click();
      assert.equal(await page.evaluate(() => personalFixture.calls.filter(call => call.name === 'approvePersonalAccount').length), 0);
    });
    await check(report,'Actual owner button clicks submit administrative approval and show success',async()=>{
      await page.locator('[data-request-id="qa_unverified"][data-request-decision="approved"]').click();
      await page.locator('#ownerActionSubmit').click();
      await page.waitForFunction(()=>document.getElementById('ownerRequestsStatus').textContent.includes('تمت الموافقة'));
      const calls=await page.evaluate(()=>personalFixture.calls.filter(c=>c.name==='approvePersonalAccount'));
      assert.equal(calls.length,1);assert.equal(calls[0].data.allowUnverified,true);
      assert.equal(await page.locator('[data-request-id="qa_unverified"][data-request-decision="approved"]').count(),0);
    });
    await check(report,'Mobile deletion surfaces server failure and retries with real button clicks',async()=>{
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(()=>{personalFixture.failNext='approvePersonalAccount';});
      await page.locator('[data-request-id="qa_unverified"][data-request-decision="deleted"]').click();
      await page.locator('#ownerActionEmailInput').fill('unverified@example.test');await page.locator('#ownerActionSubmit').click();
      await page.waitForFunction(()=>document.getElementById('ownerRequestsStatus').textContent.includes('تعذر تنفيذ'));
      assert(await page.locator('[data-request-id="qa_unverified"][data-request-decision="deleted"]').isEnabled());
      await page.locator('[data-request-id="qa_unverified"][data-request-decision="deleted"]').click();
      await page.locator('#ownerActionEmailInput').fill('unverified@example.test');await page.locator('#ownerActionSubmit').click();
      await page.waitForFunction(()=>document.getElementById('ownerRequestsStatus').textContent.includes('تم حذف'));
      assert.equal(await page.locator('[data-request-id="qa_unverified"]').count(),0);
      const calls=await page.evaluate(()=>personalFixture.calls.filter(c=>c.name==='approvePersonalAccount'&&c.data.status==='deleted'));
      assert.equal(calls.length,2);assert.equal(calls[1].data.confirmEmail,'unverified@example.test');
    });
    await context.close();
  }
  {
    const { page, context } = await harness.page({ runtime: 'unprovisioned' }); await ready(page);
    await check(report, 'Unprovisioned runtime fails closed without production or demo-account fallback', async () => {
      assert.equal(await page.evaluate(() => firebaseReady), false);
      assert.equal(await page.evaluate(() => window.HATHIR_RUNTIME_CONFIG.firebaseConfig), null);
      await page.locator('#authEmail').fill('synthetic-1@fixture.local'); await page.locator('#authPassword').fill('SYNTHETIC_FIXTURE_ONLY_1');
      await page.locator('#emailAuthBtn').click();
      assert(await page.locator('#appPage').isHidden()); assert(await page.locator('#loginPage').isVisible());
      assert.equal(await page.evaluate(() => loadLocalSession('local_owner')), false);
      assert.equal(await page.evaluate(() => Object.keys(localData.users || {}).length), 0);
      assert.equal(await page.evaluate(() => personalFixture.authCalls.length + personalFixture.calls.length + personalFixture.reads.length + personalFixture.writes.length), 0);
    });
    await context.close();
  }
  await check(report, 'No uncaught browser errors across synthetic regressions', () => assert.deepEqual(report.pageErrors, []));
})().catch(error => { report.cases.push({ label: 'Browser harness execution', passed: false, error: error.stack }); })
  .finally(async () => { if (harness) await harness.close(); saveReport(report, 'personal-ui-regression'); });

