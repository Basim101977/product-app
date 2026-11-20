'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),project='alqar-student-attendance-2026',site='hathir';
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
function requireThat(ok,message){if(!ok)throw Error(message);}
const context={window:{}};vm.runInNewContext(read('netlify_site/runtime-config.js'),context);
const runtime=context.window.HATHIR_RUNTIME_CONFIG,firebase=JSON.parse(read('firebase.json')),aliases=JSON.parse(read('.firebaserc'));
requireThat(runtime?.configured===true&&runtime.projectId===project&&runtime.firebaseConfig?.projectId===project,'Original production project mismatch');
requireThat(runtime.ownerUid==='HATHIR_OWNER_UID_REQUIRED'&&runtime.environment==='production','Existing production identity must remain pinned');
requireThat(aliases.projects.default===project&&firebase.hosting.site===site&&firebase.hosting.public==='netlify_site','Original hosting target mismatch');
requireThat(!process.env.GCLOUD_PROJECT||process.env.GCLOUD_PROJECT===project,'CLI selected another project');
requireThat(read('netlify_site/offline-store.js').includes('hathir-offline-v1')&&!read('netlify_site/offline-store.js').includes('hathir-personal-20260922-offline-v1'),'Original browser outbox namespace must remain');
requireThat(JSON.parse(read('netlify_site/manifest.webmanifest')).id==='/','Original installed-app identity must remain');
requireThat(/functions\(['"]asia-south1['"]\)/.test(read('netlify_site/offline-attendance.js')),'Existing sync endpoint region must remain');
requireThat(/syncOfflineAttendanceBatch:[\s\S]*?region:\s*['"]asia-south1['"]/.test(read('functions/offline-attendance-batch.js')),'Backend sync region mismatch');
requireThat(!read('functions/index.js').includes('hathir-runtime@project-b8a82'),'Test runtime identity must never be used in production');
const releaseManifests={'v2026.09.24-account-actions-33':'reports/release-source-manifest-account-actions-33.json','v2026.09.24-admin-accounts-32':'reports/release-source-manifest-admin-accounts-32.json','v2026.09.24-el-ph-31':'reports/release-source-manifest-el-ph-31.json','v2026.09.24-shared-rosters-30':'reports/release-source-manifest-shared-rosters-30.json','v2026.09.24-mobile-help-29':'reports/release-source-manifest-mobile-help-29.json','v2026.09.24-speed-28':'reports/release-source-manifest-speed-28.json','v2026.09.24-aligned-help-27':'reports/release-source-manifest-aligned-help-27.json','v2026.09.24-motion-help-26':'reports/release-source-manifest-motion-help-26.json','v2026.09.24-text-help-25':'reports/release-source-manifest-text-help-25.json','v2026.09.23-profile-qr-12':'reports/release-source-manifest-v20260923.json','v2026.09.23-legacy-close-13':'reports/release-source-manifest-legacy-close-13.json'};
releaseManifests['v2026.09.23-clean-start-14']='reports/release-source-manifest-clean-start-14.json';
releaseManifests['v2026.09.23-clean-sync-15']='reports/release-source-manifest-clean-sync-15.json';
releaseManifests['v2026.09.23-onboarding-16']='reports/release-source-manifest-onboarding-16.json';
releaseManifests['v2026.09.24-guided-audio-17']='reports/release-source-manifest-guided-audio-17.json';
releaseManifests['v2026.09.24-abdullah-18']='reports/release-source-manifest-abdullah-18.json';
releaseManifests['v2026.09.24-coach-notes-19']='reports/release-source-manifest-coach-notes-19.json';
releaseManifests['v2026.09.24-polished-tour-22']='reports/release-source-manifest-polished-tour-22.json';
releaseManifests['v2026.09.24-welcome-voice-23']='reports/release-source-manifest-welcome-voice-23.json';
releaseManifests['v2026.09.24-account-access-24']='reports/release-source-manifest-account-access-24.json';
releaseManifests['v2026.09.24-tour-interaction-21']='reports/release-source-manifest-tour-interaction-21.json';
releaseManifests['v2026.09.24-simple-tour-20']='reports/release-source-manifest-simple-tour-20.json';
releaseManifests['v2026.09.25-beginner-ui-34']='reports/release-source-manifest-beginner-ui-34.json';
releaseManifests['v2026.09.25-daily-actions-35']='reports/release-source-manifest-daily-actions-35.json';
releaseManifests['v2026.09.25-record-window-36']='reports/release-source-manifest-record-window-36.json';
releaseManifests['v2026.09.25-record-dialog-37']='reports/release-source-manifest-record-dialog-37.json';
releaseManifests['v2026.09.25-professional-shell-38']='reports/release-source-manifest-professional-shell-38.json';
releaseManifests['v2026.09.25-mobile-record-39']='reports/release-source-manifest-mobile-record-39.json';
releaseManifests['v2026.09.25-subject-menu-40']='reports/release-source-manifest-subject-menu-40.json';
releaseManifests['v2026.09.25-inline-scanner-record-41']='reports/release-source-manifest-inline-scanner-record-41.json';
releaseManifests['v2026.09.25-round-attendance-42']='reports/release-source-manifest-round-attendance-42.json';
releaseManifests['v2026.09.25-mobile-navigation-43']='reports/release-source-manifest-mobile-navigation-43.json';
releaseManifests['v2026.09.25-green-start-44']='reports/release-source-manifest-green-start-44.json';
releaseManifests['v2026.09.25-scanner-controls-45']='reports/release-source-manifest-scanner-controls-45.json';
releaseManifests['v2026.09.25-unified-attendance-46']='reports/release-source-manifest-unified-attendance-46.json';
releaseManifests['v2026.09.25-session-summary-47']='reports/release-source-manifest-session-summary-47.json';
releaseManifests['v2026.09.25-large-scanner-48']='reports/release-source-manifest-large-scanner-48.json';
releaseManifests['v2026.09.25-live-sync-49']='reports/release-source-manifest-live-sync-49.json';
releaseManifests['v2026.09.25-last-reading-50']='reports/release-source-manifest-last-reading-50.json';
releaseManifests['v2026.09.25-auto-close-51']='reports/release-source-manifest-auto-close-51.json';
releaseManifests['v2026.09.26-compact-record-52']='reports/release-source-manifest-compact-record-52.json';
releaseManifests['v2026.09.26-more-menu-53']='reports/release-source-manifest-more-menu-53.json';
releaseManifests['v2026.09.26-student-profile-54']='reports/release-source-manifest-student-profile-54.json';
releaseManifests['v2026.09.26-face-save-55']='reports/release-source-manifest-face-save-55.json';
releaseManifests['v2026.09.26-profile-return-56']='reports/release-source-manifest-profile-return-56.json';
releaseManifests['v2026.09.26-release-audit-57']='reports/release-source-manifest-release-audit-57.json';
releaseManifests['v2026.09.26-receive-fallback-58']='reports/release-source-manifest-receive-fallback-58.json';
releaseManifests['v2026.09.26-preparation-details-59']='reports/release-source-manifest-preparation-details-59.json';
releaseManifests['v2026.09.26-browser-setup-60']='reports/release-source-manifest-browser-setup-60.json';
releaseManifests['v2026.09.26-lecture-summary-61']='reports/release-source-manifest-lecture-summary-61.json';
releaseManifests['v2026.09.26-record-close-62']='reports/release-source-manifest-record-close-62.json';
releaseManifests['v2026.09.26-profile-controls-63']='reports/release-source-manifest-profile-controls-63.json';
releaseManifests['v2026.09.26-attendance-button-64']='reports/release-source-manifest-attendance-button-64.json';
releaseManifests['v2026.09.26-profile-sync-close-65']='reports/release-source-manifest-profile-sync-close-65.json';
releaseManifests['v2026.09.26-cancelled-column-66']='reports/release-source-manifest-cancelled-column-66.json';
releaseManifests['v2026.09.26-cancelled-header-67']='reports/release-source-manifest-cancelled-header-67.json';
releaseManifests['v2026.09.26-excel-format-68']='reports/release-source-manifest-excel-format-68.json';
releaseManifests['v2026.09.26-compact-lecture-header-69']='reports/release-source-manifest-compact-lecture-header-69.json';
releaseManifests['v2026.09.26-stacked-lecture-header-70']='reports/release-source-manifest-stacked-lecture-header-70.json';
releaseManifests['v2026.09.26-cancelled-text-71']='reports/release-source-manifest-cancelled-text-71.json';
releaseManifests['v2026.09.26-empty-column-72']='reports/release-source-manifest-empty-column-72.json';
releaseManifests['v2026.09.26-scoped-pending-73']='reports/release-source-manifest-scoped-pending-73.json';
releaseManifests['v2026.09.26-roster-confirm-74']='reports/release-source-manifest-roster-confirm-74.json';
if(!Object.hasOwn(releaseManifests,process.env.HATHIR_PRODUCTION_RELEASE||''))throw Error('Production publish is locked. Complete backups and compatibility QA, then explicitly set HATHIR_PRODUCTION_RELEASE for the approved release.');
const summary=JSON.parse(read('reports/local-regression-summary.json'));
requireThat(summary.passed===true&&summary.cloudWrites===0,'Local compatibility suite has not passed');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'../.private/baseline/manifest.json'),'utf8'));
requireThat(manifest.source===project&&!!manifest.completeAt&&!!manifest.originalCodeCompleteAt&&manifest.artifacts.some(x=>x.file==='firestore.enc'),'Verified original data and deployed-code snapshots are required');
requireThat(Date.now()-Date.parse(manifest.completeAt)<86400000,'A fresh backup is required');
for(const artifact of manifest.artifacts){
 requireThat(artifact.verified===true&&path.isAbsolute(artifact.path),'Verified backup artifact required');
 requireThat(crypto.createHash('sha256').update(fs.readFileSync(artifact.path)).digest('hex')===artifact.sha256,'Backup artifact hash mismatch');
}
const frozen=JSON.parse(read(releaseManifests[process.env.HATHIR_PRODUCTION_RELEASE]));
requireThat(frozen.release===process.env.HATHIR_PRODUCTION_RELEASE&&frozen.qaCheckedAt===summary.checkedAt,'Source freeze must correspond to final passing QA');
for(const file of frozen.files){
 requireThat(!path.isAbsolute(file.path)&&!file.path.split(/[\\/]/).includes('..'),'Invalid release path');
 requireThat(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file.path))).digest('hex')===file.sha256,'Source changed after final QA: '+file.path);
}
console.log('Original Hathir target, Auth identity, retained browser outbox and required verification checked.');



