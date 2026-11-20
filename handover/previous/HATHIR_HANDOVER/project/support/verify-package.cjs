'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'FILE-MANIFEST.json'),'utf8'));
const failures=[];
for(const entry of manifest.files){
 const segments=entry.path.split('/');
 if(path.isAbsolute(entry.path)||segments.includes('..'))throw Error('Unsafe manifest path');
 const file=path.join(root,...segments);
 if(!fs.existsSync(file)){failures.push(entry.path+': missing');continue;}
 const bytes=fs.readFileSync(file),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 if(hash!==entry.sha256||bytes.length!==entry.bytes)failures.push(entry.path+': changed');
}
console.log(JSON.stringify({passed:failures.length===0,checked:manifest.files.length,failures},null,2));
if(failures.length)process.exitCode=1;
