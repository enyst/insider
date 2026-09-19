# Insider Cat

A Projects page and a durable typed companion for **Agent Canvas**. Insider Cat
is a sibling of SmolPaws, with its own conversation and the capabilities supplied
by its configured agent profile.

This repository holds an independent copy of the App developed in
`odie/apps/insider-cat`. It includes the prepared browser bundle, source, skill,
translations, and tests. Building or installing it does not require Odie's source
checkout.

## Install in Canvas

Open **Customize → Apps → Add app** and enter:

| Field           | Value                            |
| --------------- | -------------------------------- |
| Source          | `github:enyst/insider`           |
| Ref             | `main`, or a reviewed commit SHA |
| Repository path | Leave empty                      |

Installation starts disabled. Review and enable **Insider Cat**, then open
**Projects** at `/extensions/insider-cat/projects`.

Use a local Agent Server connection with the Apps endpoints and profile launch
additions available. Canvas Apps do not currently support cloud backends. Apps
run as trusted code inside Canvas and use authenticated requests to their owning
backend.

For local development, Source can instead be the absolute directory of this
repository on the **Agent Server machine**. Leave Ref and Repository path empty.
The backend copies the prepared `extension.js`; it does not install npm
dependencies or run a build.

## What it does

- Browse conversations with workspace and title/ID filters, manual refresh, and
  explicit pagination. Filters apply to loaded conversations; the page shows its
  coverage. Approval requests, errors, paused work, and ended runs have distinct
  labels. An ended run is not a claim that a task succeeded.
- Select work using its full conversation ID without replacing your draft.
  Opening a conversation stays inside Canvas.
- Discover saved Cat controllers across all conversation-list pages. A single
  controller resumes automatically; multiple controllers require a choice.
  **New Cat conversation** creates a separate controller on the first send.
  The App remembers the last chosen controller for its backend and organization,
  then verifies its Insider tags when loading it again. `/new` prepares a fresh
  Cat without sending that command to the previous conversation. Older top-level
  Insider conversations can resume without changing their profile or guidance.
- Create the controller using the active **OpenHands agent profile** and its
  workspace, preserving the user's confirmation policy and security settings.
  The [Insider skill](skills/insider-cat/SKILL.md) is embedded in its launch
  instructions without changing the stored profile.
- Continue the controller through the normal conversation API. Messages and
  replies are saved on Agent Server. The panel displays text from the latest 50
  events and links to the full conversation for older history, tools, and
  approval controls.
- `/condense` condenses the selected controller without changing its identity or
  starting another agent turn. Resolve running work or approval requests first.
  Requesting compaction from the App or the updated regular Canvas view ends
  that Cat's active voice call, even if compaction later fails. Click **Start
  voice** after it completes to load the current context. Opening the full Cat
  conversation and returning to its App page keeps the same conversation ID.
  Older hosts without `onConversationContextChangeRequested` cannot notify the
  App about regular-view compaction; end and restart voice manually there.

Selecting a worker provides context to the Cat; it does not send that worker a
message. Coordination depends on the tools supplied by the chosen profile. This
App adds no worker dispatcher, scheduler, or shared SmolPaws memory.

Drafts survive navigation while the App remains active. They are not saved
across browser reloads, App disablement, or backend switches. If a send has an
uncertain outcome, inspect the saved conversation before sending again. Leaving
the page stops its polling without cancelling work already accepted by the
server.

## Voice

Agent Server selects the voice provider. The controls identify it as **OpenAI
API** or **Codex**. Both use WebRTC and keep the saved OpenHands Cat as the task
controller. The server handles authentication and the SDP exchange; the browser
receives no provider credentials.

The OpenAI API transport uses `gpt-realtime-2.1` and requires a standard OpenAI
API key. This transport does not use a ChatGPT subscription session or assume
subscriptions include API access.
Add a secret named `OPENAI_API_KEY` under **Settings → Secrets** on the owning
backend, or configure that environment variable on Agent Server. The missing-key
message links to Secrets. An agent profile's separate model credential is not
automatically reused for voice.

The experimental Codex transport requires an updated Agent Server configured
for Codex and a working Codex installation and sign-in on that server. Codex
provides voice and a separate relay turn whose tool addresses the saved
OpenHands Cat. The server handles this delegation; the browser never resubmits
Codex tool calls or transcripts to the Cat. There is no automatic fallback to
the API-key transport. A live relay call succeeded with the existing Codex
ChatGPT sign-in on September 16, 2026; other accounts still need their own
connection check. Codex starts from the saved Cat context; the Projects page's
selected worker is not added to that voice session.

On Agent Server, set `OH_VOICE_PROVIDER=codex`. The prototype supports the
tested `codex-cli 0.154.0` executable. It uses a dedicated Codex home under the
server's persistence directory; `OH_CODEX_VOICE_HOME` can select another
dedicated directory. Keep the relay's configuration in that directory.

As of September 16, 2026, an existing file-store sign-in can be shared with
explicit user authorization: symlink only the dedicated home's `auth.json` to
the existing Codex `auth.json`, and set `cli_auth_credentials_store = "file"`
in the dedicated configuration. Do not copy tokens or link the ordinary home's
configuration, plugins, or MCP servers. The pinned 0.154.0 file-store save follows
the symlink, so refresh updates the shared session file. This setup depends on
that save behavior and does not apply to keyring storage.

The successful live trial used these settings in the dedicated `config.toml`:

```toml
model = "gpt-5.5"
model_reasoning_effort = "low"
cli_auth_credentials_store = "file"
```

The model and effort select the Codex reasoning relay, not the Live voice model.
The saved OpenHands Cat also used GPT-5.5 in that trial. Three generated spoken
requests reached `send_to_insider`, produced saved requests and answers, and
returned through `appendSpeech` across two real calls. The same connected peer
survived opening the regular conversation view and a follow-up there. After End
and a fresh call, another saved request correctly recalled the updated test
word. An earlier trial answered directly from Voice's initial history without
saving a new request. Stronger Voice and relay instructions preceded the
successful trials, so delegation remains model-dependent and is not an
exactly-once guarantee for every utterance. Physical iPad microphone testing and
broader repeated-call and approval checks remain outstanding.

If no suitable existing session is available, use Codex's normal login flow in
the dedicated home, for example:

```sh
CODEX_HOME=/path/to/insider-codex-home codex login --device-auth
```

Use that same directory for `OH_CODEX_VOICE_HOME`. The relay rejects the ordinary
Codex home itself and enabled MCP configuration, disables unrelated tools, and
uses an ephemeral thread per call. A successful sign-in does not by itself verify
voice entitlement; test a call on the account.
The device flow can be approved from an iPad; ordinary browser login uses a
localhost callback on the server machine. Keep its one-time code private.
Long saved answers use a spoken excerpt from the beginning, with a notice that
the full answer is in the conversation. The saved answer remains complete.
The browser's missing-sign-in message appears before microphone access.

On a Canvas version with companion controls, choose a saved Cat and select
**Start voice**. Availability is checked before requesting microphone access.
The controls display the controller identity, provider, status, and latest
spoken exchange, and remain available while opening other Canvas pages. These
transient transcript previews do not replace the saved Cat history. **Mute
microphone** and **End call** work with both providers. **Stop speaking** is
available for the OpenAI API transport; Codex's current app-server API does not
expose this operation, so the button is hidden in Codex mode. Ending a call or
interrupting speech does not cancel accepted agent work.
Changing Cat, starting a new Cat, changing backend, disabling the App, or ending
the call releases the microphone and closes the connection. Returning to the
same Cat page keeps the call connected.

For the OpenAI API transport, the browser relays the voice model's
`send_to_insider` requests into that Cat's saved conversation. It waits for the
backend to confirm that the complete agent run,
including stop hooks, has settled with a `finished` status, then reloads the
saved answer. A proposed finish event alone is insufficient. An older broker
that cannot verify the run's completion directs the user to inspect the
conversation instead of speaking a proposed answer. It has no independent worker
dispatcher; approval requests are handled in the full conversation. Delegated
requests and controller replies are durable. The OpenAI API transport does not
separately save exact audio or the full voice transcript.
Typed chat remains available when voice is disconnected or unconfigured.

The [behavior and architecture notes](https://enyst.github.io/arch/insider-cat.html)
cover the design direction and distinguish this App from the older Secretary
skin and voice experiments.

## Development

Use Node.js 24.15 or newer in the 24.x series (CI uses Node 24), or Node 26+:

```sh
npm ci
npm run build
npm test
```

Edit `src/extension.js` for App behavior, `i18n.jsx` for language integration,
the local translation catalog for copy, and `skills/insider-cat/SKILL.md` for
controller guidance. The catalog retains all 15 Canvas languages.

Commit the rebuilt `extension.js` with source changes. The build test verifies
that the installed entrypoint matches the source, translations, and skill. The
bundle contains its dependencies and styles; it needs no other runtime files,
skin server, or iframe.

Tests use simulated conversations and do not call a live model or microphone.
They cover durable conversation identity, pagination, draft and target handling,
confirmation settings, uncertain requests, lifecycle cleanup, localization,
same-ID resume and condensation, and simulated WebRTC interruption/cancellation.

## License

[MIT](LICENSE). See [NOTICE.md](NOTICE.md) for source attribution and bundled
dependencies.
