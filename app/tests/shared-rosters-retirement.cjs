'use strict';
const {launch,makeReport,check,saveReport,assert}=require('./offline-harness.cjs');
const report=makeReport('shared-rosters-retirement');
(async()=>{const h=await launch(report);try{const {page,context}=await h.page();
 await check(report,'Retired centralized publishing API is absent',async()=>{assert.equal(await page.evaluate(()=>typeof HathirSharedRosters),'undefined');});
 await check(report,'Private scope sharing replacement is available',async()=>{assert(await page.evaluate(()=>typeof HathirPrivateScopeRoster.plan==='function'&&typeof HathirPrivateScopeRoster.distribute==='function'));});
 await check(report,'Startup never invokes retired centralized sharing',async()=>{assert.equal(await page.evaluate(()=>personalFixture.calls.some(c=>c.name==='sharedStudentRoster')),false);});
 await context.close();}finally{await h.close();}saveReport(report,'shared-rosters-retirement');})();
