/* Settings are device/account preferences; no student data is stored here. */
(function () {
  'use strict';
  const $=id=>document.getElementById(id),say=(ar,en)=>lang==='ar'?ar:en;
  let ready=false,identity='',prefs={},passwordBusy=false;
  let lastErrorSoundAt=-Infinity;
  const owner=()=>session?JSON.stringify([!!session.local,session.uid,session.workspaceId]):'';
  const context=()=>owner()+'|'+JSON.stringify(selectedSubjectGroup().map(s=>s.id))+'|'+todayISO();
  const connected=()=>navigator.onLine && !session?.offlineMode;
  const storageKey=()=> 'hathir-device-settings-v1:'+identity;
  function save(){
    if(!identity)return;
    try{localStorage.setItem(storageKey(),JSON.stringify(prefs));}
    catch{notify(say('تعذر حفظ الإعدادات على الجهاز؛ ستُستخدم لهذه الجلسة فقط.','Device preferences could not be saved; they apply to this session only.'),'warn');}
  }
  function scanAllowed(){
    return !!(session && !$('appPage').hidden && $('attendanceView').classList.contains('active') &&
      getSubject() && attendanceInputReady() &&
      !document.querySelector('.modalBackdrop:not([hidden])') &&
      !document.activeElement?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
  }
  function feedback(ar,en,type='error'){
    setScanStatus(say(ar,en),type,true);
    if(type==='error' && performance.now()-lastErrorSoundAt>=1000){lastErrorSoundAt=performance.now();beep('bad');}
  }
  async function read(id,method){
    if(!scanAllowed())return;
    const group=selectedSubjectGroup();
    if(group.some(s=>s.clearPending||s.rosterOperationId || (!session.local&&!s.rosterLoaded))){
      feedback('انتظر اكتمال تحميل قائمة المادة.','Wait for the subject roster to finish loading.','warn');return;
    }
    const matches=group.flatMap(subject=>(subject.students||[]).filter(s=>normalizeId(s.id)===id).map(student=>({subject,student})));
    if(matches.length!==1){
      feedback(matches.length?'الكود مكرر في المواد المختارة؛ اختر مادة واحدة.':'الطالب غير موجود في قائمة المادة الحالية.',
        matches.length?'The code is ambiguous; select one subject.':'Student not found in the current subject roster.');return;
    }
    if(!hasPermission('attendanceMark')||!memberCanAccessSubject(matches[0].subject))return;
    // A verified current-roster student, not a historical identity or another workspace.
    studentById.set(id,matches[0].student);
    await markAttendance(id,method);
  }
  function updateReaders(){
    if(!ready)return;
    const state=HathirCardReaders.state();
    $('rfidToggle').setAttribute('aria-checked',String(state.rfid));
    $('nfcToggle').disabled=!state.nfcSupported||state.pending;
    $('nfcToggle').setAttribute('aria-checked',String(state.nfc));
    let message='',status='off';
    if(!state.nfcSupported){message=say('غير مدعوم في هذا المتصفح','Not supported in this browser');status='warn';}
    else if(state.pending){message=say('بانتظار إذن القراءة…','Waiting for reading permission…');status='warn';}
    else if(state.nfc){status='on';}
    else if(state.nfcError){
      message=state.nfcError==='NotAllowedError'?say('لم يُمنح إذن NFC. يمكنك المحاولة مجددًا.','NFC permission was not granted. You can retry.'):
        state.nfcError==='NotSupportedError'?say('الجهاز أو القارئ غير متوافق مع NFC.','The device or reader does not support NFC.'):
        say('تعذر تشغيل NFC. تأكد من تفعيله في الهاتف ثم حاول مجددًا.','Could not start NFC. Enable it on your phone and retry.');
      status='error';
    }
    $('settingsNfcStatus').textContent=message;$('settingsNfcStatus').dataset.state=status;
  }
  function mirrorBadge(){
    if(!ready)return;
    const source=$('ownerRequestBadge'),target=$('settingsRequestBadge');
    const allowed=!!session&&!$('appPage').hidden&&canManageRegistration();
    target.hidden=!allowed||source.hidden;
    target.textContent=allowed?source.textContent:'';
    target.title=source.title;
    $('settingsInvitesSection').hidden=!allowed;
  }
  function clearPrivateViews(){
    $('settingsPasswordStatus').textContent='';
    $('settingsAccountName').textContent='';$('settingsAccountEmail').textContent='';
    $('ownerRegistrationModal').hidden=true;$('ownerRequestsList').replaceChildren();
    $('deletedRecordsList').replaceChildren();$('subjectRosterBackupsList').replaceChildren();
    recoverySnapshots=[];recoverySnapshotsLoading=false;$('recoveryRows').replaceChildren();
  }
  function render(){
    if(!ready)return;
    const next=owner();
    if(next!==identity){
      identity=next;prefs={};passwordBusy=false;
      HathirCardReaders.reset();close(false);clearPrivateViews();
      if(identity){
        try{prefs=JSON.parse(localStorage.getItem(storageKey())||'{}')||{};}catch{prefs={};}
        HathirCardReaders.enableRfid(prefs.rfid===true);
        if(['ar','en'].includes(prefs.lang)&&prefs.lang!==lang){lang=prefs.lang;applyLanguage();}
      }
    }
    $('settingsButtonLabel').textContent=say('إعدادات','Settings');
    $('settingsTitle').textContent=say('إعدادات','Settings');
    $('closeSettingsBtn').setAttribute('aria-label',say('إغلاق الإعدادات','Close settings'));
    $('settingsRecoveryTitle').textContent=say('استعادة البيانات المحذوفة','Recover deleted data');
    $('settingsRecoveryHelp').textContent=say('نسخ مساحتك المحفوظة فقط، مع مراجعة وتأكيد دون استبدال بيانات حالية. تتطلب اتصالًا.','Only saved backups from your workspace, with review and confirmation, never overwriting current records. Requires a connection.');
    $('recoveryNavBtn').textContent='Recovery';
    $('recoveryNavBtn').disabled=!canAccessRecoveryCenter()||!connected();
    $('settingsInvitesTitle').textContent=say('الدعوات وطلبات التسجيل','Invitations and registration requests');
    $('settingsInvitesHelp').textContent=say('للمالك فقط. يظهر عدد الطلبات المعلّقة على زر الإعدادات.','Platform owner only. Pending requests also appear on Settings.');
    $('ownerRegistrationLabel').textContent=say('الطلبات','Requests');
    $('recoveryBackBtn').textContent=say('العودة إلى الإعدادات','Back to Settings');
    $('settingsAccountName').textContent=session?.displayName||'—';
    $('settingsAccountEmail').textContent=session?.email||'';
    $('settingsPasswordBtn').disabled=passwordBusy||!session||session.local||!connected()||!auth?.currentUser||auth.currentUser.uid!==session.uid;
    $('settingsPasswordBtn').title=say('إرسال رابط إعادة تعيين كلمة المرور إلى بريد حسابك','Send a password-reset link to your account email');
    updateReaders();mirrorBadge();
  }
  function open(){
    if(!session||$('appPage').hidden)return;
    render();stopScanner();closeActionMenus();$('settingsModal').hidden=false;$('closeSettingsBtn').focus();
  }
  function close(focus=true){
    if(!ready)return;
    HathirCardReaders.test(false);$('settingsModal').hidden=true;
    if(focus&&!$('appPage').hidden)$('settingsBtn').focus();
  }
  async function resetPassword(){
    if(!session||session.local||!connected()||passwordBusy||auth?.currentUser?.uid!==session.uid)return;
    const captured=owner(),email=auth.currentUser.email;
    if(!email||!confirm(say('إرسال رابط إعادة تعيين كلمة المرور إلى بريد حسابك؟','Send a password-reset link to your account email?')))return;
    passwordBusy=true;render();
    try{await auth.sendPasswordResetEmail(email);if(captured===owner())$('settingsPasswordStatus').textContent=say('تم إرسال الرابط. راجع بريدك وصندوق الرسائل غير المرغوب فيها.','Link sent. Check your inbox and spam folder.');}
    catch(error){if(captured===owner())$('settingsPasswordStatus').textContent=say('تعذر الإرسال. تحقق من الاتصال وحاول مجددًا.','Could not send. Check your connection and retry.');}
    finally{if(captured===owner()){passwordBusy=false;render();}}
  }
  function init(){
    if(ready)return;
    HathirCardReaders.configure({owner,context,canScan:scanAllowed,testVisible:()=>false,
      changed:updateReaders,read,
      invalid:()=>feedback('البطاقة لا تحتوي على كود طالب نصي متوافق.','The card does not contain a compatible student-code text record.'),
      error:()=>feedback('تعذرت قراءة البطاقة؛ حاول مجددًا.','Card reading failed; please retry.')
    });
    ready=true;
    $('settingsBtn').addEventListener('click',open);
    $('closeSettingsBtn').addEventListener('click',()=>close());
    $('settingsModal').addEventListener('click',event=>{if(event.target===$('settingsModal'))close();});
    $('settingsModal').addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.stopPropagation();close();}
      if(event.key==='Tab'){
        const items=[...$('settingsModal').querySelectorAll('button,select,a,input')].filter(e=>!e.disabled&&!e.hidden&&e.getClientRects().length);
        const first=items[0],last=items.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    $('appLangBtn').addEventListener('click',()=>{prefs.lang=lang;save();render();});
    $('rfidToggle').addEventListener('click',()=>{prefs.rfid=!HathirCardReaders.state().rfid;save();HathirCardReaders.enableRfid(prefs.rfid);enableAudio();});
    $('nfcToggle').addEventListener('click',()=>{enableAudio(true);HathirCardReaders.test(false);if(HathirCardReaders.state().nfc)HathirCardReaders.stopNfc();else HathirCardReaders.startNfc();});
    $('settingsPasswordBtn').addEventListener('click',resetPassword);
    $('recoveryNavBtn').addEventListener('click',()=>{stopScanner();close(false);},true);
    $('ownerRegistrationBtn').addEventListener('click',()=>close(false),true);
    $('recoveryBackBtn').addEventListener('click',()=>{setView('attendanceView');open();});
    new MutationObserver(mirrorBadge).observe($('ownerRequestBadge'),{childList:true,attributes:true,subtree:true,characterData:true});
    new MutationObserver(()=>{if($('appPage').hidden){identity='';HathirCardReaders.reset();close(false);clearPrivateViews();mirrorBadge();}}).observe($('appPage'),{attributes:true,attributeFilter:['hidden']});
    window.addEventListener('online',render);window.addEventListener('offline',render);
    render();
  }
  window.HathirSettings={init,render,open,close};
})();
