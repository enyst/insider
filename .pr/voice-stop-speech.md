# Stop local speech without stopping saved work

Bead: `smolpaws-vstop`. First of three separate changes. Based on the current Insider Voice draft, PR #2.

## Behavior

- OpenAI keeps its existing speech cancellation and output-buffer clear.
- Codex now silences browser playback immediately. It sends no invented RPC and leaves the microphone and saved Cat work unchanged.
- The same button becomes **Resume audio**. Suppression persists through late tracks and broker polls. Resume may reveal ongoing speech; it does not generate a fresh answer.
- Playback promise failures from before interruption cannot fail the call later.
- UI status, decorative pose, and all 15 translations account for local suppression. Existing approval/error states retain priority.

## Verification

- Regression tests failed before implementation (4 failures, 57 passes in the initial focused run).
- `npm run build`: pass; checked-in standalone bundle rebuilt.
- `npm test`: 135 tests pass across 10 files, including lifecycle/language remounts and bundle/source equality.
- `git diff --check`: pass.
- `npm run typecheck`: unavailable; this JavaScript repository has no typecheck script. No typecheck success is claimed.
- No live microphone, account login, provider call, deployment, or service restart. Media behavior is covered with controlled WebRTC/audio test doubles, not physical playback proof.

## Deliberately separate

Automatic barge-in and stale-answer ownership: `smolpaws-vstale`.
Spoken and typed follow-up steering: `smolpaws-vsteer`.
This change does not remove the existing pending-request guard or upgrade the Codex relay.
