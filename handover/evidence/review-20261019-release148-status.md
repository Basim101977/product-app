# Published release 148

Published 19 October 2026 to https://hathir.web.app/, existing project alqar-student-attendance-2026, hosting site hathir.

Current published source: development/source/work/hathir-admin-options-20261019/app.
Identifier: v2026.10.19-admin-options-148.
Retained previous source: development/source/work/hathir-roster700-20261018/app (147), unchanged.

Scope: server-side registration name/email search across result pages; owner-only totals of cloud-saved lectures across each teacher's subjects; independent multi-email share invitations with deduplication and per-recipient retry IDs; face attendance switch OFF by default, persisted per account/workspace on this device, retaining templates and QR/manual attendance.

Counts exclude cancelled/voided/deleted lectures and deleted subjects; use live sync before retained copies/legacy, never add duplicate representations; can cache for 60 seconds. Unsynced device lectures cannot be counted by the owner. Counting failures show unavailable rather than a guessed zero.

Final local suite: 735 passing cases, no production reads/writes in those tests. Additional WebKit tests: 8 passing cases. Synthetic browser viewport/camera mocks do not establish physical phone or camera performance.

Fresh encrypted production snapshot: C:/Users/alqar/AppData/Local/HathirBackups/release-20261019-1792423195327. 37411 Firestore documents at a fixed read time, independently checked by aggregate count; 55 deployed functions and their original source archives; 256 hosting files; rules/indexes. Completed 2026-10-19T15:25:38.361Z. No account/project deletion or unlinking, data migration, new rules, recognition thresholds or outbox namespace changes.

One existing function updated and independently verified ACTIVE with a fresh timestamp: listPersonalRegistrations (us-central1), updateTime 2026-10-19T15:32:06.866720975Z. CLI confirmed successful update, then exited 1 due to the pre-existing unrelated artifact-cleanup-policy setup in asia-south1. No --force, cleanup policy or artifact deletion was used. After verifying the function and rerunning the required deployment gate, hosting deployed successfully.

All six changed website assets matched local SHA256 following deployment. Evidence: app/reports/published-148.json, change-scope-148.json, retained-release-147.json, release-source-manifest-admin-options-148.json, local-regression-summary.json, RELEASE-148-NOTES.md, and ../.private/baseline/manifest.json. Workspace logs: review-20261019-backup148.log, review-20261019-qa148.log, review-20261019-webkit148.log, review-20261019-publish148.log.
