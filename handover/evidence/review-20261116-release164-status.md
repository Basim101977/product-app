# Published 164 — 16 November 2026 Baghdad

Current release: `v2026.11.16-qr-roster-164`.

Current source: `development/source/work/hathir-qr-roster-release-20261116/app`.

This supersedes the release 163 frontend on both `hathir` and `hathirs` Hosting sites. The original URL remains HTTP 404 under the existing Google restriction; the alternate URL serves HTTP 200.

Read `hosting/release164/RESULT.md` for tests, backup, immutable release IDs, rollback references and limitations. The detailed deployment record is in the current source's `reports/published-164.json`.

Do not use the old `sites/hathir-alternate-20261115/dist` as the latest source: it is retained release 163 rollback evidence. The November 7 local source is retained unchanged; release 164 adds production cache versioning, the already-approved fixture sanitization and the already-published compressed help video. Backend code, rules, Auth configuration and storage namespaces remain unchanged.
