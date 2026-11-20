'use strict';
const {spawn}=require('node:child_process');
const {configure}=require('./portable-env.cjs');
try{
  const {APP,env}=configure();
  console.log('Portable dependencies verified. Local synthetic tests only; no Firebase login or deployment.');
  if(process.argv.includes('--check'))process.exit(0);
  const child=spawn(process.execPath,['tests/run-local.cjs'],{cwd:APP,env,stdio:'inherit',windowsHide:true});
  child.once('error',error=>{console.error(error.message);process.exitCode=1;});
  child.once('exit',code=>{process.exitCode=code??1;});
  process.once('SIGINT',()=>child.kill());
}catch(error){console.error(error.message);process.exitCode=1;}
