'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),release=process.env.HATHIR_FREEZE_RELEASE||'v2026.09.23-profile-qr-12';
const qa=JSON.parse(fs.readFileSync(path.join(root,'reports/local-regression-summary.json'),'utf8'));
if(!qa.passed||qa.cloudWrites!==0)throw Error('Passing final QA required');
const files=[];
function add(relative){
 const full=path.join(root,relative),stat=fs.statSync(full);
 if(stat.isDirectory()){
  for(const name of fs.readdirSync(full).sort())if(!['node_modules','.firebase','.git'].includes(name))add(relative+'/'+name);
 }else files.push({path:relative,bytes:stat.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')});
}
for(const name of ['netlify_site','functions','tools','firebase.json','.firebaserc','firestore_attendance.rules','firestore.indexes.json'])add(name);
const output={release,createdAt:new Date().toISOString(),qaCheckedAt:qa.checkedAt,files};
const suffix=process.env.HATHIR_FREEZE_MANIFEST||'release-source-manifest-v20260923.json';
fs.writeFileSync(path.join(root,'reports',suffix),JSON.stringify(output,null,2));
console.log(JSON.stringify({release,files:files.length,qaCheckedAt:qa.checkedAt}));
