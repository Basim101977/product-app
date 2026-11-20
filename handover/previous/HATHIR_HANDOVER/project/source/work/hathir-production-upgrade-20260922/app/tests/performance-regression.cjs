'use strict';
const {launch,makeReport,check,assert,saveReport}=require('./offline-harness.cjs');
const report=makeReport('performance-regression');
(async()=>{const h=await launch(report);try{
 await check(report,'Real QR decoder runs in worker without calling main-thread decoder',async()=>{
  const {page:p,context:c}=await h.page();await p.waitForFunction(()=>!!window.HathirQrDecoder);
  await p.evaluate(async()=>{await loadOptionalLibrary('jsqr');await loadOptionalLibrary('qrcode');});
  const result=await p.evaluate(async()=>{
   const payload=HathirNameQR.encode('أحمد علي حسن'),cv=await makeQrCanvas(payload,528),image=cv.getContext('2d').getImageData(0,0,528,528);
   const original=window.jsQR;window.jsQR=()=>{throw Error('Main thread decoding was used');};
   const code=await HathirQrDecoder.decode(image);window.jsQR=original;return {expected:payload,actual:code?.data};
  });assert.equal(result.actual,result.expected);await c.close();
 });
 await check(report,'Unavailable worker falls back and preserves original pixels',async()=>{
  const {page:p,context:c}=await h.page();await p.waitForFunction(()=>!!window.HathirQrDecoder);
  const result=await p.evaluate(async()=>{
   window.Worker=class{constructor(){throw Error('Workers unavailable');}};
   window.jsQR=(pixels,w,h)=>({data:String(pixels[0])+':'+w+':'+h});
   return (await HathirQrDecoder.decode({data:new Uint8ClampedArray([99,0,0,255]),width:1,height:1})).data;
  });assert.equal(result,'99:1:1');await c.close();
 });
 await check(report,'Face distance remains identical for numeric and legacy malformed descriptors',async()=>{
  const {page:p,context:c}=await h.page();await p.waitForFunction(()=>typeof faceDistance==='function');
  const rows=await p.evaluate(()=>{
   const a=Array.from({length:128},(_,i)=>i/128),b=a.map(x=>x+.01);
   const old=(a,b)=>{a=normalizeFaceDescriptor(a);b=normalizeFaceDescriptor(b);if(!a||!b||a.length!==b.length)return Infinity;let sum=0;for(let i=0;i<a.length;i++)sum+=(a[i]-b[i])**2;return Math.sqrt(sum);};
   return [[a,b],[a,a],[a.map(String),b],[a.slice(0,30),b],[[NaN,...a],b],[null,b]].map(([a,b])=>Object.is(old(a,b),faceDistance(a,b)));
  });assert(rows.every(Boolean));await c.close();
 });
 for(const status of ['approved','rejected'])await check(report,'Server-confirmed workspace avoids pointer round trip, status='+status,async()=>{
  const uid='qa_ready',fixture={uid,rememberedUser:true,verified:true,records:{['attendanceUserWorkspaces/'+uid]:{workspaceId:uid,active:true}},responses:{getPersonalAccountStatus:{status:'approved',emailVerified:true}}};
  const {page:p,context:c}=await h.page({fixture});await p.waitForFunction(()=>!!session&&!cloudDataLoading);
  const result=await p.evaluate(async status=>{
   personalFixture.reads=[];personalFixture.responses.getPersonalAccountStatus={status,emailVerified:true,workspaceReady:true,workspaceId:auth.currentUser.uid};
   await initializeCloudSession(auth.currentUser);return {reads:personalFixture.reads,sessionCleared:session===null,visible:!document.getElementById('appPage').hidden};
  },status);assert(!result.reads.some(x=>x.startsWith('attendanceUserWorkspaces/')));assert.equal(result.sessionCleared,status==='rejected');assert.equal(result.visible,status==='approved');if(status==='rejected')assert.equal(result.reads.length,0);await c.close();
 });
}finally{await h.close();}saveReport(report,'performance-regression');if(!report.passed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
