# Environment variable names

No values are recorded. Required delivery settings and their descriptions are in SETUP_AND_RUN.md. Remaining variables below are optional tool/test overrides or platform-provided values; consult each use before setting one.

| Name | Referenced by |
|---|---|
| `CHROME_PATH` | `app/tests/attendance-row-feedback.cjs`, `app/tests/lecture-action-visibility.cjs`, `app/tests/name-attendance-toggle.cjs`, `app/tests/offline-harness.cjs`, `app/tests/offline-package-regression.cjs`, `app/tests/preview-chrome-sw-smoke.cjs`, `app/tests/scope-preview.cjs`, `app/tests/service-worker-upgrade.cjs`, `support/portable-env.cjs` |
| `FIRESTORE_EMULATOR_HOST` | `app/tests/emulator-live-fixture.cjs`, `app/tests/private-share-emulator.cjs`, `app/tests/support-chat-server-check.cjs` |
| `GCLOUD_PROJECT` | `app/tools/deploy-check.cjs` |
| `HATHIR_FIREBASE_API_KEY` | `tools/configure-handover.cjs` |
| `HATHIR_FREEZE_MANIFEST` | `app/tools/freeze-release.cjs` |
| `HATHIR_FREEZE_RELEASE` | `app/tools/freeze-release.cjs` |
| `HATHIR_HOSTING_ONLY` | `app/tools/deploy-check.cjs` |
| `HATHIR_IMPORT_FILE` | `app/tests/numbered-roster-import.cjs` |
| `HATHIR_OWNER_EMAIL` | `app/functions/personal-workspace.js`, `tools/configure-handover.cjs` |
| `HATHIR_OWNER_UID` | `app/functions/personal-workspace.js`, `app/functions/push-notifications.js`, `app/functions/support-broadcast.js`, `app/functions/support-chat.js`, `app/functions/support-mailbox.js`, `tools/configure-handover.cjs` |
| `HATHIR_PREVIEW_PORT` | `app/preview.cjs`, `support/beginner-preview.cjs` |
| `HATHIR_PRODUCTION_RELEASE` | `app/tools/deploy-check.cjs` |
| `HATHIR_RUNTIME_SERVICE_ACCOUNT` | `app/functions/index.js` |
| `HATHIR_STRESS_EMULATOR` | `app/tests/sync-stress-regression.cjs` |
| `HATHIR_SUPPORT_EMAIL` | `tools/configure-handover.cjs` |
| `HATHIR_TEST_BROWSER` | `app/test-page-scroll.cjs`, `app/tests/offline-harness.cjs`, `app/tests/roster-filters.cjs` |
| `HOME` | `app/tests/offline-harness.cjs`, `app/tests/service-worker-upgrade.cjs` |
| `JAVA_HOME` | `support/portable-env.cjs` |
| `LOCALAPPDATA` | `app/tests/summarize-offline-review.cjs` |
| `NAME_QR_DECODER_JS` | `app/tests/name-qr-regression.cjs` |
| `NAME_QR_GENERATOR_JS` | `app/tests/name-qr-regression.cjs` |
| `PERSONAL_TEST_FIRESTORE_JAR` | `app/tests/personal-rules-emulator.cjs`, `support/portable-env.cjs` |
| `PERSONAL_TEST_JAVA` | `app/tests/personal-rules-emulator.cjs`, `support/portable-env.cjs` |
| `PLAYWRIGHT_MODULE` | `app/tests/attendance-row-feedback.cjs`, `app/tests/lecture-action-visibility.cjs`, `app/tests/name-attendance-toggle.cjs`, `app/tests/offline-harness.cjs`, `app/tests/offline-package-regression.cjs`, `app/tests/scope-preview.cjs`, `app/tests/service-worker-upgrade.cjs` |
| `USERPROFILE` | `app/tests/local-preview-check.cjs`, `app/tests/offline-harness.cjs`, `app/tests/preview-chrome-sw-smoke.cjs`, `app/tests/qr-preview-check.cjs`, `app/tests/service-worker-upgrade.cjs` |
| `WEBKIT_PATH` | `app/tests/offline-harness.cjs` |
