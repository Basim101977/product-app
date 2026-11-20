'use strict';

// Presentation/export regression only. The shared harness blocks external
// requests and supplies an in-memory Firebase fixture; no cloud is contacted.
const { REPORTS, assert, fs, path, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const report = makeReport('name-only-personal-ui-regression');
let harness;

async function installWorkspace(page) {
  await page.waitForFunction(() => Boolean(window.HathirPersonal && document.getElementById('tourReplay')));
  await page.evaluate(() => {
    personalFixture.verified = true;
    fixtureAuth.currentUser = fixtureUser();
    session = { uid: personalFixture.uid, workspaceId: personalFixture.uid, email: personalFixture.email,
      displayName: 'مدرس اختبار محلي', role: 'owner', active: true, local: false,
      permissions: rolePermissions('owner'), departmentIds: [], stageIds: [], subjectIds: [] };
    membersCache = [session]; departments = defaultDepartments(); stages = defaultStages();
    const students = [
      { id: 'MI20250001', name: 'أحمد محمد علي', faceDescriptors: [] },
      { id: 'MI20250002', name: 'أحمد محمد علي', faceDescriptors: [] },
      { id: 'MI20250003', name: 'سارة خالد عمر', faceDescriptors: [] }
    ];
    const archived = { id: 'MI20250004', name: 'طالب مؤرشف للاختبار', archived: true };
    const base = { titleAr: 'مادة الأسماء الشخصية', titleEn: 'Name-only personal subject', departmentId: DEFAULT_DEPARTMENT_ID,
      stageId: DEFAULT_STAGE_ID, ownerUserId: session.uid, ownerUid: session.uid,
      academicYearStart: 2026, stageNumber: 2, departmentPrefix: 'MI', section: '',
      totalHours: 60, lectureDurationHours: 2, attendanceLocked: false,
      lectures: ['2026-09-21'], lectureMeta: { '2026-09-21': { status: 'completed', durationHours: 2 } },
      attendance: { '2026-09-21': { MI20250001: { time: '09:00', attendedMinutes: 120, method: 'qr' }, MI20250004: { time: '09:10', attendedMinutes: 110, method: 'manual' } } },
      excuses: {}, archivedStudents: [archived], attendanceSummaries: {}, students, studentCount: students.length,
      rosterLoaded: true, rosterSource:'cohort',
      _rosterDocumentIds:Object.fromEntries(students.map(student=>[student.id,student.id])),
      _rosterBaseline:Object.fromEntries(students.map(student=>[student.id,JSON.stringify([student.name,[]])])),
      attendanceLoaded: true, lectureIndexLoaded: true, lectureIndexComplete: true, summaryLoaded: true,
      historyPending: false, historyError: false, liveLoadPending: false, liveLoadError: false,
      loadedLectureDates: new Set(['2026-09-21']), loadedSummaryStudentIds: new Set([...students, archived].map(student => student.id)) };
    subjects = [
      { ...base, id: 'qa_name_subject_a', academicStatuses: { MI20250001: 'مستوفي', MI20250002: 'غير مستوفي', MI20250004: 'محمل' } },
      { ...base, id: 'qa_name_subject_b', academicStatuses: { MI20250001: 'محمل', MI20250002: 'مستوفي' } }
    ];
    activeSubjectId = subjects[0].id; compactScope = null;
    scheduleWeeklyAbsenceReview = () => {}; prepareOfflineSubject = async () => {};
    window.fixtureInvoke = async (name, data) => {
      personalFixture.calls.push({ name, data: structuredClone(data) });
      if (name === 'setPersonalAcademicStatus') return { studentId: data.studentId, status: data.status };
      throw Error('Unexpected synthetic callable: ' + name);
    };
    applyLanguage(); showApp(); renderAll(); document.body.classList.add('beginnerRecordVisible');
  });
}

(async () => {
  harness = await launch(report, {legacyCloud:true});
  for (const width of [390, 1440]) {
    const { page, context } = await harness.page({ width });
    await installWorkspace(page);
    for (const language of ['ar', 'en']) {
      await page.evaluate(value => { lang = value; applyLanguage(); renderAll(); }, language);
      await check(report, `${width}px ${language}: names and sequence remain visible, internal-ID cells stay hidden across renders`, async () => {
        const validate = async () => {
          const result = await page.evaluate(() => {
            const visible = element => getComputedStyle(element).display !== 'none';
            const header = [...els.rosterHead.querySelectorAll('th')];
            const rows = [...els.rosterRows.querySelectorAll('tr[data-student-id]')];
            return { headerCount: header.filter(visible).length,
              visibleHeader: header.filter(visible).map(cell => cell.textContent),
              codeHeader: text('studentId'), sequenceHeader: text('num'),
              identityHeaders: header.filter(cell => cell.classList.contains('studentIdentityColumn')).length,
              rows: rows.map(row => ({ id: row.dataset.studentId, text: row.innerText,
                sequence: row.cells[0].textContent, sequenceVisible: visible(row.cells[0]),
                visibleCount: [...row.cells].filter(visible).length,
                statusCells: row.querySelectorAll('[data-personal-status-cell]').length,
                identityCells: row.querySelectorAll('.studentIdentityColumn').length,
                identityVisible: [...row.querySelectorAll('.studentIdentityColumn')].some(visible) })) };
          });
          assert.equal(result.identityHeaders, 1);
          assert(result.visibleHeader.includes(result.sequenceHeader));
          assert(!result.visibleHeader.includes(result.codeHeader));
          assert.equal(result.rows.length, 4);
          for (const [index, row] of result.rows.entries()) {
            assert.equal(row.identityCells, 1); assert.equal(row.identityVisible, false);
            assert.equal(row.sequenceVisible, true); assert.equal(row.sequence, String(index + 1));
            assert.equal(row.visibleCount, result.headerCount); assert.equal(row.statusCells, 1);
            assert(!row.text.includes(row.id), 'An internal identifier leaked into visible row text');
          }
        };
        await validate();
        await page.evaluate(() => { renderRoster('MI20250002'); renderRoster('MI20250002'); });
        await validate();
        await page.evaluate(() => renderRoster());
        await validate();
      });

      await check(report, `${width}px ${language}: profile keeps its internal identity without presenting the field or label`, async () => {
        await page.evaluate(() => openStudentProfile('MI20250001'));
        assert(await page.locator('#profileStudentNameInput').isVisible());
        assert.equal(await page.locator('#profileStudentNameInput').inputValue(), 'أحمد محمد علي');
        assert(await page.locator('#profileStudentCodeInput').isHidden());
        assert(await page.locator('label[for="profileStudentCodeInput"]').isHidden());
        assert.equal(await page.locator('#profileStudentCodeInput').inputValue(), 'MI20250001');
        await page.evaluate(() => { renderStudentProfile(); applyLanguage(); });
        assert(await page.locator('#profileStudentCodeInput').isHidden());
        assert(await page.locator('#profileStudentCodeInput').isDisabled());
        assert.equal(await page.locator('#profileStudentCodeInput').getAttribute('placeholder'), '');
        assert(!(await page.locator('#studentProfileModal').innerText()).includes('MI20250001'));
        await page.evaluate(() => { closeStudentProfile(); openNewStudentProfile(); });
        assert(await page.locator('#profileStudentNameInput').isVisible());
        assert(await page.locator('#profileStudentCodeInput').isHidden());
        assert.equal(await page.locator('#profileStudentCodeInput').inputValue(), '');
        await page.evaluate(() => closeStudentProfile());
      });

      await check(report, `${width}px ${language}: exports omit IDs and retain sequence, attendance, duplicate-name and per-course status alignment`, async () => {
        const exported = await page.evaluate(() => {
          const before = JSON.stringify(subjects);
          const outputs = subjects.map(subject => [attendanceValueForDisplay, attendanceTimeValue].map(format => buildAttendanceExportRows(subject, format)));
          return { before, after: JSON.stringify(subjects), outputs, studentHeader: text('student'), codeHeader: text('studentId'), numHeader: text('num'), statusHeader: lang === 'ar' ? 'الحالة' : 'Status', calls: personalFixture.calls.length, writes: personalFixture.writes.length };
        });
        assert.equal(exported.after, exported.before, 'Presentation export mutated the internal model');
        for (const [subjectIndex, outputs] of exported.outputs.entries()) {
          for (const [formatIndex, output] of outputs.entries()) {
            const headerIndex = output.rows.findIndex(row => row.includes(exported.studentHeader) && row.includes(exported.numHeader));
            assert(headerIndex >= 0);
            const header = output.rows[headerIndex], data = output.rows.slice(headerIndex + 1);
            assert(!header.includes(exported.codeHeader)); assert.equal(header.at(-1), exported.statusHeader);
            assert(!JSON.stringify(output.rows).includes('MI2025'), 'Export leaked an internal identifier');
            assert.deepEqual(data.map(row => row[0]), [1, 2, 3, 4]);
            assert.deepEqual(data.map(row => row[1]), ['أحمد محمد علي', 'أحمد محمد علي', 'سارة خالد عمر', 'طالب مؤرشف للاختبار']);
            assert(data.every(row => row.length === header.length));
            assert.deepEqual(data.map(row => row.at(-1)), subjectIndex === 0 ? ['مستوفي', 'غير مستوفي', '', 'محمل'] : ['محمل', 'مستوفي', '', '']);
            if (formatIndex === 1) { assert.equal(data[0][2], '09:00'); assert.equal(data[3][2], '09:10'); }
            else assert(data[0][2], 'Attendance marker disappeared when the ID column was removed');
          }
        }
        assert.equal(exported.calls, 0); assert.equal(exported.writes, 0);
      });

      await check(report, `${width}px ${language}: empty-row span matches visible headers and import help requests names only`, async () => {
        const details = await page.evaluate(() => {
          els.studentSearch.value = 'ZZ_NO_MATCH_ZZ'; renderRoster();
          const header = [...els.rosterHead.querySelectorAll('th')].filter(cell => getComputedStyle(cell).display !== 'none');
          const details = { columns: header.length, span: els.rosterRows.querySelector('td[colspan]').colSpan,
            help: text('bulkHelp'), empty: text('excelNoRows'), required: text('studentProfileRequired'), parsed: parseStudentRows([['الاسم الكامل'], ['أحمد محمد علي', 'EXTERNAL-ID']]).parsed };
          els.studentSearch.value = ''; renderRoster(); return details;
        });
        assert.equal(details.span, details.columns);
        assert.match(details.help, /QR/); assert(!/generated|يُنشأ الكود|code|الكود/i.test(details.help + details.empty + details.required));
        assert.deepEqual(details.parsed, [{ name: 'أحمد محمد علي' }]);
      });

      await check(report, `${width}px ${language}: Excel headings keep their layout and colour only cancelled text`, async () => {
        const result = await page.evaluate(async () => {
          await loadOptionalLibrary('exceljs');
          const savedDownload = download, files = [];
          download = (content, filename, type) => files.push({ content, filename, type });
          const lecture = subjects[0].lectures[0];
          try {
            exportCSV(); await exportExcel();
            subjects[0].lectureMeta[lecture].status = 'cancelled';
            await exportExcel();
          } finally { download = savedDownload; subjects[0].lectureMeta[lecture].status = 'completed'; }
          const workbooks = [];
          for (const file of files.slice(2)) {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(file.content);
            workbooks.push({ filename: file.filename, sheets: workbook.worksheets.map(sheet => {
              const rows = [];let headingNumber = 0;
              sheet.eachRow((row, number) => { rows.push(row.values.slice(1)); if (!headingNumber && row.values.includes(text("num")) && row.values.includes(text("student"))) headingNumber = number; });
              const header = sheet.getRow(headingNumber).getCell(3);
              return { rows, widths: sheet.columns.map(column => column.width), headingHeight: sheet.getRow(headingNumber).height,
                headingColor: header.font?.color?.argb || '', headingFill: header.fill?.fgColor?.argb || '',
                attendanceFill: sheet.getRow(headingNumber + 1).getCell(3).fill?.fgColor?.argb || '' };
            }) });
          }
          return { files: files.slice(0,2).map(file => ({ ...file })), workbooks,
            studentHeader: text('student'), codeHeader: text('studentId'),
            numHeader: text('num'), statusHeader: lang === 'ar' ? 'الحالة' : 'Status' };
        });
        assert.equal(result.files.length, 2); assert.equal(result.workbooks.length, 2);
        for (const file of result.files) {
          assert(file.content.includes('أحمد محمد علي')); assert(file.content.includes(result.statusHeader));
          assert(!file.content.includes('MI2025')); assert(!file.content.includes(result.codeHeader));
          assert(file.filename.endsWith('.csv'));
        }
        for (const [workbookIndex, workbook] of result.workbooks.entries()) {
          assert(workbook.filename.endsWith('.xlsx'));
          assert.equal(workbook.sheets.length, 2);
          for (const sheet of workbook.sheets) {
            const header = sheet.rows.find(row => row.includes(result.studentHeader) && row.includes(result.numHeader));
            assert.equal(header.at(-1), result.statusHeader); assert(!header.includes(result.codeHeader));
            assert(!JSON.stringify(sheet.rows).includes('MI2025'));
            assert.equal(sheet.widths[header.indexOf(result.studentHeader)], 32);
            assert.equal(sheet.widths[2], 14);
            assert.match(String(header[2]),/\n09:00/);
            assert.match(String(header[2]),language==='ar'?/م\(1\)/:/L\(1\)/);
            assert.equal(sheet.headingFill, '');
            assert.equal(sheet.attendanceFill, '');
            if (workbookIndex === 0) { assert.equal(sheet.headingColor, ''); assert.equal(sheet.headingHeight, 32); }
            else {
              assert.match(String(header[2]),language==='ar'?/\nملغاة$/:/\nCancelled$/);
              assert.equal(sheet.headingColor, 'FFB4232D');
              assert.equal(sheet.headingHeight, 46);
            }
          }
        }
      });
    }

    await check(report, `${width}px status writes and RFID binding still use internal IDs`, async () => {
      await page.locator('[data-personal-status="MI20250003"]').selectOption('مستوفي');
      await page.waitForFunction(() => subjects[0].academicStatuses.MI20250003 === 'مستوفي');
      const result = await page.evaluate(() => ({ call: personalFixture.calls.at(-1), other: subjects[1].academicStatuses.MI20250003 || '',
        ids: subjects[0].students.map(student => student.id), mark: subjects[0].attendance['2026-09-21'].MI20250001 }));
      assert.equal(result.call.name, 'setPersonalAcademicStatus');
      assert.equal(result.call.data.studentId, 'MI20250003'); assert.equal(result.call.data.subjectId, 'qa_name_subject_a');
      assert.equal(result.other, ''); assert.deepEqual(result.ids, ['MI20250001', 'MI20250002', 'MI20250003']);
      assert.equal(result.mark.time, '09:00');
      await page.evaluate(() => HathirSettings.open());
      assert(await page.locator('#rfidToggle').isVisible());
      await page.evaluate(() => { document.getElementById('settingsModal').hidden = true; });
    });

    await check(report, `${width}px editing a name retains the hidden ID and every existing attendance/status key`, async () => {
      const before = await page.evaluate(() => ({ attendance: JSON.stringify(subjects.map(subject => subject.attendance)),
        statuses: JSON.stringify(subjects.map(subject => subject.academicStatuses)), ids: subjects[0].students.map(student => student.id) }));
      await page.evaluate(() => openStudentProfile('MI20250003'));
      await page.locator('#profileStudentNameInput').fill('سارة خالد عمر حسن');
      await page.evaluate(() => saveStudentProfile());
      const after = await page.evaluate(() => ({ attendance: JSON.stringify(subjects.map(subject => subject.attendance)),
        statuses: JSON.stringify(subjects.map(subject => subject.academicStatuses)), ids: subjects[0].students.map(student => student.id),
        student: subjects[0].students.find(student => student.id === 'MI20250003'), profileId: els.profileStudentCodeInput.value }));
      assert.equal(after.student.name, 'سارة خالد عمر حسن'); assert.equal(after.profileId, 'MI20250003');
      assert.deepEqual(after.ids, before.ids); assert.equal(after.attendance, before.attendance); assert.equal(after.statuses, before.statuses);
      assert(await page.locator('#profileStudentCodeInput').isHidden());
      await page.evaluate(() => closeStudentProfile());
    });

    await page.evaluate(() => { lang = 'ar'; applyLanguage(); renderAll(); });
    fs.mkdirSync(REPORTS, { recursive: true });
    const screenshot = path.join(REPORTS, `name-only-roster-${width}.png`);
    await page.locator('#rosterHead').scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshot, animations: 'disabled' }); report.screenshots.push(screenshot);
    await context.close();
  }

  for (const mode of ['server', 'cached', 'prepared-offline']) {
    const { page, context } = await harness.page(); await installWorkspace(page);
    await check(report, `Roster completeness: ${mode} requires authoritative reads and preserves prepared offline data`, async () => {
      const result = await page.evaluate(async mode => {
        const subject = subjects[0], originalRef = cohortRefForSubject, reads = [];
        subject.rosterLoaded = mode === 'prepared-offline';
        if (mode === 'prepared-offline') session.offlineMode = true;
        const before = JSON.stringify(subject.students);
        cohortRefForSubject = () => ({get:async options=>{reads.push(options);return {exists:true,metadata:{fromCache:mode==='cached'},data:()=>({rosterVersion:1})};}, collection: () => ({ get: async options => {
          reads.push(options);
          return { metadata: { fromCache: mode === 'cached' }, forEach(callback) { this.docs.forEach(callback); }, docs: [
            { id: 'SERVER-STUDENT', data: () => ({ id: 'SERVER-STUDENT', name: 'طالب مكتمل من الخادم' }) }
          ] };
        } }) });
        let error = '';
        try { await ensureCohortRosterLoaded(subject); } catch (failure) { error = failure.message; }
        finally { cohortRefForSubject = originalRef; }
        return { reads, error, before, after: JSON.stringify(subject.students), loaded: subject.rosterLoaded };
      }, mode);
      if (mode === 'prepared-offline') { assert.deepEqual(result.reads, []); assert.equal(result.after, result.before); assert.equal(result.loaded, true); }
      else {
        assert.deepEqual(result.reads, [{ source: 'server' },{source:'server'}]);
        if (mode === 'cached') { assert(result.error); assert.equal(result.loaded, false); assert.equal(result.after, result.before); }
        else { assert.equal(result.error, ''); assert.equal(result.loaded, true); assert(result.after.includes('SERVER-STUDENT')); }
      }
    });
    await context.close();
  }

  for (const mutation of ['account', 'workspace', 'same-account-session', 'subject', 'roster-reset', 'cohort', 'generation']) {
    const { page, context } = await harness.page(); await installWorkspace(page);
    await check(report, `Roster load revalidates ${mutation} before applying server results`, async () => {
      const result = await page.evaluate(async mutation => {
        const subject = subjects[0], originalRef = cohortRefForSubject;
        subject.rosterLoaded = false;
        const before = JSON.stringify(subject.students);
        let resolveRead;
        cohortRefForSubject = () => ({get:async()=>({exists:true,metadata:{fromCache:false},data:()=>({rosterVersion:1})}), collection: () => ({ get: () => new Promise(resolve => { resolveRead = resolve; }) }) });
        try {
          const loading = ensureCohortRosterLoaded(subject);
          if (mutation === 'account') session.uid = 'changed-user';
          if (mutation === 'workspace') session.workspaceId = 'changed-workspace';
          if (mutation === 'same-account-session') session = { ...session };
          if (mutation === 'subject') subjects[0] = { ...subject };
          if (mutation === 'roster-reset') subject.lastRosterResetId = 'changed-reset';
          if (mutation === 'cohort') subject.rosterCohortId = 'personal_changed_cohort';
          if (mutation === 'generation') cloudLoadGeneration++;
          resolveRead({ metadata: { fromCache: false },forEach(callback){this.docs.forEach(callback);}, docs: [
            { id: 'STALE-STUDENT', data: () => ({ id: 'STALE-STUDENT', name: 'طالب من استجابة قديمة' }) }
          ] });
          await loading;
          return { before, after: JSON.stringify(subject.students), loaded: subject.rosterLoaded,
            activeStudents: JSON.stringify(subjects.map(item => item.students)), pending: cohortRosterLoads.size };
        } finally { cohortRefForSubject = originalRef; }
      }, mutation);
      assert.equal(result.after, result.before); assert.equal(result.loaded, false);
      assert(!result.activeStudents.includes('STALE-STUDENT')); assert.equal(result.pending, 0);
    });
    await context.close();
  }
})().catch(error => { report.pageErrors.push({ error: error.stack || String(error) }); })
  .finally(async () => { if (harness) await harness.close(); saveReport(report, 'name-only-ui-regression'); });
