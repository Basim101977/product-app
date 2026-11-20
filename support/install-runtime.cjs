'use strict';
// Downloads one public official emulator artifact; never logs in or deploys.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream');const {pipeline}=require('node:stream/promises');
const {JAR_SHA}=require('./portable-env.cjs');
const URL='https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar';
const directory=path.join(__dirname,'runtime'),target=path.join(directory,'firestore-emulator-v1.22.0.jar');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async()=>{
  if(fs.existsSync(target)){if(sha(target)!==JAR_SHA)throw Error('Existing emulator hash differs. Remove only that file after review and retry.');console.log('Verified emulator already installed.');return;}
  fs.mkdirSync(directory,{recursive:true});
  const partial=target+'.'+process.pid+'.partial';
  try{
    const response=await fetch(URL,{redirect:'error',signal:AbortSignal.timeout(300000)});
    if(!response.ok)throw Error('Official download returned HTTP '+response.status);
    await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(partial,{flags:'wx'}));
    if(fs.statSync(partial).size!==136707194||sha(partial)!==JAR_SHA)throw Error('Downloaded emulator length/hash mismatch; it will not be executed.');
    fs.renameSync(partial,target);console.log('Installed verified Firestore emulator 1.22.0: '+target);
  }finally{if(fs.existsSync(partial))fs.unlinkSync(partial);}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
