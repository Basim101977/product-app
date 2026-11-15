/* Personal edition integration. The existing attendance engine remains shared;
 * account lifecycle, roster identity and academic status use personal APIs only. */
(function () {
  'use strict';
  const config = window.HATHIR_RUNTIME_CONFIG || {};
  const $ = id => document.getElementById(id);
  const say = (ar, en) => lang === 'ar' ? ar : en;
  const PREFIXES = Object.freeze({medical_labs:'MLT',community_health:'CHT',nursing:'NT',pharmacy:'PT',forensic_evidence:'FET',accounting:'AT',materials_management:'MMT',legal_administration:'LAT',computer_networks_software:'CNS',electronic_techniques:'ELC',electronics_smartphones:'EL-PH',power_mechanics:'PMT',civil_techniques:'CT',civil_building:'CTB',civil_roads:'CTR',mechanical_techniques:'MT',surveying_techniques:'ST',medical_devices:'MI'});
  const DEPARTMENT_ENGLISH = Object.freeze({medical_labs:'Medical Laboratory Techniques',community_health:'Community Health Techniques',nursing:'Nursing Techniques',pharmacy:'Pharmacy Techniques',forensic_evidence:'Forensic Evidence Techniques',accounting:'Accounting Techniques',materials_management:'Materials Management Techniques',legal_administration:'Legal Administration Techniques',computer_networks_software:'Computer Networks and Software Techniques',electronic_techniques:'Electronic Techniques',electronics_smartphones:'Electronics – Smart Phones',power_mechanics:'Power Mechanics Techniques',civil_techniques:'Civil Techniques',civil_building:'Civil Techniques – Building',civil_roads:'Civil Techniques – Roads',mechanical_techniques:'Mechanical Techniques',surveying_techniques:'Surveying Techniques',medical_devices:'Medical Instrumentation Techniques'});
  // Issued identifiers are immutable. Only unallocated standard departments
  // adopt the approved catalog; the server rechecks allocation atomically.
  const departmentPrefix = department => department?.codePrefix || department?.prefix || PREFIXES[department?.id] || '';
  departmentPickerTitle = department => {
    const name = String(department?.nameAr || department?.nameEn || department?.id || '').replace(/^\s*قسم\s+/u, '').trim();
    const prefix = departmentPrefix(department);
    // Native option labels are plain text: isolate the Latin suffix and its
    // parentheses inside an RTL label, without changing the stored name/code.
    return `\u2067${name}${prefix ? ` \u2066(${prefix})\u2069` : ''}\u2069`;
  };
  const STATUSES = Object.freeze(['', 'مستوفي', 'عبور']);
  let authBusy = false, statusBusy = false, registrationState = null, ownerBadgeBusy = false, accountStatusUid='';
  let lastVerificationSent = 0, accountAttempt = 0;
  function accountWait(promise, milliseconds=8000) {
    let timer;
    return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Account connection timed out.'),{code:'auth/network-request-failed'})),Math.max(1,milliseconds));})]).finally(()=>clearTimeout(timer));
  }
  function accountRecovery(message) {
    if(!auth?.currentUser)return;
    if(session&&!$('appPage').hidden){notify(message,'warn');return;}
    $('loginPage').dataset.accountSaved='true';$('loginPage').hidden=false;
    $('personalPendingActions').hidden=false;$('resendVerificationBtn').hidden=true;
    $('checkApprovalBtn').textContent=say('إعادة فتح الحساب','Retry opening account');
    setAuthStatus(message,'error');
  }
  const pendingImports = new Map();
  const academicStatusWrites = new Map();
  const statusWriteKey = (subjectId,studentId) => JSON.stringify([session?.uid,session?.workspaceId,subjectId,studentId]);
  const cleanName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  function validNamePart(value) {
    const name = cleanName(value);
    return name.length >= 2 && name.length <= 50 && /^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*$/u.test(name) &&
      !/(?:^| )(د|دكتور|دكتورة|الدكتور|الدكتورة|أستاذ|استاذ|استاذة|أستاذة|الأستاذ|الاستاذ|الأستاذة|الاستاذة|مهندس|مهندسة|المهندس|المهندسة|م|السيد|السيدة|dr|doctor|prof|professor|mr|mrs|ms|eng|engineer)(?: |$)/iu.test(name.replace(/\p{M}/gu,''));
  }
  const strongPassword = value => value.length >= 6;
  async function call(name, data = {}) {
    if (!firebaseReady || !auth?.currentUser) throw Error(say('سجّل الدخول أولاً.','Sign in first.'));
    await loadOptionalLibrary('functions');
    return (await firebase.app().functions('us-central1').httpsCallable(name)(data)).data;
  }
  function ownerIdentity(user = auth?.currentUser) {
    return Boolean(user && config.ownerUid && config.ownerEmail && user.uid === config.ownerUid &&
      String(user.email || '').toLowerCase() === String(config.ownerEmail).toLowerCase() &&
      (user.emailVerified || (accountStatusUid===user.uid && registrationState?.isPlatformOwner===true && registrationState?.emailVerificationRequired===false)));
  }
  isPlatformOwnerEmail = email => Boolean(ownerIdentity() && String(email || '').toLowerCase() === String(config.ownerEmail).toLowerCase());
  canManageRegistration = () => Boolean(session && !session.local && session.uid === auth?.currentUser?.uid && ownerIdentity());
  let ownerAccessRequest=null;
  async function refreshOwnerAccess() {
    const user=auth?.currentUser;
    if(!session?.deviceFirst||!navigator.onLine||!user||session.uid!==user.uid||user.uid!==config.ownerUid||
      String(user.email||'').toLowerCase()!==String(config.ownerEmail||'').toLowerCase())return;
    if(ownerAccessRequest)return ownerAccessRequest;
    ownerAccessRequest=(async()=>{
      try{
        const state=await accountWait(call('getPersonalAccountStatus'),12000);
        if(auth?.currentUser!==user||session?.uid!==user.uid||!session.deviceFirst)return;
        accountStatusUid=user.uid;registrationState=state;
        renderAll();window.HathirSettings?.render?.();
      }catch(error){console.warn('Owner account status unavailable:',error.code||error.name);}
      finally{ownerAccessRequest=null;}
    })();
    return ownerAccessRequest;
  }
  window.addEventListener('online',()=>{refreshOwnerAccess();});
  const originalDepartments = defaultDepartments;
  defaultDepartments = () => originalDepartments().map(department => ({...department, nameEn:DEPARTMENT_ENGLISH[department.id] || department.nameEn, codePrefix:PREFIXES[department.id]}));
  ensureCloudOrganization=async snapshots=>{
    if(!session||session.local||!canManageDepartments())return;
    const captured=session,workspaceId=session.workspaceId,uid=session.uid;
    const current=()=>session===captured&&session.uid===uid&&session.workspaceId===workspaceId&&auth?.currentUser?.uid===uid&&canManageDepartments();
    const workspace=workspaceRef();
    const read=async ref=>{const result=await ref.get({source:'server'});if(result.metadata?.fromCache===true)throw Error('Fresh organization setup requires server confirmation.');return result;};
    if(!snapshots){const [departmentSnapshot,stageSnapshot]=await Promise.all([read(workspace.collection('departments')),read(workspace.collection('stages'))]);snapshots={departmentSnapshot,stageSnapshot};}
    if(!current())return;
    if(snapshots.departmentSnapshot.metadata?.fromCache===true || snapshots.stageSnapshot.metadata?.fromCache===true)throw Error('Cached organization data cannot authorize setup.');
    // A partial or existing organization is never backfilled/reformatted by an
    // upgrade. Only a genuinely empty workspace receives the initial catalog.
    if(snapToArray(snapshots.departmentSnapshot).length || snapToArray(snapshots.stageSnapshot).length)return;
    const [oldSubjects,oldCohorts]=await Promise.all([read(workspace.collection('subjects').limit(1)),read(workspace.collection('cohorts').limit(1))]);
    if(!current()||snapToArray(oldSubjects).length||snapToArray(oldCohorts).length)return;
    const records=[...defaultDepartments().map(value=>({ref:workspace.collection('departments').doc(value.id),value})),
      ...defaultStages().map(value=>({ref:workspace.collection('stages').doc(value.id),value}))];
    await db.runTransaction(async transaction=>{
      const existing=await Promise.all(records.map(record=>transaction.get(record.ref)));
      const ws=await transaction.get(workspace);
      // A concurrent tab/admin may have initialized or customized these rows.
      // Transaction retries observe that change and leave every saved row alone.
      if(!current()||existing.some(snapshot=>snapshot.exists))return;
      records.forEach(record=>transaction.set(record.ref,{...record.value,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
      if(ws.exists)transaction.update(workspace,{settings:{...(ws.data()?.settings||{}),smartphoneDepartmentAdded:true}});
    });
  };
  // Explicit catalog addition requested for all existing workspaces. Never
  // rewrite existing departments/stages or resurrect a later deliberate deletion.
  async function ensureSmartphoneDepartment(snapshots){
    const id='electronics_smartphones';
    if(!session||session.local||!canManageDepartments()||snapToArray(snapshots.departmentSnapshot).some(d=>d.id===id))return false;
    const captured=session,workspace=workspaceRef();
    const records=[defaultDepartments().find(d=>d.id===id),...defaultStagesForDepartment(id)].map((value,i)=>({value,ref:workspace.collection(i?'stages':'departments').doc(value.id)}));
    return db.runTransaction(async tx=>{
      const [ws,...existing]=await Promise.all([tx.get(workspace),...records.map(r=>tx.get(r.ref))]);
      if(session!==captured||auth?.currentUser?.uid!==captured.uid||!ws.exists||ws.data()?.settings?.smartphoneDepartmentAdded===true)return false;
      if(existing[0].exists)return false;
      records.forEach((r,i)=>{if(!existing[i].exists)tx.set(r.ref,{...r.value,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});});
      tx.update(workspace,{settings:{...(ws.data()?.settings||{}),smartphoneDepartmentAdded:true}});
      return true;
    });
  }
  async function ensureCivilBranches(snapshots){
    if(!session||session.local||!canManageDepartments())return false;
    const captured=session,workspace=workspaceRef();
    const existingIds=new Set(snapToArray(snapshots.departmentSnapshot).map(d=>d.id));
    const defaults=defaultDepartments().filter(d=>['civil_building','civil_roads'].includes(d.id)&&!existingIds.has(d.id));
    if(!defaults.length)return false;
    const records=defaults.flatMap(d=>[{ref:workspace.collection('departments').doc(d.id),value:d},...defaultStagesForDepartment(d.id).map(s=>({ref:workspace.collection('stages').doc(s.id),value:s}))]);
    return db.runTransaction(async tx=>{
      const [ws,...existing]=await Promise.all([tx.get(workspace),...records.map(r=>tx.get(r.ref))]);
      if(!ws.exists||session!==captured||auth?.currentUser?.uid!==captured.uid||!canManageDepartments())return false;
      let changed=false;records.forEach((r,i)=>{if(!existing[i].exists){tx.set(r.ref,{...r.value,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});changed=true;}});return changed;
    });
  }
  const originalOrganizationLoad=loadCloudOrganization;
  loadCloudOrganization=async()=>{
    let snapshots=await originalOrganizationLoad();
    if(!snapshots)throw Error(say('تعذر تحميل أقسام مساحتك. أعد الاتصال وحاول مجدداً.','Could not load your workspace departments. Reconnect and retry.'));
    // The guarded bootstrap is create-only and does nothing to old workspaces.
    await ensureCloudOrganization(snapshots);
    if(await ensureSmartphoneDepartment(snapshots))snapshots=await originalOrganizationLoad();
    if(await ensureCivilBranches(snapshots))snapshots=await originalOrganizationLoad();
    departments=departments.filter(d=>d.id!=='civil_techniques');stages=stages.filter(s=>s.departmentId!=='civil_techniques');
    departments=departments.map(department=>({...department,codePrefix:departmentPrefix(department),
      nameEn:DEPARTMENT_ENGLISH[department.id] && (!department.nameEn || department.nameEn === department.nameAr)
        ? DEPARTMENT_ENGLISH[department.id] : department.nameEn}));
    return snapshots;
  };
  cohortIdForSubject = subject => {
    if (!subject) return '';
    const pointer=subject.rosterCohortId || '';
    // Clearing a device roster detaches it from shared subjects using a local UUID.
    // This identity is never a legacy cloud cohort document path.
    if(session?.deviceFirst && /^device_[a-f0-9]{32}$/i.test(pointer))return pointer;
    if (/^(?:private_[a-f0-9]{40}|personal_[A-Za-z0-9_-]+|cohort_[A-Za-z0-9_-]+)$/.test(pointer)) return pointer;
    if (pointer) throw Error('Unsupported stored roster pointer; review required.');
    if(subject.rosterNaming==='name')return `cohort_names_${subjectDepartmentId(subject)}__${subjectStageId(subject)}${subjectSection(subject)?'__'+subjectSection(subject):''}${subjectStudyPeriod(subject)==='evening'?'__evening':''}`;
    const legacy=subject.rosterSchemaVersion===1 || (subject.rosterSchemaVersion===undefined && subject.academicYearStart===undefined && subject.stageNumber===undefined);
    if (legacy) return `cohort_${subjectDepartmentId(subject)}__${subjectStageId(subject)}${subjectSection(subject) ? '__' + subjectSection(subject) : ''}${subjectStudyPeriod(subject)==='evening'?'__evening':''}`.replace(/\//g,'_');
    if (!Number.isInteger(subject.academicYearStart) || subject.academicYearStart<2000 || subject.academicYearStart>2100 ||
        !Number.isInteger(subject.stageNumber) || subject.stageNumber<1 || subject.stageNumber>6) throw Error('Incomplete roster identity; review the subject setup without changing its existing roster.');
    return `personal_${subject.academicYearStart}_${subjectDepartmentId(subject)}_${subject.stageNumber}${subjectSection(subject) ? '__' + subjectSection(subject) : ''}${subjectStudyPeriod(subject)==='evening'?'__evening':''}`;
  };
  // Unresolved/subject-local lists must never be merged merely because their
  // department and stage agree. Only a verified central source is shared.
  const rosterSourceKey=subject=>subjectStudyPeriod(subject)+':'+(subject.rosterSource==='cohort' ? 'cohort:'+cohortIdForSubject(subject) : 'subject:'+subject.id);
  sharedRosterPeers=(subject,sourceSubjects=subjects)=>{
    if(!subject)return [];
    const peers=(sourceSubjects || []).filter(item=>rosterSourceKey(item)===rosterSourceKey(subject));
    return peers.length?peers:[subject];
  };
  syncSharedRostersInMemory=(sourceSubjects=subjects)=>{
    const grouped=new Map();
    for(const subject of sourceSubjects || []){const key=rosterSourceKey(subject);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(subject);}
    for(const peers of grouped.values()){
      if(peers.length>1 && peers.every(peer=>peer.rosterLoaded===true)){
        const roster=mergeRosterStudents(peers.map(peer=>peer.students || []));
        for(const peer of peers){peer.students=roster;peer.studentCount=roster.length;}
      }
    }
  };
  applyCohortRosterInMemory=(subject,roster)=>{
    const normalized=mergeRosterStudents([roster || []]);
    for(const peer of sharedRosterPeers(subject)){
      peer.students=normalized;peer.rosterLoaded=true;peer.studentCount=normalized.length;
      peer.faceTemplatesLoaded=peer.rosterSource!=='cohort';
    }
    return normalized;
  };
  // This edition has no local seeded users or central delegation workflow.
  localLogin = () => false;
  loadLocalSession = () => false;
  loadLocalData = () => {
    // Retain any historical local-only data, but do not reactivate its users,
    // normalize it into seeded defaults, or write it during cloud migration.
    localData={users:{},subjects:{},departments:{},stages:{},workspace:{}};
    try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved&&typeof saved==='object'&&!Array.isArray(saved))localData={...localData,...saved,users:saved.users&&typeof saved.users==='object'?saved.users:{}};}catch{}
  };
  const originalFirebaseInit = initFirebase;
  initFirebase = () => { if (config.configured !== false && firebaseConfig?.apiKey && firebaseConfig?.projectId) originalFirebaseInit(); else finishAuthStartup(); };
  const originalOfflineRestore = restoreOfflineSession;
  // This is only the original prepared-cache restore, not a server approval.
  // Auth UID and active own-workspace snapshots are checked by the original
  // restore; online writes and session promotion revalidate server authority.
  restoreOfflineSession = user => user && auth?.currentUser?.uid===user.uid ? originalOfflineRestore(user) : Promise.resolve(false);
  canAccessUsersView = () => false;
  const originalPermissions = hasPermission;
  hasPermission = permission => !['usersManage'].includes(permission) && originalPermissions(permission);
  TEXT.ar.passwordMinimum = '6 خانات على الأقل.';
  TEXT.en.passwordMinimum = 'Use at least 6 characters.';
  TEXT.ar.approvalPending = 'تم حفظ طلبك. فعّل بريدك من رابط التحقق ثم انتظر موافقة المالك. لا تنشئ حساباً أو طلباً آخر؛ ادخل بالحساب نفسه وتابع الحالة هنا.';
  TEXT.en.approvalPending = 'Your request is saved. Verify your email using its link, then wait for owner approval. Do not register again; sign in to this same account to check its status.';
  TEXT.ar.authMissing = 'تعذر الاتصال بخدمة الحسابات. أعد الاتصال وحاول مجدداً؛ لا تنشئ حساباً بديلاً.';
  TEXT.en.authMissing = 'Account service is unavailable. Reconnect and retry; do not create a replacement account.';
  TEXT.ar.bulkHelp = 'الأسماء فقط: اسم الطالب الكامل في كل سطر أو في العمود الأول من Excel. صف العنوان اختياري؛ بطاقات QR الجديدة تعتمد على الاسم الكامل.';
  TEXT.en.bulkHelp = 'Names only: one full student name per line or in the first Excel column. An optional header is accepted. New QR cards use the full name.';
  TEXT.ar.studentProfileRequired = 'أدخل اسم الطالب الكامل أولاً.';
  Object.assign(TEXT.ar,{profileFaceHeading:'بصمة الوجه',profileOpenCamera:'فتح الكاميرا',profileStopCamera:'إيقاف الكاميرا',profileRetryAccess:'إعادة فحص الاتصال والمزامنة',saveFaceFromCamera:'التقاط وحفظ البصمة',saveFaceFromImage:'اختيار صورة وحفظ البصمة'});
  Object.assign(TEXT.en,{profileFaceHeading:'Face enrollment',profileOpenCamera:'Open camera',profileStopCamera:'Stop camera',profileRetryAccess:'Check connection and synchronization',saveFaceFromCamera:'Capture and save',saveFaceFromImage:'Choose image and save'});
  TEXT.en.studentProfileRequired = 'Enter the student’s full name first.';
  TEXT.ar.excelNoRows = 'لم أجد أسماء طلبة. ضع الاسم الكامل في العمود الأول من أول ورقة.';
  TEXT.en.excelNoRows = 'No student names were found. Put each full name in the first column of the first sheet.';
  TEXT.ar.search = 'بحث باسم الطالب';
  TEXT.en.search = 'Search student name';

  function hideStudentIdentityFields() {
    // The profile save path still needs its immutable internal ID. Hide the
    // presentation only; do not remove/reset this input or any roster dataset.
    const input = $('profileStudentCodeInput');
    if (!input) return;
    input.readOnly = true;
    input.disabled = true;
    input.placeholder = '';
    const field = input.closest('.field');
    if (field) { field.hidden = true; field.classList.add('personalStudentIdentityField'); }
    const fields = field?.parentElement;
    if (fields?.classList.contains('grid2')) fields.classList.add('personalNameOnlyFields');
  }

  function pendingMessage(state) {
    if (state.status === 'rejected') return say('هذا الطلب مرفوض. لا تعِد التسجيل؛ راجع المالك بالحساب نفسه.','This request was rejected. Do not register again; contact the owner about this same account.');
    if (state.status === 'unregistered' || state.status === 'not_registered' || state.status === 'missing') return say('الحساب موجود ولم يكتمل حفظ طلبه. أكمل حقول الاسم في إنشاء حساب بالحساب نفسه؛ لن نعيد إنشاء الحساب.','Your account exists but its request is incomplete. Complete the name fields in Create account using this same account; it will not be recreated.');
    if (!state.emailVerified) return say('حسابك محفوظ. افتح رابط التحقق المرسل إلى بريدك (وتحقق من البريد غير المرغوب)، ثم اضغط تحديث الحالة. ' + (state.status === 'approved' ? 'تمت موافقة المالك.' : 'الموافقة من المالك مطلوبة أيضاً.') + ' لا حاجة لإعادة التسجيل.', 'Your account is saved. Open the email verification link (check spam too), then refresh status. ' + (state.status === 'approved' ? 'Owner approval is complete.' : 'Owner approval is also required.') + ' No new registration is needed.');
    return say('تم التحقق من بريدك. طلبك بانتظار موافقة المالك؛ ادخل بالحساب نفسه لاحقاً أو حدّث الحالة، دون إعادة التسجيل.','Your email is verified. Owner approval is pending; sign in to this same account later or refresh status. Do not register again.');
  }
  function showPending(state) {
    registrationState = state;
    $('loginPage').dataset.accountSaved=String(!['unregistered','not_registered','missing'].includes(state.status));
    $('checkApprovalBtn').textContent=say('تحديث حالة الحساب','Refresh account status');
    session = null;
    $('appPage').hidden = true;
    $('loginPage').hidden = false;
    $('personalPendingActions').hidden = false;
    $('resendVerificationBtn').hidden = Boolean(state.emailVerified);
    setAuthStatus(pendingMessage(state), state.status === 'rejected' ? 'error' : 'ok');
  }
  async function sendVerification() {
    const user = auth?.currentUser;
    if (!user || user.emailVerified) return;
    if (Date.now() - lastVerificationSent < 60000) throw Error(say('انتظر دقيقة قبل طلب رابط آخر.','Wait one minute before requesting another link.'));
    await user.sendEmailVerification();
    lastVerificationSent = Date.now();
  }
  initializeCloudSession = async user => {
    if (await window.HathirDeviceWorkspace?.restoreLocal(user)) return true;
    const attempt=++accountAttempt, deadline=Date.now()+8000;
    const wait=async promise=>{const result=await accountWait(promise,deadline-Date.now());if(attempt!==accountAttempt||auth?.currentUser?.uid!==user.uid)throw Object.assign(Error('Account changed.'),{code:'auth/account-changed'});return result;};
    // Verified returning users can reuse a valid token. Unverified/pending users
    // refresh it so an email verification completed elsewhere is recognized.
    if(!user.emailVerified||registrationState){await wait(user.reload());await wait(user.getIdToken(true));}
    else await wait(user.getIdToken());
    const state = await wait(call('getPersonalAccountStatus'));
    if(auth?.currentUser?.uid!==user.uid)return false;
    accountStatusUid=user.uid;
    registrationState = state;
    if ((!state.emailVerified && state.emailVerificationRequired!==false) || (state.status !== 'approved' && !state.isPlatformOwner)) { showPending(state); return false; }
    const pointerRef=db.collection('attendanceUserWorkspaces').doc(user.uid);
    let snapshot;
    // A fresh callable response can carry the same server-side ownership check.
    // Older deployments and unprovisioned workspaces keep the original fallback.
    if(state.workspaceReady===true&&state.workspaceId===user.uid) {
      snapshot={exists:true,data:()=>({workspaceId:user.uid,active:true})};
    } else {
      try {snapshot=await wait(pointerRef.get({source:'server'}));}
      catch(error){if(!/^(firestore\/)?permission-denied$/.test(error.code||''))throw error;}
    }
    // On the first approved entry, rules intentionally deny a pointer read
    // until the server has provisioned the member and workspace. The callable
    // rechecks current approval; a rejected account never gains offline access.
    if(!snapshot?.exists||snapshot.data()?.workspaceId!==user.uid||snapshot.data()?.active===false){
      await wait(call('openIndividualWorkspace'));
      snapshot=await wait(pointerRef.get({source:'server'}));
    }
    const pointer = snapshot.data() || {};
    if (!snapshot.exists || pointer.workspaceId !== user.uid || pointer.active === false) throw Error('Personal workspace ownership mismatch.');
    session = {uid:user.uid, email:user.email || '',displayName:state.fullName || pointer.displayName || user.displayName || user.email,
      workspaceId:user.uid, role:'owner', permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[],active:true,local:false};
    membersCache = [session]; departments = []; stages = []; subjects = []; activeSubjectId = ''; compactScope = null;
    $('personalPendingActions').hidden = true;delete $('loginPage').dataset.accountSaved;
    const generation = ++cloudLoadGeneration;
    cloudDataLoading = true; showApp();
    try {
      if (await window.HathirDeviceWorkspace?.restoreCloud(user)) return true;
      await loadCloudData({hydrateActiveAttendance:false,loadActiveRoster:false,render:false});
      if (!isCurrentCloudLoad(generation,user.uid)) return false;
      if (window.HathirDeviceWorkspace) { await HathirDeviceWorkspace.prepare(user); return true; }
      cloudDataLoading = false; renderAll();
      await hydrateActiveSubjectAttendance();
      return true;
    } catch(error) { cloudDataLoading = false; renderAll(); throw error; }
  };
  const originalSetAuthMode = setAuthMode;
  setAuthMode = mode => {
    originalSetAuthMode(mode);
    document.querySelectorAll('[data-signup-only]').forEach(element => { element.hidden = authMode !== 'signup'; });
    if (registrationState && auth?.currentUser) setAuthStatus(pendingMessage(registrationState),'ok');
  };
  handleEmailAuth = async () => {
    if (authBusy) return;
    const email = $('authEmail').value.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,'').trim(), password = $('authPassword').value;
    $('authEmail').value=email;
    if (!email) return setAuthStatus(say('أدخل البريد الإلكتروني.','Enter your email address.'),'error');
    if (!$('authEmail').checkValidity()) return setAuthStatus(say('صيغة البريد الإلكتروني غير صحيحة. تحقق من الحروف وعدم وجود مسافات داخله.','The email address is invalid. Check its spelling and remove internal spaces.'),'error');
    if (!password) return setAuthStatus(say('أدخل كلمة المرور.','Enter your password.'),'error');
    const isSignup = authMode === 'signup';
    const names = {firstName:cleanName($('authFirstName').value),fatherName:cleanName($('authFatherName').value),grandfatherName:cleanName($('authGrandfatherName').value)};
    if (isSignup && !Object.values(names).every(validNamePart)) return setAuthStatus(say('أدخل الاسم الأول واسم الأب واسم الجد، أسماء فقط دون ألقاب أو أرقام أو علامات. يمكن لكل حقل احتواء اسم مركب.','Enter first, father and grandfather names, without titles, numbers or punctuation. Compound names are accepted.'),'error');
    if (isSignup && !strongPassword(password)) return setAuthStatus(text('passwordMinimum'),'error');
    if (isSignup && password !== $('authPasswordConfirm').value) return setAuthStatus(text('passwordsMismatch'),'error');
    if (!firebaseReady) return setAuthStatus(text('authMissing'),'error');
    authBusy = true; signupInProgress = true; $('emailAuthBtn').disabled = true;
    try {
      setAuthStatus(text('loading'));
      await authPersistenceReady;
      let user = auth.currentUser;
      if (!user || String(user.email).toLowerCase() !== email.toLowerCase()) {
        if (isSignup) {
          try { user = (await auth.createUserWithEmailAndPassword(email,password)).user; }
          catch(error) { if(error.code !== 'auth/email-already-in-use') throw error; user = (await auth.signInWithEmailAndPassword(email,password)).user; }
        } else user = (await auth.signInWithEmailAndPassword(email,password)).user;
      }
      if (isSignup) {
        // Server creates once by UID and never replaces an existing decision.
        await call('submitPersonalRegistration', names);
        await user.updateProfile({displayName:Object.values(names).join(' ')});
        let verificationError = null;
        if (!user.emailVerified) { try { await sendVerification(); } catch(error) { verificationError = error; } }
        $('authPassword').value = ''; $('authPasswordConfirm').value = ''; setAuthMode('login');
        await initializeCloudSession(user);
        if (verificationError) setAuthStatus(pendingMessage(registrationState) + ' ' + say('تعذر إرسال الرابط الآن؛ اضغط إعادة الإرسال. ','The verification link could not be sent; use Resend. ') + verificationError.message,'error');
      } else await initializeCloudSession(user);
    } catch(error) {
      if(error.code==='auth/account-changed')return;
      if(!isSignup&&isOfflineConnectionError(error)&&auth?.currentUser){
        if(await recoverOfflineLogin(auth.currentUser,error))return;
        accountRecovery(say('حسابك محفوظ، لكن تعذر الاتصال ولا توجد نسخة محلية جاهزة على هذا الجهاز. أعد المحاولة عند عودة الإنترنت.','Your account is saved, but the server is unreachable and this device has no ready local copy. Retry when connected.'));return;
      }
      if (isSignup && !session && auth?.currentUser && String(auth.currentUser.email).toLowerCase() === email.toLowerCase()) {
        registrationState = {status:'unregistered',emailVerified:Boolean(auth.currentUser.emailVerified)};
        try { registrationState = await call('getPersonalAccountStatus'); } catch {}
        showPending(registrationState);
        setAuthStatus(pendingMessage(registrationState) + ' ' + (error.message || String(error)),'error');
      } else if (session) notify(error.message || String(error),'error');
      else setAuthStatus(error.message || String(error),'error');
    }
    finally { authBusy = false; signupInProgress = false; $('emailAuthBtn').disabled = false; }
  };
  async function refreshStatus() {
    if (statusBusy || !auth?.currentUser) return;
    statusBusy = true; $('checkApprovalBtn').disabled = true;
    try {
      const user=auth.currentUser;
      if(!navigator.onLine){if(await restoreOfflineSession(user))return;throw Object.assign(Error('Offline'),{code:'auth/network-request-failed'});}
      await initializeCloudSession(user);
    }
    catch(error) {
      if(error.code==='auth/account-changed')return;
      if(isOfflineConnectionError(error)&&await recoverOfflineLogin(auth.currentUser,error))return;
      accountRecovery(isOfflineConnectionError(error)?say('تعذر الاتصال، ولا توجد نسخة محلية جاهزة لهذا الحساب على هذا الجهاز. اتصل بالإنترنت ثم أعد المحاولة.','Cannot connect, and no ready local copy exists for this account on this device. Connect and retry.'):(error.message||String(error)));
    }
    finally { statusBusy = false; $('checkApprovalBtn').disabled = false; }
  }
  syncOwnerRequestBadge = async () => {
    const badge = $('ownerRequestBadge');
    if (!canManageRegistration()) {badge.hidden = true; badge.textContent = ''; return;}
    if (ownerBadgeBusy || badge.dataset.loadedUid === session.uid) return;
    ownerBadgeBusy = true;
    try {
      const result = await call('listPersonalRegistrations',{countOnly:true});
      if (!canManageRegistration()) return;
      const count = result.pendingCount ?? (result.requests || []).filter(request => request.status === 'pending').length;
      badge.textContent = String(count); badge.hidden = !count; badge.dataset.loadedUid = session.uid;
    } catch(error) { console.warn('Registration badge unavailable:',error.code); }
    finally {ownerBadgeBusy = false;}
  };
  let presenceBeatAt=0, presenceBeatUid='', presenceBeatBusy=false, presenceReadAt=0, presenceReadBusy=false;
  function presenceReady(){return session && !session.local && auth?.currentUser?.uid===session.uid && navigator.onLine && document.visibilityState==='visible';}
  async function sendPresence(){
    if(!presenceReady() || presenceBeatBusy)return;
    const uid=session.uid;
    if(presenceBeatUid===uid && Date.now()-presenceBeatAt<90000)return;
    presenceBeatUid=uid;presenceBeatAt=Date.now();presenceBeatBusy=true;
    try{await accountWait(call('accountPresence',{action:'beat'}),10000);}catch{}finally{presenceBeatBusy=false;}
  }
  async function refreshPresence(force=false){
    const list=$('ownerRequestsList');
    if(!list || !list.getClientRects().length || !canManageRegistration())return;
    const nodes=[...list.querySelectorAll('[data-presence-uid]')];
    if(!navigator.onLine){nodes.forEach(node=>{node.textContent=say('حالة الاتصال غير متاحة — جهازك غير متصل','Presence unavailable — you are offline');node.style.color='';});return;}
    if(!presenceReady() || presenceReadBusy || (!force && Date.now()-presenceReadAt<60000) || !nodes.length)return;
    presenceReadAt=Date.now();presenceReadBusy=true;const uid=session.uid;
    try{
      // Read only the rows currently loaded in the owner's requests panel.
      const rows=[];
      for(let offset=0;offset<nodes.length;offset+=100){
        if(!canManageRegistration() || session.uid!==uid)return;
        const result=await accountWait(call('accountPresence',{action:'list',uids:nodes.slice(offset,offset+100).map(node=>node.dataset.presenceUid)}),10000);
        rows.push(...(result.accounts||[]));
      }
      if(!canManageRegistration() || session.uid!==uid)return;
      const accounts=new Map(rows.map(row=>[row.uid,row]));
      nodes.forEach(node=>{
        const row=accounts.get(node.dataset.presenceUid);
        node.style.color=row?.online?'#15803d':'';
        node.textContent=row?.online?say('● متصل الآن','● Online now'):row?.lastSeen?say('● غير متصل · آخر ظهور: ','● Offline · Last seen: ')+new Date(row.lastSeen).toLocaleString(lang==='ar'?'ar-IQ':'en-GB'):say('● لم يُرصد اتصال بعد','● No connection recorded yet');
        node.title=say('حالة تقريبية؛ قد يستغرق ظهور الانقطاع حتى 3 دقائق.','Approximate status; disconnection may take up to 3 minutes to appear.');
      });
    }catch{if(session?.uid===uid)nodes.forEach(node=>{node.textContent=say('حالة الاتصال غير متاحة مؤقتاً','Presence temporarily unavailable');node.style.color='';});}
    finally{presenceReadBusy=false;}
  }
  function presenceTick(){void sendPresence();void refreshPresence();}
  setInterval(presenceTick,15000);
  document.addEventListener('visibilitychange',presenceTick);
  window.addEventListener('online',()=>{presenceBeatAt=0;presenceReadAt=0;presenceTick();});
  window.addEventListener('offline',()=>void refreshPresence());

  let loadedOwnerRequests = [], ownerRequestsUid = '', ownerRequestsGeneration = 0, ownerSearchTimer=0;
  $('ownerRequestsSearch').addEventListener('input',()=>{clearTimeout(ownerSearchTimer);++ownerRequestsGeneration;ownerSearchTimer=setTimeout(()=>loadOwnerRequests(),300);});
  async function showLectureCounts(requests,uid,generation){
    const queue=[...requests];await Promise.all(Array.from({length:3},async()=>{while(queue.length){if(session?.uid!==uid||generation!==ownerRequestsGeneration||!canManageRegistration())return;const row=queue.shift(),id=row.uid||row.id;const el=[...$('ownerRequestsList').querySelectorAll('[data-lecture-count-uid]')].find(e=>e.dataset.lectureCountUid===id);if(!el)continue;try{const r=await call('listPersonalRegistrations',{lectureUid:id});if(session?.uid!==uid||generation!==ownerRequestsGeneration)return;el.textContent=say('المحاضرات: ','Lectures: ')+r.lectureCount;el.title=say('الإجمالي المحفوظ سحابيًا لجميع المواد، دون الملغاة والمحذوفة','Cloud-saved total across all subjects, excluding cancelled and deleted lectures');}catch{if(session?.uid===uid&&generation===ownerRequestsGeneration)el.textContent=say('المحاضرات: تعذر التحميل','Lectures: unavailable');}}}));
  }
  loadOwnerRequests = async (options = {}) => {
    if (!canManageRegistration()) return;
    const uid=session.uid,generation=++ownerRequestsGeneration,cursor=typeof options.cursor==='string'?options.cursor:null;
    if(!cursor||ownerRequestsUid!==uid){loadedOwnerRequests=[];ownerRequestsUid=uid;}
    const status = $('ownerRequestsStatus'); status.textContent = text('loading'); if(!cursor) $('ownerRequestsList').replaceChildren();
    try {
      const search=$('ownerRequestsSearch').value.trim();
      $('ownerRequestsSearch').setAttribute('aria-label',say('بحث التدريسيين','Search teachers'));
      $('ownerRequestsSearch').placeholder=say('اسم التدريسي أو البريد الإلكتروني','Teacher name or email');
      $('ownerLectureCountHelp').textContent='';
      const result = await call('listPersonalRegistrations',{cursor,search});
      if (!canManageRegistration()||session.uid!==uid||generation!==ownerRequestsGeneration) return;
      loadedOwnerRequests=[...new Map([...loadedOwnerRequests,...(result.requests||[])].map(row=>[row.uid||row.id,row])).values()];
      const requests = loadedOwnerRequests;
      status.textContent = requests.length?say('الطلبات: ','Requests: ') + requests.length:say('لا توجد نتائج مطابقة.','No matching results.');
      $('ownerRequestsList').innerHTML = requests.map(request => `<article class="card" style="margin:12px 0;padding:16px"><strong>${escapeHtml(request.fullName || '')}</strong> <span class="small" data-lecture-count-uid="${escapeHtml(request.uid || request.id)}">${say("المحاضرات: جارٍ التحميل…","Lectures: loading…")}</span><p dir="ltr">${escapeHtml(request.email || '')}</p><p>${escapeHtml(request.status === 'approved' ? say('موافق عليه','Approved') : request.status === 'rejected' ? say('مرفوض','Rejected') : say('بانتظار الموافقة','Pending'))}</p>${request.status === 'pending' ? `<div class="miniActions"><button type="button" class="btn" data-request-id="${escapeHtml(request.uid || request.id)}" data-request-decision="approved">${say('موافقة','Approve')}</button><button type="button" class="btn danger" data-request-id="${escapeHtml(request.uid || request.id)}" data-request-decision="rejected">${say('رفض','Reject')}</button></div>` : ''}</article>`).join('');
      $('ownerRequestsList').querySelectorAll('article').forEach((article,index)=>{
        const row=requests[index], verified=row.emailVerified===true, note=document.createElement('p');
        note.className='small muted';note.textContent=row.adminEmailApproved?say('موافق عليه إداريًا دون تحقق البريد','Administratively approved without email verification'):verified?say('تم التحقق من البريد','Email verified'):say('البريد غير متحقق — يمكنك الموافقة إداريًا أو حذف الحساب لإعادة التسجيل','Email unverified — approve administratively or delete the account to register again');
        article.append(note);
        const presence=document.createElement('p');presence.className='small muted';presence.dataset.presenceUid=row.uid||row.id;presence.textContent=say('جارٍ فحص الاتصال…','Checking connection…');article.append(presence);
        const approve=article.querySelector('[data-request-decision="approved"]');
        if(approve){approve.disabled=false;approve.textContent=verified?say('موافقة','Approve'):say('موافقة إدارية','Administrative approval');}
        if(row.status==='rejected'||(row.status==='approved'&&!verified&&!row.adminEmailApproved)){
          const allow=document.createElement('button');allow.type='button';allow.className='btn';allow.dataset.requestId=row.uid||row.id;allow.dataset.requestDecision='approved';allow.textContent=say('موافقة إدارية','Administrative approval');article.append(allow);
        }
        const remove=document.createElement('button');remove.type='button';remove.className='btn danger';remove.dataset.requestId=row.uid||row.id;remove.dataset.requestDecision='deleted';remove.textContent=row.status==='deleting'?say('إكمال حذف الحساب','Retry account deletion'):say('حذف الحساب لإعادة التسجيل','Delete account to register again');article.append(remove);
      });
      if(result.nextCursor){const more=document.createElement('button');more.type='button';more.className='btn';more.dataset.loadOlderRequests='true';more.textContent=say('تحميل طلبات أقدم','Load older requests');more.addEventListener('click',()=>{more.disabled=true;loadOwnerRequests({cursor:result.nextCursor});});$('ownerRequestsList').appendChild(more);}
      void showLectureCounts(requests,uid,generation);
      refreshPresence(true);
      delete $('ownerRequestBadge').dataset.loadedUid; syncOwnerRequestBadge();
    } catch(error) { if(session?.uid!==uid||generation!==ownerRequestsGeneration)return; status.textContent = error.message || String(error); const more=$('ownerRequestsList').querySelector('[data-load-older-requests]');if(more)more.disabled=false; }
  };
  let ownerDecisionBusy=false;
  function confirmOwnerAction(row,decision){
    return new Promise(resolve=>{
      const deletion=decision==='deleted',dialog=document.createElement('dialog');
      dialog.id='ownerActionDialog';dialog.dir=lang==='ar'?'rtl':'ltr';
      dialog.className='modalCard';dialog.style.cssText='width:min(92vw,480px);max-height:85dvh;border:1px solid #dbe4eb;border-radius:20px;padding:24px;box-shadow:0 24px 80px #142b4050;';
      dialog.setAttribute('aria-labelledby','ownerActionTitle');
      dialog.innerHTML=`<form><h2 id="ownerActionTitle"></h2><p id="ownerActionExplanation"></p><p id="ownerActionEmail" dir="ltr" style="overflow-wrap:anywhere"></p><label id="ownerActionEmailLabel" for="ownerActionEmailInput"></label><input id="ownerActionEmailInput" type="email" autocomplete="off" dir="ltr"><p id="ownerActionError" role="alert"></p><div class="miniActions"><button id="ownerActionSubmit" type="submit" class="btn"></button><button id="ownerActionCancel" type="button" class="btn ghost"></button></div></form>`;
      dialog.querySelector('h2').textContent=deletion?say('حذف الحساب لإعادة التسجيل','Delete account to register again'):say('تأكيد الموافقة الإدارية','Confirm administrative approval');
      dialog.querySelector('#ownerActionExplanation').textContent=deletion?say('سيُحذف حساب الدخول ويمكن التسجيل بالبريد نفسه مجددًا. تبقى بيانات المساحة القديمة محفوظة ولن تنتقل للحساب الجديد.','The login account will be deleted so this email can register again. Old workspace data stays retained and does not transfer.'):say('سيُسمح لهذا الحساب بالدخول دون انتظار التحقق من البريد.','This account will be allowed to sign in without waiting for email verification.');
      dialog.querySelector('#ownerActionEmail').textContent=row.email;
      const input=dialog.querySelector('input'),label=dialog.querySelector('label'),submit=dialog.querySelector('#ownerActionSubmit');
      input.hidden=label.hidden=!deletion;input.required=deletion;label.textContent=say('اكتب البريد أعلاه لتأكيد الحذف','Type the email above to confirm deletion');
      submit.textContent=deletion?say('تأكيد حذف الحساب','Confirm account deletion'):say('تأكيد الموافقة','Confirm approval');submit.classList.toggle('danger',deletion);
      const cancel=dialog.querySelector('#ownerActionCancel');cancel.textContent=say('إلغاء','Cancel');
      let settled=false;const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(value);};
      cancel.onclick=()=>finish(null);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
      dialog.querySelector('form').onsubmit=event=>{event.preventDefault();if(deletion&&input.value.trim().toLowerCase()!==row.email.toLowerCase()){dialog.querySelector('#ownerActionError').textContent=say('البريد غير مطابق. اكتب البريد الظاهر أعلاه.','Email does not match. Type the address shown above.');input.focus();return;}finish({confirmEmail:deletion?input.value.trim():undefined});};
      document.body.append(dialog);dialog.showModal();(deletion?input:cancel).focus();
    });
  }
  decideOwnerRequest = async (uid, decision) => {
    if (ownerDecisionBusy || !canManageRegistration() || !['approved','rejected','deleted'].includes(decision)) return;
    const row=loadedOwnerRequests.find(r=>(r.uid||r.id)===uid);if(!row)return;
    const actingUid=session.uid;ownerDecisionBusy=true;
    const status=$('ownerRequestsStatus');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    try{
      let confirmation={};
      if(decision==='deleted'||(decision==='approved'&&!row.emailVerified)){
        confirmation=await confirmOwnerAction(row,decision);if(!confirmation)return;
      }
      if(!canManageRegistration()||session.uid!==actingUid)return;
      document.querySelectorAll('[data-request-decision]').forEach(button=>{button.disabled=true;});
      status.textContent=say('جارٍ تنفيذ الإجراء…','Applying account action…');status.scrollIntoView({block:'nearest'});
      const result=await call('approvePersonalAccount',{uid,status:decision,...(decision==='deleted'?{confirmEmail:confirmation.confirmEmail}:{allowUnverified:decision==='approved'&&!row.emailVerified})});
      if(result.uid!==uid||result.status!==decision)throw Error(say('لم يؤكد الخادم تنفيذ الإجراء. حدّث القائمة.','The server did not confirm the action. Refresh the list.'));
      if(!canManageRegistration()||session.uid!==actingUid)return;
      await loadOwnerRequests();
      status.textContent=decision==='deleted'?say('تم حذف حساب الدخول. يمكن التسجيل بالبريد نفسه مجددًا.','Login account deleted. This email can register again.'):decision==='approved'?say('تمت الموافقة على الحساب. يمكن للتدريسي تحديث حالة الحساب أو تسجيل الدخول.','Account approved. The teacher can refresh account status or sign in.'):say('تم رفض الطلب.','Request rejected.');
      status.scrollIntoView({block:'nearest'});
    }catch(error){if(session?.uid===actingUid){status.textContent=say('تعذر تنفيذ الإجراء: ','Could not apply action: ')+(error.message||String(error));status.scrollIntoView({block:'nearest'});}}
    finally{ownerDecisionBusy=false;document.querySelectorAll('[data-request-decision]').forEach(button=>{button.disabled=false;});}
  };
  ownerInviteMessage = () => {
    const url = new URL(location.pathname,location.origin); url.searchParams.set('signup','1');
    return {url:url.href,message:say('مرحباً بك في حاضر الشخصي. سجّل باسمك الأول واسم الأب واسم الجد وبريدك، واختر كلمة مرور من 6 خانات على الأقل. افتح رابط التحقق في بريدك ثم انتظر موافقة المالك. ستكون لك مساحة مستقلة لإدارة موادك وطلبتك وحضورهم. لا تعِد التسجيل أثناء الانتظار.','Welcome to Hathir Personal. Register with your first, father and grandfather names, your email, and a password of at least 6 characters. Open the email verification link, then wait for owner approval. Your subjects, students and attendance have a private workspace. Do not register again while waiting.')+'\n'+url.href};
  };
  const originalOpenRequests = openOwnerRegistration;
  openOwnerRegistration = async () => {
    await originalOpenRequests();
    $('ownerRegistrationHint').textContent='';
  };

  isStudentHeader = first => /^(name|full\s*name|student\s*name|الاسم|الاسم\s*الكامل|اسم\s*الطالب|أسماء\s*الطلبة|اسماء\s*الطلبة)$/i.test(cleanName(first));
  buildStudentFromPair = first => { const name = cleanName(first); return /\p{L}/u.test(name) && !isStudentHeader(name) ? {name} : null; };
  const importNameCell = row => {
    const cells = Array.isArray(row) ? row : [row];
    const first = cleanName(cells[0]);
    // Numbered rosters put a serial number before the name. Never import it as a name.
    return /^[0-9٠-٩۰-۹]+[.)-]?$/.test(first) ? cells[1] : cells[0];
  };
  parseStudentLine = line => {
    const raw = String(line || '').trim();
    const cells=[];let cell='',quoted=false;
    for(let i=0;i<raw.length;i++){
      const char=raw[i];
      if(char==='"'){if(quoted&&raw[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
      else if(!quoted&&/[\t,;]/.test(char)){cells.push(cell);cell='';}
      else cell+=char;
    }
    cells.push(cell);
    if(cells.some(isStudentHeader))return null;
    return buildStudentFromPair(importNameCell(cells));
  };
  parseStudentRows = rows => {
    const parsed = []; let skipped = 0, nameColumn = null;
    rows.forEach(row => {
      const cells=Array.isArray(row)?row:[row];
      const header=cells.findIndex(isStudentHeader);
      if(header>=0){nameColumn=header;return;}
      const value=nameColumn===null?importNameCell(cells):cells[nameColumn];
      const student=buildStudentFromPair(value);
      if(student)parsed.push(student);
      else if(cells.some(value=>cleanName(value)))skipped++;
    });
    return {parsed,skipped};
  };
  ensureCohortRosterLoaded = async subject => {
    if (!subject || !session || usesLocalWorkspace(session) || subject.rosterLoaded === true) return subject;
    const capturedSession=session, uid=session.uid, workspaceId=session.workspaceId, cohortId=cohortIdForSubject(subject);
    const mutationScope=attendanceMutationScope(subject), generation=cloudLoadGeneration;
    const loadKey=JSON.stringify([uid,workspaceId,subject.id,cohortId,mutationScope.rosterResetId,generation]);
    if (cohortRosterLoads.has(loadKey)) return cohortRosterLoads.get(loadKey);
    const current=()=>session===capturedSession && session?.uid===uid && session?.workspaceId===workspaceId &&
      cloudLoadGeneration===generation && attendanceMutationScopeValid(mutationScope) && cohortIdForSubject(subject)===cohortId;
    const loading=(async()=>{
      // A cached query may contain only the rows individually read so far. It
      // cannot establish name uniqueness or promote that roster to complete.
      const read=async ref=>{const result=await ref.get({source:'server'});if(result.metadata?.fromCache===true)throw Error('A complete server roster is required.');return result;};
      const cohort=cohortRefForSubject(subject),subjectRef=workspaceRef().collection('subjects').doc(subject.id);
      const [parent,central]=await Promise.all([read(cohort),read(cohort.collection('students'))]);
      let docs=snapToArray(central),roster,source='cohort';
      const authoritative=Boolean(subject.rosterCohortId || Number(parent.data()?.rosterVersion || 0)>=1 || docs.length);
      if(!authoritative){
        const legacy=await read(subjectRef.collection('students'));docs=snapToArray(legacy);source='subcollection';
        if(!docs.length){
          const fresh=await read(subjectRef),data=fresh.data() || {};
          if(!fresh.exists || (data.rosterCohortId || '')!==(subject.rosterCohortId || '') ||
              (data.lastRosterResetId || '')!==mutationScope.rosterResetId)throw Error('The roster changed; reload before continuing.');
          source='embedded';
          // Attendance clearing never removes students. A roster reset does.
          roster=subject.lastRosterResetId?[]:(Array.isArray(data.students)?data.students:[]).map(normalizeStudentRecord);
        }
      }
      if(!roster)roster=docs.map(normalizeCloudStudent);
      if(roster.some(student=>!student.id||!student.name) || new Set(roster.map(student=>student.id)).size!==roster.length)throw Error('The saved roster contains incomplete or duplicate identities; review required.');
      if(!current()) return subject;
      subject.rosterSource=source;
      subject._rosterDocumentIds=Object.fromEntries(docs.map(doc=>[normalizeCloudStudent(doc).id,doc.id]));
      subject._rosterBaseline=Object.fromEntries(roster.map(student=>[student.id,rosterStudentFingerprint(student)]));
      applyCohortRosterInMemory(subject,roster);
      for(const peer of sharedRosterPeers(subject)){
        peer._rosterDocumentIds={...subject._rosterDocumentIds};peer._rosterBaseline={...subject._rosterBaseline};
      }
      return subject;
    })().finally(()=>{if(cohortRosterLoads.get(loadKey)===loading)cohortRosterLoads.delete(loadKey);});
    cohortRosterLoads.set(loadKey,loading); return loading;
  };
  scheduleCohortFaceTemplateMigration = () => {};
  const originalFaceLoad=ensureSubjectFaceTemplatesLoaded;
  ensureSubjectFaceTemplatesLoaded=async(subject,options={})=>{
    if(!subject||usesLocalWorkspace(session))return subject;
    if(options.force && ['embedded','subcollection'].includes(subject.rosterSource))subject.rosterLoaded=false;
    await ensureSubjectRosterLoaded(subject);
    if(subject.rosterSource==='cohort'){
      const result=await originalFaceLoad(subject,options);
      for(const peer of sharedRosterPeers(subject))peer._rosterBaseline=Object.fromEntries((peer.students||[]).map(student=>[student.id,rosterStudentFingerprint(student)]));
      return result;
    }
    if(!['subcollection','embedded'].includes(subject.rosterSource))throw Error('Roster source must be verified before loading faces.');
    subject.faceTemplateDescriptors=new Map((subject.students || []).map(student=>[student.id,getFaceDescriptors(student)]));
    subject.faceTemplatesLoaded=true;return subject;
  };
  const rosterStudentFingerprint=student=>JSON.stringify([student.name,getFaceDescriptors(student)]);
  persistCohortRoster = async (subject,roster,options={}) => {
    if (!subject || session?.local) return;
    if(!subject.rosterLoaded || !['cohort','subcollection','embedded'].includes(subject.rosterSource))throw Error('Verify the complete original roster before editing.');
    const normalized=mergeRosterStudents([roster]),removedIds=uniqueIds(options.removedIds || []);
    const changed=normalized.filter(student=>subject._rosterBaseline?.[student.id]!==rosterStudentFingerprint(student));
    const updates=changed.map(student=>({studentId:student.id,name:student.name,
      faceDescriptor:student.faceDescriptor || null,faceDescriptors:getFaceDescriptors(student),faceDescriptorMap:faceDescriptorMapFromList(getFaceDescriptors(student))}));
    if(subject.rosterSource==='embedded'){
      if(updates.length>300)throw Error('Edit at most 300 legacy rows at a time; the roster has not been replaced.');
      if(updates.length || removedIds.length)await call('updateLegacyEmbeddedRoster',{workspaceId:session.workspaceId,subjectId:subject.id,updates,removedIds});
      subject._rosterBaseline=Object.fromEntries(normalized.map(student=>[student.id,rosterStudentFingerprint(student)]));
      return;
    }
    const cohort=subject.rosterSource==='cohort'?cohortRefForSubject(subject):workspaceRef().collection('subjects').doc(subject.id),operations=[];
    // Allocation and metadata are server-only. Existing student IDs cannot be
    // changed through profiles; updating a name never reallocates its code.
    changed.forEach(student=>{
      const documentId=subject._rosterDocumentIds?.[student.id];
      if(!documentId)throw Error('An existing roster document is required; use the names import to allocate new students.');
      if(subject.rosterSource==='subcollection'){
        const update=updates.find(value=>value.studentId===student.id),{studentId,faceDescriptors,...data}=update;
        data.faceTemplateCount=faceDescriptors.length;
        operations.push({type:'update',ref:cohort.collection('students').doc(documentId),data:{...data,updatedAt:serverTimestamp(),updatedBy:session.uid}});return;
      }
      operations.push({type:'update',ref:cohort.collection('students').doc(documentId),data:{name:student.name,updatedAt:serverTimestamp(),updatedBy:session.uid}});
      const face=faceTemplateDocumentPayload(student);
      if(face) operations.push({type:'set',ref:cohort.collection('faceTemplates').doc(student.id),data:face});
      else if(subject.faceTemplatesLoaded) operations.push({type:'delete',ref:cohort.collection('faceTemplates').doc(student.id)});
    });
    removedIds.forEach(id=>{const documentId=subject._rosterDocumentIds?.[id];if(!documentId)throw Error('Original roster document missing; reload before deleting.');operations.push({type:'delete',ref:cohort.collection('students').doc(documentId)});if(subject.rosterSource==='cohort')operations.push({type:'delete',ref:cohort.collection('faceTemplates').doc(id)});});
    for(let index=0;index<operations.length;index+=400) {
      const batch=db.batch();operations.slice(index,index+400).forEach(operation=>{
        if(operation.type==='delete')batch.delete(operation.ref);
        else if(operation.type==='update')batch.update(operation.ref,operation.data);
        else batch.set(operation.ref,operation.data,{merge:true});
      });await batch.commit();
    }
    for(const peer of sharedRosterPeers(subject))peer._rosterBaseline=Object.fromEntries(normalized.map(student=>[student.id,rosterStudentFingerprint(student)]));
  };
  async function importNames(names, skipped = 0) {
    if (session?.deviceFirst) return HathirDeviceWorkspace.importNames(names,skipped);
    if (!requireSingleSection()) return [];
    const subject = getSubject();
    if (!canManageStudents(subject)) throw Error(text('noPermission'));
    await ensureSubjectRosterLoaded(subject);
    names = names.map(cleanName).filter(Boolean);
    if (!names.length) throw Error(text('excelNoRows'));
    if (names.length > 700) throw Error(say('الحد 700 اسم في الاستيراد الواحد. قسّم الملف إلى قوائم أصغر ثم استوردها إلى المادة نفسها.','Import up to 700 names at a time. Split this file into smaller lists and import them into the same subject.'));
    const allowDuplicateNames = true;
    const importKey = JSON.stringify([session.uid,subject.id,names,allowDuplicateNames]);
    let operation = pendingImports.get(importKey);
    if (operation?.busy) return [];
    if (!operation) {
      // Persist only a payload digest and random receipt, never roster names.
      // A refresh after an uncertain upload reuses the server receipt as well.
      let key='';
      if(crypto.subtle) {
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(importKey));
        key='hathir-personal-name-import-v1:'+Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
      }
      let id='';try{if(key)id=sessionStorage.getItem(key)||'';}catch{}
      if(!/^[A-Za-z0-9_-]{16,100}$/.test(id))id=crypto.randomUUID();
      try{if(key)sessionStorage.setItem(key,id);}catch{}
      operation = {id,key,busy:false}; pendingImports.set(importKey,operation);
    }
    operation.busy = true;
    try {
      let result={students:[],added:0};
      for(let offset=0;offset<names.length;offset+=300){
        const part=await call('importPersonalStudents',{workspaceId:session.workspaceId,subjectId:subject.id,names:names.slice(offset,offset+300),plannedNamesCount:names.length-offset,operationId:names.length>300?operation.id+'_'+offset:operation.id,allowDuplicateNames,nameOnly:true});
        result={...part,students:[...result.students,...(part.students||[])],added:result.added+Number(part.added??part.created??part.students?.length??0)};
      }
      if (/^[A-Z]{2,6}$/.test(result.departmentPrefix || '')) {
        subject.departmentPrefix = result.departmentPrefix;
        subject.personalScopeLocked = true;
        const department = departmentById(subject.departmentId);
        if (department) { department.codePrefix = result.departmentPrefix; department.codePrefixLocked = true; }
      }
      if (/^(?:private_[a-f0-9]{40}|personal_[A-Za-z0-9_-]+|cohort_[A-Za-z0-9_-]+)$/.test(result.cohortId || '')) subject.rosterCohortId = result.cohortId;
      // The API may return only newly allocated/reused rows; merge with live roster.
      subject.rosterLoaded=false;
      await ensureSubjectRosterLoaded(subject);
      if (els.bulkStudents) els.bulkStudents.value = '';
      buildStudentCache(); renderAll();
      notify(text('importDone',{added:result.added ?? result.created ?? (result.students || []).length,skipped:skipped + Number(result.skipped || 0)}),'ok');
      window.HathirOnboarding?.completed('students');
      pendingImports.delete(importKey);try{if(operation.key)sessionStorage.removeItem(operation.key);}catch{}
      return result.students || [];
    } finally {operation.busy = false;}
  }
  importParsedStudents = (students, skipped = 0) => importNames(students.map(student=>student.name),skipped);
  let fileImportBusy=false;
  function fileImportProgress(file,subject) {
    const dialog=document.createElement('dialog');dialog.id='studentImportProgress';dialog.className='beginnerRosterDialog';
    const body=document.createElement('div');body.className='beginnerRosterBody';
    const title=document.createElement('h2');title.textContent=say('رفع قائمة الطلبة','Import student list');
    const target=document.createElement('p');target.textContent=(subject?subjectTitle(subject)+' — ':'')+file.name;
    const status=document.createElement('p');status.id='studentImportProgressStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const close=document.createElement('button');close.className='btn';close.type='button';close.textContent=say('إغلاق','Close');close.disabled=true;
    close.onclick=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(fileImportBusy)event.preventDefault();});dialog.onclose=()=>dialog.remove();
    body.append(title,target,status,close);dialog.append(body);document.body.append(dialog);dialog.showModal();
    return {update(message){status.textContent=message;},finish(message,error=false){status.textContent=message;status.dataset.state=error?'error':'success';close.disabled=false;close.focus();}};
  }
  importStudentsFromFile = async event => {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(fileImportBusy)return;
    fileImportBusy=true;
    const uid=session?.uid,subject=getSubject(),subjectId=subject?.id;
    const progress=fileImportProgress(file,subject);
    try {
      if(!subject)throw Error(say('اختر المادة التي تريد إضافة الطلبة إليها أولًا.','Choose the destination subject first.'));
      if(selectedSections().length>1)throw Error(say('اختر شعبة واحدة ثم أعد رفع الملف.','Select one section, then import the file again.'));
      if(!canManageStudents(subject))throw Error(text('noPermission'));
      if (file.size > HathirSpreadsheetImport.maxBytes) throw Error('FILE_TOO_LARGE');
      progress.update(say('جارٍ قراءة الملف…','Reading file…'));
      let result;
      if(isExcelFile(file)) {
        const rows = await HathirSpreadsheetImport.read(file);
        result=parseStudentRows(rows);
      } else {
        const parsed=[];let skipped=0;
        const content=await accountWait(file.text(),15000);
        for(const line of content.split(/\r?\n/)){const student=parseStudentLine(line);if(student)parsed.push(student);else if(line.trim())skipped++;}
        result={parsed,skipped};
      }
      if(!result.parsed.length)throw Error(text('excelNoRows'));
      if(session?.uid!==uid||getSubject()?.id!==subjectId)throw Error(say('تغيّر الحساب أو المادة أثناء قراءة الملف. أعد اختيار المادة ورفع الملف.','Account or subject changed while reading. Select the subject and import again.'));
      progress.update(say('جارٍ حفظ ','Saving ')+result.parsed.length+say(' اسمًا…',' names…'));
      const imported=await importParsedStudents(result.parsed,result.skipped);
      if(!Array.isArray(imported)||!imported.length)throw Error(say('لم تُضف أسماء. راجع المادة والشعبة المختارتين ثم أعد المحاولة.','No names were added. Check the selected subject and section, then retry.'));
      progress.finish(text('importDone',{added:imported.length,skipped:result.skipped}));
    } catch(error) {
      const messages = {
        FILE_TOO_LARGE: ['حجم الملف أكبر من 5 ميغابايت. قسّم القائمة إلى ملفات أصغر.', 'File exceeds 5 MB. Split the roster into smaller files.'],
        FILE_READ_TIMEOUT: ['تعذر فتح الملف من جهازك في الوقت المحدد. احفظ نسخة في التنزيلات وتأكد من اكتمال تنزيلها ثم أعد المحاولة.', 'Reading the file timed out. Save a fully downloaded copy in Downloads and retry.'],
        SHEET_TOO_LARGE: ['الورقة كبيرة جدًا؛ استخدم قائمة أسماء لا تتجاوز 1000 صف و32 عمودًا.', 'Use a roster sheet of at most 1000 rows and 32 columns.'],
        PARSE_TIMEOUT: ['استغرقت قراءة الملف وقتًا طويلًا. جرّب ملفًا أصغر أو CSV.', 'Parsing timed out. Try a smaller file or CSV.'],
        INVALID_FILE: ['تعذر قراءة الملف. تحقق من صيغته ثم أعد المحاولة.', 'Cannot read this file. Check its format and retry.'],
        EMPTY_SHEET: [text('excelNoRows'), text('excelNoRows')],
        WORKER_UNAVAILABLE: ['المتصفح لا يدعم قراءة Excel المعزولة. استخدم CSV.', 'This browser cannot safely parse Excel. Use CSV.']
      };
      progress.finish(messages[error.message] ? say(...messages[error.message]) : error.message || text('fileReadFailed'),true);
    } finally {fileImportBusy=false;}
  };
  addStudent = async () => { const rows = await importNames([els.studentName.value]); if(rows.length) els.studentName.value = ''; };
  const originalProfile = renderStudentProfile;
  let profileQrKey='',profileQrCanvas=null,profileQrOwner=null,profileQrGeneration=0;
  function clearProfileQr(){
    profileQrGeneration++;profileQrKey='';profileQrCanvas=null;profileQrOwner=null;
    $('profileQrImage').hidden=true;$('profileQrImage').removeAttribute('src');
    $('profileQrSave').disabled=true;
  }
  function currentProfileQr(){
    const {subject,student}=activeProfile();
    return !els.studentProfileModal.hidden&&student&&subject&&profileQrOwner===session&&profileQrKey===JSON.stringify([session?.uid,session?.workspaceId,subject.id,student.id,student.name]);
  }
  async function renderProfileQr(){
    if(els.studentProfileModal.hidden)return;
    $('profileQrSave').textContent=say('حفظ الصورة','Save image');
    $('profileQrRetry').textContent=say('إعادة المحاولة','Try again');
    const {subject,student}=activeProfile();
    if(!student||studentProfileMode==='new'){clearProfileQr();$('profileQrRetry').hidden=true;$('profileQrName').textContent='';$('profileQrStatus').textContent=say('احفظ الطالب لإظهار QR.','Save the student to display the QR.');return;}
    const key=JSON.stringify([session?.uid,session?.workspaceId,subject.id,student.id,student.name]);
    if(key===profileQrKey&&profileQrOwner===session)return;
    clearProfileQr();profileQrKey=key;profileQrOwner=session;
    $('profileQrName').textContent=student.name;$('profileQrRetry').hidden=true;
    $('profileQrStatus').textContent=say('جارٍ تجهيز QR…','Preparing QR…');
    const captured=session,generation=profileQrGeneration;
    try{
      const canvas=await makeQrCanvas(HathirNameQR.encode(student.name),720);
      if(generation!==profileQrGeneration||profileQrKey!==key||session!==captured||!currentProfileQr())return;
      profileQrCanvas=canvas;$('profileQrImage').src=canvas.toDataURL('image/png');$('profileQrImage').alt=say('QR الطالب: ','Student QR: ')+student.name;
      $('profileQrImage').hidden=false;$('profileQrStatus').textContent='';
      $('profileQrSave').disabled=false;
    }catch(error){
      if(generation!==profileQrGeneration||profileQrKey!==key||session!==captured||!currentProfileQr())return;
      $('profileQrStatus').textContent=say('تعذر تجهيز QR. أعد المحاولة.','Could not prepare the QR. Try again.');$('profileQrRetry').hidden=false;
    }
  }
  const originalProfileClose=closeStudentProfile;
  closeStudentProfile=()=>{clearProfileQr();originalProfileClose();};
  let profileSaving=false;
  renderStudentProfile = () => {
    originalProfile();
    hideStudentIdentityFields();
    renderProfileQr();
    if(profileSaving)for(const id of ['profileStudentNameInput','saveStudentProfileBtn','profileFaceStartBtn','profileFaceCameraBtn','profileFaceImageBtn','profileFaceDeleteBtn','deleteStudentBtn'])$(id).disabled=true;
  };
  const originalSaveProfile = saveStudentProfile;
  saveStudentProfile = async () => {
    if(profileSaving||faceBusy)return;
    profileSaving=true;renderStudentProfile();
    try {
    if (studentProfileMode !== 'new') return await originalSaveProfile();
    const name = cleanName($('profileStudentNameInput').value);
    if (!name) return notify(text('studentProfileRequired'),'warn');
    $('saveStudentProfileBtn').disabled = true;
    try {
      const rows = await importNames([name]);
      if (rows.length) {activeProfileStudentId = rows[0].id; studentProfileMode = 'edit'; renderStudentProfile();window.HathirOnboarding?.completed('student-saved');}
    } catch(error) {notify(error.message || String(error),'error');}
    finally {$('saveStudentProfileBtn').disabled = false;}
    } finally {profileSaving=false;if(!$('studentProfileModal').hidden)renderStudentProfile();}
  };
  const originalRoster = renderRoster;
  function refreshAcademicStatusControls() {
    let blockedReason='';
    document.querySelectorAll('[data-personal-status]').forEach(select=>{
      const source=subjects.find(item=>item.id===select.dataset.subjectId);
      const pending=academicStatusWrites.has(statusWriteKey(source?.id,select.dataset.personalStatus));
      const editable=canManageStudents(source);
      const reason=editable?'':!session?.local&&sharedRosterPeers(source).some(offlineHasPendingForSubject)
        ? say('تغيير حالة الطالب متوقف مؤقتًا حتى اكتمال مزامنة الحضور.','Student status changes are paused until attendance finishes syncing.')
        : !session?.local&&(!navigator.onLine||session?.offlineMode)
        ? say('تغيير حالة الطالب يتطلب الاتصال والتحقق من الحساب.','Student status changes require a connection and verified session.')
        : source?.cachedDisplayOnly||source?.liveLoadPending
        ? say('انتظر اكتمال تحميل قائمة الطلبة لتغيير الحالة.','Wait for the roster to load before changing status.')
        : say('لا تتوفر صلاحية تغيير حالة الطالب لهذا الحساب.','This account cannot change student status.');
      select.disabled=pending||!editable;
      select.setAttribute('aria-busy',String(pending));
      select.title=pending?say('جارٍ حفظ الحالة','Saving status'):reason;
      if(reason){blockedReason ||= reason;select.setAttribute('aria-describedby','academicStatusAvailability');}
      else select.removeAttribute('aria-describedby');
    });
    let notice=$('academicStatusAvailability');
    if(!notice&&$('attendanceRecordCard')){
      notice=document.createElement('p');notice.id='academicStatusAvailability';notice.setAttribute('role','status');notice.className='muted';
      $('attendanceRecordCard').insertBefore(notice,$('attendanceRecordCard').querySelector('.tableWrap'));
    }
    if(notice){notice.hidden=!blockedReason;notice.textContent=blockedReason;}
  }
  const originalStatusActionPermissions=renderActionPermissions;
  renderActionPermissions=()=>{originalStatusActionPermissions();refreshAcademicStatusControls();};
  renderRoster = studentId => {
    originalRoster(studentId);
    const subject = attendanceView(); if(!subject) return;
    $('rosterOlderLecturesBtn').textContent = say('محاضرات أقدم', 'Older lectures');
    $('rosterNewerLecturesBtn').textContent = say('محاضرات أحدث', 'Newer lectures');
    const header = els.rosterHead?.querySelector('tr');
    if (header && !header.querySelector('[data-personal-status-head]')) {
      const th = document.createElement('th'); th.dataset.personalStatusHead = ''; th.textContent = say('الحالة','Status'); header.append(th);
    }
    // Derive empty-row spans from semantic headers, including the optional
    // face column, while preserving every underlying data-column index.
    const visibleColumnCount = header ? [...header.cells].filter(cell => !cell.classList.contains('studentIdentityColumn') && !(cell.classList.contains('faceIndicatorColumn') && document.body.classList.contains('faceAttendanceOff'))).length : 0;
    if (visibleColumnCount) els.rosterRows.querySelectorAll('tr:not([data-student-id]) > td[colspan]').forEach(cell => { cell.colSpan = visibleColumnCount; });
    els.rosterRows.querySelectorAll('tr[data-student-id]').forEach(row => {
      const source = subject._sources ? studentSubject(row.dataset.studentId) : subject;
      const pending = academicStatusWrites.get(statusWriteKey(source?.id,row.dataset.studentId));
      const value = pending?.value ?? source?.academicStatuses?.[row.dataset.studentId] ?? '';
      row.classList.toggle('personalStatusSet',Boolean(value));
      let cell = row.querySelector('[data-personal-status-cell]');
      if (!cell) {cell = document.createElement('td'); cell.dataset.personalStatusCell = ''; row.append(cell);}
      cell.innerHTML = `<select class="personalAcademicStatus" data-personal-status="${escapeHtml(row.dataset.studentId)}" data-subject-id="${escapeHtml(source?.id||'')}" ${pending?'disabled aria-busy="true"':''} aria-label="${escapeHtml(say('الحالة الأكاديمية للطالب','Student academic status'))}">${STATUSES.map(status=>`<option value="${status}" ${status===value?'selected':''}>${status}</option>`).join('')}</select>`;
    });
    refreshAcademicStatusControls();
  };
  async function saveStatus(select) {
    const subject = subjects.find(item=>item.id === select.dataset.subjectId), studentId = select.dataset.personalStatus;
    if (!canManageStudents(subject) || !STATUSES.includes(select.value)) return;
    const key = statusWriteKey(subject.id,studentId);
    if (academicStatusWrites.has(key)) return;
    const previous = subject.academicStatuses?.[studentId] || '', value = select.value;
    academicStatusWrites.set(key,{value});
    select.disabled = true;
    try {
      if (!session.deviceFirst) await call('setPersonalAcademicStatus',{workspaceId:session.workspaceId,subjectId:subject.id,studentId,status:value});
      subject.academicStatuses ||= {}; if(value) subject.academicStatuses[studentId] = value; else delete subject.academicStatuses[studentId];
      if (session.deviceFirst) await saveLocalData();
    } catch(error) {select.value = previous; notify(error.message || String(error),'error');}
    finally {academicStatusWrites.delete(key);renderRoster();}
  }
  const originalExportRows = buildAttendanceExportRows;
  buildAttendanceExportRows = (subject,value) => {
    const result = originalExportRows(subject,value), rows = result.rows;
    const headerIndex = rows.findIndex(row=>row.includes(text('studentId')) && row.includes(text('student')));
    if (headerIndex >= 0) {
      const codeIndex = rows[headerIndex].indexOf(text('studentId'));
      rows[headerIndex].push(say('الحالة','Status'));
      const sourceById = new Map();
      for (const source of subject._sources || [subject]) {
        for (const student of historyStudentsFor(source)) sourceById.set(String(student.id),source);
      }
      for(let index=headerIndex+1;index<rows.length;index++) {
        const id = String(rows[index][codeIndex] || '');
        rows[index].push((sourceById.get(id) || subject).academicStatuses?.[id] || '');
      }
      // Resolve status using the private ID before dropping that export-only
      // column. Attendance, archived roster rows and stored keys stay untouched.
      for(let index=headerIndex;index<rows.length;index++) rows[index].splice(codeIndex,1);
    }
    return result;
  };

  function subjectIdentity(departmentId,stageId) {
    const stage=stageById(stageId);
    if(!stage||stage.departmentId!==departmentId)throw Error(say('اختر القسم والمرحلة أولاً.','Choose the department and stage first.'));
    return {rosterNaming:'name'};
  }
  const originalCompactAction = compactSubjectAction;
  compactSubjectAction = async action => {
    if (action !== '__add') return originalCompactAction(action);
    if (!hasPermission('classesCreate') || !compactScope) throw Error(text('noPermission'));
    const identity = subjectIdentity(compactScope.departmentId,compactScope.stageId);
    const title = prompt(say('اسم المادة','Subject name')); if(!title?.trim()) {renderSubjectSelect(); return;}
    const totalHours = Number($('teachingAnnualHours').value), lectureDurationHours = Number($('attendanceDurationSelect').value);
    if (!Number.isFinite(totalHours) || totalHours <= 0 || !Number.isFinite(lectureDurationHours) || lectureDurationHours <= 0 || lectureDurationHours > 24) throw Error(say('تحقق من مجموع الساعات ومدة المحاضرة.','Check total hours and lecture duration.'));
    const id = 'subject_' + crypto.randomUUID();
    const value = {id,titleAr:title.trim(),titleEn:title.trim(),departmentId:compactScope.departmentId,stageId:compactScope.stageId,studyPeriod:subjectStudyPeriod(compactScope),section:'',ownerUserId:session.uid,...identity,totalHours,lectureDurationHours,absenceSettings:readAbsenceSettings(),lectures:[],lectureMeta:{},excuses:{},archivedStudents:[]};
    if(session.deviceFirst){
      const created={...value,students:[],attendance:{},rosterLoaded:true,attendanceLoaded:true,lectureIndexLoaded:true,lectureIndexComplete:true,loadedLectureDates:new Set()};
      const planned=HathirPrivateScopeRoster.distribute(localData,created);
      for(const [key,update] of Object.entries(planned.subjects)){if(localData.subjects[key])Object.assign(localData.subjects[key],update);else localData.subjects[key]=update;}
      await saveLocalData();subjects=Object.values(localData.subjects);activeSubjectId=id;compactScope.section='';delete compactScope.sections;await compactRefresh();return;
    }
    await workspaceRef().collection('subjects').doc(id).set({...value,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    activeSubjectId = id; compactScope.section = ''; delete compactScope.sections;
    await loadCloudData({hydrateActiveAttendance:false,loadActiveRoster:false}); await compactRefresh();
  };
  compactDepartmentAction = async action => {
    const current = departmentById(compactScope.departmentId);
    const name = prompt(say('اسم القسم','Department name'),action==='__edit'?departmentTitle(current):''); if(!name?.trim()) {renderSubjectSelect();return;}
    const id = action==='__edit' ? current.id : makeId('dept',name);
    const codePrefix = current && action==='__edit' ? departmentPrefix(current) : String(prompt(say('اختصار داخلي للقسم: حرفان أو ثلاثة بالإنجليزية. لا يتغير بعد إضافة الطلبة.','Internal department prefix: 2–3 English letters, fixed after adding students.')) || '').trim().toUpperCase();
    if (!(action==='__edit' && id==='electronics_smartphones' && codePrefix==='EL-PH') && !/^[A-Z]{2,3}$/.test(codePrefix || '')) throw Error(say('الاختصار يجب أن يكون حرفين أو ثلاثة.','The prefix must contain 2–3 letters.'));
    if (departments.some(department=>department.id!==id && departmentPrefix(department)===codePrefix)) throw Error(say('الاختصار مستخدم لقسم آخر.','Another department uses this prefix.'));
    if(session.deviceFirst){
      localData.departments[id]={...(current||{}),id,nameAr:name.trim(),nameEn:name.trim(),codePrefix,active:true};
      defaultStagesForDepartment(id).forEach(stage=>{localData.stages[stage.id] ||= stage;});await saveLocalData();
      departments=Object.values(localData.departments);stages=Object.values(localData.stages);chooseActiveSubjectForPicker(id);await compactRefresh();return;
    }
    const batch = db.batch(); batch.set(workspaceRef().collection('departments').doc(id),{id,nameAr:name.trim(),nameEn:name.trim(),codePrefix,active:true},{merge:true});
    defaultStagesForDepartment(id).forEach(stage=>batch.set(workspaceRef().collection('stages').doc(stage.id),stage,{merge:true}));
    await batch.commit(); await loadCloudOrganization(); chooseActiveSubjectForPicker(id); await compactRefresh();
  };
  const originalSubjectSelect = renderSubjectSelect;
  renderSubjectSelect = () => {
    originalSubjectSelect();
    const subject = getSubject();
    const label=item=>subjectTitle(item)+(item.academicYearStart?' · '+item.academicYearStart+'–'+(Number(item.academicYearStart)+1):'');
    const option=(id,title,selected=false)=>`<option value="${escapeHtml(id)}" ${selected?'selected':''}>${escapeHtml(title)}</option>`;
    // A course with the same name in a new year is a separate course, not a
    // duplicate section to hide from the picker.
    els.subjectSelect.innerHTML=(subject?'':option('',say('أضف مادة','Add a subject'),true))+compactSubjects().map(item=>option(item.id,label(item),item.id===activeSubjectId)).join('')+
      option('__add',say('+ إضافة مادة','+ Add subject'))+(subject?option('__edit',say('تعديل المادة','Edit subject'))+option('__delete',say('حذف المادة الحالية','Delete current subject')):'');
    $('quickTeachingSubject').innerHTML=attendanceAvailableSubjects().map(item=>option(item.id,label(item)+' · '+subjectContext(item),item.id===activeSubjectId)).join('') || option('',say('أضف المادة التي تدرسها','Add your subject'),true);
  };
  function supportReady() { return config.supportEnabled === true && config.supportEmail === 'redacted@example.invalid'; }
  function localizePersonalUI() {
    const expand=$('expandAttendanceRecordBtn');
    if(expand){const opened=expand.getAttribute('aria-expanded')==='true';expand.title=opened?say('تصغير سجل الحضور','Exit expanded attendance record'):say('تكبير سجل الحضور','Expand attendance record');expand.setAttribute('aria-label',expand.title);}
    hideStudentIdentityFields();
    for(const [id,ar,en] of [
      ['resendVerificationBtn','إعادة إرسال رابط التحقق','Resend verification link'],
      ['checkApprovalBtn','تحققت من بريدي — تحديث الحالة','I verified my email — refresh status'],
      ['pendingSignOutBtn','استخدام حساب آخر','Use another account'],
      ['personalNameHelp','الأسماء فقط، دون ألقاب علمية أو أرقام أو علامات ترقيم. تُقبل الأسماء المركبة.','Names only, without academic titles, digits or punctuation. Compound names are accepted.'],
      ['personalPasswordHelp','6 خانات على الأقل.','At least 6 characters.'],
      ['personalSupportBtn','دعم','Support'],['personalSupportTitle','دعم حاضر','Hathir support']
    ]) if($(id)) $(id).textContent=say(ar,en);
    for(const [id,ar,en] of [['authFirstName','الاسم الأول','First name'],['authFatherName','اسم الأب','Father’s name'],['authGrandfatherName','اسم الجد','Grandfather’s name']]) {
      const label=document.querySelector(`label[for="${id}"]`);if(label)label.textContent=say(ar,en);
      $(id).placeholder=say(ar+' — يمكن أن يكون مركباً',en+' — compound names accepted');
    }
  }
  const originalApplyLanguage=applyLanguage;
  applyLanguage=()=>{originalApplyLanguage();localizePersonalUI();};
  function setupRosterExpansion() {
    const card=$('attendanceRecordCard'),button=$('expandAttendanceRecordBtn');
    let expanded=false,nativeOwned=false,scrollX=0,scrollY=0;
    function collapse(){
      if(!expanded)return;
      expanded=false;card.classList.remove('rosterExpandedCard');document.body.classList.remove('rosterExpanded');
      button.setAttribute('aria-expanded','false');localizePersonalUI();
      if(nativeOwned){nativeOwned=false;const exit=document.exitFullscreen||document.webkitExitFullscreen;try{Promise.resolve(exit?.call(document)).catch(()=>{});}catch{}}
      window.scrollTo(scrollX,scrollY);if(!$('appPage').hidden)button.focus({preventScroll:true});
    }
    button.addEventListener('click',()=>{
      if(expanded){collapse();return;}
      scrollX=window.scrollX;scrollY=window.scrollY;expanded=true;
      card.classList.add('rosterExpandedCard');document.body.classList.add('rosterExpanded');
      button.setAttribute('aria-expanded','true');localizePersonalUI();button.focus({preventScroll:true});
      // Fullscreen the document so existing edit dialogs remain usable above
      // the enlarged record. Fixed viewport layout also works on iPhone.
      const root=document.documentElement,request=root.requestFullscreen||root.webkitRequestFullscreen;
      if(request&&!document.fullscreenElement&&!document.webkitFullscreenElement){
        try{Promise.resolve(request.call(root)).catch(()=>{});}catch{}
      }
    });
    const changed=()=>{const element=document.fullscreenElement||document.webkitFullscreenElement;
      if(element===document.documentElement&&expanded)nativeOwned=true;
      else if(nativeOwned)collapse();
    };
    document.addEventListener('fullscreenchange',changed);document.addEventListener('webkitfullscreenchange',changed);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&expanded&&!document.querySelector('.modalBackdrop:not([hidden]),dialog[open]')){event.preventDefault();collapse();}});
    new MutationObserver(()=>{if($('appPage').hidden||!$('attendanceView').classList.contains('active'))collapse();})
      .observe($('appPage'),{attributes:true,subtree:true,attributeFilter:['hidden','class']});
  }
  function setupUI() {
    setupRosterExpansion();
    $('profileQrSave').addEventListener('click',()=>{
      if(!profileQrCanvas||!currentProfileQr())return;
      const key=profileQrKey,name=activeProfile().student.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
      profileQrCanvas.toBlob(blob=>{if(blob&&key===profileQrKey&&currentProfileQr())download(blob,name+'-QR.png','image/png');},'image/png');
    });
    $('profileQrRetry').addEventListener('click',()=>{clearProfileQr();renderProfileQr();});
    $('resendVerificationBtn').addEventListener('click',async()=>{
      const button=$('resendVerificationBtn'); button.disabled=true;
      try {await sendVerification(); setAuthStatus(say('تم إرسال رابط تحقق حقيقي إلى بريد حسابك. افتحه ثم حدّث الحالة.','A verification link was sent to your account email. Open it, then refresh status.'),'ok');}
      catch(error){setAuthStatus(error.message || String(error),'error');}
      finally{button.disabled=false;}
    });
    $('checkApprovalBtn').addEventListener('click',refreshStatus);
    $('pendingSignOutBtn').addEventListener('click',async()=>{await auth?.signOut();registrationState=null;delete $('loginPage').dataset.accountSaved;$('personalPendingActions').hidden=true;setAuthMode('login');setAuthStatus('');});
    $('rosterRows').addEventListener('change',event=>{if(event.target.matches('[data-personal-status]')) saveStatus(event.target);});
    if (!firebaseConfig?.apiKey || !firebaseReady) setAuthStatus(text('authMissing'),'error');
    localizePersonalUI();
    renderSubjectSelect();
  }
  const originalInit = init;
  init = () => { originalInit(); setupUI(); };
  window.HathirPersonal = Object.freeze({accountWait,accountRecovery,validNamePart,strongPassword,cleanName,prefixes:PREFIXES,statuses:STATUSES,refreshStatus,supportReady,refreshOwnerAccess,openSupport:()=>{$('beginnerMenuClose')?.click();window.open('/help.html','_blank','noopener');}});
})();

