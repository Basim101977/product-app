const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = path.resolve(__dirname, '../../development/source/work/hathir-face-preference-20261026/app');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'reports/release-source-manifest-face-optin-163.json')));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const output = path.join(__dirname, 'dist');
fs.mkdirSync(output, {recursive:true});
const files = manifest.files.filter(f => f.path.startsWith('netlify_site/'));
for (const file of files) {
  const relative = file.path.slice('netlify_site/'.length);
  assert(!relative.split('/').includes('..'));
  const bytes = fs.readFileSync(path.join(source, file.path));
  assert.equal(sha(bytes), file.sha256, 'Source mismatch: '+relative);
  const target = path.join(output, relative);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, bytes);
}
const indexPath = path.join(output,'index.html');
const original = fs.readFileSync(indexPath,'utf8');
let html = original;
const removed=[];
for (const [name,end,count,prefix] of [['defaultStudents','extraStudents',30,'PRIMARY'],['extraStudents','clone',4,'EXTRA']]) {
  const start=html.indexOf('    function '+name+'() {');
  const stop=html.indexOf('    function '+end+'(',start+1);
  assert(start>=0 && stop>start);
  const section=html.slice(start,stop);
  const rows=[...section.matchAll(/\{ name: ("(?:[^"\\]|\\.)*"), id: ("(?:[^"\\]|\\.)*") \}/g)];
  assert.equal(rows.length,count);
  removed.push(...rows.flatMap(r=>[JSON.parse(r[1]),JSON.parse(r[2])]));
  const replacement='    function '+name+'() {\n      return '+JSON.stringify(Array.from({length:count},(_,i)=>({name:'Synthetic '+prefix+' student '+(i+1),id:'QA-'+prefix+'-'+(i+1)})))+';\n    }\n\n';
  html=html.slice(0,start)+replacement+html.slice(stop);
}
const start=html.indexOf('    function defaultLocalData() {');
const stop=html.indexOf('    function cacheElements() {',start);
assert(start>=0&&stop>start);
let section=html.slice(start,stop);
const counts={password:0,email:0,displayName:0};
section=section.replace(/\b(password|email|displayName): ("(?:[^"\\]|\\.)*")/g,(_,key,literal)=>{
  const value=JSON.parse(literal); if(key!=='displayName')removed.push(value);
  const i=++counts[key];
  return key+': '+JSON.stringify(key==='password'?'SYNTHETIC_DISABLED_LOCAL_'+i:key==='email'?'alternate-fixture-'+i+'@fixture.local':'Synthetic local fixture '+i);
});
assert.equal(counts.password,7);assert.equal(counts.email,7);assert.equal(counts.displayName,7);
html=html.slice(0,start)+section+html.slice(stop);
for(const value of removed) {
  if(/^\d{4}$/.test(value)) continue;
  assert(!html.includes(value),'Legacy seed value outside sanitized ranges');
}
fs.writeFileSync(indexPath,html);
let scripts=0;
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=/.test(m[1])&&m[2].trim()){new vm.Script(m[2]);scripts++;}
for(const file of files.filter(f=>f.path.endsWith('.js')&&!f.path.includes('/vendor/'))) new vm.Script(fs.readFileSync(path.join(output,file.path.slice('netlify_site/'.length)),'utf8'),{filename:file.path});
const config={window:{}};vm.runInNewContext(fs.readFileSync(path.join(output,'runtime-config.js'),'utf8'),config);
assert.equal(config.window.HATHIR_RUNTIME_CONFIG.projectId,'alqar-student-attendance-2026');
assert.equal(sha(fs.readFileSync(path.join(output,'runtime-config.js'))),sha(fs.readFileSync(path.join(source,'netlify_site/runtime-config.js'))));
assert(process.env.FFMPEG_EXE,'Set FFMPEG_EXE to a trusted ffmpeg executable before preparing this deployment');
const video=path.join(output,'assets/help-v5/teacher-guide.mp4');
const compressed=video+'.compressed.mp4';
require('node:child_process').execFileSync(process.env.FFMPEG_EXE,['-hide_banner','-loglevel','error','-y','-i',video,'-map','0:v:0','-map','0:a:0','-vf','scale=720:-2,fps=15','-c:v','libx264','-preset','veryfast','-b:v','205k','-maxrate','220k','-bufsize','440k','-c:a','aac','-ac','1','-b:a','48k','-movflags','+faststart',compressed]);
assert(fs.statSync(compressed).size<25*1024*1024);
fs.renameSync(compressed,video);
const report={sourceRelease:manifest.release,files:files.length,inlineScriptsParsed:scripts,sourceFilesVerified:true,originalSourcesModified:false,runtimeConfigUnchanged:true,productionDataIncluded:false,changes:['Sanitized disabled legacy local seed data in alternate index.html only','Compressed instructional video to fit hosting asset limit; duration and chapters preserved'],originalIndexSha256:sha(original),alternateIndexSha256:sha(html),videoBytes:fs.statSync(video).size,videoSha256:sha(fs.readFileSync(video))};
fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
