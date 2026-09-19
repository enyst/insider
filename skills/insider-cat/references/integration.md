# Controller integration notes

This is the integration reference for the standalone Insider Cat App. The local
[skill](../SKILL.md), source, and translation catalog are sufficient to build the
App; no Odie checkout or globally installed skill is required.

## How the App activates the role

The build reads `skills/insider-cat/SKILL.md`, removes its frontmatter, and embeds
the body in the self-contained `extension.js`. When the person sends the first
message to a new Cat conversation, the App uses the active OpenHands agent
profile and appends the skill body through
`agent_launch_additions.system_message_suffix_append`.

The same suffix explicitly identifies the active controller and its backend and
explains the App's capability limits. It preserves the stored profile's existing
instructions. The controller receives the role directly; this path does not
depend on SDK project skill discovery or an `invoke_skill` tool. Rebuild and
commit the bundle after changing the skill.

Creation also reads `/server_info` through the bound host request and appends
validated `runtime_services` metadata: agent-side HTTP(S) addresses and
environment-variable names for a URL, authentication key, or key-file path.
It copies no credential values or arbitrary metadata instructions. The host
must provide those references to the agent process. Absent or unavailable
metadata is omitted, without substituting a default backend or blocking launch.

Both `smolpaws: insider` and `insiderrole: controller` tags identify saved,
top-level Cat conversations for discovery. Tags are metadata, not permission
grants or a skill loader. The profile supplies the model, credentials, and
available tools. The App does not add worker-management tools, shared memory,
or a scheduler.

## Durable conversation and selected work

The App uses the normal Agent Server conversation API. Creation supplies the
profile ID, workspace, a generated conversation UUID, confirmation/security
settings, the role suffix, and an initial message with `run: true`. The response
returns the conversation ID in JSON. Later messages go to that controller's
events endpoint, also with `run: true`.

The controller and a selected worker are distinct conversations. The selected
worker's full ID, title, workspace, and observed execution state are data attached
to a Cat message. They do not change the controller's workspace or send anything
to the worker. An agent needs actual tool schemas and returned results to
coordinate work; browser API availability is not equivalent to an agent tool.

The App discovers controllers across all list pages, verifies their tags before
sending follow-ups, and keeps requests bound to the host's owning backend.
Creation reserves an ID before submission so a lost response can be investigated
without blindly creating another conversation. A request receipt establishes
acceptance, not task completion.

The panel reads recent saved MessageEvents and FinishAction messages. It does
not promote a previous `agent_final_response` to the result of a new turn, and
it links the full Canvas conversation for earlier events and approval controls.

## Host and voice boundaries

Canvas App host API v1 supplies page registration, navigation, immutable backend
metadata, and authenticated JSON requests. Its `registerCompanion` capability
hosts the persistent voice controls across page navigation. Its
`onConversationContextChangeRequested` capability ends the matching call before
regular Canvas requests compaction. The App owns the browser media session and
keeps the call bound to the selected Cat and the owning backend. Changing Cat,
ending the call, compaction, and App disposal release the media session without
cancelling accepted agent work.

Agent Server owns provider credentials and session negotiation. For the OpenAI
API transport, the App relays voice tool requests to the saved Cat and waits for
the complete agent run before speaking its saved result. For the Codex
transport, Agent Server owns this delegation; the browser does not resubmit
transcripts or tool calls. Voice starts from the Cat's saved context; transient
speech previews are not the durable conversation log. See the README for
provider setup and tested limitations.

The host supplies no coordination tools for the agent. Apps run as trusted code
in Canvas's browser context; the skill does not provide a security boundary.

For other integrations that expose this skill through an SDK catalog instead
of embedding it, supply both the skill and its resources where the executing
server can read them. Explicitly identify the active Insider controller and
instruct it to load the skill. Ordinary workers should not adopt the role merely
because their project contains the skill or a document mentions Insider Cat.

The [App README](../../../README.md) describes installation and testing. The
[behavior notes](https://enyst.github.io/arch/insider-cat.html) describe the
App's behavior, architecture, and further coordination work.

## Voice hands work to this agent

As of September 20, 2026, the realtime model is the listening/speaking layer;
the saved OpenHands Cat is the reasoning and tool-execution layer. Conceptually
Voice calls `ask_agent(request)` and speaks the verified saved result. The
OpenAI API transport implements that with `send_to_insider`; the Codex transport
uses an explicit `handoff_request` that Agent Server dispatches directly. The
inactive Codex background thread has no tools and is not the Cat's executor.

Task delegation appends a user Message with `run: true`, waits for the actual
run and stop hooks to settle, and selects the new saved answer. The SDK's
`/ask_agent` endpoint is a different, stateless question facility; using it here
would omit durable turns and the normal tool loop.

A saved Cat with `tools: []` is still a real OpenHands agent. It lacks workspace
and coordination tools even if built-in utilities remain available. An LLM
profile switch does not install tools, and an active agent profile is a launch
default for new conversations. Do not silently expand an intentionally limited
saved agent's permissions as a side effect of connecting Voice.

Normal OpenHands tools plus enabled skills are the intended starting point.
The terminal can execute documented Agent Server API requests using
`openhands-api` and the owning backend's runtime URL and authentication source.
This supports counting, inspection, and authorized worker operations without
requiring a bespoke tool for each endpoint. The browser's authenticated access
is separate: it does not by itself configure the agent's terminal environment.

Backend-wide counts need an authoritative count query; conversation listings
must follow pagination. Loaded cards are not the backend total. A filesystem
fallback requires a verified local persistence path and counts distinct
conversation records, not events. Dedicated backend-bound tools could make
these operations more convenient, but remain optional. Worker mutations stay
explicit and subject to existing authorization and approval rules.
