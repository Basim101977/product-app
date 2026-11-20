/* Public application files only; never reads or modifies an account outbox. */
(()=>{'use strict';
 let checking=null,lastCheck=0,message='لم يُفحص اكتمال ملفات البرنامج بعد.',complete=false;
 const say=(ar,en)=>document.documentElement.lang==='en'?en:ar;
 function render(){
  const anchor=document.getElementById('settingsInvitesSection');if(!anchor)return;
  let section=document.getElementById('offlinePackageSection');
  if(!section){section=document.createElement('section');section.id='offlinePackageSection';section.className='settingsSection';
   const title=document.createElement('h3');title.textContent=say('العمل دون إنترنت','Offline operation');
   const status=document.createElement('p');status.id='offlinePackageStatus';status.setAttribute('role','status');
   const button=document.createElement('button');button.type='button';button.className='btn ghost';button.id='offlinePackageCheck';button.textContent=say('تجهيز وفحص ملفات البرنامج','Prepare and check app files');button.onclick=()=>prepare().catch(()=>{});
   section.append(title,status,button);anchor.before(section);
  }
  document.getElementById('offlinePackageStatus').textContent=message;
  document.getElementById('offlinePackageCheck').disabled=!!checking;
  section.dataset.ready=String(complete);
 }
 function inspect(repair=false){return new Promise((resolve,reject)=>{
  const worker=navigator.serviceWorker?.controller;if(!worker)return reject(Error(say('ملفات البرنامج لم تكتمل أو لم تُفعّل بعد. أعد الفحص بوجود الإنترنت.','App files are not installed or active yet. Check again online.')));
  const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error(say('تعذر التحقق من ملفات البرنامج.','Could not verify app files.')));},repair?120000:15000);
  channel.port1.onmessage=({data})=>{clearTimeout(timer);channel.port1.close();resolve(data);};worker.postMessage({type:repair?'OFFLINE_PACKAGE_REPAIR':'OFFLINE_PACKAGE_STATUS'},[channel.port2]);
 });}
 async function prepare(){
  if(checking)return checking;
  complete=false;message=say('جارٍ تجهيز وفحص الملفات، ومنها الإكسل وPDF وقراءة البطاقات والمساعدة…','Preparing and checking Excel, PDF, card reading and help files…');
  checking=(async()=>{
   if(location.protocol==='file:'||!navigator.serviceWorker)throw Error(say('استخدم رابط HTTPS أو نسخة localhost لتجهيز العمل دون إنترنت.','Use HTTPS or localhost to prepare offline operation.'));
   if(navigator.onLine)await ensureOfflineServiceWorker();
   const result=await inspect(navigator.onLine);complete=result.ready&&result.version===HATHIR_OFFLINE_PACKAGE.version;
   message=complete?say('ملفات البرنامج جاهزة دون إنترنت على هذا الجهاز. يلزم فتح الحساب مرة بوجود الإنترنت لحفظ بياناته.','App files are ready offline on this device. Open the account online once to save its data.'):
    say('الملفات غير مكتملة بعد؛ أبقِ البرنامج مفتوحًا بوجود الإنترنت ثم أعد الفحص.','Files are not complete yet; keep the app open online and check again.');
   return {...result,ready:complete};
  })().catch(error=>{complete=false;message=error.message;throw error;}).finally(()=>{checking=null;lastCheck=Date.now();render();});render();return checking;
 }
 window.HathirOfflinePackage=Object.freeze({prepare,inspect,render});
 window.addEventListener('load',()=>{render();if(navigator.serviceWorker)navigator.serviceWorker.ready.then(()=>prepare().catch(()=>{}));});
 window.addEventListener('online',()=>{if(Date.now()-lastCheck>30000)prepare().catch(()=>{});});
})();
