# Published release 151 — 2026-10-22

Live: https://hathir.web.app/
Release: v2026.10.21-consolidation-151
Source: development/source/work/hathir-consolidation-20261021/app
Verified at: 2026-10-22T10:20:58.725Z

766 final local cases passed, including Requests sidebar access, Arabic/English priority order, consolidation imports, badges, numeric base-60 durations, per-column filtering and filtered export. Read-only file checks were separate from synthetic QA. Targeted WebKit checks passed; no physical-phone verification.

Hosting-only deployment succeeded. All 6 changed/new public assets match SHA256 after publication: index.html, service-worker.js, settings-ui.js, consolidation-model.js, consolidation.css, consolidation.js. Backend runtime, security rules, original Firebase project and identity unchanged. Deployment gate retained, registered release manifest and verified fresh encrypted snapshot before publish.

Backup: C:\Users\USER\AppData\Local\HathirBackups\release-20261022-1792663894049
Snapshot: 41844 Firestore documents at one independently counted read time, 55 deployed functions and their original source archives, 256 previous hosting files, rules and indexes. AES-GCM encrypted, hash/roundtrip and DPAPI key recovery verified. Auth password hashes and unsynced device-local pending records are not included. No full restore performed.

Retained previous release 150: development/source/work/hathir-clean-notes-20261019/app and reports/retained-release-150.json. Frozen final manifest: reports/release-source-manifest-consolidation-151.json (315 source files). Full QA: review-20261022-qa151-publish.log. Backup log: review-20261022-backup151.log. Publish log: review-20261022-publish151.log.

Consolidation remains individual and device-local. It does not query other teachers' workspaces; existing workspace backup/sync does not include its independent IndexedDB store. Raw uploads are not persisted. No announcement sent.
