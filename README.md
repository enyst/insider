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
- Create the controller using the active **OpenHands agent profile** and its
  workspace, preserving the user's confirmation policy and security settings.
  The [Insider skill](skills/insider-cat/SKILL.md) is embedded in its launch
  instructions without changing the stored profile.
- Continue the controller through the normal conversation API. Messages and
  replies are saved on Agent Server. The panel displays text from the latest 50
  events and links to the full conversation for older history, tools, and
  approval controls.

Selecting a worker provides context to the Cat; it does not send that worker a
message. Coordination depends on the tools supplied by the chosen profile. This
App adds no worker dispatcher, scheduler, shared SmolPaws memory, or credentials.

Drafts survive navigation while the App remains active. They are not saved
across browser reloads, App disablement, or backend switches. If a send has an
uncertain outcome, inspect the saved conversation before sending again. Leaving
the page stops its polling without cancelling work already accepted by the
server.

## Voice

Voice is not connected in this version. Typed chat works independently. A future
integration needs supported server-side OpenAI session creation, persistent
Canvas controls, and explicit microphone and call lifecycles, tied to the same
durable controller.

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
confirmation settings, uncertain requests, lifecycle cleanup, and localization.

## License

[MIT](LICENSE). See [NOTICE.md](NOTICE.md) for source attribution and bundled
dependencies.
