# Local candidate 152 — delete all consolidation files

Not published. Production remains release 151 at https://hathir.web.app/. Published 151 source retained unchanged: development/source/work/hathir-consolidation-20261021/app.
Candidate: development/source/work/hathir-consolidation-clear-20261022/app. Version: v2026.10.22-consolidation-clear-152. Preview: http://127.0.0.1:4192/ (synthetic, loopback only, production network blocked). Preview runner: review-20261022-clear152-preview.cjs, session 22458.

Added an always-visible bulk removal button beside consolidation upload/export, disabled when there are no summaries or drafts or an operation is busy. Uses existing native confirmation, including total file count and explicitly all departments/stages on this device. Cancel does nothing. Confirmation commits an empty source list atomically to the existing current-account/workspace IndexedDB key; only after success clears drafts, search, paging and column filters. Does not touch raw Excel files, attendance records, other teachers, other accounts or server data. Individual Remove remains available. Storage failure preserves summaries/drafts and exposes the existing error status.

Changed public files: consolidation.css, consolidation.js, index.html, service-worker.js. index/service-worker changes are version/cache references only. No backend, identity/rules or persistence-schema changes. No source freeze/deploy-gate bypass or publication.

Targeted synthetic checks: 19 cases passed in Chromium and 19 in WebKit; includes cancellation, persistence failure, deleting across all scopes, filtered view still deletes all reports, current-account isolation, reload persistence, empty disabled state, new-stage import after deletion and original course retention. Desktop/mobile screenshots inspected together. No physical phone validation. Evidence: review-20261022-clear152-ui.log, review-20261022-clear152-webkit.log and candidate reports/consolidation-ui.json. Full final suite and fresh production snapshot required before any later authorized publish.

## Publication completed
Published release 152 at 2026-10-22T16:45:01.695Z. Earlier local-only statements are history. Final 770 cases passed; verified all four changed public assets after hosting deployment. Current status: review-20261022-release152-status.md.
