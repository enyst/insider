# Changelog

Notable changes to Insider Cat, newest first.

## [Unreleased]

- Talk and dictate from beside Send: real-time voice moved to a waveform button next to Send, plus a microphone that dictates into your draft ([#34](https://github.com/enyst/insider/pull/34)).
- A friendlier first run: empty boards welcome you with a hint, and the empty Cat panel suggests starter prompts ([#37](https://github.com/enyst/insider/pull/37), [#47](https://github.com/enyst/insider/pull/47)).
- Easier to get started: a plain-language "What is Insider?" section and a "Try it in 5 minutes" quick start ([#46](https://github.com/enyst/insider/pull/46), [#35](https://github.com/enyst/insider/pull/35), [#39](https://github.com/enyst/insider/pull/39)).

## [0.2.0-beta.1] - 2026-11-09

The Projects work board release: a Cat-first board that groups conversations by
what they need from the person, with live conversation cards, project files,
reactions and message folding, and coordinated work. The board is now fully
usable with a keyboard and a screen reader, and every Insider string is
translated into 15 languages. This beta precedes the stable 0.2.0.

### Added

- Make the work board fully usable with a keyboard and a screen reader:
  focusable cards, ARIA roles and labels, and keyboard navigation.
- Translate every Insider string into 15 languages: Arabic, Catalan, German,
  English, Spanish, French, Italian, Japanese, Korean, Norwegian, Portuguese,
  Turkish, Ukrainian, Simplified Chinese, and Traditional Chinese.
- Redesign Insider around an expressive Cat and integrated Voice, with accurate
  Voice failures and Voice kept discoverable before a Cat is selected
  ([#2](https://github.com/enyst/insider/pull/2)).
- Support local Codex speech interruption without canceling Cat work
  ([#3](https://github.com/enyst/insider/pull/3)).
- Group work by attention and track it per Cat
  ([#5](https://github.com/enyst/insider/pull/5)).
- Live conversation cards and Resolved work
  ([#6](https://github.com/enyst/insider/pull/6)).
- Workers learn which Cat is talking to them and where to put decisions
  ([#8](https://github.com/enyst/insider/pull/8)).
- Label messages another conversation sent
  ([#9](https://github.com/enyst/insider/pull/9)).
- Show emoji reactions in Cat chat
  ([#10](https://github.com/enyst/insider/pull/10)).
- The Cat delegates work and routes updates to conversations
  ([#12](https://github.com/enyst/insider/pull/12)).
- Fold coordinator updates and follow the single send route
  ([#14](https://github.com/enyst/insider/pull/14)).
- Show what an asking conversation needs on its card
  ([#15](https://github.com/enyst/insider/pull/15)).
- Fold person copies and replies from project conversations
  ([#16](https://github.com/enyst/insider/pull/16)).
- Show project files under the work list
  ([#20](https://github.com/enyst/insider/pull/20)).
- Show one project's work and drop folder-era controls
  ([#24](https://github.com/enyst/insider/pull/24)).
- Head the board with the project and link each part's pull request
  ([#25](https://github.com/enyst/insider/pull/25)).
- Show conversation mentions as links in the Cat chat
  ([#23](https://github.com/enyst/insider/pull/23)).
- Show each part's PR state and CI on its card
  ([#26](https://github.com/enyst/insider/pull/26)).

### Fixed

- Fence stale Voice delivery: reject stale voice function calls, fence stale
  playback, and supersede delivered answers
  ([#4](https://github.com/enyst/insider/pull/4)).
- Follow light Canvas themes such as Paper
  ([#7](https://github.com/enyst/insider/pull/7)).
- Keep live cards after transient errors; tie Voice answers to their request
  ([#11](https://github.com/enyst/insider/pull/11)).
- Send spoken requests through idle-only server admission
  ([#13](https://github.com/enyst/insider/pull/13)).
- Clamp long asks on conversation cards
  ([#17](https://github.com/enyst/insider/pull/17)).
- Make card asks fully readable instead of clamping
  ([#21](https://github.com/enyst/insider/pull/21)).
- Read PR status from the reviewed route
  ([#27](https://github.com/enyst/insider/pull/27)).
- Resume legacy Insider Cats in the app and Voice.
- Keep new Cats in verified host workspaces.

### Changed

- Restore skill-guided backend access and inherit Cat runtime context.
- Clarify Voice delegation and Insider agent capabilities.
- Patch vulnerable App development dependencies.
