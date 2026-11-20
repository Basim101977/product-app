/* No student data or face data is stored in notification payloads. */
function notificationBinding(write,value){return new Promise((resolve,reject)=>{
  const open=indexedDB.open('hathir-notification-device-v1',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('binding');
  open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{const db=open.result,tx=db.transaction('binding',write?'readwrite':'readonly'),store=tx.objectStore('binding');let result;
    const request=write?store.put(value,'uid'):store.get('uid');request.onsuccess=()=>{result=request.result};tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=()=>{db.close();reject(tx.error)};
  };
});}
self.addEventListener('message',event=>{
  if(event.data?.type==='HATHIR_PUSH_BIND')event.waitUntil(notificationBinding(true,typeof event.data.uid==='string'?event.data.uid:null));
});
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let p;try{p=event.data?.json()}catch{return}
    if(!p||!['share','registration','support','announcement'].includes(p.kind)||typeof p.uid!=='string')return;
    const uid=await notificationBinding(false);if(uid!==p.uid)return;
    await self.registration.showNotification('حاضر',{body:p.kind==='announcement'?'وصل إعلان جديد من إدارة حاضر.':p.kind==='support'?'وصلت رسالة جديدة في محادثة الدعم.':p.kind==='registration'?'وصل طلب تسجيل جديد للمراجعة.':'وصلت مشاركة جديدة إلى حسابك.',tag:p.tag,icon:'/assets/hathir-check-large-icon-192-20260929.png',data:{uid,kind:p.kind,...(p.kind==='announcement'&&typeof p.messageId==='string'?{messageId:p.messageId}:{})}});
  })());
});
self.addEventListener('notificationclick',event=>{
  const data=event.notification.data;event.notification.close();
  event.waitUntil((async()=>{
    if(!data||await notificationBinding(false)!==data.uid)return;
    const destination=new URL('/?notification='+encodeURIComponent(data.kind),self.location.origin);if(data.kind==='announcement'&&typeof data.messageId==='string')destination.searchParams.set('announcement',data.messageId);const url=destination.href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const page=windows.find(c=>new URL(c.url).origin===self.location.origin);
    if(page){await page.navigate(url);await page.focus()}else await self.clients.openWindow(url);
  })());
});

