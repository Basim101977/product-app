# Hathir alternate frontend — 2026-11-15

## Preservation
- Original Firebase hosting and backend configuration were not modified.
- Same Firebase project: `alqar-student-attendance-2026`.
- Source: release `v2026.10.26-face-optin-163` from `development/source/work/hathir-face-preference-20261026/app`.
- Account identities, passwords and cloud records were not migrated or reset.
- Login with the owner's existing credentials and data loading remain pending.
- Published private gate redirects to OpenAI login. Owner account selected; email OTP entry is pending in the visible browser tab, followed by Hathir login. The Gmail connector withholds OTP content; user was asked to enter it directly.
- Browser-local unsynced data does not move between origins automatically.

## Alternate
- Site ID: `appgprj_6afa0ffad488819183364e6954d5d104`.
- Published URL: `https://hathir-alternate.basim77.chatgpt.site` (private access gate verified live).
- Audience: private owner trial; no teacher rollout yet.
- Checkout: `sites/hathir-alternate-20261115`.
- Pushed source SHA: `8023d45da75aeaff441402ff44684ac328f74c57`.
- Archive: `C:/Users/alqar/AppData/Local/HathirPublish/hathir-alternate-20261115.tar.gz`.
- Publication succeeded at `2026-11-15T20:31:27.786734+00:00`.
- Deployment ID: `appgdep_6afa1686c7dc81919f7d0a0f6e5a1c13`.
- Version ID: `appgprj_6afa0ffad488819183364e6954d5d104~appgver_9ada7d764c1081919c7a6e36c084eac5`.

## Verification and packaging
- Original frontend files verified against release manifest before copying.
- Runtime Firebase config byte-for-byte unchanged.
- Disabled legacy local fixture values sanitized; actual Firebase users untouched.
- Unreferenced help-v1 through help-v4 assets preserved outside deployment at `outputs/hathir-obsolete-help-preserved`.
- Current help-v5 video compressed to about 19.6 MB for host file limit, with duration and chapters preserved.
- Deployment assets: 175 files, about 36.5 MB uncompressed.
- Local HTTP 200; login screen renders without browser errors.
- Help page lists 18 lessons; video readyState 4, duration 721.133 seconds, playback advances without media error.
- Initial source upload expired with HTTP 403; remote was verified empty before preparing smaller source snapshot. Previous local commits are retained.
- Windows tar failed on Arabic output pathname; packaging succeeded using the ASCII archive path above.

## Support appointment
- Google Cloud case `77093063`.
- Monday 2026-11-16, 10:00 Baghdad / 07:00 UTC.
- Meet: https://meet.google.com/fiq-qcqn-jyh
- Email confirms link/time; Simone confirmed supervisor/Escalation Manager attendance in chat.
