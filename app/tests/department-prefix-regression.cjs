'use strict';

// Candidate-only regression: loopback browser + pure backend helpers. No cloud
// SDK clients, account credentials, deployed reads, or external writes.
const { REPORTS, assert, fs, path, makeReport, check, saveReport, launch } = require('./offline-harness.cjs');
const backend = require('../functions/personal-workspace.js');
const EXPECTED = Object.freeze({ medical_labs: 'MLT', community_health: 'CHT', nursing: 'NT', pharmacy: 'PT',
  forensic_evidence: 'FET', accounting: 'AT', materials_management: 'MMT', legal_administration: 'LAT',
  computer_networks_software: 'CNS', electronic_techniques: 'ELC', power_mechanics: 'PMT', civil_techniques: 'CT',
  mechanical_techniques: 'MT', surveying_techniques: 'ST', medical_devices: 'MI' });
const DISPLAY_EXPECTED={...EXPECTED,electronics_smartphones:'EL-PH',civil_building:'CTB',civil_roads:'CTR'};
const DEFAULT_EXPECTED=Object.fromEntries(Object.entries(DISPLAY_EXPECTED).filter(([id])=>id!=='civil_techniques'));
const report = makeReport('department-prefix-candidate-regression');
report.deploymentScope = 'Local candidate only; prior deployed-smoke reports do not verify these edits.';
let harness;
const plainLabel = value => String(value || '').replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
const expectedLabel = (department, prefix) => department.nameAr.replace(/^\s*قسم\s+/u, '').trim() + ' (' + prefix + ')';

async function workspace(page, { saved = false, locked = false, legacyField = false } = {}) {
  await page.waitForFunction(() => Boolean(window.HathirPersonal && document.getElementById('tourReplay')));
  await page.evaluate(({ saved, locked, legacyField }) => {
    personalFixture.verified = true; personalFixture.accountStatus = 'approved';
    fixtureAuth.currentUser = fixtureUser();
    session = { uid: personalFixture.uid, workspaceId: personalFixture.uid, email: personalFixture.email,
      displayName: 'مدرس اختبار محلي', role: 'owner', active: true, local: false,
      permissions: rolePermissions('owner'), departmentIds: [], stageIds: [], subjectIds: [] };
    membersCache = [session]; departments = defaultDepartments(); stages = defaultStages(); subjects = [];
    activeSubjectId = ''; compactScope = { departmentId: 'medical_devices', stageId: DEFAULT_STAGE_ID, section: '' };
    if (saved) {
      const base = 'attendanceWorkspaces/' + session.uid;
      for (const item of departments) personalFixture.records[base + '/departments/' + item.id] = { ...item };
      for (const item of stages) personalFixture.records[base + '/stages/' + item.id] = { ...item };
      const department = personalFixture.records[base + '/departments/medical_devices'];
      department.nameEn = department.nameAr;
      department.codePrefix = legacyField ? '' : 'MD'; department.codePrefixLocked = locked;
      if (legacyField) department.prefix = 'MD';
    }
    // Leave actual organization loading, prefix resolution, and subject creation
    // intact. Stub only post-save refreshes to isolate the persisted payload.
    loadCloudData = async () => {}; compactRefresh = async () => {};
    scheduleWeeklyAbsenceReview = () => {}; prepareOfflineSubject = async () => {};
    window.prompt = () => 'مادة اختبار محلية';
    document.getElementById('teachingAnnualHours').value = '60';
    document.getElementById('attendanceDurationSelect').value = '2';
  }, { saved, locked, legacyField });
  await page.evaluate(() => loadCloudOrganization());
}

async function createSubject(page, departmentId = 'medical_devices') {
  return page.evaluate(async departmentId => {
    const stage = stages.find(item => item.departmentId === departmentId && Number(item.sort) === 2);
    if (!stage) throw Error('Missing synthetic second stage for ' + departmentId);
    compactScope = { departmentId, stageId: stage.id, section: '' };
    document.getElementById('teachingAnnualHours').value = '60';
    document.getElementById('attendanceDurationSelect').value = '2';
    await compactSubjectAction('__add');
    return personalFixture.writes.filter(item => /\/subjects\//.test(item.path)).at(-1);
  }, departmentId);
}

(async () => {
  await check(report, 'Backend mapping is exactly the 15 requested canonical prefixes', () => {
    assert.deepEqual(backend.DEPARTMENT_PREFIXES, EXPECTED);
    assert.equal(new Set(Object.values(EXPECTED)).size, 15);
  });
  await check(report, 'Backend all 15 known unallocated legacy defaults resolve canonically; locked defaults survive', () => {
    for (const [id, prefix] of Object.entries(EXPECTED)) {
      const legacy = backend.LEGACY_DEPARTMENT_PREFIXES[id];
      assert.equal(backend.resolveDepartmentPrefix(id, { codePrefix: legacy }), prefix, id);
      assert.equal(backend.resolveDepartmentPrefix(id, { codePrefix: legacy, codePrefixLocked: true }), legacy, id);
      const subject = { departmentId: id, stageId: id + '_2', academicYearStart: 2026, stageNumber: 2, departmentPrefix: legacy };
      const stage = { departmentId: id, sort: 2 };
      assert.equal(backend.validateCohort(subject, { codePrefix: legacy }, stage).departmentPrefix, prefix, id);
    }
  });
  await check(report, 'Backend preserves issued MD and rejects contradictory historical reservations', () => {
    assert.equal(backend.resolveDepartmentPrefix('medical_devices', { codePrefix: 'MD' }, {}, ['MD']), 'MD');
    assert.equal(backend.resolveDepartmentPrefix('medical_devices', { codePrefix: 'MI' },
      { personalScopeLocked: true, departmentPrefix: 'MD' }), 'MD');
    assert.throws(() => backend.resolveDepartmentPrefix('medical_devices', { codePrefix: 'MI', codePrefixLocked: true }, {}, ['MD']));
    assert.equal(backend.resolveDepartmentPrefix('custom_local', { codePrefix: 'QA' }), 'QA');
  });
  harness = await launch(report, {legacyCloud:true});
  {
    const { page, context } = await harness.page(); await workspace(page);
    await check(report, 'Frontend mapping and fresh persisted department seeds match the default catalog', async () => {
      const actual = await page.evaluate(() => ({ prefixes: HathirPersonal.prefixes, defaults: defaultDepartments(),defaultStages:defaultStages(),
        stageWrites:personalFixture.writes.filter(item=>/\/stages\//.test(item.path)),
        writes: personalFixture.writes.filter(item => /\/departments\//.test(item.path)) }));
      assert.deepEqual(actual.prefixes, DISPLAY_EXPECTED);
      assert.deepEqual(Object.fromEntries(actual.defaults.map(item => [item.id, item.codePrefix])), DEFAULT_EXPECTED);
      assert.deepEqual(Object.fromEntries(actual.writes.map(item => [item.value.id, item.value.codePrefix])), DEFAULT_EXPECTED);
      assert.deepEqual(actual.stageWrites.map(item=>item.value.id).sort(),actual.defaultStages.map(item=>item.id).sort());
      assert(actual.stageWrites.every(item=>DISPLAY_EXPECTED[item.value.departmentId] && Number.isInteger(item.value.sort)));
      assert(actual.defaults.every(item => /[A-Za-z]/.test(item.nameEn) && item.nameEn !== item.nameAr));
    });
    await check(report, 'Existing workspace receives EL-PH once and retains custom data and deliberate deletion', async () => {
      const actual = await page.evaluate(async () => {
        const base='attendanceWorkspaces/'+session.uid, id='electronics_smartphones';
        personalFixture.records[base]={settings:{customPreference:'keep'}};
        for(const key of Object.keys(personalFixture.records))if(key.includes('/'+id))delete personalFixture.records[key];
        const old=personalFixture.records[base+'/departments/medical_devices'];old.nameAr='قسم محفوظ';
        const before=personalFixture.writes.length;
        await loadCloudOrganization();
        const added=personalFixture.records[base+'/departments/'+id];
        const settings={...personalFixture.records[base].settings};
        const stagesAdded=Object.keys(personalFixture.records).filter(key=>key.includes('/stages/'+id)).length;
        const preserved=personalFixture.records[base+'/departments/medical_devices'].nameAr;
        for(const key of Object.keys(personalFixture.records))if(key.includes('/'+id))delete personalFixture.records[key];
        await loadCloudOrganization();
        const restored=Boolean(personalFixture.records[base+'/departments/'+id]);
        // Restore the fixture for the remaining catalog checks.
        personalFixture.records[base].settings.smartphoneDepartmentAdded=false;
        old.nameAr=defaultDepartments().find(d=>d.id==='medical_devices').nameAr;
        await loadCloudOrganization();
        return {added,settings,stagesAdded,preserved,restored};
      });
      assert.equal(actual.added.codePrefix,'EL-PH');assert.equal(actual.stagesAdded,5);
      assert.equal(actual.settings.customPreference,'keep');assert.equal(actual.settings.smartphoneDepartmentAdded,true);
      assert.equal(actual.preserved,'قسم محفوظ');assert.equal(actual.restored,false);
    });
    for (const locale of ['ar', 'en']) {
      await check(report, 'All 17 current default department options retain Arabic names and canonical abbreviations in ' + locale, async () => {
        const actual = await page.evaluate(locale => {
          lang = locale; applyLanguage(); renderSubjectSelect(); renderSubjectSelect();
          const select = document.getElementById('attendanceDepartmentSelect');
          const style = getComputedStyle(select);
          return { defaults: defaultDepartments(), options: Array.from(select.options, item => ({ id: item.value, label: item.textContent })),
            selected: select.value, dir: select.dir, direction: style.direction, textAlign: style.textAlign,
            prefixFields: document.querySelectorAll('#personalDepartmentPrefix').length,
            modalText: document.getElementById('teachingSetupModal').textContent,
            yearFields: document.querySelectorAll('#personalAcademicYear').length,
            year: document.getElementById('personalAcademicYear')?.value };
        }, locale);
        const normal = actual.options.filter(item => !item.id.startsWith('__'));
        assert.equal(normal.length, 17);
        for (const department of actual.defaults) {
          const option = normal.find(item => item.id === department.id);
          assert(option, department.id);
          assert.equal(plainLabel(option.label), expectedLabel(department, DISPLAY_EXPECTED[department.id]), department.id);
          assert(option.label.includes('\u2066(' + DISPLAY_EXPECTED[department.id] + ')\u2069'), 'Latin abbreviation is directionally isolated: ' + department.id);
        }
        assert.equal(actual.selected, 'medical_devices');
        assert.equal(actual.dir, 'rtl'); assert.equal(actual.direction, 'rtl'); assert.equal(actual.textAlign, 'right');
        assert.deepEqual(actual.options.filter(item => item.id.startsWith('__')).map(item => plainLabel(item.label)),
          locale === 'ar' ? ['+ إضافة قسم', '✎ تعديل القسم'] : ['+ Add department', 'Edit department']);
        assert.equal(actual.prefixFields, 0);
        assert(!/اختصار القسم الداخلي|Internal department prefix|للترميز داخل حاضر|Used by Hathir, not an official university code/.test(actual.modalText));
        assert.equal(actual.yearFields, 0); assert.equal(actual.year, undefined);
      });
    }
    await check(report, 'Custom department shows its effective QA abbreviation without changing stored data', async () => {
      const actual = await page.evaluate(() => {
        const before = personalFixture.writes.length;
        const previousScope = { ...compactScope };
        const custom = { id: 'custom_qa', nameAr: 'قسم اختبار محلي', nameEn: 'Local QA department', codePrefix: 'QA', active: true };
        departments.push(custom); stages.push(...defaultStagesForDepartment(custom.id));
        try {
          chooseActiveSubjectForPicker(custom.id); renderSubjectSelect();
          const select = document.getElementById('attendanceDepartmentSelect');
          return { selected: select.value, label: select.selectedOptions[0].textContent, writes: personalFixture.writes.length - before };
        } finally {
          departments = departments.filter(item => item.id !== custom.id);
          stages = stages.filter(item => item.departmentId !== custom.id);
          compactScope = previousScope; renderSubjectSelect();
        }
      });
      assert.equal(actual.selected, 'custom_qa'); assert.equal(plainLabel(actual.label), 'اختبار محلي (QA)');
      assert.equal(actual.writes, 0);
    });
    await check(report, 'Existing cloud workspace gets both civil branches once without changing saved records', async()=>{
 const result=await page.evaluate(async()=>{
  const base='attendanceWorkspaces/'+session.uid;personalFixture.records[base]={settings:{keep:'yes'}};
  for(const k of Object.keys(personalFixture.records))if(/\/(civil_building|civil_roads)(?:_stage_\d+)?$/.test(k))delete personalFixture.records[k];
  const protectedStage={id:'civil_building_stage_2',departmentId:'civil_building',nameAr:'مرحلة محفوظة',sort:2,keep:'yes'};
  personalFixture.records[base+'/stages/'+protectedStage.id]=protectedStage;
  const original=JSON.stringify(protectedStage),before=personalFixture.writes.length;
  await loadCloudOrganization();const added=personalFixture.writes.slice(before),count=personalFixture.writes.length;
  await loadCloudOrganization();return {added:added.map(w=>w.path),repeat:personalFixture.writes.length-count,stageUnchanged:JSON.stringify(personalFixture.records[base+'/stages/'+protectedStage.id])===original,setting:personalFixture.records[base].settings.keep,loaded:departments.filter(d=>['civil_building','civil_roads'].includes(d.id)).length};
 });assert.equal(result.loaded,2);assert.equal(result.added.length,11);assert.equal(result.repeat,0);assert(result.stageUnchanged);assert.equal(result.setting,'yes');
 });
    await check(report, 'Retired civil preset is not seeded; saved legacy department and stages are hidden pending authorized server removal', async () => {
 const state=await page.evaluate(async()=>{
  const base='attendanceWorkspaces/'+session.uid,d={id:'civil_techniques',nameAr:'قسم التقنيات المدنية',nameEn:'Civil Techniques',active:true,codePrefix:'CT'};
  const before=personalFixture.writes.filter(w=>w.path.includes('/civil_techniques')).length;
  personalFixture.records[base+'/departments/'+d.id]=d;
  for(const st of defaultStagesForDepartment(d.id))personalFixture.records[base+'/stages/'+st.id]=st;
  const saved={id:'civil_saved',departmentId:d.id,students:[{id:'saved_student',name:'طالب محفوظ'}],attendance:{'2026-10-01':{saved_student:{time:'09:00',method:'manual'}}}};
  personalFixture.records[base+'/subjects/'+saved.id]=saved;const original=JSON.stringify(saved);
  await loadCloudOrganization();
  return {absent:!defaultDepartments().some(x=>x.id===d.id),protected:isBuiltInDepartment(d.id),loaded:departments.some(x=>x.id===d.id),stage:stages.some(x=>x.departmentId===d.id),unchanged:JSON.stringify(personalFixture.records[base+'/subjects/'+saved.id])===original,newWrites:personalFixture.writes.filter(w=>w.path.includes('/civil_techniques')).length-before};
 });assert(state.absent&&state.protected&&!state.loaded&&!state.stage&&state.unchanged);assert.equal(state.newWrites,0);
});
for (const [id, prefix] of Object.entries(DEFAULT_EXPECTED)) {
      await check(report, 'New subject uses name-based roster without a year or student prefix: ' + id + ' = ' + prefix, async () => {
        const write = await createSubject(page, id);
        assert.equal(write.value.departmentId, id); assert.equal(write.value.departmentPrefix, undefined);
        assert.equal(write.value.academicYearStart, undefined); assert.equal(write.value.stageNumber, undefined); assert.equal(write.value.rosterNaming, 'name');
        assert.match(write.path, /^attendanceWorkspaces\/qa_personal_a\/subjects\/subject_/);
      });
    }
    await check(report, 'New custom department cannot reserve an already canonical prefix', async () => {
      const result = await page.evaluate(async () => {
        compactScope = { departmentId: 'medical_devices', stageId: DEFAULT_STAGE_ID };
        const before = personalFixture.writes.length; let prompts = 0;
        window.prompt = () => ++prompts === 1 ? 'قسم اختبار إضافي' : 'MI';
        try { await compactDepartmentAction('__add'); return { rejected: false }; }
        catch (error) { return { rejected: true, message: error.message, writes: personalFixture.writes.length - before }; }
      });
      assert.equal(result.rejected, true); assert.equal(result.writes, 0);
    });
    await context.close();
  }
  for (const scenario of [{ locked: false, legacyField: false, expected: 'MD' },
    { locked: true, legacyField: false, expected: 'MD' }, { locked: true, legacyField: true, expected: 'MD' }]) {
    const { page, context } = await harness.page(); await workspace(page, { saved: true, ...scenario });
    await check(report, 'Already-created workspace ' + (scenario.locked ? 'locked' : 'unlocked') +
      (scenario.legacyField ? ' legacy prefix field' : ' codePrefix field') + ' loads and creates ' + scenario.expected, async () => {
      const current = await page.evaluate(() => {
        renderSubjectSelect();
        const select = document.getElementById('attendanceDepartmentSelect');
        return { department: departmentById('medical_devices'), display: select.selectedOptions[0].textContent, selected: select.value,
          prefixField: Boolean(document.getElementById('personalDepartmentPrefix')),
          writes: personalFixture.writes, saved: personalFixture.records['attendanceWorkspaces/' + session.uid + '/departments/medical_devices'] };
      });
      assert.equal(current.department.codePrefix, scenario.expected);
      assert.equal(current.selected, 'medical_devices');
      assert.equal(plainLabel(current.display), expectedLabel(current.department, scenario.expected));
      assert.equal(current.prefixField, false);
      assert.equal(current.department.codePrefixLocked, scenario.locked);
      assert(current.department.nameEn.includes('Medical Instrumentation'));
      assert.equal(current.writes.length, 0, 'Existing saved organization must not be silently rewritten by loading');
      assert.equal(current.saved.codePrefix || current.saved.prefix, 'MD');
      const write = await createSubject(page); assert.equal(write.value.departmentPrefix, undefined); assert.equal(write.value.rosterNaming, 'name');
    });
    await context.close();
  }
  for(const scenario of ['partial-department','partial-stage','existing-subject','existing-cohort','concurrent-canonical-document']){
    const {page,context}=await harness.page();await workspace(page,{saved:true});
    await check(report,'Create-only bootstrap preserves '+scenario+' without adding or rewriting organization data',async()=>{
      const result=await page.evaluate(async scenario=>{
        const base='attendanceWorkspaces/'+session.uid;
        personalFixture.records={};personalFixture.writes=[];
        const key=scenario==='partial-department'?base+'/departments/medical_devices':scenario==='partial-stage'?base+'/stages/original-stage':scenario==='existing-subject'?base+'/subjects/original-subject':base+'/cohorts/original-cohort';
        if(scenario!=='concurrent-canonical-document')personalFixture.records[key]={id:key.split('/').pop(),nameAr:'بيانات أصلية',codePrefix:'OLD',sort:2,studentCount:17,keep:'unchanged'};
        const originalTransaction=db.runTransaction;
        if(scenario==='concurrent-canonical-document')db.runTransaction=async work=>{
          personalFixture.records[base+'/departments/medical_devices']={id:'medical_devices',nameAr:'قسم متزامن',codePrefix:'RACE',keep:'unchanged'};
          return originalTransaction(work);
        };
        const before=JSON.stringify(personalFixture.records);
        try{await loadCloudOrganization();}finally{db.runTransaction=originalTransaction;}
        return {before,after:JSON.stringify(personalFixture.records),writes:personalFixture.writes,concurrent:personalFixture.records[base+'/departments/medical_devices']};
      },scenario);
      assert.deepEqual(result.writes,[]);
      if(scenario==='concurrent-canonical-document')assert.equal(result.concurrent.codePrefix,'RACE');
      else assert.equal(result.after,result.before);
    });await context.close();
  }
  for (const width of [390, 1440]) {
    const { page, context } = await harness.page({ width }); await workspace(page);
    await check(report, 'Existing workspace receives EL-PH once and retains custom data and deliberate deletion', async () => {
      const actual = await page.evaluate(async () => {
        const base='attendanceWorkspaces/'+session.uid, id='electronics_smartphones';
        personalFixture.records[base]={settings:{customPreference:'keep'}};
        for(const key of Object.keys(personalFixture.records))if(key.includes('/'+id))delete personalFixture.records[key];
        const old=personalFixture.records[base+'/departments/medical_devices'];old.nameAr='قسم محفوظ';
        const before=personalFixture.writes.length;
        await loadCloudOrganization();
        const added=personalFixture.records[base+'/departments/'+id];
        const settings={...personalFixture.records[base].settings};
        const stagesAdded=Object.keys(personalFixture.records).filter(key=>key.includes('/stages/'+id)).length;
        const preserved=personalFixture.records[base+'/departments/medical_devices'].nameAr;
        for(const key of Object.keys(personalFixture.records))if(key.includes('/'+id))delete personalFixture.records[key];
        await loadCloudOrganization();
        const restored=Boolean(personalFixture.records[base+'/departments/'+id]);
        // Restore the fixture for the remaining catalog checks.
        personalFixture.records[base].settings.smartphoneDepartmentAdded=false;
        old.nameAr=defaultDepartments().find(d=>d.id==='medical_devices').nameAr;
        await loadCloudOrganization();
        return {added,settings,stagesAdded,preserved,restored};
      });
      assert.equal(actual.added.codePrefix,'EL-PH');assert.equal(actual.stagesAdded,5);
      assert.equal(actual.settings.customPreference,'keep');assert.equal(actual.settings.smartphoneDepartmentAdded,true);
      assert.equal(actual.preserved,'قسم محفوظ');assert.equal(actual.restored,false);
    });
    for (const locale of ['ar', 'en']) {
      await check(report, width + 'px ' + locale + ' teaching modal shows the inline abbreviation without horizontal overflow', async () => {
        await page.evaluate(locale => { lang = locale; applyLanguage(); showApp(); }, locale);
        await page.evaluate(()=>document.getElementById('teachingSetupBtn').click());
        assert(await page.locator('#teachingSetupModal').isVisible());
        assert.equal(await page.locator('#personalAcademicYear,#legacyImportScopeFields').count(),0);
        const layout = await page.evaluate(() => {
          const select = document.getElementById('attendanceDepartmentSelect');
          const box = select.getBoundingClientRect();
          return { selected: select.selectedOptions[0].textContent, pageFits: document.documentElement.scrollWidth <= innerWidth,
            controlFits: box.left >= 0 && box.right <= innerWidth, direction: getComputedStyle(select).direction,
            textAlign: getComputedStyle(select).textAlign, removedFields: document.querySelectorAll('#personalDepartmentPrefix').length };
        });
        assert.match(plainLabel(layout.selected), /\(MI\)$/);
        assert(layout.pageFits, 'Page must not horizontally overflow'); assert(layout.controlFits, 'Department select must fit the viewport');
        assert.equal(layout.direction, 'rtl'); assert.equal(layout.textAlign, 'right'); assert.equal(layout.removedFields, 0);
        fs.mkdirSync(REPORTS, { recursive: true });
        const file = path.join(REPORTS, 'department-picker-' + locale + '-' + width + '.png');
        await page.screenshot({ path: file, animations: 'disabled' }); report.screenshots.push(file);
        await page.locator('#closeTeachingSetup').click();
      });
    }
    await context.close();
  }
  await check(report, 'Browser completed with no uncaught errors and no network outside loopback', () => {
    assert.deepEqual(report.pageErrors, []);
    assert.equal(report.externalNetwork, 'blocked'); assert.equal(report.cloudWrites, 0);
  });
})().catch(error => { report.cases.push({ label: 'Harness completion', passed: false, error: error.stack }); })
  .finally(async () => { if (harness) await harness.close(); saveReport(report, 'department-prefix-regression'); });
