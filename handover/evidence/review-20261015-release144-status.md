# Published: release 144

`v2026.10.15-subject-schedule-144` published to https://hathir.web.app/ (Hosting only). The five changed/added assets were verified by SHA-256 at their exact release URLs after deployment. An initial immediate check saw a stale response; subsequent checks matched. Evidence: `development/source/work/hathir-subject-ux-local-20261015/app/reports/published-144.json`.

712 passing cases. The full run's only failure was Java's inability to open the emulator JAR via an Arabic path; the actual 131-case emulator suite then passed with its resolved ASCII path. Original failed output retained; final summary transparently records that rerun. No app source changed between QA and freeze/deployment.

Current published source is `development/source/work/hathir-subject-ux-local-20261015/app`, despite its local-preview directory name. Prior 143 source remains intact at `development/source/work/hathir-sharing-20261015/app`. Do not deploy the older original source tree. Verified encrypted production backup remains within the existing 24-hour policy and all original deployment guards passed. No backend, rules, or data migration deployed.
