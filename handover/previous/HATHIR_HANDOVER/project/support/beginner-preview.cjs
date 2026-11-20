'use strict';
// Interactive loopback-only preview. It strips production Firebase boot files,
// injects the existing local demo session and never contacts application data.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { configure } = require('./portable-env.cjs');
const { APP } = configure({ emulator:false });
const site = path.join(APP, 'netlify_site');
const host = '127.0.0.1';
const preferredPort = Number(process.env.HATHIR_PREVIEW_PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.ttf':'font/ttf','.mp4':'video/mp4'};
const runtime = `window.HATHIR_RUNTIME_CONFIG=${JSON.stringify({configured:false,firebaseConfig:null,environment:'local-preview',supportEnabled:true,supportEmail:'redacted@example.invalid'})};`;
const preview = `<script>
window.addEventListener('load',()=>{
  const openFixture=()=>{if(session)return;const uid='local_preview_teacher';session={uid,email:'preview@fixture.local',displayName:'تدريسي تجريبي',workspaceId:'local_preview',role:'owner',permissions:rolePermissions('owner'),departmentIds:[],stageIds:[],subjectIds:[],active:true,local:true};membersCache=[session];departments=defaultDepartments();stages=defaultStages();const stageId=stages.find(item=>item.departmentId==='medical_devices'&&Number(item.sort)===2)?.id||DEFAULT_STAGE_ID;compactScope={departmentId:'medical_devices',stageId,section:''};const subject={id:'preview_subject',titleAr:'الحاسوب',titleEn:'Computer',departmentId:'medical_devices',stageId,ownerUserId:uid,rosterNaming:'name',totalHours:60,lectureDurationHours:2,students:[{id:'preview_1',name:'سارة علي'},{id:'preview_2',name:'محمد حسن'},{id:'preview_3',name:'زينب أحمد'}],attendance:{},lectureMeta:{},lectures:[],excuses:{},archivedStudents:[],rosterLoaded:true};subjects=[subject];localData={workspace:{id:'local_preview'},users:{[uid]:session},departments:Object.fromEntries(departments.map(x=>[x.id,x])),stages:Object.fromEntries(stages.map(x=>[x.id,x])),subjects:{[subject.id]:subject}};activeSubjectId=subject.id;showApp();};
  openFixture();setTimeout(openFixture,800);
  const badge=document.createElement('div');badge.textContent='معاينة محلية — لا تتصل ببيانات Firebase';badge.dir='rtl';badge.style.cssText='position:fixed;z-index:99999;left:12px;bottom:12px;padding:8px 12px;border-radius:999px;background:#172b3a;color:white;font:700 12px Tajawal,Arial;box-shadow:0 8px 24px #0003';document.body.append(badge);
},{once:true});
</script>`;

const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname); }
  catch { response.writeHead(400); response.end(); return; }
  if (pathname === '/runtime-config.js') { response.writeHead(200, {'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'}); response.end(runtime); return; }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(site, relative);
  if (!file.startsWith(site + path.sep)) { response.writeHead(403); response.end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404); response.end('Not found'); return; }
    if (relative === 'index.html') {
      let html = data.toString('utf8').replace(/\s*<script defer src="https:\/\/www\.gstatic\.com\/firebasejs\/[^>]+><\/script>/g, '');
      html = html.replace('</body>', preview + '</body>');
      response.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'none'; frame-src 'none'"});
      response.end(html); return;
    }
    response.writeHead(200, {'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'}); response.end(data);
  });
});
server.on('error', error => { console.error(error.message); process.exitCode=1; });
server.listen(preferredPort, host, () => console.log(`Hathir local beginner preview: http://${host}:${server.address().port}/`));
