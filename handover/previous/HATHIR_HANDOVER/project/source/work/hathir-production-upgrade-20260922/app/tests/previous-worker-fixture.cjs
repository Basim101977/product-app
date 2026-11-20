'use strict';
// Minimal synthetic worker/storage predecessor, not an archived application.
const fs=require('fs'),path=require('path'),os=require('os');
module.exports=function(site){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'HathirWorkerFixture-'));
 process.once('exit',()=>{if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('HathirWorkerFixture-'))fs.rmSync(root,{recursive:true,force:true});});
 fs.copyFileSync(path.join(site,'offline-store.js'),path.join(root,'offline-store.js'));
 fs.copyFileSync(path.join(site,'manifest.webmanifest'),path.join(root,'manifest.webmanifest'));
 fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><title>Synthetic worker fixture</title><script src="offline-store.js"></script>');
 fs.writeFileSync(path.join(root,'service-worker.js'),`const CACHE_VERSION = "student-attendance-shell-synthetic-previous";
const APP_SHELL = ["/","/index.html","/offline-store.js","/manifest.webmanifest"];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE_VERSION).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith(caches.open(CACHE_VERSION).then(async c=>(await c.match(e.request))||fetch(e.request)));});`);
 return root;
};
