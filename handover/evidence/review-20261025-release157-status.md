# Published release157 — 2026-10-25
Live https://hathir.web.app/
Source development/source/work/hathir-department-tools-20261025/app
Version v2026.10.25-department-tools-157
Verified 2026-10-25T10:19:52.732Z

Department dropdown within subject create/edit now has in-row Edit/Delete icons and sticky Create department command. Original native field and stage change handler retained. Existing subject department remains locked; name changes preserve IDs/stage/history. Creation preserves original stage presets. Duplicate normalized names rejected. Built-in/referenced departments retain existing delete protection. Existing confirmation/permission/local-cloud save functions reused. Local failure rollback tested.

786 final synthetic cases passed, including10 new department cases; targeted10 cases passed WebKit and original8 subject tests passed. No real cloud CRUD test or physical-device claim. Hosting-only deployment. Five changed/new asset hashes verified: index.html, service-worker.js, subject-tools.js, department-tools.css, department-tools.js. Backend/security rules/identity/schema unchanged.

Fresh encrypted backup C:\Users\USER\AppData\Local\HathirBackups\release-20261025-1792923323316:43999 Firestore documents fixed-time independently counted,55 deployed functions/source archives,261 previous hosting files,rules/indexes. Initial backup stalled on large file body and was stopped by verified owned PID; its incomplete artifacts/log retained. Successful helper review-20261025-backup157-cached.cjs reuses258 previous hosting files only after encrypted-artifact/decrypted hash checks and exact matching of current immutable Hosting file hashes, downloads3changed files, and confirms live Hosting release stable before/after. New encryption roundtrip/hash and DPAPI recovery verified. No restore performed; Auth password hashes/device-local pending records excluded.

Previous156 retained at development/source/work/hathir-consolidation-plain-20261023/app and reports/retained-release-156.json. Freeze reports/release-source-manifest-department-tools-157.json. Logs review-20261025-qa157-publish.log, review-20261025-backup157-cached.log, review-20261025-publish157.log. No announcement sent.
