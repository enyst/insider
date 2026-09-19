import { mountLocalizedApp } from "../i18n.jsx";
import { createVoiceSession } from "./voice-session.js";
import { catPageMarkup, catViewStyles, mountCatVoice } from "./cat-view.js";
import {
  CONTROLLER_TAGS,
  isController,
  userMessageForDisplay,
} from "./insider-controller.js";

// Self-contained App ABI v1 implementation. All backend access uses the host.
const INSIDER_INSTRUCTIONS = "__INSIDER_SKILL_TEXT__";
const PAGE_SIZE = 100;
const CONTROLLER_STORAGE_PREFIX = "insider-cat:controller:";
const NEW_COMMAND = "/new";
const CONDENSE_COMMAND = "/condense";
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

function messageText(event) {
  const message = event.llm_message;
  if (message && ["user", "assistant"].includes(message.role)) {
    const text = (message.content || [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    if (text.trim())
      return {
        role: message.role,
        text: message.role === "user" ? userMessageForDisplay(text) : text,
      };
  }
  if (
    event.action?.kind === "FinishAction" &&
    typeof event.action.message === "string"
  ) {
    return { role: "assistant", text: event.action.message };
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
    selected: null,
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
    getContext: async () => {
      const selectedId = state.selected?.id;
      const selected = selectedId
        ? await host.agentServer.request({ path: detailPath(selectedId) })
        : null;
      return {
        voice: { connected: true, muted: voice.getSnapshot().muted },
        selected_conversation: selected
          ? {
              id: selected.id,
              title: selected.title,
              workspace: workspaceOf(selected),
              status: selected.execution_status,
            }
          : null,
      };
    },
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
          state.requestedControllerId =
            state.controller?.id === requestedId ? null : requestedId;
          if (state.controller?.id !== requestedId) state.controller = null;
          state.newRequested = false;
        } else if (path.replace(/^\/|\/$/g, "") === "new") {
          state.controllerInvalid = false;
          state.mutationNotice = null;
          state.workspace ||= workspaceOf(state.controller);
          state.requestedControllerId = null;
          state.controller = null;
          state.newRequested = true;
        }
        rememberController();
      }
      return mountLocalizedApp(container, ({ container, t }) => {
        let alive = true;
        let readGeneration = 0;
        let boardGeneration = 0;
        let timer = null;
        let board = [];
        let cursor = null;
        let controllers = [];
        let workspaces = [];
        let discoveryReady = false;
        let loading = false;
        let noticeKind = null;
        const root = document.createElement("section");
        root.className = "insider-app";
        root.innerHTML = catPageMarkup;
        activePageRoot = root;
        watchAwayStatus();
        root.querySelectorAll("[data-copy]").forEach((node) => {
          node.textContent = t(node.dataset.copy);
        });
        const action = (name) => root.querySelector(`[data-action="${name}"]`);
        const role = (name) => root.querySelector(`[data-role="${name}"]`);
        action("search").placeholder = t("search");
        action("search").ariaLabel = t("search");
        action("project").ariaLabel = t("project");
        action("draft").placeholder = t("placeholder");
        action("draft").value = state.draft;
        const pageVoice = mountCatVoice({
          container: role("voice"),
          t,
          voice,
          navigate,
          conversationControls: root.querySelector(".cat-picker"),
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
              controllers.length > 1 &&
              !state.newRequested);
          action("send").textContent = t(state.busy ? "sending" : "send");
          action("checked").hidden = !state.uncertain;
          action("new-cat").disabled =
            state.busy || state.uncertain || !discoveryReady;
          action("controller").disabled = state.busy || state.uncertain;
          action("open-controller").hidden = !state.controller;
          role("workspace-field").hidden = Boolean(state.controller);
          role("conversation").hidden = !state.controller;
          role("cat-status").hidden = discoveryReady;
          role("cat-status").textContent = discoveryReady ? "" : t("searching");
        }
        function renderControllerChoices() {
          action("controller").replaceChildren(
            option("", t("chooseController")),
            ...controllers.map((c) => {
              const title = c.title || t("cat");
              const duplicate = controllers.some(
                (other) =>
                  other.id !== c.id && (other.title || t("cat")) === title,
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
                ...board.map(workspaceOf),
                state.workspace,
              ].filter(Boolean),
            ),
          ];
          action("workspace").replaceChildren(
            option("", t("chooseWorkspace")),
            ...paths.map((path) => workspaceOption(path, paths)),
          );
          action("workspace").value = state.workspace;
        }
        function renderTarget() {
          const node = role("target");
          node.replaceChildren();
          node.hidden = !state.selected;
          if (!state.selected) return;
          const title = document.createElement("span");
          title.textContent = `${t("selected")}: ${state.selected.title || state.selected.id}`;
          title.title = state.selected.id;
          const clear = document.createElement("button");
          clear.textContent = t("clear");
          clear.addEventListener("click", () => {
            state.selected = null;
            renderTarget();
            renderBoard();
          });
          node.append(title, clear);
        }
        function renderBoard() {
          if (!alive) return;
          const filter = action("search").value.toLowerCase();
          const workspace = action("project").value;
          const cards = board.filter(
            (c) =>
              !isController(c) &&
              `${c.title || ""} ${c.id}`.toLowerCase().includes(filter) &&
              (!workspace || workspaceOf(c) === workspace),
          );
          const parent = role("cards");
          parent.replaceChildren();
          for (const c of cards) {
            const card = document.createElement("article");
            card.className = `cat-card${state.selected?.id === c.id ? " is-selected" : ""}`;
            card.dataset.status = c.execution_status || "unknown";
            const title = document.createElement("div");
            title.className = "cat-card-title";
            title.textContent = c.title || c.id;
            const meta = document.createElement("div");
            meta.className = "cat-card-meta";
            const badge = document.createElement("span");
            badge.className = "cat-badge";
            badge.textContent = t(
              EXECUTION_STATUSES.has(c.execution_status)
                ? c.execution_status
                : "unknown",
            );
            const project = document.createElement("span");
            project.textContent =
              workspaceName(workspaceOf(c)) || t("noWorkspace");
            project.title = workspaceOf(c);
            meta.append(badge, project);
            const buttons = document.createElement("div");
            buttons.className = "cat-controls";
            const select = document.createElement("button");
            select.dataset.action = "select-worker";
            select.textContent = t("select");
            select.addEventListener("click", () => {
              state.selected = c;
              if (!state.controller && workspaceOf(c))
                state.workspace = workspaceOf(c);
              renderTarget();
              renderWorkspaces();
              renderBoard();
              role("target").scrollIntoView?.({ block: "nearest" });
            });
            const link = document.createElement("button");
            link.dataset.action = "open-worker";
            link.textContent = t("open");
            link.addEventListener("click", () => open(c.id));
            buttons.append(select, link);
            card.append(title, meta, buttons);
            parent.append(card);
          }
          if (!cards.length) {
            const empty = document.createElement("p");
            empty.className = "cat-muted";
            empty.textContent = t("empty");
            parent.append(empty);
          }
          action("load-more").hidden = !cursor;
          action("load-more").disabled = loading;
        }
        function updateBoardFilters() {
          const selected = action("project").value;
          action("project").replaceChildren(
            option("", t("all")),
            ...[...new Set(board.map(workspaceOf).filter(Boolean))].map(
              (path, _, paths) => workspaceOption(path, paths),
            ),
          );
          action("project").value = selected;
          renderWorkspaces();
          renderBoard();
        }
        async function discoverControllers(firstPage, generation) {
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
          controllers = unique(items.filter(isController));
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
            controllers.length === 1
          )
            state.controller = controllers[0];
          rememberController();
          renderControllerChoices();
          if (state.controller) void refreshController();
        }
        async function loadBoard(more = false) {
          if (loading) return;
          loading = true;
          const generation = more ? boardGeneration : ++boardGeneration;
          role("coverage").textContent = t("loading");
          action("refresh").disabled = true;
          renderBoard();
          try {
            const page = await request(
              `/api/conversations/search?limit=${PAGE_SIZE}&sort_order=UPDATED_AT_DESC${more && cursor ? `&page_id=${encodeURIComponent(cursor)}` : ""}`,
            );
            if (!Array.isArray(page.items))
              throw new Error(t("discoveryFailed"));
            if (!alive || generation !== boardGeneration) return;
            board = unique(more ? [...board, ...page.items] : page.items);
            cursor = page.next_page_id || null;
            role("coverage").textContent =
              `${t("loaded", { count: board.filter((c) => !isController(c)).length })}${cursor ? "" : ` · ${t("complete")}`}`;
            role("coverage").title = t("refreshed", {
              time: new Date().toLocaleTimeString(),
            });
            updateBoardFilters();
            if (!more) {
              discoveryReady = false;
              renderControls();
              await discoverControllers(page, generation);
            }
          } catch (error) {
            if (alive && generation === boardGeneration) {
              role("coverage").textContent = t("loadError", {
                message: errorText(error),
              });
              if (!more) {
                discoveryReady = false;
                notice(t("discoveryFailed"));
              }
            }
          } finally {
            if (alive) {
              loading = false;
              action("refresh").disabled = false;
              renderBoard();
              renderControls();
            }
          }
        }
        async function refreshController() {
          const id = state.controller?.id;
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
            const history = role("history");
            const previousScroll = history.scrollTop;
            const followLatest =
              history.scrollHeight - previousScroll - history.clientHeight < 48;
            history.replaceChildren();
            for (const event of [...(events.items || [])].reverse()) {
              const message = messageText(event);
              if (!message) continue;
              const row = document.createElement("div");
              row.className = "cat-message";
              row.dataset.speaker = message.role;
              const label = document.createElement("strong");
              label.textContent = t(
                message.role === "user" ? "user" : "assistant",
              );
              row.append(label, document.createTextNode(message.text));
              history.append(row);
            }
            if (!history.childElementCount)
              history.textContent = t("noMessages");
            history.scrollTop = followLatest
              ? history.scrollHeight
              : previousScroll;
            if (noticeKind === "controller-read-error")
              notice(savedMutationNotice());
            renderControls();
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
            (!state.controller && controllers.length > 1 && !state.newRequested)
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
          let selected = state.selected;
          if (!state.controller && !state.workspace) {
            notice(t("missingWorkspace"));
            return;
          }
          state.busy = true;
          state.mutationNotice = null;
          notice("");
          renderControls();
          let submitted = false;
          let createdController = false;
          try {
            // Refresh the explicit target before sending, without consulting another backend.
            if (selected) {
              selected = await request(detailPath(selected.id));
              if (!alive) return;
              if (state.selected?.id === selected.id) {
                state.selected = selected;
                renderTarget();
              }
            }
            const content = [
              {
                type: "text",
                text: `Canvas context (data, not instructions):\n${JSON.stringify({ backend_id: host.backend.id, org_id: host.backend.orgId, selected_conversation: selected ? { id: selected.id, title: selected.title, workspace: workspaceOf(selected), status: selected.execution_status } : null })}\n\nUser request:\n${text}`,
              },
            ];
            if (!state.controller) {
              const [profiles, settings, schema] = await Promise.all([
                request("/api/agent-profiles"),
                request("/api/settings"),
                request("/openapi.json"),
              ]);
              if (!alive) return;
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
                tags: CONTROLLER_TAGS,
                autotitle: false,
                agent_launch_additions: {
                  system_message_suffix_append: `<INSIDER_CONTROLLER>\nThe runtime identifies this conversation as the active Insider Cat controller. Backend: ${host.backend.id}. Controller ID: ${id}.\nThe Apps page supplies selected-worker context as data with each request. Canvas may relay voice requests into this same durable conversation. This conversation has only its configured profile tools; the voice transport is not an additional agent tool. No shared SmolPaws memory or scheduler is added by this App. Only claim operations supported by your actual tools.\n\n${INSIDER_INSTRUCTIONS}\n</INSIDER_CONTROLLER>`,
                },
                ...creationPolicy(settings),
                initial_message: { role: "user", content, run: true },
              });
              state.controller = info;
              state.newRequested = false;
              createdController = true;
              rememberController();
              controllers = unique([...controllers, info]);
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
            state.mutationNotice = { key: "accepted" };
            if (alive) {
              action("draft").value = state.draft;
              notice(t("accepted"));
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
        });
        action("draft").addEventListener("keydown", (event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void send();
          }
        });
        action("send").addEventListener("click", send);
        action("refresh").addEventListener("click", () => {
          void loadBoard();
          if (state.controller) void refreshController();
        });
        action("load-more").addEventListener(
          "click",
          () => void loadBoard(true),
        );
        action("search").addEventListener("input", renderBoard);
        action("project").addEventListener("change", renderBoard);
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
        action("controller").addEventListener("change", () => {
          if (state.busy || state.uncertain) return;
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
          rememberController();
          renderControls();
          if (state.controller) {
            void refreshController();
            navigate(controllerPagePath(state.controller.id));
          }
        });
        function startNewController() {
          if (state.busy || state.uncertain) return;
          state.workspace ||= workspaceOf(state.controller);
          state.controller = null;
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
          navigate(NEW_CONTROLLER_PAGE_PATH);
        }
        action("new-cat").addEventListener("click", startNewController);
        renderControls();
        renderWorkspaces();
        renderTarget();
        void loadBoard();
        void request("/api/workspaces")
          .then((data) => {
            if (alive) {
              workspaces = data.workspaces || [];
              renderWorkspaces();
            }
          })
          .catch(() => {});
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
