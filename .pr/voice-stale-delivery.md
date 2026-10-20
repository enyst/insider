# Fence stale voice delivery

Bead: `smolpaws-vstale`. Separate from follow-up steering (`smolpaws-vsteer`).

## App

- New speech or nonempty typed input invalidates prior playback and pending answer delivery. Typing does not submit a request.
- After interruption, OpenAI audio resumes automatically only for a response with the current request metadata and matching response ID. Late starts/stops/captions cannot change the current owner. Explicit Resume audio remains available.
- Superseded tool calls receive a superseded receipt instead of the old answer. Their durable Cat result stays saved.
- Automatic barge-in only suppresses local playback; server VAD owns response interruption. It does not send a cancellation that could race the next delegation.
- Codex browser events never dispatch requests. A speech-start event, if provided by the pinned transport, can only suppress playback. Codex still requires explicit resume because the protocol cannot causally identify queued audio.

## Companion server change

The separate `fix/insider-stale-speech` branch, based on SDK Voice draft #5180, prevents a pending Codex answer from being queued after newer speech. It also declines to speak when another saved user message appeared during submission or completion. Saved results remain intact. No API schema or version-pin changes.

Already queued provider audio cannot be revoked by this server change. Local suppression is the fallback. A transcript final following a partial for the same utterance does not create another generation. The protocol lacks transcript IDs; this is deliberately conservative, not physical playback proof.

## Verification

- App: `npm run build`; **141 tests / 10 files**; `git diff --check` pass. The repo has no typecheck script.
- Server: **52 tests** (Codex relay real subprocess protocol fixture plus voice router), **1 live-socket voice route test**, Ruff, and Pyright pass. Tests use the existing sibling checkout's Python environment with this branch first on PYTHONPATH. Pyright uses that interpreter explicitly.
- New App and server regressions failed before implementation.
- No live microphone, provider login/calls, deployment, paid resources, or running-user-service changes.

This change does not remove the pending-request guard or enable steering. Keep that next bead separate.
