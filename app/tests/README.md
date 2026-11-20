# Local personal-workspace regression tests

These tests use synthetic Arabic names and `example.test` accounts only. They do
not read credentials, use production/staging data, deploy, or send cloud writes.
The browser harness blocks every non-loopback network request and replaces the
Firebase compatibility SDK with an in-memory mock. Runtime configuration is
synthetic for UI tests; static tests inspect the real candidate configuration.

From this `app` directory:

```powershell
node tests/security-isolation-static.cjs
node tests/personal-ui-regression.cjs
node tests/department-prefix-regression.cjs
node tests/personal-rules-emulator.cjs
node tests/run-local.cjs
node tests/function-metadata-static.cjs
```

Playwright is resolved from an installed `playwright` package, `PLAYWRIGHT_MODULE`,
or the bundled Codex runtime. `CHROME_PATH` can override the browser executable.
Reports and screenshots are written under `reports/`, outside the hosted site.

The department-prefix suite compares all 15 canonical frontend/backend mappings,
checks new subject payloads, and loads an already-created organization with both
unlocked and locked legacy prefixes. It verifies local candidate changes only;
an earlier public/deployed smoke result is not proof those later edits are live.

The emulator suite performs actual rules compilation and evaluation against an
isolated `demo-hathir-personal-rules` project on loopback. It requires the cached,
SHA256-verified JAR and local Java runtime from the prior regression work; the
`PERSONAL_TEST_JAVA` and `PERSONAL_TEST_FIRESTORE_JAR` variables can locate them.
It does not download a runtime or use Firebase credentials.

The supplemental function-metadata check uses the installed `functions` package
dependencies but stubs Firebase Admin before evaluation. It validates all 35
exported runtime identities and scaling options without credential discovery.

These tests do **not** verify deployed Firebase authorization, live email delivery,
payment-provider behavior, physical camera/NFC operation, or real mobile hardware.
Static source guardrails alone are not a proof of security.

After root confirms the authorized personal site has been deployed,
`node tests/live-public-smoke.cjs` performs read-only GETs of its public assets.
That separate command does use the network, only for the exact personal Hosting
origin; it never reads user data or invokes authentication or cloud functions.
