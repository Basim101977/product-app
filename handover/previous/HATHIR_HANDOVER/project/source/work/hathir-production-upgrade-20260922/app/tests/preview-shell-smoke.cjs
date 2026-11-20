'use strict';
// Anonymous, read-only browser smoke against the exact preview origin.
const path=require('node:path');
const {chromium}=require(path.resolve(__dirname,'../../../../../support/node_modules/playwright'));
const {assert,fs,REPORTS}=require('./offline-harness.cjs');
const origin='https://hathir--beginner-ui-34-4dww7a27.web.app';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const results=[];
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:width<500?844:1000},serviceWorkers:'block'});
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   const response=await page.goto(origin+'/?release=v2026.09.26-release-audit-57',{waitUntil:'domcontentloaded',timeout:30000});
   await page.locator('#loginPage').waitFor({state:'visible',timeout:30000});
   await page.waitForFunction(()=>!document.getElementById('authStartup')||document.getElementById('authStartup').hidden,null,{timeout:30000});
   const state=await page.evaluate(()=>({version:typeof APP_VERSION==='string'?APP_VERSION:'',login:!document.getElementById('loginPage').hidden,overflow:document.documentElement.scrollWidth>innerWidth,app:!document.getElementById('appPage').hidden}));
   assert.equal(response.status(),200);assert.equal(state.version,'v2026.09.26-release-audit-57');assert(state.login&&!state.app&&!state.overflow,JSON.stringify(state));assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(REPORTS,`preview-login-${width}.png`)});
   results.push({width,status:response.status(),...state,pageErrors:errors.length});
   await context.close();
  }
 }finally{await browser.close()}
 fs.writeFileSync(path.join(REPORTS,'preview-shell-smoke.json'),JSON.stringify({checkedAt:new Date().toISOString(),origin,anonymous:true,readOnly:true,results},null,2)+'\n');
 console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1});
