'use strict';
const { assert, makeReport, check, saveReport, launch, REPORTS, path } = require('./offline-harness.cjs');
const report = makeReport('auth-startup-local-regression');
const uid = 'qa_remembered_teacher';
function fixture(overrides = {}) {
  return { uid, rememberedUser:true, verified:true, authDelay:600,
    records:{ ['attendanceUserWorkspaces/'+uid]:{workspaceId:uid,active:true} },
    responses:{ getPersonalAccountStatus:{status:'approved',emailVerified:true,fullName:'مدرس اختبار'}, openIndividualWorkspace:{workspaceId:uid} }, ...overrides };
}
(async () => {
  const harness = await launch(report, {legacyCloud:true});
  try {
    for(const width of [390,1440]) await check(report, width+'px branded loader animates, fits screen and offers recovery for a stalled Auth callback', async()=>{
      const {page,context}=await harness.page({width,fixture:fixture({authDelay:60000})});
      await page.clock.install();
      await page.reload();
      await page.locator('#authStartup').waitFor({state:'visible'});
      assert.equal(await page.locator('#loginPage').isVisible(),false);
      assert.equal(await page.locator('.startupArc').evaluate(el=>getComputedStyle(el).animationName),'startupOrbit');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(REPORTS,'startup-'+width+'.png')});
      await page.clock.fastForward(12001);
      assert.equal(await page.locator('#authStartupRetry').isVisible(),true);
      assert.match(await page.locator('#authStartupMessage').innerText(),/تأخر فتح حسابك/);
      assert.equal(await page.locator('#authStartup').getAttribute('aria-busy'),'false');
      assert.equal(await page.locator('#appPage').isVisible(),false);
      await page.clock.fastForward(60000);
      await page.locator('#appPage').waitFor({state:'visible'});
      assert.equal(await page.locator('#authStartup').isVisible(),false);
      await context.close();
    });
    await check(report,'A blocked SDK cannot prevent the early watchdog; late loading recovers normally',async()=>{
      const {page,context}=await harness.page();
      await page.clock.install();
      let release;const held=new Promise(resolve=>release=resolve);
      await context.route('https://www.gstatic.com/firebasejs/**',async route=>{await held;await route.fulfill({contentType:'text/javascript',body:'/* delayed synthetic SDK */'});});
      await page.reload({waitUntil:'commit'});
      await page.locator('#authStartup').waitFor({state:'visible'});
      await page.waitForFunction(()=>Boolean(window.HathirStartup));
      await page.clock.fastForward(12001);
      assert.equal(await page.locator('#authStartupRetry').isVisible(),true);
      assert.match(await page.locator('#authStartupMessage').innerText(),/تأخر تحميل التطبيق/);
      assert.equal(await page.locator('#loginPage').isVisible(),false);
      release();
      await page.waitForLoadState('load');
      await page.clock.fastForward(100);
      await page.locator('#loginPage').waitFor({state:'visible'});
      await context.close();
    });
    await check(report,'Saved English and reduced motion apply to startup',async()=>{
      const {page,context}=await harness.page({fixture:fixture({authDelay:60000})});
      await page.evaluate(()=>localStorage.setItem('student_qr_attendance_admin_lang_v1','en'));
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.reload();
      assert.equal(await page.locator('#authStartupMessage').innerText(),'Opening your account');
      assert.equal(await page.locator('.startupArc').evaluate(el=>getComputedStyle(el).animationName),'none');
      await context.close();
    });
    await check(report, 'Remembered approved identity opens main page without login flash, including reload', async () => {
      const {page,context} = await harness.page({fixture:fixture()});
      assert.equal(await page.locator('#loginPage').isVisible(),false);
      await page.locator('#appPage').waitFor({state:'visible'});
      assert.equal(await page.locator('#authStartup').isVisible(),false);
      assert.equal(await page.evaluate(() => session.uid),uid);
      assert.deepEqual(await page.evaluate(() => personalFixture.persistenceCalls),['local']);
      assert.equal(await page.evaluate(() => personalFixture.authCalls.some(x=>x.name==='signInWithEmailAndPassword')),false);
      await page.reload();
      assert.equal(await page.locator('#loginPage').isVisible(),false);
      await page.locator('#appPage').waitFor({state:'visible'});
      await context.close();
    });
    await check(report, 'No remembered identity shows login', async () => {
      const {page,context} = await harness.page();
      await page.locator('#loginPage').waitFor({state:'visible'});
      assert.equal(await page.locator('#appPage').isVisible(),false);
      await context.close();
    });
    for (const state of [{status:'pending',emailVerified:true},{status:'approved',emailVerified:false}]) {
      await check(report, 'Approval and verification remain required: '+JSON.stringify(state), async () => {
        const {page,context} = await harness.page({fixture:fixture({responses:{getPersonalAccountStatus:state}})});
        await page.locator('#loginPage').waitFor({state:'visible'});
        assert.equal(await page.locator('#appPage').isVisible(),false);
        assert.equal(await page.locator('#personalPendingActions').isVisible(),true);
        assert.equal(await page.locator('#authEmail').isVisible(),false);
        assert.equal(await page.locator('#signupTab').isVisible(),false);
        assert.equal(await page.evaluate(() => personalFixture.calls.some(x=>x.name==='openIndividualWorkspace')),false);
        await context.close();
      });
    }
    await check(report, 'Blocked persistent storage does not strand the startup screen', async () => {
      const {page,context} = await harness.page({fixture:fixture({persistenceFails:true})});
      await page.locator('#appPage').waitFor({state:'visible'});
      assert.equal(await page.locator('#authStartup').isVisible(),false);
      await context.close();
    });
    for(const password of ['abcdef','123456'])await check(report,'Six simple characters create a saved pending account: '+password,async()=>{
      const {page,context}=await harness.page({fixture:{responses:{submitPersonalRegistration:{status:'pending'},getPersonalAccountStatus:{status:'pending',emailVerified:false}}}});try{
        await page.locator('#signupTab').click();
        for(const [id,value] of Object.entries({authEmail:'\u200fteacher@example.test',authFirstName:'مدرس',authFatherName:'محمد',authGrandfatherName:'أحمد',authPassword:password,authPasswordConfirm:password}))await page.locator('#'+id).fill(value);
        await page.locator('#emailAuthBtn').click();await page.locator('#personalPendingActions').waitFor({state:'visible'});
        assert.equal(await page.evaluate(()=>personalFixture.authCalls.filter(c=>c.name==='createUserWithEmailAndPassword').length),1);
        assert.equal(await page.locator('#authEmail').inputValue(),'teacher@example.test');
        assert.equal(await page.locator('#authEmail').isVisible(),false);
        await page.locator('#pendingSignOutBtn').click();assert.equal(await page.locator('#authEmail').isVisible(),true);
      }finally{await context.close();}
    });
    await check(report,'First approved account provisions through the server when rules deny an uncreated workspace pointer',async()=>{
      const {page,context}=await harness.page({fixture:fixture({rememberedUser:false,records:{}})});try{
        await page.evaluate(async()=>{
          fixtureAuth.currentUser=fixtureUser();const collection=db.collection.bind(db);let provisioned=false;
          db.collection=name=>{const ref=collection(name);if(name==='attendanceUserWorkspaces'){const doc=ref.doc.bind(ref);ref.doc=id=>{const r=doc(id),get=r.get.bind(r);r.get=async()=>{if(!provisioned)throw Object.assign(Error('Not provisioned'),{code:'permission-denied'});return get();};return r;};}return ref;};
          const invoke=fixtureInvoke;window.fixtureInvoke=async(name,data)=>{const result=await invoke(name,data);if(name==='openIndividualWorkspace'){provisioned=true;personalFixture.records['attendanceUserWorkspaces/'+personalFixture.uid]={workspaceId:personalFixture.uid,active:true};}return result;};
          await initializeCloudSession(fixtureAuth.currentUser);
        });
        assert.equal(await page.locator('#appPage').isVisible(),true);assert.equal(await page.evaluate(()=>session.uid),uid);
      }finally{await context.close();}
    });
    async function seedOffline(page,owner=uid){
      await page.evaluate(async owner=>{
        const now=Date.now(),subject={id:'saved_subject',titleAr:'مادة محفوظة',departmentId:'medical_devices',stageId:'stage_2',ownerUid:owner,ownerUserId:owner,
          students:[{id:'qa_student',name:'طالب محفوظ'}],archivedStudents:[],attendance:{},lectures:[],lectureMeta:{},excuses:{},attendanceSummaries:{},academicStatuses:{},
          totalHours:60,lectureDurationHours:2,rosterLoaded:true,attendanceLoaded:true,faceTemplatesLoaded:true,offlinePreparedAt:now,attendanceServerReadAt:now};
        await HathirOfflineStore.save({key:HathirOfflineStore.key(owner,subject.id),uid:owner,workspaceId:owner,session:{uid:owner,workspaceId:owner,active:true,local:false,role:'owner',permissions:rolePermissions('owner'),displayName:'مدرس محفوظ'},departments:defaultDepartments(),stages:defaultStages(),subject,savedAt:now});
      },owner);
    }
    await check(report,'Offline reload opens the same prepared account without any server call or login form',async()=>{
      const {page,context}=await harness.page({fixture:fixture({authDelay:0})});try{
        await page.locator('#appPage').waitFor({state:'visible'});await seedOffline(page);
        await context.addInitScript(()=>{Object.defineProperty(navigator,'onLine',{get:()=>false});window.offlineCalls=0;window.fixtureInvoke=async(name,data)=>{if(!(name==='supportChat'&&data?.action==='announcements'))offlineCalls++;throw Object.assign(Error('offline'),{code:'functions/unavailable'});};});
        await page.reload();await page.locator('#appPage').waitFor({state:'visible'});
        assert.equal(await page.evaluate(()=>session.offlineMode),true);assert.equal(await page.locator('#loginPage').isVisible(),false);
        assert.equal(await page.evaluate(()=>offlineCalls),0);assert.equal(await page.evaluate(()=>subjects[0].students[0].name),'طالب محفوظ');
        assert.equal(await page.evaluate(async()=> (await HathirOfflineStore.operations(session.uid)).length),0);
        assert.equal(await page.evaluate(async()=>{enableAudio=async()=>true;beep=async()=>{};return Boolean(await markAttendance('qa_student','manual'));}),true);
        const queued=await page.evaluate(async()=> (await HathirOfflineStore.operations(session.uid)).map(o=>o.id));assert.equal(queued.length,1);
        await page.reload();await page.locator('#appPage').waitFor({state:'visible'});
        assert.deepEqual(await page.evaluate(async()=> (await HathirOfflineStore.operations(session.uid)).map(o=>o.id)),queued);
        assert.equal(await page.evaluate(()=>Object.values(subjects[0].attendance).some(rows=>Object.keys(rows).length===1)),true);

      }finally{await context.close();}
    });
    await check(report,'An unreachable online server times out into the local copy; a late reply cannot replace it',async()=>{
      const {page,context}=await harness.page({fixture:fixture({authDelay:0})});try{
        await page.locator('#appPage').waitFor({state:'visible'});await seedOffline(page);
        await context.addInitScript(()=>{const original=fixtureInvoke;window.fixtureInvoke=(name,data)=>name==='getPersonalAccountStatus'?new Promise(resolve=>{window.releaseAccount=()=>resolve({status:'approved',emailVerified:true});}):original(name,data);});
        await page.clock.install();await page.reload();await page.waitForFunction(()=>typeof releaseAccount==='function');await page.clock.fastForward(8100);
        await page.locator('#appPage').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>session.offlineMode),true);
        await page.evaluate(()=>releaseAccount());await page.waitForTimeout(100);
        assert.equal(await page.evaluate(()=>session.offlineMode),true);
        assert.equal(await page.evaluate(()=>personalFixture.calls.some(c=>c.name==='openIndividualWorkspace')),false);
      }finally{await context.close();}
    });
    await check(report,'A stalled old-operation reset check cannot block local startup or discard the outbox',async()=>{
      const {page,context}=await harness.page({fixture:fixture({authDelay:0})});try{
        await page.locator('#appPage').waitFor({state:'visible'});await seedOffline(page);
        await page.evaluate(async()=>{const snapshot=await HathirOfflineStore.subject(personalFixture.uid,'saved_subject');await HathirOfflineStore.enqueue(snapshot,{id:'qa-retained-close',uid:personalFixture.uid,workspaceId:personalFixture.uid,subjectId:'saved_subject',kind:'close',date:'2026-09-23',rosterResetId:'',preparedAt:snapshot.subject.offlinePreparedAt,createdAt:Date.now(),meta:{status:'completed'}});});
        await context.addInitScript(()=>{
          const original=firebase.firestore;
          const wrap=r=>{const c=r.collection,d=r.doc,g=r.get;if(c)r.collection=x=>wrap(c(x));if(d)r.doc=x=>wrap(d(x));if(g)r.get=(...args)=>r.path.endsWith('/subjects/saved_subject')?(window.resetReadStarted=true,new Promise(()=>{})):g(...args);return r;};
          const factory=()=>{const db=original(),c=db.collection;db.collection=x=>wrap(c(x));return db;};Object.assign(factory,original);firebase.firestore=factory;
        });
        await page.clock.install();await page.reload();await page.waitForFunction(()=>window.resetReadStarted);await page.clock.fastForward(2100);
        await page.locator('#appPage').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>session.offlineMode),true);
        assert.deepEqual(await page.evaluate(async()=> (await HathirOfflineStore.operations(session.uid)).map(o=>o.id)),['qa-retained-close']);
      }finally{await context.close();}
    });
    await check(report,'An offline account cannot open another teacher’s saved workspace',async()=>{
      const {page,context}=await harness.page({fixture:fixture({authDelay:0})});try{
        await page.locator('#appPage').waitFor({state:'visible'});await seedOffline(page,'another_teacher');
        await context.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));await page.reload();
        await page.locator('#personalPendingActions').waitFor({state:'visible'});assert.equal(await page.locator('#appPage').isVisible(),false);
        assert.equal(await page.locator('#authEmail').isVisible(),false);assert((await page.locator('#authStatus').innerText()).includes('لا توجد نسخة محلية'));
        assert.equal(await page.evaluate(()=>fixtureAuth.currentUser.uid),uid);
      }finally{await context.close();}
    });
    await check(report,'An explicit server rejection never falls back to cached approval',async()=>{
      const {page,context}=await harness.page({fixture:fixture({authDelay:0})});try{
        await page.locator('#appPage').waitFor({state:'visible'});await seedOffline(page);
        await context.addInitScript(()=>{window.fixtureInvoke=async()=>{throw Object.assign(Error('Permission denied'),{code:'functions/permission-denied'});};});await page.reload();
        await page.locator('#loginPage').waitFor({state:'visible'});assert.equal(await page.locator('#appPage').isVisible(),false);assert.equal(await page.evaluate(()=>session),null);
        assert.equal(await page.evaluate(()=>fixtureAuth.currentUser),null);
      }finally{await context.close();}
    });
    await check(report, 'Missing configuration leaves login accessible', async () => {
      const {page,context} = await harness.page({runtime:'unprovisioned'});
      await page.locator('#loginPage').waitFor({state:'visible'});
      assert.equal(await page.locator('#authStartup').isVisible(),false);
      await context.close();
    });
  } finally { await harness.close(); saveReport(report,'auth-startup-regression'); }
})().catch(error => {console.error(error);process.exitCode=1;});
