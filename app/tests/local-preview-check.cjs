const {chromium}=require(require('path').join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});
  await page.goto('http://127.0.0.1:4197/');
  await page.waitForFunction(()=>[...document.querySelectorAll('.rosterFullName[data-name-attendance]')].some(el=>el.getClientRects().length&&getComputedStyle(el).visibility==='visible'));
  await page.waitForFunction(()=>document.querySelector('#workspaceSyncReminder')?.hidden===false);
  await page.locator('#workspaceSyncReminder').scrollIntoViewIfNeeded();
  await page.screenshot({path:'development/source/work/hathir-lecture-sync-local-20261106/app/reports/local-preview-'+width+'.png'});
  for(const id of ['offlineStatus','deviceRecordStatus','syncStatusHost','beginnerSyncStatus']){
    const old=page.locator('#'+id);if(await old.count()&&await old.isVisible())throw Error('Duplicate sync indicator: '+id);
  }
  const result=await page.evaluate(()=>({demo:document.querySelector('#workspaceSyncReminder').textContent,register:document.querySelector('#rosterRows .rosterFullName[data-name-attendance]').closest('td').cellIndex,tail:document.querySelectorAll('#rosterRows .miniActions [data-mark]').length}));
  if(result.register!==1||result.tail!==0||!result.demo.includes('مثال توضيحي'))throw Error(JSON.stringify(result));
  if(await page.locator('#workspaceSyncReminder button').count())throw Error('Sync button should not be shown');
  if(await page.locator('#attendanceRecordCard #workspaceSyncReminder').count())throw Error('Sync bar belongs outside the table');
  console.log(width,'preview verified');
  await page.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});


