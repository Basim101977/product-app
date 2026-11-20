'use strict';
// Screenshot-only preview through the original network-blocking mock harness.
// Never exposes a raw server URL with the production runtime configuration.
const fs=require('node:fs'),path=require('node:path');
const {configure,applyEnvironment}=require('./portable-env.cjs');
(async()=>{
  const {APP,SUPPORT,env}=configure({emulator:false});applyEnvironment(env);
  const {launch,makeReport}=require(path.join(APP,'tests/offline-harness.cjs'));
  const harness=await launch(makeReport('portable-safe-preview'));
  try{
    const {page}=await harness.page({width:390,runtime:'synthetic'});
    await page.waitForFunction(()=>Boolean(window.HathirPersonal));
    const directory=path.join(SUPPORT,'previews');fs.mkdirSync(directory,{recursive:true});
    const target=path.join(directory,'synthetic-login-390.png');
    await page.screenshot({path:target,fullPage:true});console.log('Synthetic local preview saved: '+target);
  }finally{await harness.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
