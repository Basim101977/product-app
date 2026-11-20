'use strict';
// Handover adapter, not part of the original frozen application.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const SUPPORT=__dirname;
const APP=path.resolve(SUPPORT,'../app');
const JAR_SHA='9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c';
function file(value,label){if(!value||!fs.existsSync(value)||!fs.statSync(value).isFile())throw Error(label+' missing: '+(value||'(not configured)'));return path.resolve(value);}
function configure({emulator=true}={}){
  if(Number(process.versions.node.split('.')[0])!==22)throw Error('Use Node.js 22; original validated version: 22.20.0.');
  file(path.join(APP,'tests/run-local.cjs'),'Packaged original application');
  file(path.join(APP,'tests/previous-worker-fixture.cjs'),'Synthetic worker upgrade fixture');
  const env={...process.env};
  // No login/token/service-account settings are needed by these local tests.
  for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','FIREBASE_CONFIG','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','HATHIR_PRODUCTION_RELEASE','NODE_OPTIONS'])delete env[key];
  env.PLAYWRIGHT_MODULE=file(require.resolve('playwright'),'Pinned Playwright');
  env.CHROME_PATH=file(process.env.CHROME_PATH||require('playwright').chromium.executablePath(),'Chromium (run npx playwright install chromium)');
  env.NAME_QR_GENERATOR_JS=file(require.resolve('qrcode-generator'),'Pinned QR generator');
  env.NAME_QR_DECODER_JS=file(require.resolve('jsqr'),'Pinned QR decoder');
  for(const name of ['firebase-admin','firebase-functions'])file(path.join(APP,'functions/node_modules',name,'package.json'),'Functions dependency '+name+' (run npm ci in functions)');
  if(emulator){
    env.PERSONAL_TEST_JAVA=file(process.env.PERSONAL_TEST_JAVA||(process.env.JAVA_HOME&&path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java')),'Java 21; set PERSONAL_TEST_JAVA or JAVA_HOME');
    const version=spawnSync(env.PERSONAL_TEST_JAVA,['-version'],{encoding:'utf8',windowsHide:true});
    if(version.error||version.status!==0||!/(?:openjdk|java) version "21\./.test(version.stderr+version.stdout))throw Error('Java 21 is required; '+(version.error?.message||version.stderr||version.stdout));
    env.PERSONAL_TEST_FIRESTORE_JAR=file(process.env.PERSONAL_TEST_FIRESTORE_JAR||path.join(SUPPORT,'runtime/firestore-emulator-v1.22.0.jar'),'Pinned Firestore emulator (npm run install:emulator)');
    // Resolve the runtime junction before invoking Java on Windows, whose
    // launcher may decode non-ASCII argument paths through the system codepage.
    env.PERSONAL_TEST_FIRESTORE_JAR=fs.realpathSync(env.PERSONAL_TEST_FIRESTORE_JAR);
    const sha=crypto.createHash('sha256').update(fs.readFileSync(env.PERSONAL_TEST_FIRESTORE_JAR)).digest('hex');
    if(sha!==JAR_SHA)throw Error('Emulator SHA256 mismatch; refusing to execute it.');
  }
  return {APP,SUPPORT,env};
}
function applyEnvironment(env){
  for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','FIREBASE_CONFIG','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','HATHIR_PRODUCTION_RELEASE','NODE_OPTIONS'])delete process.env[key];
  Object.assign(process.env,env);
}
module.exports={configure,applyEnvironment,APP,SUPPORT,JAR_SHA};
