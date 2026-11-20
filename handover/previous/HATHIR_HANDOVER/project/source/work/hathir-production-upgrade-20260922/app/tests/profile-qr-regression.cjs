'use strict';
const vm=require('node:vm');
const {REPORTS,assert,fs,path,launch,makeReport,check,saveReport}=require('./offline-harness.cjs');
const report=makeReport('profile-qr');
const source=fs.readFileSync(path.join(__dirname,'personal-ui-regression.cjs'),'utf8');
const fixture=vm.runInNewContext(source.slice(source.indexOf('async function installCallables'),source.indexOf('const row ='))+';({installWorkspace})');
(async()=>{const h=await launch(report);try{
 for(const width of [390,1440])await check(report,width+'px larger inline QR is generated lazily, decodes to the full name and downloads',async()=>{
  const {page,context}=await h.page({width});try{
   await fixture.installWorkspace(page);
   assert.equal(await page.evaluate(()=>typeof window.qrcode),'undefined');
   await page.evaluate(()=>{window.qrCalls=0;window.originalQr=makeQrCanvas;makeQrCanvas=(...args)=>{qrCalls++;return originalQr(...args);};renderRoster();});
   assert.equal(await page.evaluate(()=>qrCalls),0);
   await page.evaluate(()=>{subjects[0].students[0].name='أحمد علي 2';openStudentProfile(subjects[0].students[0].id);});
   await page.locator('#profileQrImage').waitFor({state:'visible'});
   await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../netlify_site/vendor/jsQR-1.4.0.min.js'),'utf8')});
   const decoded=await page.evaluate(()=>{const img=document.getElementById('profileQrImage'),c=document.createElement('canvas');c.width=c.height=720;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,720,720);const p=ctx.getImageData(0,0,720,720);return {actual:jsQR(p.data,720,720).data,expected:HathirNameQR.encode('أحمد علي 2')};});
   assert.equal(decoded.actual,decoded.expected);
   await page.evaluate(()=>{renderStudentProfile();renderStudentProfile();});assert.equal(await page.evaluate(()=>qrCalls),1);
   assert.equal(await page.locator('#profileQrExpand,#profileQrTitle,#profileQrZoom').count(),0);
   const imageBox=await page.locator('#profileQrImage').boundingBox();assert(imageBox.width>224&&imageBox.width<=280);
   await page.locator('.profileQrBox').screenshot({path:path.join(REPORTS,'profile-qr-inline-'+width+'.png')});
   await page.evaluate(()=>{download=(blob,name,type)=>{window.qrDownload={bytes:blob.size,name,type};};});
   await page.locator('#profileQrSave').click();await page.waitForFunction(()=>!!window.qrDownload);
   const download=await page.evaluate(()=>qrDownload);assert(download.bytes>100);assert.equal(download.name,'أحمد علي 2-QR.png');assert.equal(download.type,'image/png');
   await page.evaluate(()=>closeStudentProfile());assert.equal(await page.locator('#profileQrImage').getAttribute('src'),null);
  }finally{await context.close();}
 });
 await check(report,'Late QR from another student is discarded; unsaved students have no QR',async()=>{
  const {page,context}=await h.page();try{await fixture.installWorkspace(page);
   await page.evaluate(()=>{window.originalQr=makeQrCanvas;let first=true;makeQrCanvas=async(...args)=>{if(first){first=false;await new Promise(resolve=>window.releaseQr=resolve);}return originalQr(...args);};openStudentProfile(subjects[0].students[0].id);openStudentProfile(subjects[0].students[1].id);});
   await page.locator('#profileQrImage').waitFor({state:'visible'});const before=await page.locator('#profileQrImage').getAttribute('src');
   await page.evaluate(async()=>{releaseQr();await new Promise(resolve=>setTimeout(resolve,100));});assert.equal(await page.locator('#profileQrImage').getAttribute('src'),before);
   await page.evaluate(()=>{closeStudentProfile();openNewStudentProfile();});assert.equal(await page.locator('#profileQrImage').isVisible(),false);assert.equal(await page.locator('#profileQrSave').isDisabled(),true);
  }finally{await context.close();}
 });
 await check(report,'Generation failure can retry, and a saved rename refreshes the QR',async()=>{
  const {page,context}=await h.page();try{await fixture.installWorkspace(page);
   await page.evaluate(()=>{window.originalQr=makeQrCanvas;makeQrCanvas=async()=>{throw Error('Synthetic failure');};openStudentProfile(subjects[0].students[0].id);});
   await page.locator('#profileQrRetry').waitFor({state:'visible'});await page.evaluate(()=>makeQrCanvas=originalQr);await page.locator('#profileQrRetry').click();await page.locator('#profileQrImage').waitFor({state:'visible'});
   const before=await page.locator('#profileQrImage').getAttribute('src');
   await page.evaluate(()=>{activeProfile().student.name='اسم طالب معدل';renderStudentProfile();});await page.locator('#profileQrImage').waitFor({state:'visible'});
   assert.notEqual(await page.locator('#profileQrImage').getAttribute('src'),before);
  }finally{await context.close();}
 });
}finally{await h.close();saveReport(report,'profile-qr-regression');}})().catch(error=>{console.error(error);process.exitCode=1;});
