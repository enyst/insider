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

The `smolpaws: insider` and `insiderrole: controller` tags identify saved Cat
conversations for discovery. Tags are metadata, not permission grants or a skill
loader. The profile supplies the model, credentials, and available tools. The
App does not add worker-management tools, shared memory, or a scheduler.

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
metadata, and authenticated JSON requests. It supplies no persistent shell
panel, selected-conversation subscription outside the page, microphone session,
or coordination tools for the agent. Apps run as trusted code in Canvas's browser
context; the skill does not provide a security boundary.

A future voice adapter must bind audio to the same durable controller, keep
selection current, and separate ending a call from cancelling work. Supported
OpenAI session creation belongs on a trusted server with provider credentials
kept there. The old Secretary skin's subscription-token and key-file experiments
are not part of this App.

For other integrations that expose this skill through an SDK catalog instead
of embedding it, supply both the skill and its resources where the executing
server can read them. Explicitly identify the active Insider controller and
instruct it to load the skill. Ordinary workers should not adopt the role merely
because their project contains the skill or a document mentions Insider Cat.

The [App README](../../../README.md) describes installation and testing. The
[behavior notes](https://enyst.github.io/arch/insider-cat.html) describe the
historical prototypes and further coordination and voice work.
