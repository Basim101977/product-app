'use strict';
// Real service worker, real vendored libraries, fresh isolated browser. No credentials or cloud writes.
const http=require('node:http'),vm=require('node:vm');
const {SITE,REPORTS,fs,path,assert,makeReport,check,saveReport}=require('./offline-harness.cjs');
const report=makeReport('complete-offline-package');
const source=fs.readFileSync(path.join(__dirname,'personal-ui-regression.cjs'),'utf8');
const fixture=vm.runInNewContext(source.slice(source.indexOf('async function installCallables'),source.indexOf('const row ='))+';({installWorkspace})');
(async()=>{
 const server=http.createServer((req,res)=>{
  for(const rule of JSON.parse(fs.readFileSync(path.join(SITE,'../firebase.json'),'utf8')).hosting.headers||[])if(rule.source==='**')for(const h of rule.headers)res.setHeader(h.key,h.value);
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(SITE,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(SITE+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.mp4':'video/mp4','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream');
  fs.readFile(file,(e,b)=>{res.statusCode=e?404:200;res.end(e?'missing':b);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await require(process.env.PLAYWRIGHT_MODULE).chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 const context=await browser.newContext({serviceWorkers:'allow',acceptDownloads:true});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 try{
  await page.goto(origin);await page.waitForFunction(()=>!!window.HathirOfflinePackage);
  await check(report,'Fresh install caches every app asset before any optional library is used',async()=>{
   await page.evaluate(()=>ensureOfflineServiceWorker());
   const result=await page.evaluate(()=>HathirOfflinePackage.prepare());assert.equal(result.ready,true);assert.deepEqual(result.missing,[]);
   assert.equal(await page.evaluate(()=>typeof XLSX),'undefined');assert.equal(await page.evaluate(()=>typeof jspdf),'undefined');return {assets:result.total};
  });
  await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!!window.HathirOfflinePackage);
  await check(report,'Offline reload runs the real Firebase SDK and all application scripts',async()=>{
   assert.equal(await page.evaluate(()=>navigator.onLine),false);
   assert.equal(await page.evaluate(()=>typeof firebase.auth),'function');
   assert.equal((await page.evaluate(()=>HathirOfflinePackage.prepare())).ready,true);
  });
  await check(report,'First offline use of Excel import parses a real XLSX in the worker',async()=>{
   const rows=await page.evaluate(async()=>{await loadOptionalLibrary('xlsx');const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['الاسم','القسم','المرحلة'],['طالب اختبار أوفلاين','تقنيات','الثانية']]));const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});return HathirSpreadsheetImport.read(new File([bytes],'students.xlsx'));});
   assert.equal(rows[1][0],'طالب اختبار أوفلاين');assert.equal(rows[1][2],'الثانية');
  });
  await page.evaluate(()=>{window.personalFixture={uid:'qa_offline_only',email:'qa-offline@example.invalid'};window.fixtureAuth={};window.fixtureUser=()=>({uid:personalFixture.uid});});
  await fixture.installWorkspace(page);
  await page.evaluate(()=>{session.local=true;subjects.forEach(s=>s.students.forEach((x,i)=>x.name=['أحمد علي حسن','محمد علي حسن','علي حسن محمد','حسن علي أحمد'][i]));document.getElementById('tourClose')?.click();});
  await check(report,'Real attendance Excel export downloads and opens offline',async()=>{
   const pending=page.waitForEvent('download');await page.evaluate(()=>exportExcel());const file=await (await pending).path();const bytes=fs.readFileSync(file);assert.equal(bytes.subarray(0,2).toString(),'PK');
   const names=await page.evaluate(async values=>{const wb=new ExcelJS.Workbook();await wb.xlsx.load(Uint8Array.from(values).buffer);return wb.worksheets.map(s=>s.rowCount);},[...bytes]);assert.equal(names.length,2);assert(names.every(n=>n>20));
  });
  await check(report,'Real student QR PDF downloads offline with embedded cards',async()=>{
   const pending=page.waitForEvent('download');await page.evaluate(()=>exportStudentQrPdf());const bytes=fs.readFileSync(await (await pending).path());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert(bytes.length>10000);return {bytes:bytes.length};
  });
  await check(report,'QR encodes and decodes offline using the actual libraries',async()=>{
   const value=await page.evaluate(async()=>{await loadOptionalLibrary('jsqr');await loadOptionalLibrary('qrcode');const payload=HathirNameQR.encodeScoped('أحمد علي حسن','medical_devices','medical_stage_2');const canvas=await makeQrCanvas(payload,320);const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);return {payload,decoded:jsQR(image.data,canvas.width,canvas.height).data};});assert.equal(value.decoded,value.payload);
  });
  await check(report,'Face library and all three model sets load for first use offline',async()=>{
   const loaded=await page.evaluate(async()=>{await loadOptionalLibrary('faceapi');await Promise.all([faceapi.nets.tinyFaceDetector,faceapi.nets.faceLandmark68Net,faceapi.nets.faceRecognitionNet].map(net=>net.loadFromUri(FACE_MODEL_URL)));return [faceapi.nets.tinyFaceDetector,faceapi.nets.faceLandmark68Net,faceapi.nets.faceRecognitionNet].every(net=>net.isLoaded);});assert.equal(loaded,true);
  });
  await check(report,'Help video stays online-only: excluded from the offline package and never served from cache offline',async()=>{
   const data=await page.evaluate(async()=>{const assets=HATHIR_OFFLINE_PACKAGE.assets;let served=false;try{served=(await fetch('/assets/help-v5/teacher-guide.mp4',{headers:{Range:'bytes=100-199'}})).ok;}catch{}const cached=[];for(const key of await caches.keys())for(const request of await (await caches.open(key)).keys())if(/\.mp4$/.test(new URL(request.url).pathname))cached.push(request.url);return {video:assets.filter(x=>/\.mp4$/.test(x)),served,cached};});
   assert.deepEqual(data,{video:[],served:false,cached:[]});
  });
  await check(report,'Readiness refuses to claim complete after a required asset is lost',async()=>{
   await page.evaluate(async()=>{for(const key of await caches.keys())if(key.startsWith('student-attendance-shell-'))await (await caches.open(key)).delete('/vendor/exceljs-4.4.0.min.js');});
   const result=await page.evaluate(()=>HathirOfflinePackage.prepare());assert.equal(result.ready,false);assert(result.missing.includes('/vendor/exceljs-4.4.0.min.js'));
  });
  await check(report,'Reconnecting repairs a missing app file without touching account storage',async()=>{
   await context.setOffline(false);const result=await page.evaluate(()=>HathirOfflinePackage.prepare());assert.equal(result.ready,true);assert.deepEqual(result.missing,[]);
  });
 }finally{await context.close();await browser.close();await new Promise(r=>server.close(r));saveReport(report,'offline-package-regression');}
})().catch(e=>{console.error(e);process.exitCode=1;});
