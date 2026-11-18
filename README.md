# Unreleased @openhands/typescript-client builds

Temporary home for packed builds of `clients/typescript` from OpenHands/software-agent-sdk. Canvas PRs that need client changes merged after the latest npm release install these, so their CI can type-check before that release exists.

- `typescript-client/openhands-typescript-client-sdk-45d8c90.tgz`: `npm pack` of OpenHands/software-agent-sdk@45d8c908 (main, 2026-11-18; its package.json still says 1.62.0). It has the experimental-flags, reactions, ask_user, mentions and message-edit client methods.

Canvas PRs point at it by raw URL at a fixed commit, and their lockfile pins its integrity hash. Once an SDK release carries these changes, the PRs go back to a normal version pin and this branch can be deleted.
