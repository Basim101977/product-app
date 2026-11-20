# Published release 152 — 2026-10-22

Live: https://hathir.web.app/
Release: v2026.10.22-consolidation-clear-152
Source: development/source/work/hathir-consolidation-clear-20261022/app
Verified: 2026-10-22T16:45:01.695Z

Added Delete all files in attendance consolidation, with native confirmation stating file count and all departments/stages on the current device. Cancel leaves all reports intact. Empty source list is committed atomically for current uid/workspace before clearing pending drafts, search, column filters and pagination. Failure to persist retains reports and drafts. Original Excel files, attendance, other accounts and cloud records remain untouched by this action.

Final local QA: 770 passing cases at 2026-10-22T16:42:42.911Z, synthetic only. Targeted 19-case consolidation checks also passed WebKit. Includes cancellation, storage failure, filtered-view all-scope removal, persistence across reload, account isolation, importing a new stage after clearing and original attendance retention. No physical-phone verification.

Hosting-only deployment. Verified SHA256 for all 4 changed assets: consolidation.css, consolidation.js, index.html, service-worker.js. Backend runtime, security rules, Firebase target/identity and data schemas unchanged. Existing release checks retained; freeze manifest reports/release-source-manifest-consolidation-clear-152.json.

Fresh encrypted backup: C:\Users\USER\AppData\Local\HathirBackups\release-20261022-1792687060418. Contents: 41883 Firestore documents (fixed read time, independent count), 55 deployed functions and original source archives, 259 previous hosting files, rules/indexes. AES-GCM hash/roundtrip and current-user DPAPI recovery verified. Auth password hashes and unsynced device-local attendance are outside this snapshot; no full restore performed.

Previous published 151 source retained: development/source/work/hathir-consolidation-20261021/app. Its 315 frozen source files were reverified unchanged. Retained hashes: reports/retained-release-151.json. Logs: review-20261022-qa152-publish.log, review-20261022-backup152.log and review-20261022-publish152.log. No announcement sent.
