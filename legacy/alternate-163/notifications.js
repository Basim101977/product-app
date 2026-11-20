(function(){
  'use strict';
  const $=id=>document.getElementById(id),say=(a,b)=>document.documentElement.lang==='en'?b:a;
  let busy=false,identity=null,enabled=false,checked=false;
  const signedIn=()=>typeof session!=='undefined'&&session&&typeof auth!=='undefined'&&auth?.currentUser?.uid===session.uid&&!$('appPage')?.hidden?session.uid:null;
  const supported=()=>window.isSecureContext&&'Notification'in window&&'serviceWorker'in navigator&&'PushManager'in window;
  const needsHome=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const installed=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  function note(ar,en){const el=$('deviceNotificationsStatus');el.textContent=say(ar,en);el.hidden=!el.textContent;}
  async function worker(){return Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('worker-unavailable')),12000))]);}
  async function call(data){return (await firebase.app().functions('us-central1').httpsCallable('deviceNotifications',{timeout:20000})(data)).data;}
  function binding(uid){if(!('serviceWorker'in navigator))return;navigator.serviceWorker.ready.then(r=>r.active?.postMessage({type:'HATHIR_PUSH_BIND',uid})).catch(()=>{});}
  function saved(){try{return JSON.parse(localStorage.getItem('hathir-push-device-v1')||'null')}catch{return null}}
  function render(){
    if(!$('settingsInvitesSection'))return;
    if(!$('deviceNotificationsSection')){
      const section=document.createElement('section');section.id='deviceNotificationsSection';section.className='settingsSection';
      section.innerHTML='<div class="settingsRow"><h3 id="deviceNotificationsTitle"></h3><button type="button" class="btn ghost" id="deviceNotificationsEnable"></button></div><p id="deviceNotificationsStatus" role="status" aria-live="polite"></p>';
      $('settingsInvitesSection').before(section);$('deviceNotificationsEnable').onclick=toggle;
    }
    const uid=signedIn();if(uid!==identity){identity=uid;enabled=false;checked=false;binding(uid);}
    $('deviceNotificationsTitle').textContent=say('إشعارات الهاتف','Phone notifications');
    const button=$('deviceNotificationsEnable');button.disabled=busy||!uid;
    button.textContent=busy?say('جارٍ الإعداد…','Setting up…'):enabled?say('إيقاف إشعارات هذا الجهاز','Disable notifications on this device'):say('تفعيل إشعارات هذا الجهاز','Enable notifications on this device');
    if(busy)return;
    if(needsHome()&&!installed())note('على الآيفون: أضف حاضر إلى الشاشة الرئيسية وافتحه من أيقونته، ثم فعّل الإشعارات.','On iPhone, add Hathir to the Home Screen and open its icon before enabling notifications.');
    else if(!supported())note('هذا المتصفح لا يدعم إشعارات الهاتف.','This browser does not support push notifications.');
    else if(Notification.permission==='denied')note('الإشعارات محظورة. اسمح بها من إعدادات الهاتف أو المتصفح ثم أعد المحاولة.','Notifications are blocked. Allow them in your phone or browser settings and retry.');
    else if(enabled)note('مفعّلة: رسائل الدعم والمشاركات، وطلبات التسجيل للمالك.','Enabled for this account: incoming shares, and registration requests for the owner.');
    else note('','');
    const record=saved();
    if(!checked&&uid&&supported()&&record?.uid===uid&&Notification.permission==='granted'&&navigator.onLine){checked=true;Promise.all([call({action:'status',id:record.id}),worker().then(r=>r.pushManager.getSubscription())]).then(([r,subscription])=>{if(identity===uid&&!busy){enabled=r.enabled===true&&!!subscription;render()}}).catch(()=>{});}
    const kind=new URL(location.href).searchParams.get('notification');
    if(uid&&kind&&['share','registration','support','announcement'].includes(kind)){
      const announcementId=new URL(location.href).searchParams.get('announcement');const target=kind==='announcement'?(window.HathirSupportChat?.announcements?()=>window.HathirSupportChat.announcements(announcementId):null):kind==='support'?window.HathirSupportChat?.open:kind==='share'?window.HathirPrivateShare?.open:()=>{if(typeof canManageRegistration==='function'&&canManageRegistration())$('ownerRegistrationBtn')?.click()};
      if(target){const url=new URL(location.href);url.searchParams.delete('notification');url.searchParams.delete('announcement');history.replaceState(null,'',url);setTimeout(target,0);}
    }
  }
  async function toggle(){
    const uid=signedIn();if(!uid||busy)return;
    if(needsHome()&&!installed()||!supported()){render();return;}
    if(!navigator.onLine){note('اتصل بالإنترنت لتفعيل الإشعارات أو إيقافها.','Connect to enable or disable notifications.');return;}
    const ensure=()=>{if(signedIn()!==uid)throw Error('account-changed')};
    // Request directly in the tap handler, as required by iOS.
    const permission=enabled?Promise.resolve(Notification.permission):Notification.requestPermission();
    const disabling=enabled;busy=true;render();
    try{
      const allowed=await permission;ensure();
      if(!disabling&&allowed!=='granted'){busy=false;render();return;}
      const registration=await worker();ensure();
      if(disabling){const record=saved();if(record?.uid===uid)await call({action:'remove',id:record.id});ensure();const old=await registration.pushManager.getSubscription();if(old)await old.unsubscribe();localStorage.removeItem('hathir-push-device-v1');enabled=false;binding(null);}
      else{
        const config=await call({action:'config'});ensure();
        const key=Uint8Array.from(atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
        let subscription=await registration.pushManager.getSubscription();ensure();
        if(subscription){const current=new Uint8Array(subscription.options.applicationServerKey||[]);if(current.length!==key.length||current.some((x,i)=>x!==key[i])){await subscription.unsubscribe();subscription=null;}}
        if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});ensure();
        const result=await call({action:'subscribe',subscription:subscription.toJSON(),publicKey:config.publicKey});
        if(signedIn()!==uid){await subscription.unsubscribe();throw Error('account-changed')}
        localStorage.setItem('hathir-push-device-v1',JSON.stringify({uid,id:result.id}));binding(uid);enabled=result.enabled===true;checked=true;
      }
    }catch(error){busy=false;render();if(identity===uid)note('تعذر تفعيل الخدمة الآن. تحقق من الاتصال وأعد المحاولة؛ لم تتغير بيانات الحضور.','Notification setup failed. Check the connection and retry; attendance data is unchanged.');return;}
    finally{busy=false;}
    render();
  }
  window.HathirNotifications={render};
  window.addEventListener('online',()=>{checked=false;render()});
  window.addEventListener('focus',render);
  document.addEventListener('DOMContentLoaded',()=>{render();if($('appPage'))new MutationObserver(render).observe($('appPage'),{attributes:true,attributeFilter:['hidden']});});
})();
