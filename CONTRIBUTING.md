# Contributing

## Prerequisites

- [Node.js](https://nodejs.org/) — 22.22.2+, 24.15+, or 26+ (CI runs Node 24).
- npm (bundled with Node.js).

## Setup

Install the dependencies pinned by the lockfile:

```sh
npm ci
```

## Run the tests

```sh
npm test
```

This runs the Vitest suite (`vitest run`). Tests use simulated conversations and
do not call a live model or microphone. The build test verifies that the
committed `extension.js` bundle exactly matches the source, the Insider skill,
and the translation catalog.

## Build the app

```sh
npm run build
```

This runs `node build.mjs`, which bundles `src/extension.js` with the Insider
skill and the local translation catalog into the standalone `extension.js`
entrypoint.

Edit `src/extension.js` for App behavior, `i18n.jsx` for language integration,
the local translation catalog for copy, and `skills/insider-cat/SKILL.md` for
controller guidance. Rebuild and commit the regenerated `extension.js` together
with source changes.

## CI

The `Check App` workflow runs `npm ci` and `npm test` on every pull request.
