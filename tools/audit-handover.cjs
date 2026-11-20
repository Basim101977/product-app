'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');const findings=[],large=[];
const signatures=[['Google API key',/AIza[\w-]{30,}/],['GitHub token',/(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/],['OpenAI key',/sk-(?:proj-)?[A-Za-z0-9_-]{30,}/],['OAuth token',/(?:ya29\.[\w.-]{25,}|1\/\/[\w-]{40,})/],['JWT',/eyJ[\w-]{15,}\.[\w-]{15,}\.[\w-]{10,}/],['Private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]];
function scan(label,b){if(b.length>50*1024*1024)large.push({path:label,bytes:b.length});if(b.includes(0))return;let s=b.toString('utf8');for(const [kind,re]of signatures)if(re.test(s))findings.push({path:label,kind});
 if(!label.includes('/vendor/')&&!/package-lock|pnpm-lock|LICENSE|OFL/.test(label)){
 const emails=s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];
 for(const email of new Set(emails))if(!/\.(?:test|local|invalid)$|@(?:example\.(?:com|org)|test\.com)|gserviceaccount\.com$|@(?:w3\.org|chromium\.org|mozilla\.org|types\/)/i.test(email))findings.push({path:label,kind:'Email requires review'});
 }}
const files=cp.execFileSync('git',['ls-files','--cached','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
for(const f of files){try{scan(f,cp.execFileSync('git',['show',':'+f],{cwd:root,maxBuffer:60*1024*1024,stdio:['ignore','pipe','ignore']}));}catch(e){findings.push({path:f,kind:'Unreadable staged file'});}}
if(process.argv.includes('--history')){const objects=cp.execFileSync('git',['rev-list','--objects','--branches','--tags'],{cwd:root,encoding:'utf8',maxBuffer:10000000}).trim().split('\n');for(const row of objects){const space=row.indexOf(' ');if(space<0)continue;const id=row.slice(0,space),file=row.slice(space+1);const type=cp.execFileSync('git',['cat-file','-t',id],{cwd:root,encoding:'utf8'}).trim();if(type==='blob')scan('history/'+file,cp.execFileSync('git',['cat-file','blob',id],{cwd:root,maxBuffer:60*1024*1024}));}}
const report={checkedAt:new Date().toISOString(),scope:'Staged files'+(process.argv.includes('--history')?' and all branch/tag reachable Git blobs':''),files:files.length,findings,large,limitations:'Pattern scan plus manual source review, not a proof of absence of every form of personal information. Public third-party license attribution is preserved.'};
fs.writeFileSync(path.join(root,'handover/SECURITY_SCAN.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({files:files.length,findings:findings.length,large:large.length,details:findings.slice(0,30)}));if(findings.length||large.length)process.exitCode=1;
