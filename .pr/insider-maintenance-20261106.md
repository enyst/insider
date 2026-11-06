# Insider App maintenance - 6 November 2026

The draft starts at `bf99051b0c8293c324091c47bac5df3b3d16d45b` and already
contains the fetched App `main` at
`521362c2f19ac840f0dec971da353b08e6c90792`. No App merge or runtime behavior
change was needed. The paired Canvas and Agent Server PRs contain their own
current-main merges and verification.

## Findings and changes

- README still described the October 23 state, including PR #4 as open and
  untested. It now documents the integrated behavior, correct installation
  branch/field names, current setup, October 26 live evidence, and remaining
  checks. Historical relay experiments no longer read as current instructions.
- The locked development toolchain had five npm audit findings: three high and
  two moderate package findings. The runtime dependencies were unaffected.
  Compatible patched versions resolve all five findings.

| Dependency | Before | After | Patched release published (UTC) |
| --- | --- | --- | --- |
| Vite | 8.0.16 | 8.1.6 | 2026-10-06 04:51:51 |
| Vitest and its matching packages | 4.1.10 | 4.1.12 | 2026-10-15 14:51:24 |
| undici, through jsdom | 8.10.2 | 8.12.2 | 2026-10-15 15:05:34 |
| source-map-js, through CSS tooling | 1.2.1 | 1.2.2 | 2026-09-30 14:08:09 |

Versions and publication dates were checked against the npm registry. The
Vite/Vitest install used a 30 October cutoff; the two targeted transitive
updates used a 16 October cutoff. All changed dependencies are development-only.
No major dependency upgrade, new direct dependency, or audit override was added.

The audit included [Vite's file-serving issue](https://github.com/advisories/GHSA-rq7h-c2jc-7f22),
[Vitest's mock registration issue](https://github.com/advisories/GHSA-qxg6-89mg-rqv8),
[undici's TLS option issue](https://github.com/advisories/GHSA-2m5v-pch6-74hx), and
[source-map-js section-offset handling](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
The full current audit reports **zero vulnerabilities** after the update.

## Verification

On Node 24.22.1 and npm 11.19.1:

- Baseline: all 150 tests in ten files passed; rebuilding reproduced
  `extension.js` unchanged.
- After the fixes, a fresh `npm ci` passed and reported zero vulnerabilities.
- `npm test`: all 150 tests in ten files passed with Vitest 4.1.12.
- `npm run build`: succeeded; `git diff --exit-code -- extension.js` passed.
  The installed browser bundle is byte-for-byte unchanged.
- `git diff --check`: passed.
- The refreshed Canvas host API v1 still supplies the App's page, companion,
  request, navigation, and pre-compaction contracts. The refreshed SDK still
  supplies the existing profile-launch and Voice fields/error categories.

This is source, dependency, and regression verification. It did not restart
shared services or repeat live provider, physical microphone/speaker, or iPad
checks. The [October 26 record](https://github.com/enyst/insider/blob/bf99051b0c8293c324091c47bac5df3b3d16d45b/.pr/insider-verification-20261026.md)
remains the dated live evidence, including its explicit limits.
