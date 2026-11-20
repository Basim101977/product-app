const {assert,makeReport,check,saveReport}=require('./offline-harness.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const report=makeReport('lecture-action-visibility');
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
 const p=await b.newPage();await p.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4199/')?r.continue():r.abort());
 await p.clock.install({time:new Date('2026-11-17T12:00:00+03:00')});
 await p.goto('http://127.0.0.1:4199/');await p.locator('[data-preview-scan="matching"]').waitFor();
 for(const mode of ['empty','historical','expired','active','completed','cancelled','orphan','removed'])await check(report,'Lecture controls: '+mode,async()=>{
  const state=await p.evaluate(mode=>{
   const s=getSubject(),date=mode==='historical'?'2026-11-03':todayISO();
   s.lectures=mode==='empty'?[]:[date];s.attendance={};s.lectureMeta={};
   if(mode!=='empty'){s.attendance[date]={example:{time:'08:00',attendedMinutes:120}};s.lectureMeta[date]={status:['completed','cancelled'].includes(mode)?mode:'active',startTime:mode==='active'?'11:30':'08:00',durationHours:2};}
   if(mode==='orphan')s.lectures=[];
   if(mode==='orphan'||mode==='removed'){s.attendance[date]={};s.lectureMeta[date].startTime='11:30';}
   if(mode==='removed')s.lectureMeta[date].hideWhenEmpty=true;
   renderLectureBanner();
   return ['completeLectureBtn','cancelLectureBtn'].map(id=>({hidden:document.getElementById(id).hidden,display:getComputedStyle(document.getElementById(id)).display}));
  },mode);
  for(const item of state){assert.equal(item.hidden,mode!=='active');assert.equal(item.display==='none',mode!=='active');}
 });
}finally{await b.close();saveReport(report,'lecture-action-visibility');}})().catch(e=>{console.error(e);process.exitCode=1;});
