const {assert,makeReport,check,saveReport,path}=require('./offline-harness.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);const report=makeReport('scope-preview');
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
 for(const width of [390,1440])await check(report,'Isolated interactive preview '+width+'px: correct/rejected/legacy scans and no external requests',async()=>{
  const c=await b.newContext({viewport:{width,height:1000},serviceWorkers:'block'}),p=await c.newPage(),external=[];
  await c.route('**/*',r=>{if(r.request().url().startsWith('http://127.0.0.1:4199/'))return r.continue();external.push(r.request().url());return r.abort();});
  p.on('pageerror',e=>report.pageErrors.push(e.message));
  const response=await p.goto('http://127.0.0.1:4199/');assert(response.headers()['content-security-policy'].includes("connect-src 'none'"));
  await p.locator('[data-preview-scan="matching"]').waitFor();
  const before=await p.evaluate(()=>getSubject().students.length);assert.equal(before,0);
  await p.locator('[data-preview-scan="department"]').click();assert.equal(await p.evaluate(()=>getSubject().students.length),0);
  await p.locator('[data-preview-scan="stage"]').click();assert.equal(await p.evaluate(()=>getSubject().students.length),0);
  await p.locator('[data-preview-scan="matching"]').click();await p.waitForFunction(()=>getSubject().students.length===1);
  p.once('dialog',d=>d.dismiss());await p.locator('[data-preview-scan="legacy"]').click();assert.equal(await p.evaluate(()=>getSubject().students.length),1);
  p.once('dialog',d=>d.accept());await p.locator('[data-preview-scan="legacy"]').click();await p.waitForFunction(()=>getSubject().students.length===2);
  await p.screenshot({path:path.join(__dirname,'../reports/scope-preview-'+width+'.png')});
  await p.reload();await p.locator('[data-preview-scan="matching"]').waitFor();
  const saved=await p.evaluate(()=>localData.subjects.preview_qr_empty.students.length);assert.equal(saved,2);
  assert.deepEqual(external,[]);await c.close();
 });
 }finally{await b.close();saveReport(report,'scope-preview');}})().catch(e=>{console.error(e);process.exitCode=1;});
