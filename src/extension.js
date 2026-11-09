import { mountLocalizedApp } from "../i18n.jsx";
import { createVoiceSession } from "./voice-session.js";
import {
  buildRuntimeServicesSuffix,
  fetchServerInfo,
} from "./runtime-context.js";
import {
  MICROPHONE_ICON,
  catPageMarkup,
  catViewStyles,
  mountCatVoice,
} from "./cat-view.js";
import {
  ATTENTION_GROUPS,
  COLLAPSED_GROUPS,
  REACTION_EMOJI,
  askOf,
  belongsToCat,
  conversationRefs,
  mentionParts,
  inlineMarkdownParts,
  foldReactions,
  groupByAttention,
  groupFor,
  idKey,
  latestPullRequest,
  pullRequestStatusKeys,
  isResolved,
  relativeAge,
  resolvedTags,
} from "./attention.js";
import {
  CONTROLLER_TAGS,
  isController,
  userMessageForDisplay,
} from "./insider-controller.js";

// Self-contained App ABI v1 implementation. All backend access uses the host.
const INSIDER_INSTRUCTIONS = "__INSIDER_SKILL_TEXT__";
const PAGE_SIZE = 100;
// Conversations the Cat names are re-read on each history refresh.
const REF_LIMIT = 6;
const REF_TIMEOUT = 4000;
const CONTROLLER_STORAGE_PREFIX = "insider-cat:controller:";
const NEW_COMMAND = "/new";
const CONDENSE_COMMAND = "/condense";
const PROJECT_LIST_PAGE_PATH = "/extensions/insider-cat/projects";
const NEW_CONTROLLER_PAGE_PATH = "/extensions/insider-cat/projects/new";
const controllerPagePath = (id) =>
  `/extensions/insider-cat/projects/conversations/${encodeURIComponent(id)}`;
const CONTROLLER_ROUTE = /^\/?conversations\/([^/]+)\/?$/;
const EXECUTION_STATUSES = new Set([
  "idle",
  "running",
  "paused",
  "waiting_for_confirmation",
  "finished",
  "error",
  "stuck",
  "deleting",
]);
const workspaceOf = (c) => c?.workspace?.working_dir || "";
// Empty/absent selectable runtimes retain the earlier local-only contract.
const isLocalOnlyRuntime = (info) =>
  info?.conversation_runtime === "local" &&
  !info.available_conversation_runtimes?.includes("docker");
const hasLocalRuntime = (info) =>
  info?.conversation_runtime === "local" ||
  info?.available_conversation_runtimes?.includes("local");
const detailPath = (id) => `/api/conversations/${encodeURIComponent(id)}`;
const errorText = (error) =>
  error instanceof Error ? error.message : String(error);
const unique = (items) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];

function creationPolicy(settings) {
  const c = settings.conversation_settings || {};
  const confirmation_policy =
    c.confirmation_mode !== true
      ? { kind: "NeverConfirm" }
      : c.security_analyzer === "llm"
        ? { kind: "ConfirmRisky", threshold: "HIGH", confirm_unknown: true }
        : { kind: "AlwaysConfirm" };
  const analyzers = {
    llm: "LLMSecurityAnalyzer",
    pattern: "PatternSecurityAnalyzer",
    policy_rail: "PolicyRailSecurityAnalyzer",
  };
  return {
    confirmation_policy,
    ...(analyzers[c.security_analyzer]
      ? { security_analyzer: { kind: analyzers[c.security_analyzer] } }
      : {}),
    ...(Number.isInteger(c.max_iterations) && c.max_iterations > 0
      ? { max_iterations: c.max_iterations }
      : {}),
  };
}

function supportsControllerLaunch(schema) {
  let node =
    schema?.paths?.["/api/conversations"]?.post?.requestBody?.content?.[
      "application/json"
    ]?.schema;
  const seen = new Set();
  while (
    node?.$ref?.startsWith("#/components/schemas/") &&
    !seen.has(node.$ref)
  ) {
    seen.add(node.$ref);
    node = schema.components?.schemas?.[node.$ref.split("/").pop()];
  }
  return Boolean(
    node?.properties?.agent_launch_additions &&
    node?.properties?.agent_profile_id,
  );
}

// Agent Server marks a message another conversation sent with
// sender "conversation:<id>" and puts a header for the agent in front of it.
const SENDER_PREFIX = "conversation:";
// Headers the server puts before a message one conversation passes to another:
// coordinator instructions, a member's update or reply, and copies of what the
// person wrote in a member conversation.
const SENDER_HEADER =
  /^\[(Sent by|Update from|Reply in|Message from the person in) /;

/** True when a failed request says the resource does not exist (404). */
function isNotFound(error) {
  const status = error?.status ?? error?.response?.status ?? error?.statusCode;
  if (status !== undefined) return Number(status) === 404;
  return /\b404\b|not found/i.test(String(error?.message || ""));
}

// A new Cat's project is named from the first line of the person's first
// request and keeps the whole request as its goal (server limits apply).
const PROJECT_NAME_MAX = 80;
const PROJECT_GOAL_MAX = 4096;
export function projectNameFrom(text) {
  const line =
    String(text)
      .split("\n")
      .find((l) => l.trim()) || "";
  const name = line.trim().replace(/\s+/g, " ");
  if (!name) return "Project";
  return name.length > PROJECT_NAME_MAX
    ? `${name.slice(0, PROJECT_NAME_MAX - 1).trimEnd()}…`
    : name;
}

function messageText(event) {
  const message = event.llm_message;
  if (message && ["user", "assistant"].includes(message.role)) {
    const sender =
      message.role === "user" &&
      typeof event.sender === "string" &&
      event.sender.startsWith(SENDER_PREFIX)
        ? event.sender.slice(SENDER_PREFIX.length)
        : "";
    let parts = (message.content || []).filter((item) => item.type === "text");
    const header =
      sender && parts.length > 1 ? SENDER_HEADER.exec(parts[0].text)?.[1] : "";
    if (header) parts = parts.slice(1);
    const text = parts.map((item) => item.text).join("\n");
    if (text.trim())
      return sender
        ? {
            id: event.id,
            role: "user",
            text,
            sender,
            // The person's own words, copied from a project conversation.
            person: header === "Message from the person in",
          }
        : {
            id: event.id,
            role: message.role,
            text: message.role === "user" ? userMessageForDisplay(text) : text,
          };
  }
  if (
    event.action?.kind === "FinishAction" &&
    typeof event.action.message === "string"
  ) {
    return { id: event.id, role: "assistant", text: event.action.message };
  }
  return null;
}

export function activate(host) {
  if (host.apiVersion !== "1")
    throw new Error("Insider Cat requires Canvas App host API 1.");
  const storageKey = `${CONTROLLER_STORAGE_PREFIX}${JSON.stringify([host.backend.id, host.backend.orgId])}`;
  let savedSelection;
  try {
    savedSelection = JSON.parse(localStorage.getItem(storageKey) || "null");
  } catch {
    // A malformed or unavailable cache must not prevent browsing saved work.
  }
  const state = {
    project: null,
    // The person asked for the project list: don't reopen the only Cat.
    choosingProject: false,
    draft: "",
    controller: null,
    workspace: "",
    uncertain: false,
    newRequested: savedSelection?.newRequested === true,
    busy: false,
    controllerInvalid: false,
    controllerStatusUnknown: false,
    mutationNotice: null,
    requestedControllerId:
      typeof savedSelection?.controllerId === "string"
        ? savedSelection.controllerId
        : null,
  };
  let syncCompanion = null;
  let activePageRoot = null;
  let awayTimer = null;
  let awayGeneration = 0;
  let disposed = false;
  let serverInfo = null;

  // Regular Canvas can start or finish work while Projects is unmounted.
  // Refresh only the companion's status there; page polling owns it otherwise.
  function watchAwayStatus() {
    clearTimeout(awayTimer);
    const generation = ++awayGeneration;
    const id = state.controller?.id;
    if (
      disposed ||
      activePageRoot ||
      !syncCompanion ||
      !id ||
      state.controllerInvalid
    )
      return;
    const current = () =>
      !disposed &&
      !activePageRoot &&
      generation === awayGeneration &&
      state.controller?.id === id;
    const schedule = () => {
      if (current() && !state.controllerInvalid)
        awayTimer = setTimeout(
          refresh,
          state.controller?.execution_status === "running" ? 2500 : 10000,
        );
    };
    const refresh = async () => {
      try {
        const info = await host.agentServer.request({ path: detailPath(id) });
        if (!current()) return;
        state.controllerStatusUnknown = false;
        state.controllerInvalid = !isController(info);
        if (!state.controllerInvalid) state.controller = info;
      } catch {
        if (!current()) return;
        state.controllerStatusUnknown = true;
      }
      if (current()) syncCompanion?.();
      schedule();
    };
    schedule();
  }
  const voiceAudio = document.createElement("audio");
  voiceAudio.autoplay = true;
  voiceAudio.hidden = true;
  // Route and language remounts never detach the playback element.
  document.body.append(voiceAudio);
  const voice = createVoiceSession({
    host,
    canSubmit: (id) =>
      !state.busy &&
      !state.uncertain &&
      !state.controllerInvalid &&
      state.controller?.id === id,
    getContext: async () => ({
      voice: { connected: true, muted: voice.getSnapshot().muted },
      ...(state.project ? { project: state.project } : {}),
    }),
    onChange: () => {
      syncCompanion?.();
      syncCurrent?.();
    },
  });
  const unsubscribeContextChanges = host.onConversationContextChangeRequested?.(
    ({ conversationId, reason }) => {
      if (
        reason === "condense" &&
        voice.getSnapshot().controllerId === conversationId
      )
        voice.end();
    },
  );
  const canStartVoice = () =>
    Boolean(state.controller) &&
    !state.busy &&
    !state.uncertain &&
    !state.controllerInvalid &&
    !state.controllerStatusUnknown &&
    ["idle", "error"].includes(voice.getSnapshot().status);
  const startVoice = () => {
    if (canStartVoice()) void voice.start(state.controller, voiceAudio);
  };
  const unregisterCompanion = host.registerCompanion?.({
    id: "voice",
    mount: ({ container, navigate }) =>
      mountLocalizedApp(container, ({ container, t }) => {
        const root = document.createElement("section");
        root.className = "insider-voice";
        root.innerHTML = `<style>${catViewStyles}</style>`;
        const view = mountCatVoice({
          container: root,
          t,
          voice,
          compact: true,
          navigate,
          getState: () => ({ ...state, voiceSupported: true }),
          start: startVoice,
          canStart: canStartVoice,
        });
        const sync = () => {
          const current = voice.getSnapshot();
          const connected = !["idle", "error"].includes(current.status);
          root.hidden =
            Boolean(activePageRoot) ||
            (!state.controller && !connected && current.status !== "error");
          view.sync();
        };
        container.append(root);
        syncCompanion = sync;
        sync();
        watchAwayStatus();
        return () => {
          if (syncCompanion === sync) {
            syncCompanion = null;
            watchAwayStatus();
          }
          root.remove();
        };
      }),
  });
  const rememberController = () => {
    state.controllerStatusUnknown = false;
    if (
      voice.getSnapshot().controllerId &&
      voice.getSnapshot().controllerId !== state.controller?.id
    )
      voice.end();
    syncCompanion?.();
    watchAwayStatus();
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          controllerId: state.controller?.id || state.requestedControllerId,
          newRequested: state.newRequested,
        }),
      );
    } catch {
      // Durable conversations remain available when browser storage is disabled.
    }
  };
  let lastRoute = null;
  let disposeCurrent = null;
  let syncCurrent = null;
  const unregister = host.registerPage(
    "projects",
    ({ container, navigate, path = "" }) => {
      if (path !== lastRoute && !state.busy && !state.uncertain) {
        const previousRoute = lastRoute;
        lastRoute = path;
        const match = path.match(CONTROLLER_ROUTE);
        if (match) {
          state.controllerInvalid = false;
          state.mutationNotice = null;
          let requestedId;
          try {
            requestedId = decodeURIComponent(match[1]);
          } catch {
            requestedId = match[1];
          }
          state.choosingProject = false;
          state.requestedControllerId =
            state.controller?.id === requestedId ? null : requestedId;
          if (state.controller?.id !== requestedId) state.controller = null;
          state.newRequested = false;
        } else if (path.replace(/^\/|\/$/g, "") === "new") {
          state.choosingProject = false;
          state.controllerInvalid = false;
          state.mutationNotice = null;
          state.workspace ||= workspaceOf(state.controller);
          state.requestedControllerId = null;
          state.controller = null;
          state.newRequested = true;
        } else if (
          previousRoute !== null &&
          path.replace(/^\/|\/$/g, "") === ""
        ) {
          // Back to the project list from a Cat or a new project. The first
          // visit keeps resuming the remembered Cat.
          state.choosingProject = true;
          state.controllerInvalid = false;
          state.mutationNotice = null;
          state.requestedControllerId = null;
          state.controller = null;
          state.newRequested = false;
        }
        rememberController();
      }
      return mountLocalizedApp(container, ({ container, t }) => {
        let alive = true;
        let readGeneration = 0;
        let boardGeneration = 0;
        let timer = null;
        let board = [];
        const missingRefs = new Set();
        // The project this Cat coordinates, when the Agent Server has Projects.
        let boardProject = null;
        const collapsedGroups = new Set(COLLAPSED_GROUPS);
        const tracking = new Set();
        const groupCopy = Object.fromEntries(
          [...ATTENTION_GROUPS.map((g) => g.id), "other", "resolved"].map(
            (id) => [id, `group${id[0].toUpperCase()}${id.slice(1)}`],
          ),
        );
        let controllers = [];
        // The board follows the project on its own: new parts and their
        // status show up without Refresh.
        const BOARD_REFRESH_MS = 15_000;
        let lastBoardLoad = 0;
        const boardRefresh = setInterval(() => {
          if (!alive || state.busy || loading) return;
          if (document.visibilityState === "hidden") return;
          if (Date.now() - lastBoardLoad < BOARD_REFRESH_MS) return;
          void loadBoard({ quiet: true });
        }, 5_000);
        let dictation = null;
        let stopDictation = () => {};
        let syncDictation = () => {};
        // Project names by their Cat, to name each project in the chooser.
        let projectNamesByCat = new Map();
        // The server answered 404 on /api/projects: Projects is off there.
        let projectsOff = false;
        let workspaces = [];
        let workspaceDiscoveryReady = false;
        let workspaceGeneration = 0;
        let discoveryReady = false;
        let loading = false;
        let noticeKind = null;
        const root = document.createElement("section");
        root.className = "insider-app";
        // The app's selected language lives on the i18n wrapper's `lang`
        // attribute; timestamps must follow it, not the browser locale.
        const locale = () => root.closest("[lang]")?.lang || undefined;
        root.innerHTML = catPageMarkup;
        activePageRoot = root;
        watchAwayStatus();
        root.querySelectorAll("[data-copy]").forEach((node) => {
          node.textContent = t(node.dataset.copy);
        });
        const action = (name) => root.querySelector(`[data-action="${name}"]`);
        const role = (name) => root.querySelector(`[data-role="${name}"]`);
        action("report-problem").href =
          "https://github.com/enyst/insider/issues/new";
        action("report-problem").setAttribute(
          "aria-label",
          `${t("reportProblem")} — ${t("opensNewTab")}`,
        );
        action("draft").placeholder = t("placeholder");
        action("draft").value = state.draft;
        const pageVoice = mountCatVoice({
          container: role("voice"),
          t,
          voice,
          navigate,
          conversationControls: root.querySelector(".cat-picker"),
          actionsTarget: root.querySelector('[data-role="composer-controls"]'),
          getState: () => ({
            ...state,
            voiceSupported: Boolean(host.registerCompanion),
          }),
          start: startVoice,
          canStart: () =>
            Boolean(host.registerCompanion) &&
            discoveryReady &&
            canStartVoice(),
        });
        role("conversation").title = t("partialHistory");
        // Dictation, as in OpenHands: the browser's speech recognition types
        // into the draft. It is not the real-time Voice call, and the two
        // never share the microphone.
        const Recognition =
          globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
        const dictate = action("dictate");
        dictate.innerHTML = `${MICROPHONE_ICON}<span class="cat-sr-only"></span>`;
        dictate.querySelector("span").textContent = t("dictate");
        dictate.title = t("dictate");
        const callLive = () =>
          !["idle", "error"].includes(voice.getSnapshot().status);
        stopDictation = (abort = false) => {
          const current = dictation;
          dictation = null;
          dictate.setAttribute("aria-pressed", "false");
          if (abort) current?.abort?.();
          else current?.stop();
        };
        syncDictation = () => {
          const live = callLive();
          if (live && dictation) stopDictation(true);
          dictate.hidden = !Recognition || live;
        };
        dictate.addEventListener("click", () => {
          if (dictation) return stopDictation();
          if (!Recognition || callLive()) return;
          const recognition = new Recognition();
          recognition.lang =
            root.closest("[lang]")?.lang || navigator.language || "en";
          recognition.interimResults = false;
          recognition.continuous = true;
          recognition.onresult = (event) => {
            if (!alive || dictation !== recognition) return;
            const draft = action("draft");
            for (let i = event.resultIndex; i < event.results.length; i++) {
              if (!event.results[i].isFinal) continue;
              const words = event.results[i][0].transcript.trim();
              if (!words) continue;
              draft.value = draft.value
                ? `${draft.value.replace(/\s+$/, "")} ${words}`
                : words;
            }
            // Through the usual path, so the draft is saved as if typed.
            draft.dispatchEvent(new Event("input", { bubbles: true }));
          };
          recognition.onend = () => {
            if (dictation === recognition) stopDictation();
          };
          recognition.onerror = (event) => {
            if (dictation !== recognition) return;
            stopDictation(true);
            if (
              alive &&
              event?.error &&
              !["no-speech", "aborted"].includes(event.error)
            )
              notice(t("dictationFailed"));
          };
          dictation = recognition;
          dictate.setAttribute("aria-pressed", "true");
          try {
            recognition.start();
          } catch {
            stopDictation(true);
            notice(t("dictationFailed"));
          }
        });
        syncDictation();
        container.append(root);
        const request = (path, method = "GET", body) =>
          host.agentServer.request({
            path,
            method,
            ...(body === undefined ? {} : { body }),
          });
        const notice = (text, kind = null) => {
          if (alive) {
            noticeKind = kind;
            role("notice").textContent = text;
          }
        };
        // A screen-reader-only live region for board actions (resolve, reopen)
        // that move a card between groups without any visible copy.
        const announceBoard = (text) => {
          if (alive) role("board-status").textContent = text;
        };
        const savedMutationNotice = () => {
          const outcome = state.mutationNotice;
          return outcome
            ? `${t(outcome.key, outcome.params)}${outcome.uncertain ? `\n${t("uncertain")}` : ""}`
            : state.uncertain
              ? t("uncertain")
              : "";
        };
        const option = (value, text) => {
          const node = document.createElement("option");
          node.value = value;
          node.textContent = text;
          return node;
        };
        const workspaceName = (path) =>
          path
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() || path;
        const workspaceOption = (path, paths) => {
          const name = workspaceName(path);
          const duplicate = paths.some(
            (other) => other !== path && workspaceName(other) === name,
          );
          const node = option(path, duplicate ? path : name);
          node.title = path;
          return node;
        };
        const open = (id) =>
          navigate(`/conversations/${encodeURIComponent(id)}`);

        function renderControls() {
          if (!alive) return;
          syncCompanion?.();
          pageVoice.sync();
          action("send").disabled =
            state.busy ||
            !discoveryReady ||
            state.uncertain ||
            state.controllerInvalid ||
            (!state.controller &&
              !state.newRequested &&
              (controllers.length > 1 || state.choosingProject));
          action("send").textContent = t(state.busy ? "sending" : "send");
          action("checked").hidden = !state.uncertain;
          syncDictation();
          action("new-cat").disabled =
            state.busy || state.uncertain || !discoveryReady;
          action("controller").disabled = state.busy || state.uncertain;
          // A Cat's window belongs to its one project: choosing or starting
          // another project happens on the project list.
          role("projects-off").hidden =
            !projectsOff || Boolean(state.controller) || state.newRequested;
          role("picker").hidden =
            Boolean(state.controller) || state.newRequested;
          action("all-projects").hidden =
            !state.controller && !state.newRequested;
          action("all-projects").disabled = state.busy || state.uncertain;
          action("open-controller").hidden = !state.controller;
          // A new Cat runs in the first host workspace; ask only when none is known.
          role("workspace-field").hidden =
            Boolean(state.controller) || Boolean(state.workspace);
          role("conversation").hidden = !state.controller;
          role("cat-status").hidden = discoveryReady;
          role("cat-status").textContent = discoveryReady ? "" : t("searching");
        }
        function renderControllerChoices() {
          action("controller").replaceChildren(
            option("", t("chooseController")),
            ...controllers.map((c) => {
              const title =
                projectNamesByCat.get(idKey(c.id)) || c.title || t("cat");
              const duplicate = controllers.some(
                (other) =>
                  other.id !== c.id &&
                  (projectNamesByCat.get(idKey(other.id)) ||
                    other.title ||
                    t("cat")) === title,
              );
              const node = option(
                c.id,
                duplicate ? `${title} · ${c.id.slice(0, 8)}` : title,
              );
              node.title = c.id;
              return node;
            }),
          );
          action("controller").value = state.controller?.id || "";
          action("controller").title = state.controller?.id || "";
          renderControls();
        }
        function renderWorkspaces() {
          const paths = [
            ...new Set(
              [
                ...workspaces.map((w) => w.path),
                ...(isLocalOnlyRuntime(serverInfo)
                  ? [...board.map(workspaceOf), state.workspace]
                  : []),
              ].filter(Boolean),
            ),
          ];
          if (workspaceDiscoveryReady && !paths.includes(state.workspace))
            state.workspace = "";
          if (!state.workspace && paths.length) state.workspace = paths[0];
          action("workspace").replaceChildren(
            option("", t("chooseWorkspace")),
            ...paths.map((path) => workspaceOption(path, paths)),
          );
          action("workspace").value = state.workspace;
          role("workspace-field").hidden =
            Boolean(state.controller) || Boolean(state.workspace);
        }
        async function refreshWorkspaces() {
          const generation = ++workspaceGeneration;
          const [info, data] = await Promise.all([
            fetchServerInfo(request),
            request("/api/workspaces").catch(() => null),
          ]);
          if (!alive || generation !== workspaceGeneration) return;
          serverInfo = info;
          workspaces = data?.workspaces || [];
          workspaceDiscoveryReady = true;
          renderWorkspaces();
        }
        async function updateTags(c, nextTags, focusAction, stillValid) {
          if (tracking.has(c.id)) return;
          tracking.add(c.id);
          renderBoard();
          let announce = null;
          try {
            // A tag update replaces the whole set: start from the saved tags.
            const fresh = await request(detailPath(c.id));
            if (!alive || !stillValid()) return;
            const tags = nextTags(fresh?.tags);
            await request(detailPath(c.id), "PATCH", { tags });
            if (!alive) return;
            board = board.map((item) =>
              item.id === c.id ? { ...item, ...fresh, tags } : item,
            );
            const moved = board.find((item) => item.id === c.id);
            if (moved)
              announce = `${moved.title || moved.id} — ${t(groupCopy[groupFor(moved)])}`;
          } catch (error) {
            notice(t("tagError", { message: errorText(error) }));
          } finally {
            tracking.delete(c.id);
            if (alive) {
              renderBoard();
              // A resolved card may move into a collapsed group: keep focus
              // on that group's toggle instead of losing it.
              const moved = board.find((item) => item.id === c.id);
              restoreFocus(
                `[data-card="${c.id}"] [data-action="${focusAction}"]`,
                moved && `[data-action="group-${groupFor(moved)}"]`,
              );
              if (announce) announceBoard(announce);
            }
          }
        }
        function restoreFocus(selector, fallback) {
          (
            root.querySelector(selector) ||
            (fallback && root.querySelector(fallback))
          )?.focus?.();
        }
        function renderBoard() {
          if (!alive) return;
          const controllerId = state.controller?.id;
          // The board is one project: its conversations, or, on an Agent
          // Server without Projects, the work this Cat started or tracks.
          const projectKey = boardProject && idKey(boardProject.id);
          const cards = controllerId
            ? board.filter(
                (c) =>
                  !isController(c) &&
                  idKey(c.id) !== idKey(controllerId) &&
                  (projectKey
                    ? idKey(c.tags?.project || "") === projectKey
                    : belongsToCat(c, controllerId)),
              )
            : [];
          const grouped = groupByAttention(cards);
          renderProjectHead(grouped);
          readPullRequests(cards);
          const parent = role("cards");
          parent.replaceChildren();
          for (const group of grouped) {
            const section = document.createElement("section");
            section.className = "cat-group";
            section.dataset.group = group.id;
            const collapsed = collapsedGroups.has(group.id);
            const head = document.createElement("button");
            head.className = "cat-group-head";
            head.type = "button";
            head.id = `group-head-${group.id}`;
            head.dataset.action = `group-${group.id}`;
            head.setAttribute("aria-expanded", String(!collapsed));
            head.setAttribute("aria-controls", `group-panel-${group.id}`);
            head.textContent = `${t(groupCopy[group.id])} · ${group.items.length}`;
            head.addEventListener("click", () => {
              if (collapsedGroups.has(group.id))
                collapsedGroups.delete(group.id);
              else collapsedGroups.add(group.id);
              renderBoard();
              restoreFocus(`[data-action="group-${group.id}"]`);
            });
            const body = document.createElement("div");
            body.className = "cat-group-body";
            body.id = `group-panel-${group.id}`;
            body.setAttribute("role", "group");
            body.setAttribute("aria-label", t(groupCopy[group.id]));
            if (!collapsed) for (const c of group.items) body.append(card(c));
            section.append(head, body);
            parent.append(section);
          }
          if (!cards.length && !loading) {
            if (!board.length) {
              const empty = document.createElement("div");
              empty.className = "cat-empty";
              const title = document.createElement("p");
              title.className = "cat-empty-title";
              title.textContent = t("emptyFirstRunTitle");
              const hint = document.createElement("p");
              hint.className = "cat-empty-hint";
              hint.textContent = t("emptyFirstRunHint");
              empty.append(title, hint);
              parent.append(empty);
            } else {
              const empty = document.createElement("p");
              empty.className = "cat-muted";
              empty.textContent = t(controllerId ? "emptyCat" : "empty");
              parent.append(empty);
            }
          }
        }
        // The project's name, goal and how its work stands, above the cards.
        function renderProjectHead(grouped) {
          role("work-title").textContent = boardProject?.name || t("workTitle");
          const goal = role("project-goal");
          goal.textContent = boardProject?.description || "";
          goal.hidden = !goal.textContent;
          const progress = role("project-progress");
          progress.textContent = grouped
            .map((g) => `${t(groupCopy[g.id])} ${g.items.length}`)
            .join(" · ");
          progress.hidden = !boardProject || !grouped.length;
        }
        // Pull requests the project's conversations mention, read once per
        // conversation and change, from the light project transcript.
        const pullRequests = new Map();
        const pullRequestReads = new Map();
        let pullRequestRender = null;
        // State and CI of each pull request, from the agent server's GitHub
        // access. Open PRs are read again every minute so CI can move on;
        // Refresh reads them at once.
        const pullRequestStatuses = new Map();
        const STATUS_TTL = 60_000;
        const PR_STATES = new Set(["open", "closed", "merged"]);
        let pullRequestSweep = null;
        function clearPullRequests() {
          pullRequests.clear();
          pullRequestReads.clear();
          pullRequestStatuses.clear();
          clearTimeout(pullRequestSweep);
          pullRequestSweep = null;
        }
        function expirePullRequestStatuses() {
          for (const entry of pullRequestStatuses.values()) entry.at = 0;
        }
        function sweepPullRequestStatuses() {
          if (pullRequestSweep) return;
          pullRequestSweep = setTimeout(() => {
            pullRequestSweep = null;
            if (!alive || !boardProject) return;
            for (const pr of pullRequests.values()) readPullRequestStatus(pr);
          }, STATUS_TTL);
        }
        function readPullRequestStatus(pr) {
          const known = pullRequestStatuses.get(pr.url);
          if (known && Date.now() - known.at < STATUS_TTL) return;
          // A merged or closed PR no longer changes.
          if (known?.status && known.status.state !== "open") return;
          const project = boardProject;
          const entry = { at: Date.now(), status: known?.status || null };
          pullRequestStatuses.set(pr.url, entry);
          const stillWanted = () =>
            alive &&
            boardProject?.id === project?.id &&
            pullRequestStatuses.get(pr.url) === entry;
          request(
            `/api/git/repositories/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/pull-requests/${pr.number}?provider=github`,
          )
            .then((status) => {
              if (!stillWanted()) return;
              const before = JSON.stringify(entry.status);
              entry.status = PR_STATES.has(status?.state) ? status : null;
              if (entry.status?.state === "open") sweepPullRequestStatuses();
              if (before !== JSON.stringify(entry.status))
                schedulePullRequestRender();
            })
            .catch((error) => {
              if (!stillWanted()) return;
              const code = Number(
                error?.status ?? error?.response?.status ?? error?.statusCode,
              );
              // GitHub away, slow or rate-limited: keep what we knew and try
              // again later.
              if (!code || code >= 500 || code === 429) {
                if (entry.status?.state === "open") sweepPullRequestStatuses();
                return;
              }
              // No token (409), no such PR, or no route on an older server:
              // the card keeps its plain link.
              const had = entry.status;
              entry.status = null;
              if (had) schedulePullRequestRender();
            });
        }
        // Results arrive one by one: draw them together, keeping focus.
        function schedulePullRequestRender() {
          if (pullRequestRender) return;
          pullRequestRender = setTimeout(() => {
            pullRequestRender = null;
            if (!alive) return;
            const focused = document.activeElement;
            const cardId = focused?.closest?.("[data-card]")?.dataset.card;
            const focusAction = focused?.dataset?.action;
            renderBoard();
            if (cardId && focusAction)
              restoreFocus(
                `[data-card="${cardId}"] [data-action="${focusAction}"]`,
              );
          }, 50);
        }
        function readPullRequests(cards) {
          const project = boardProject;
          if (!project) return;
          for (const c of cards) {
            const key = idKey(c.id);
            const known = pullRequests.get(key);
            if (known) readPullRequestStatus(known);
            const version = `${project.id}:${c.updated_at || ""}`;
            if (pullRequestReads.get(key) === version) continue;
            pullRequestReads.set(key, version);
            const stillWanted = () =>
              alive &&
              boardProject?.id === project.id &&
              pullRequestReads.get(key) === version;
            request(
              `/api/projects/${encodeURIComponent(project.id)}/conversations/${encodeURIComponent(c.id)}/messages?limit=50`,
            )
              .then((transcript) => {
                if (!stillWanted()) return;
                // The agent's own words, newest last; the person's and tool
                // output can name unrelated pull requests.
                const pr = latestPullRequest(
                  (transcript?.messages || [])
                    .filter((m) => m.source === "agent")
                    .map((m) => m.text),
                );
                const before = pullRequests.get(key)?.url;
                if (pr) {
                  pullRequests.set(key, pr);
                  readPullRequestStatus(pr);
                } else pullRequests.delete(key);
                if (before !== pr?.url) schedulePullRequestRender();
              })
              .catch(() => {
                // Read again on the next render; older servers have no
                // transcript, and their cards simply show no PR line.
                if (pullRequestReads.get(key) === version)
                  pullRequestReads.delete(key);
              });
          }
        }
        function card(c) {
          const controllerId = state.controller?.id;
          const card = document.createElement("article");
          card.className = "cat-card";
          card.dataset.status = c.execution_status || "unknown";
          card.dataset.card = c.id;
          const title = document.createElement("h3");
          title.className = "cat-card-title";
          title.textContent = c.title || c.id;
          const name = title.textContent;
          const meta = document.createElement("div");
          meta.className = "cat-card-meta";
          const badge = document.createElement("span");
          badge.className = "cat-badge";
          badge.textContent = t(
            EXECUTION_STATUSES.has(c.execution_status)
              ? c.execution_status
              : "unknown",
          );
          const age = document.createElement("span");
          age.textContent = relativeAge(c.updated_at, Date.now(), locale());
          if (c.updated_at)
            age.title = new Date(c.updated_at).toLocaleString(locale());
          meta.append(badge, age);
          const ask = askOf(c);
          const askLine = document.createElement("div");
          if (ask) {
            askLine.className = "cat-card-ask";
            askLine.textContent = ask;
          }
          const buttons = document.createElement("div");
          buttons.className = "cat-controls";
          const link = document.createElement("button");
          link.dataset.action = "open-worker";
          link.textContent = t("open");
          link.setAttribute("aria-label", `${t("open")} ${name}`);
          link.addEventListener("click", () => open(c.id));
          buttons.append(link);
          const resolved = isResolved(c);
          const resolve = document.createElement("button");
          resolve.dataset.action = "resolve-worker";
          resolve.textContent = t(resolved ? "reopen" : "resolve");
          resolve.setAttribute(
            "aria-label",
            `${t(resolved ? "reopen" : "resolve")} ${name}`,
          );
          resolve.disabled = tracking.has(c.id);
          resolve.addEventListener(
            "click",
            () =>
              void updateTags(
                c,
                (tags) => resolvedTags(tags, !resolved),
                "resolve-worker",
                () => true,
              ),
          );
          buttons.append(resolve);
          const pr = boardProject && pullRequests.get(idKey(c.id));
          const prLine = document.createElement("a");
          if (pr) {
            prLine.className = "cat-card-pr";
            prLine.href = pr.url;
            prLine.target = "_blank";
            prLine.rel = "noopener noreferrer";
            const words = pullRequestStatusKeys(
              pullRequestStatuses.get(pr.url)?.status,
            ).map((k) => t(k));
            prLine.textContent = [
              t("prLabel", { label: pr.label }),
              ...words,
            ].join(" · ");
            prLine.setAttribute(
              "aria-label",
              `${prLine.textContent} — ${t("opensNewTab")}`,
            );
            if (words.length > 1)
              prLine.dataset.checks = pullRequestStatuses.get(
                pr.url,
              ).status.checks;
          }
          card.append(
            title,
            meta,
            ...(ask ? [askLine] : []),
            ...(pr ? [prLine] : []),
            buttons,
          );
          return card;
        }
        async function discoverControllers(firstPage, generation) {
          // Project names only label the chooser: never hold discovery up.
          const projectsRead = Promise.race([
            request("/api/projects").catch((error) =>
              isNotFound(error) ? { off: true } : null,
            ),
            new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          let items = [...firstPage.items];
          let next = firstPage.next_page_id;
          const seen = new Set();
          while (next) {
            if (!alive || generation !== boardGeneration) return;
            if (seen.has(next)) throw new Error(t("discoveryFailed"));
            seen.add(next);
            const page = await request(
              `/api/conversations/search?limit=${PAGE_SIZE}&sort_order=UPDATED_AT_DESC&page_id=${encodeURIComponent(next)}`,
            );
            if (!Array.isArray(page.items))
              throw new Error(t("discoveryFailed"));
            items.push(...page.items);
            next = page.next_page_id;
          }
          if (!alive || generation !== boardGeneration) return;
          board = unique(items);
          controllers = unique(items.filter(isController));
          const projects = await projectsRead;
          if (!alive || generation !== boardGeneration) return;
          projectsOff = projects?.off === true;
          projectNamesByCat = new Map(
            (projects?.projects || [])
              .filter((p) => p?.coordinator_conversation_id && p.name)
              .map((p) => [idKey(p.coordinator_conversation_id), p.name]),
          );
          discoveryReady = true;
          if (state.requestedControllerId && !state.controller) {
            state.controller =
              controllers.find((c) => c.id === state.requestedControllerId) ||
              null;
            if (!state.controller) {
              state.controllerInvalid = true;
              notice(t("invalidController"));
            }
            state.requestedControllerId = null;
          }
          if (
            !state.controller &&
            !state.controllerInvalid &&
            !state.newRequested &&
            !state.choosingProject &&
            controllers.length === 1
          )
            state.controller = controllers[0];
          rememberController();
          renderControllerChoices();
          if (state.controller) void refreshController();
        }
        // `quiet` keeps the board in place while it is read again in the
        // background: no loading text, no flash of a partial board.
        async function loadBoard({ quiet = false } = {}) {
          if (loading) return;
          loading = true;
          const generation = ++boardGeneration;
          if (!quiet) {
            role("coverage").textContent = t("loading");
            action("refresh").disabled = true;
            renderBoard();
          }
          try {
            const page = await request(
              `/api/conversations/search?limit=${PAGE_SIZE}&sort_order=UPDATED_AT_DESC`,
            );
            if (!Array.isArray(page.items))
              throw new Error(t("discoveryFailed"));
            if (!alive || generation !== boardGeneration) return;
            if (!quiet) {
              board = unique(page.items);
              discoveryReady = false;
              renderControls();
            }
            // Discovery reads every page: the board is complete after it.
            await discoverControllers(page, generation);
            if (!alive || generation !== boardGeneration) return;
            // Local-only backends offer the folders their conversations use.
            renderWorkspaces();
            renderControls();
            role("coverage").textContent = "";
            role("coverage").title = t("refreshed", {
              time: new Date().toLocaleTimeString(),
            });
          } catch (error) {
            if (alive && generation === boardGeneration && !quiet) {
              role("coverage").textContent = t("loadError", {
                message: errorText(error),
              });
              discoveryReady = false;
              notice(t("discoveryFailed"));
            }
          } finally {
            if (alive) {
              loading = false;
              lastBoardLoad = Date.now();
              action("refresh").disabled = false;
              renderBoard();
              renderControls();
            }
          }
        }
        // Live status for conversations the Cat names in its messages.
        async function readConversationRefs(messages, controllerId) {
          const keys = new Map();
          for (const message of messages)
            for (const ref of [
              ...(message.sender ? [message.sender] : []),
              ...conversationRefs(message.text),
            ])
              if (idKey(ref) !== idKey(controllerId)) {
                // The latest mention decides which cards fit the limit.
                keys.delete(idKey(ref));
                keys.set(idKey(ref), ref);
              }
          const wanted = [...keys.values()]
            .filter((ref) => !missingRefs.has(idKey(ref)))
            .slice(-REF_LIMIT);
          const found = await Promise.allSettled(
            wanted.map((ref) =>
              Promise.race([
                request(detailPath(ref)),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("timeout")), REF_TIMEOUT),
                ),
              ]),
            ),
          );
          const refs = new Map();
          found.forEach((result, index) => {
            if (result.status === "fulfilled" && result.value?.id)
              refs.set(idKey(result.value.id), result.value);
            // Other UUIDs in text (events, tool calls) are not conversations:
            // stop asking for them while this page is open. Only a clear
            // "not found" counts; a timeout or server error is retried.
            else if (isNotFound(result.reason))
              missingRefs.add(idKey(wanted[index]));
          });
          return refs;
        }
        // Mentions read as links that open the conversation, named by its
        // current title when the server reported it.
        function textNodes(text) {
          return inlineMarkdownParts(text).map((part) => {
            if (typeof part === "string") return document.createTextNode(part);
            const node = document.createElement(
              part.bold !== undefined ? "b" : "code",
            );
            node.textContent = part.bold ?? part.code;
            return node;
          });
        }
        function mentionNodes(text, refs) {
          return mentionParts(text).flatMap((part) => {
            if (typeof part === "string") return textNodes(part);
            // A real inline link, so a long title wraps with the sentence
            // instead of jumping to a line of its own.
            const id = refs.get(idKey(part.id))?.id || part.id;
            const link = document.createElement("a");
            link.className = "cat-mention";
            link.href = `/conversations/${encodeURIComponent(id)}`;
            link.dataset.ref = idKey(part.id);
            link.title = part.id;
            link.textContent = refs.get(idKey(part.id))?.title || part.title;
            link.addEventListener("click", (event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              open(id);
            });
            return [link];
          });
        }
        function refCard(c) {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "cat-ref";
          card.dataset.action = "open-ref";
          card.dataset.ref = idKey(c.id);
          card.dataset.status = c.execution_status || "unknown";
          card.title = c.id;
          const title = document.createElement("span");
          title.className = "cat-ref-title";
          title.textContent = c.title || c.id;
          const meta = document.createElement("span");
          meta.className = "cat-card-meta";
          const badge = document.createElement("span");
          badge.className = "cat-badge";
          badge.textContent =
            groupFor(c) === "resolved"
              ? t("groupResolved")
              : t(
                  EXECUTION_STATUSES.has(c.execution_status)
                    ? c.execution_status
                    : "unknown",
                );
          meta.append(badge);
          const age = relativeAge(c.updated_at, Date.now(), locale());
          if (age) {
            const when = document.createElement("span");
            when.textContent = age;
            meta.append(when);
          }
          card.append(title, meta);
          card.addEventListener("click", () => open(c.id));
          return card;
        }
        // Project files: artifacts of the project this Cat coordinates, from
        // Agent Server Projects. Hidden when the Cat leads no project or the
        // server has no projects API.
        let filesProjectId = null;
        let filesControllerId = null;
        let filesGeneration = 0;
        let previewName = null;
        const TEXT_FILE =
          /\.(md|markdown|txt|json|csv|log|ya?ml|toml|diff|patch)$/i;
        const artifactPath = (projectId, name) =>
          `/api/projects/${encodeURIComponent(projectId)}/artifacts${name === undefined ? "" : `/${encodeURIComponent(name)}`}`;
        function setBoardProject(project) {
          if ((boardProject?.id || null) !== (project?.id || null))
            clearPullRequests();
          // Voice requests read the project from the shared state.
          state.project = project
            ? { id: project.id, name: project.name }
            : null;
          if (
            (boardProject?.id || null) === (project?.id || null) &&
            boardProject?.name === project?.name &&
            boardProject?.description === project?.description
          ) {
            boardProject = project;
            return;
          }
          boardProject = project;
          renderBoard();
        }
        // The project and its files belong to the current Cat only.
        function forgetProject() {
          setBoardProject(null);
          hideFiles();
        }
        function hideFiles() {
          filesProjectId = null;
          filesControllerId = null;
          previewName = null;
          role("files").hidden = true;
          role("file-preview").hidden = true;
        }
        async function refreshFiles(controllerId) {
          const generation = ++filesGeneration;
          const current = () =>
            alive &&
            generation === filesGeneration &&
            state.controller?.id === controllerId;
          let list;
          let projectId;
          let projects;
          try {
            projects = await request("/api/projects");
          } catch (error) {
            // No Projects on this Agent Server: nothing to show. Any other
            // failure keeps the last known project until the next refresh.
            if (current() && isNotFound(error)) forgetProject();
            return;
          }
          if (!current()) return;
          const project = (projects?.projects || []).find(
            (p) => idKey(p.coordinator_conversation_id) === idKey(controllerId),
          );
          setBoardProject(project || null);
          if (!project) {
            hideFiles();
            return;
          }
          projectId = project.id;
          try {
            list = await request(artifactPath(projectId));
          } catch {
            // The project stays on the board; only its files are unavailable.
            if (current()) hideFiles();
            return;
          }
          if (!current()) return;
          if (filesProjectId !== projectId) {
            previewName = null;
            role("file-preview").hidden = true;
          }
          filesProjectId = projectId;
          filesControllerId = controllerId;
          renderFiles(Array.isArray(list?.artifacts) ? list.artifacts : []);
        }
        function renderFiles(artifacts) {
          role("files").hidden = false;
          role("files-title").textContent = t("filesTitle", {
            count: artifacts.length,
          });
          const focused =
            document.activeElement?.closest?.(".cat-file")?.dataset.file;
          const items = [...artifacts].sort((a, b) =>
            String(b.updated_at || "").localeCompare(
              String(a.updated_at || ""),
            ),
          );
          role("file-list").replaceChildren(
            ...items.map((artifact) => {
              const item = document.createElement("li");
              item.className = "cat-file";
              item.dataset.file = artifact.name;
              item.dataset.source = artifact.source;
              const name = document.createElement("button");
              name.textContent = artifact.name;
              name.setAttribute(
                "aria-expanded",
                String(previewName === artifact.name),
              );
              name.addEventListener(
                "click",
                () => void togglePreview(artifact.name),
              );
              const meta = document.createElement("div");
              meta.className = "cat-file-meta";
              const source = document.createElement("span");
              source.className = "cat-file-source";
              source.textContent = t(
                artifact.source === "user" ? "fileFromYou" : "fileFromAgent",
              );
              const maker =
                artifact.conversation_id &&
                board.find(
                  (c) => idKey(c.id) === idKey(artifact.conversation_id),
                );
              if (maker) source.textContent += ` · ${maker.title || maker.id}`;
              const age = document.createElement("span");
              age.textContent = relativeAge(
                artifact.updated_at,
                Date.now(),
                locale(),
              );
              meta.append(source, age);
              item.append(name, meta);
              return item;
            }),
          );
          if (previewName && !items.some((a) => a.name === previewName)) {
            previewName = null;
            role("file-preview").hidden = true;
          }
          if (focused)
            role("file-list")
              .querySelector(
                `.cat-file[data-file="${CSS.escape(focused)}"] button`,
              )
              ?.focus();
        }
        async function togglePreview(name) {
          const preview = role("file-preview");
          if (previewName === name) {
            previewName = null;
            preview.hidden = true;
          } else {
            previewName = name;
            preview.hidden = false;
            if (!TEXT_FILE.test(name)) preview.textContent = t("fileNoPreview");
            else {
              preview.textContent = t("loading");
              try {
                const text = await request(artifactPath(filesProjectId, name));
                if (previewName === name)
                  preview.textContent =
                    typeof text === "string"
                      ? text
                      : JSON.stringify(text, null, 2);
              } catch (error) {
                if (previewName === name)
                  preview.textContent = t("fileError", {
                    message: errorText(error),
                  });
              }
            }
          }
          role("file-list")
            .querySelectorAll(".cat-file button")
            .forEach((button) =>
              button.setAttribute(
                "aria-expanded",
                String(button.textContent === previewName),
              ),
            );
        }
        async function addFile(file) {
          const projectId = filesProjectId;
          const controllerId = state.controller?.id;
          if (!file || !projectId || !controllerId) return;
          const body = new FormData();
          body.append("file", file, file.name);
          action("add-file").disabled = true;
          try {
            await host.agentServer.request({
              path: artifactPath(projectId),
              method: "POST",
              body,
            });
          } catch (error) {
            notice(t("fileError", { message: errorText(error) }));
          } finally {
            if (alive) action("add-file").disabled = false;
          }
          if (alive) await refreshFiles(controllerId);
        }
        async function refreshController() {
          const id = state.controller?.id;
          // Files belong to the Cat that leads the project, never a previous one.
          if (alive && filesControllerId && filesControllerId !== id)
            forgetProject();
          if (!id || !alive) return;
          const generation = ++readGeneration;
          clearTimeout(timer);
          try {
            const [info, events] = await Promise.all([
              request(detailPath(id)),
              request(
                `${detailPath(id)}/events/search?limit=50&sort_order=TIMESTAMP_DESC`,
              ),
            ]);
            if (
              !alive ||
              generation !== readGeneration ||
              state.controller?.id !== id
            )
              return;
            if (!isController(info)) {
              state.controllerInvalid = true;
              renderControls();
              throw new Error(t("invalidController"));
            }
            state.controllerInvalid = false;
            state.controllerStatusUnknown = false;
            state.controller = info;
            const chronological = [...(events.items || [])].reverse();
            const messages = chronological.map(messageText).filter(Boolean);
            const reactions = foldReactions(chronological);
            const refs = await readConversationRefs(messages, id);
            if (
              !alive ||
              generation !== readGeneration ||
              state.controller?.id !== id
            )
              return;
            const history = role("history");
            // Rebuilding the history must not drop keyboard focus on a card.
            const focusedRef =
              document.activeElement?.closest?.(".cat-ref")?.dataset.ref;
            const previousScroll = history.scrollTop;
            const followLatest =
              history.scrollHeight - previousScroll - history.clientHeight < 48;
            history.replaceChildren();
            for (const message of messages) {
              const row = document.createElement("div");
              row.className = "cat-message";
              row.dataset.speaker = message.sender
                ? "conversation"
                : message.role;
              const label = document.createElement("strong");
              label.textContent = t(
                message.person
                  ? "youInConversation"
                  : message.sender
                    ? "fromConversation"
                    : message.role === "user"
                      ? "user"
                      : "assistant",
              );
              row.append(label, ...mentionNodes(message.text, refs));
              const rowRefs = new Map();
              for (const ref of [
                ...(message.sender ? [message.sender] : []),
                ...conversationRefs(message.text),
              ])
                if (!rowRefs.has(idKey(ref))) rowRefs.set(idKey(ref), ref);
              for (const ref of rowRefs.values()) {
                const linked = refs.get(idKey(ref));
                if (linked) row.append(refCard(linked));
              }
              const chips = message.id && reactions.get(message.id);
              if (chips?.length) {
                const strip = document.createElement("div");
                strip.className = "cat-reactions";
                for (const chip of chips) {
                  const item = document.createElement("span");
                  item.className = "cat-reaction";
                  item.dataset.emoji = chip.emoji;
                  item.textContent = REACTION_EMOJI[chip.emoji];
                  item.title = chip.sources
                    .map((source) =>
                      t(source === "user" ? "user" : "assistant"),
                    )
                    .join(", ");
                  // Screen readers name the emoji in the reader's language.
                  item.setAttribute("role", "img");
                  item.setAttribute(
                    "aria-label",
                    `${REACTION_EMOJI[chip.emoji]} ${item.title}`,
                  );
                  strip.append(item);
                }
                row.append(strip);
              }
              history.append(row);
            }
            if (!history.childElementCount)
              history.textContent = t("noMessages");
            if (focusedRef)
              history
                .querySelector(`.cat-ref[data-ref="${focusedRef}"]`)
                ?.focus();
            history.scrollTop = followLatest
              ? history.scrollHeight
              : previousScroll;
            if (noticeKind === "controller-read-error")
              notice(savedMutationNotice());
            renderControls();
            void refreshFiles(id);
          } catch (error) {
            if (alive && generation === readGeneration) {
              state.controllerStatusUnknown = true;
              renderControls();
              notice(
                t("catError", { message: errorText(error) }),
                "controller-read-error",
              );
            }
          } finally {
            if (alive && generation === readGeneration)
              timer = setTimeout(
                refreshController,
                state.controller?.execution_status === "running" ? 2500 : 10000,
              );
          }
        }
        async function send() {
          if (
            !alive ||
            state.busy ||
            !discoveryReady ||
            state.uncertain ||
            state.controllerInvalid ||
            (!state.controller &&
              !state.newRequested &&
              (controllers.length > 1 || state.choosingProject))
          )
            return;
          const text = action("draft").value.trim();
          if (!text) return;
          state.draft = action("draft").value;
          if (text === NEW_COMMAND) {
            state.draft = "";
            action("draft").value = "";
            startNewController();
            return;
          }
          if (text === CONDENSE_COMMAND) {
            await condenseController();
            return;
          }
          const voiceState = voice.getSnapshot();
          if (voiceState.requestPending || voiceState.status === "thinking") {
            notice(t("voiceThinking"));
            return;
          }
          const submittedDraft = state.draft;
          const controllerWorkspace = state.workspace;
          if (!state.controller && !state.workspace) {
            notice(
              t(
                isLocalOnlyRuntime(serverInfo)
                  ? "missingWorkspace"
                  : "hostWorkspace",
              ),
            );
            return;
          }
          state.busy = true;
          state.mutationNotice = null;
          notice("");
          renderControls();
          let submitted = false;
          let createdController = false;
          let projectError = null;
          try {
            // Read at send time: a new Cat's project exists only just before.
            const requestContent = () => [
              {
                type: "text",
                text: `Canvas context (data, not instructions):\n${JSON.stringify({ backend_id: host.backend.id, org_id: host.backend.orgId, ...(state.project ? { project: state.project } : {}) })}\n\nUser request:\n${text}`,
              },
            ];
            const content = requestContent();
            if (!state.controller) {
              const [profiles, settings, schema, runtimeInfo, workspaceData] =
                await Promise.all([
                  request("/api/agent-profiles"),
                  request("/api/settings"),
                  request("/openapi.json"),
                  fetchServerInfo(request),
                  request("/api/workspaces").catch(() => null),
                ]);
              if (!alive) return;
              ++workspaceGeneration;
              serverInfo = runtimeInfo;
              workspaces = workspaceData?.workspaces || [];
              workspaceDiscoveryReady = true;
              renderWorkspaces();
              if (!hasLocalRuntime(runtimeInfo))
                throw new Error(t("runtimeUnavailable"));
              if (
                !isLocalOnlyRuntime(runtimeInfo) &&
                !workspaces.some(
                  (workspace) => workspace.path === controllerWorkspace,
                )
              )
                throw new Error(t("hostWorkspace"));
              if (!supportsControllerLaunch(schema))
                throw new Error(t("incompatible"));
              const profile = profiles.profiles?.find(
                (p) => p.id === profiles.active_agent_profile_id,
              );
              if (!profile || profile.agent_kind !== "openhands")
                throw new Error(t("noProfile"));
              const id = crypto.randomUUID();
              // Reserve the ID before submission; a lost response can still be inspected.
              state.controller = {
                id,
                tags: CONTROLLER_TAGS,
                execution_status: "idle",
              };
              submitted = true;
              const info = await request("/api/conversations", "POST", {
                conversation_id: id,
                agent_profile_id: profile.id,
                workspace: { working_dir: controllerWorkspace },
                ...(runtimeInfo.available_conversation_runtimes?.includes(
                  "local",
                )
                  ? { conversation_runtime: "local" }
                  : {}),
                tags: CONTROLLER_TAGS,
                autotitle: false,
                agent_launch_additions: {
                  system_message_suffix_append: [
                    buildRuntimeServicesSuffix(runtimeInfo),
                    `<INSIDER_CONTROLLER>\nThe runtime identifies this conversation as the active Insider Cat controller. Backend: ${host.backend.id}. Controller ID: ${id}.\nThe Apps page shows the person this Cat's project: its conversations grouped by what they need, and its files. Canvas may relay voice requests into this same durable conversation. This conversation has only its configured profile tools; the voice transport is not an additional agent tool. No shared SmolPaws memory or scheduler is added by this App. Only claim operations supported by your actual tools.\n\n${INSIDER_INSTRUCTIONS}\n</INSIDER_CONTROLLER>`,
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                },
                ...creationPolicy(settings),
                // With Projects, the first request waits until the Cat's
                // project exists, so the workers it starts join the project.
                // (The server runs any initial message at once.)
                ...(projectsOff
                  ? { initial_message: { role: "user", content, run: true } }
                  : {}),
              });
              state.controller = info;
              state.newRequested = false;
              createdController = true;
              rememberController();
              controllers = unique([...controllers, info]);
              if (!projectsOff) {
                projectError = await createProjectFor(info.id, text);
                if (!alive) return;
                await request(`${detailPath(info.id)}/events`, "POST", {
                  role: "user",
                  content: requestContent(),
                  run: true,
                });
              }
              // Naming is cosmetic; failure must not turn an accepted message into a retry.
              if (alive)
                void request(detailPath(info.id), "PATCH", {
                  title: t("cat"),
                }).catch(() => {});
            } else {
              const info = await request(detailPath(state.controller.id));
              if (!alive) return;
              if (!isController(info)) {
                state.controllerInvalid = true;
                throw new Error(t("invalidController"));
              }
              state.controller = info;
              rememberController();
              submitted = true;
              await request(
                `${detailPath(state.controller.id)}/events`,
                "POST",
                {
                  role: "user",
                  content,
                  run: true,
                },
              );
            }
            if (state.draft === submittedDraft) state.draft = "";
            state.mutationNotice = projectError
              ? { key: "projectCreateError", params: { message: projectError } }
              : { key: "accepted" };
            if (alive) {
              action("draft").value = state.draft;
              notice(savedMutationNotice());
              renderControllerChoices();
              void refreshController();
              if (createdController)
                navigate(controllerPagePath(state.controller.id));
            }
          } catch (error) {
            state.uncertain = submitted;
            state.mutationNotice = {
              key: "requestError",
              params: { message: errorText(error) },
              uncertain: submitted,
            };
            if (!alive) return;
            notice(
              `${t("requestError", { message: errorText(error) })}${submitted ? `\n${t("uncertain")}` : ""}`,
            );
          } finally {
            state.busy = false;
            syncCurrent?.();
          }
        }
        async function condenseController() {
          const id = state.controller?.id;
          if (!id) {
            notice(t("condenseChoose"));
            return;
          }
          state.busy = true;
          state.mutationNotice = null;
          notice(t("condensing"));
          renderControls();
          try {
            const info = await request(detailPath(id));
            if (!alive || state.controller?.id !== id) return;
            if (!isController(info)) throw new Error(t("invalidController"));
            if (
              ["running", "waiting_for_confirmation"].includes(
                info.execution_status,
              )
            ) {
              state.mutationNotice = { key: "condenseBusy" };
              notice(t("condenseBusy"));
              return;
            }
            voice.end();
            await request(`${detailPath(id)}/condense`, "POST");
            if (state.draft.trim() === CONDENSE_COMMAND) state.draft = "";
            state.mutationNotice = { key: "condensed" };
            if (alive) {
              action("draft").value = state.draft;
              notice(t("condensed"));
              void refreshController();
            }
          } catch (error) {
            state.mutationNotice = {
              key: "condenseError",
              params: { message: errorText(error) },
            };
            if (alive)
              notice(t("condenseError", { message: errorText(error) }));
          } finally {
            state.busy = false;
            syncCurrent?.();
          }
        }
        action("draft").addEventListener("input", () => {
          state.draft = action("draft").value;
          if (state.draft.trim()) voice.noteTypedInput();
        });
        action("draft").addEventListener("keydown", (event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void send();
          }
        });
        action("send").addEventListener("click", send);
        action("refresh").addEventListener("click", () => {
          expirePullRequestStatuses();
          void loadBoard();
          void refreshWorkspaces();
          if (state.controller) void refreshController();
        });
        action("add-file").addEventListener("click", () =>
          action("file-input").click(),
        );
        action("file-input").addEventListener("change", () => {
          const input = action("file-input");
          const [file] = input.files || [];
          input.value = "";
          void addFile(file);
        });
        action("workspace").addEventListener("change", () => {
          state.workspace = action("workspace").value;
        });
        action("open-controller").addEventListener("click", () => {
          if (state.controller) open(state.controller.id);
        });
        action("checked").addEventListener("click", () => {
          state.uncertain = false;
          state.mutationNotice = null;
          state.draft = "";
          action("draft").value = "";
          notice("");
          renderControls();
        });
        action("projects-settings").addEventListener("click", (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          navigate("/settings/experimental");
        });
        action("all-projects").addEventListener("click", () => {
          if (state.busy || state.uncertain) return;
          state.choosingProject = true;
          state.controller = null;
          state.newRequested = false;
          state.requestedControllerId = null;
          state.controllerInvalid = false;
          state.mutationNotice = null;
          ++readGeneration;
          clearTimeout(timer);
          role("history").replaceChildren();
          forgetProject();
          rememberController();
          renderControllerChoices();
          renderBoard();
          navigate(PROJECT_LIST_PAGE_PATH);
          action("controller").focus();
        });
        action("controller").addEventListener("change", () => {
          if (state.busy || state.uncertain) return;
          state.choosingProject = Boolean(!action("controller").value);
          state.controller =
            controllers.find((c) => c.id === action("controller").value) ||
            null;
          state.newRequested = false;
          state.requestedControllerId = null;
          state.uncertain = false;
          state.controllerInvalid = false;
          state.mutationNotice = null;
          ++readGeneration;
          clearTimeout(timer);
          role("history").replaceChildren();
          forgetProject();
          rememberController();
          renderControls();
          renderBoard();
          if (state.controller) {
            void refreshController();
            navigate(controllerPagePath(state.controller.id));
            // The chooser hides with the Cat open; keep focus on the page.
            action("draft").focus();
          }
        });
        // Every project has its own Cat: a new Cat creates its backend
        // project with itself as coordinator. A server with Projects off
        // answers 404, and the Cat works from tags as before.
        async function createProjectFor(controllerId, requestText) {
          try {
            const project = await request("/api/projects", "POST", {
              name: projectNameFrom(requestText),
              description: requestText.slice(0, PROJECT_GOAL_MAX),
              coordinator_conversation_id: controllerId,
            });
            if (alive && project?.id) {
              projectNamesByCat.set(idKey(controllerId), project.name);
              setBoardProject(project);
            }
          } catch (error) {
            if (isNotFound(error)) projectsOff = true;
            else return errorText(error);
          }
          return null;
        }
        function startNewController() {
          if (state.busy || state.uncertain) return;
          state.choosingProject = false;
          state.workspace ||= workspaceOf(state.controller);
          state.controller = null;
          forgetProject();
          state.requestedControllerId = null;
          state.newRequested = true;
          state.uncertain = false;
          state.controllerInvalid = false;
          state.mutationNotice = null;
          ++readGeneration;
          clearTimeout(timer);
          role("history").replaceChildren();
          rememberController();
          renderWorkspaces();
          renderControllerChoices();
          renderBoard();
          navigate(NEW_CONTROLLER_PAGE_PATH);
          action("draft").focus();
        }
        action("new-cat").addEventListener("click", startNewController);
        renderControls();
        renderWorkspaces();
        void loadBoard();
        void refreshWorkspaces();
        const synchronize = () => {
          if (!alive) return;
          action("draft").value = state.draft;
          renderControllerChoices();
          if (state.mutationNotice || state.uncertain)
            notice(savedMutationNotice());
        };
        syncCurrent = synchronize;
        const dispose = () => {
          if (!alive) return;
          alive = false;
          ++readGeneration;
          ++boardGeneration;
          clearTimeout(timer);
          clearTimeout(pullRequestRender);
          clearInterval(boardRefresh);
          stopDictation(true);
          clearTimeout(pullRequestSweep);
          root.remove();
          if (disposeCurrent === dispose) disposeCurrent = null;
          if (syncCurrent === synchronize) syncCurrent = null;
          if (activePageRoot === root) activePageRoot = null;
          syncCompanion?.();
          watchAwayStatus();
        };
        disposeCurrent = dispose;
        return dispose;
      });
    },
    { icon: "cat" },
  );
  return () => {
    disposed = true;
    watchAwayStatus();
    unsubscribeContextChanges?.();
    voice.end();
    voiceAudio.remove();
    unregisterCompanion?.();
    disposeCurrent?.();
    unregister();
  };
}
