'use strict';
const {launch,makeReport,check,saveReport,assert}=require('./offline-harness.cjs');
const report=makeReport('release-current-auth');
(async()=>{const h=await launch(report);try{
 for(const status of ['approved','pending','rejected'])await check(report,'Current device startup gates '+status,async()=>{
  const uid='qa_current_'+status;
  const fixture={uid,rememberedUser:true,verified:true,accountStatus:status,responses:{getPersonalAccountStatus:{status,emailVerified:true,workspaceReady:true,workspaceId:uid},openIndividualWorkspace:{workspaceId:uid},closedLectureWorkspace:{revision:null,count:0},deviceLiveSync:{ready:false}}};
  const {page,context}=await h.page({fixture});try{
   if(status==='approved'){
    await page.waitForFunction(()=>session?.deviceFirst===true&&!document.getElementById('appPage').hidden);
    assert.equal(await page.evaluate(()=>session.uid),uid);
    assert.equal(await page.evaluate(()=>HathirDeviceWorkspace.active()),true);
    await page.reload();await page.waitForFunction(()=>session?.deviceFirst===true&&!document.getElementById('appPage').hidden);
    assert.equal(await page.evaluate(()=>session.uid),uid);
   }else{
    await page.waitForFunction(()=>!document.getElementById('personalPendingActions').hidden);
    assert.equal(await page.locator('#appPage').isVisible(),false);
    assert.equal(await page.evaluate(()=>personalFixture.calls.some(c=>c.name==='closedLectureWorkspace'||c.name==='openIndividualWorkspace')),false);
   }
  }finally{await context.close();}
 });
}finally{await h.close();}saveReport(report,'release-current-auth');})();
