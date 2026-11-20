'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^127\.0\.0\.1:\d+$/);
const requireFunctions=require('node:module').createRequire(require('node:path').resolve(__dirname,'../functions/index.js'));
const admin=requireFunctions('firebase-admin/app');
const app=admin.initializeApp({projectId:'demo-hathir-stress'},'stress');const firestore=requireFunctions('firebase-admin/firestore').getFirestore(app);
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
module.exports=()=>{
 const prefix='qa_'+crypto.randomUUID().replaceAll('-','')+'_';let count=0;
 const db={collection:name=>firestore.collection(prefix+name),runTransaction:fn=>firestore.runTransaction(fn)};
 const handler=require('../functions/device-live-sync')({db,onCall:(_,fn)=>fn,HttpsError,authorisedWorkspaceOwner:async()=>{}}).deviceLiveSync;
 return {call:async(data,uid='owner')=>{await new Promise(r=>setTimeout(r,(++count*17)%75));return handler({auth:{uid},data:{workspaceId:uid,...data}});}};
};
