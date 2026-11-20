const {assert,launch,makeReport,check,saveReport}=require('./offline-harness.cjs');
const report=makeReport('security-headers');
(async()=>{const h=await launch(report);try{
 const {page}=await h.page();
 await check(report,'Security headers enforce framing, base and plugin restrictions without restricting cloud connections',async()=>{
  const response=await page.request.get(h.origin);const headers=response.headers();
  assert.equal(headers['x-frame-options'],'DENY');assert.equal(headers['referrer-policy'],'no-referrer');
  const csp=headers['content-security-policy'];assert(csp.includes("frame-ancestors 'none'"));assert(csp.includes("object-src 'none'"));assert(csp.includes("base-uri 'self'"));
  assert(!csp.includes('connect-src'));assert(!csp.includes('script-src'));
  assert.equal(headers['permissions-policy'],'camera=(self), microphone=()');
 });
 await check(report,'Browser blocks same-origin embedding of the app',async()=>{
  const messages=[];page.on('console',m=>messages.push(m.text()));
  await page.evaluate(()=>{const f=document.createElement('iframe');f.id='framing-test';f.src=location.origin+'/index.html';document.body.append(f);});
  await page.waitForFunction(()=>{const f=document.getElementById('framing-test');try{return f.contentDocument===null;}catch{return true;}});
  assert(messages.some(m=>/frame-ancestors|X-Frame-Options|Refused to frame/i.test(m)));
 });
 await check(report,'Top-level auth remains usable and no JavaScript errors',async()=>{
  await page.reload();await page.locator('#authEmail').waitFor();assert.deepEqual(report.pageErrors,[]);
 });
}finally{await h.close();saveReport(report,'security-headers');}})().catch(e=>{console.error(e);process.exitCode=1;});
