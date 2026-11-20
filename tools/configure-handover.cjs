'use strict';
// Materialize local configuration. Never commits files or deploys anything.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),app=path.join(root,'app');
const required=['HATHIR_FIREBASE_API_KEY','HATHIR_OWNER_UID','HATHIR_OWNER_EMAIL'];
for(const key of required)if(!process.env[key])throw Error('Missing environment variable: '+key);
const replacements={HATHIR_FIREBASE_API_KEY_REQUIRED:process.env.HATHIR_FIREBASE_API_KEY,HATHIR_OWNER_UID_REQUIRED:process.env.HATHIR_OWNER_UID,'redacted@example.invalid':process.env.HATHIR_OWNER_EMAIL};
// Replacement values enter JS/JSON/rules string literals; reject unsafe syntax.
for(const value of Object.values(replacements))if(!/^[A-Za-z0-9_@.+-]+$/.test(value))throw Error('Invalid configuration characters');
const targetFiles=['netlify_site/runtime-config.js','netlify_site/personal-ui.js','netlify_site/index.html','netlify_site/__/firebase/init.js','netlify_site/__/firebase/init.json','firestore_attendance.rules','functions/personal-workspace.js','functions/push-notifications.js','functions/support-chat.js','functions/support-mailbox.js','functions/support-broadcast.js'];
for(const rel of targetFiles){const f=path.join(app,rel);if(!fs.existsSync(f))continue;let s=fs.readFileSync(f,'utf8');if(rel==='netlify_site/personal-ui.js' && process.env.HATHIR_SUPPORT_EMAIL){if(!/^[A-Za-z0-9_@.+-]+$/.test(process.env.HATHIR_SUPPORT_EMAIL))throw Error('Invalid support email');s=s.split('redacted@example.invalid').join(process.env.HATHIR_SUPPORT_EMAIL);}for(const [placeholder,value]of Object.entries(replacements))s=s.split(placeholder).join(value);if(rel==='netlify_site/runtime-config.js'){s=s.replace(/configured:\s*false/,'configured: true');if(process.env.HATHIR_SUPPORT_EMAIL){if(!/^[A-Za-z0-9_@.+-]+$/.test(process.env.HATHIR_SUPPORT_EMAIL))throw Error('Invalid support email');s=s.replace(/supportEmail:\s*'[^']*'/,"supportEmail: '"+process.env.HATHIR_SUPPORT_EMAIL+"'");}}fs.writeFileSync(f,s);}
console.log('Local configuration generated. Do not commit configured files. Production release manifests must be reviewed and regenerated separately.');
