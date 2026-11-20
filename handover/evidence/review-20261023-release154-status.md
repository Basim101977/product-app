# Published release 154 — 2026-10-23
Live: https://hathir.web.app/
Source: development/source/work/hathir-record-scroll-20261023/app
Release: v2026.10.23-record-scroll-154
Verified: 2026-10-23T07:16:04.005Z

Home roster can reach 8px from viewport top even with empty/short cohorts. CSS screen-only minimum card height and safe-area scroll margin; no automatic scrolling, inner-table or frozen-name changes. Expanded dialog and printing retained.

Final synthetic QA: 776 passing cases, including six new phone/desktop reachability cases. Targeted six cases also passed WebKit. No physical-device verification. Hosting only, three changed public assets SHA256 verified: beginner-ui.css, index.html, service-worker.js. Backend, security rules and Firebase identity unchanged. Previous153 retained at development/source/work/hathir-sidebar-icons-20261022/app; hashes reports/retained-release-153.json. Freeze reports/release-source-manifest-record-scroll-154.json.

Fresh encrypted backup C:\Users\USER\AppData\Local\HathirBackups\release-20261023-1792739500161: 42108 Firestore documents, 55 deployed functions/source archives, 261 previous hosting assets, rules/indexes. Independent count, encryption roundtrip/hashes and DPAPI recovery verified. Auth password hashes and device-local pending records excluded; no restore performed. Two earlier backup attempts failed from interrupted response/body timeouts; retained logs review-20261023-backup154.log and -retry.log. Successful helper now retries complete JSON/body responses and downloads hosting with four bounded read slots and 180s timeouts; no production writes from backup. Success log review-20261023-backup154-final.log.

Publish log review-20261023-publish154.log; final QA review-20261023-qa154-publish.log. No announcement sent.
