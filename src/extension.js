import { mountLocalizedApp } from "../i18n.jsx";
import { createVoiceSession } from "./voice-session.js";
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
const OPENAI_API_KEY_NAME = "OPENAI_API_KEY";
const SECRETS_ROUTE = "/settings/secrets";
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
    mutationNotice: null,
    requestedControllerId:
      typeof savedSelection?.controllerId === "string"
        ? savedSelection.controllerId
        : null,
  };
  let syncCompanion = null;
  const voiceAudio = document.createElement("audio");
  voiceAudio.autoplay = true;
  voiceAudio.hidden = true;
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
  const unregisterCompanion = host.registerCompanion?.({
    id: "voice",
    mount: ({ container, navigate }) =>
      mountLocalizedApp(container, ({ container, t }) => {
        const root = document.createElement("section");
        root.className = "insider-voice";
        root.innerHTML = `<style>.insider-voice{box-sizing:border-box;width:min(360px,calc(100vw - 32px));padding:14px 16px;border:1px solid #53677e;border-radius:16px;background:#182432;color:#edf5ff;box-shadow:0 8px 28px #0005;font:13px/1.5 system-ui,sans-serif}.insider-voice[hidden]{display:none}.insider-voice strong{font-size:14px}.insider-voice p{margin:6px 0}.insider-voice .voice-id{font:10px/1.4 ui-monospace,monospace;overflow-wrap:anywhere;opacity:.75}.insider-voice .voice-actions{display:flex;gap:7px;flex-wrap:wrap}.insider-voice button{font:inherit;color:inherit;background:#253c51;border:1px solid #58738c;border-radius:7px;padding:6px 9px;cursor:pointer}.insider-voice button:disabled{opacity:.5;cursor:default}.insider-voice button:focus-visible{outline:2px solid #96cfff;outline-offset:2px}.insider-voice [hidden]{display:none!important}</style><strong data-role="name"></strong><p data-role="controller-id" class="voice-id"></p><p data-role="status" role="status" aria-live="polite"></p><div class="voice-actions"><button data-action="start"></button><button data-action="mute"></button><button data-action="interrupt"></button><button data-action="end"></button><button data-action="open"></button></div>`;
        const button = (name) => root.querySelector(`[data-action="${name}"]`);
        const provider = document.createElement("p");
        provider.dataset.role = "provider";
        const transcripts = document.createElement("div");
        transcripts.dataset.role = "transcripts";
        transcripts.style.cssText =
          "max-height:100px;overflow:auto;overflow-wrap:anywhere";
        const transcriptNodes = Object.fromEntries(
          ["user", "assistant"].map((role) => {
            const line = document.createElement("p");
            const label = document.createElement("strong");
            label.textContent = `${t(role)}: `;
            const text = document.createElement("span");
            line.append(label, text);
            transcripts.append(line);
            return [role, { line, text }];
          }),
        );
        root.querySelector(".voice-actions").before(provider, transcripts);
        const setup = document.createElement("button");
        setup.dataset.action = "setup";
        setup.textContent = t("voiceSetup");
        setup.onclick = () => navigate(SECRETS_ROUTE);
        root.querySelector(".voice-actions").append(setup);
        button("start").textContent = t("voiceStart");
        button("interrupt").textContent = t("voiceInterrupt");
        button("end").textContent = t("voiceEnd");
        button("open").textContent = t("full");
        button("start").onclick = () => {
          if (state.controller && !state.busy && !state.controllerInvalid)
            void voice.start(state.controller, voiceAudio);
        };
        button("mute").onclick = () =>
          voice.setMuted(!voice.getSnapshot().muted);
        button("interrupt").onclick = () => voice.interrupt();
        button("end").onclick = () => voice.end();
        button("open").onclick = () => {
          const id = voice.getSnapshot().controllerId || state.controller?.id;
          if (id) navigate(`/conversations/${encodeURIComponent(id)}`);
        };
        const sync = () => {
          const current = voice.getSnapshot();
          const connected = !["idle", "error"].includes(current.status);
          provider.textContent =
            current.provider === "codex"
              ? "Codex"
              : current.provider === "openai"
                ? "OpenAI API"
                : "";
          provider.hidden = !provider.textContent;
          for (const [role, nodes] of Object.entries(transcriptNodes)) {
            nodes.text.textContent = current.transcripts?.[role] || "";
            nodes.line.hidden = !nodes.text.textContent;
          }
          transcripts.hidden = !Object.values(current.transcripts || {}).some(
            Boolean,
          );
          root.hidden =
            !state.controller && !connected && current.status !== "error";
          root.querySelector('[data-role="name"]').textContent =
            state.controller?.title || t("cat");
          root.querySelector('[data-role="controller-id"]').textContent =
            current.controllerId || state.controller?.id || "";
          root.querySelector('[data-role="status"]').textContent = current.error
            ? t(current.error, { name: OPENAI_API_KEY_NAME })
            : t(
                current.muted
                  ? "voiceMuted"
                  : {
                      idle: "voiceReady",
                      connecting: "voiceConnecting",
                      listening: "voiceListening",
                      thinking: "voiceThinking",
                      speaking: "voiceSpeaking",
                    }[current.status],
              );
          button("start").hidden = connected;
          setup.hidden = current.error !== "voiceKeyMissing";
          button("start").disabled =
            !state.controller ||
            state.busy ||
            state.uncertain ||
            state.controllerInvalid;
          button("mute").hidden = !connected;
          button("mute").disabled = current.status === "connecting";
          button("mute").textContent = t(
            current.muted ? "voiceUnmute" : "voiceMute",
          );
          button("interrupt").hidden =
            !connected || current.provider === "codex";
          button("end").hidden = !connected;
        };
        root.append(voiceAudio);
        container.append(root);
        syncCompanion = sync;
        sync();
        return () => {
          if (syncCompanion === sync) syncCompanion = null;
          root.remove();
        };
      }),
  });
  const rememberController = () => {
    if (
      voice.getSnapshot().controllerId &&
      voice.getSnapshot().controllerId !== state.controller?.id
    )
      voice.end();
    syncCompanion?.();
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
        root.innerHTML = `<style>
      .insider-app{--cat-bg:var(--oh-surface,#171b22);--cat-line:var(--oh-border,#39414d);--cat-text:var(--oh-foreground,#edf1f6);color:var(--cat-text);max-width:1520px;margin:auto;padding:clamp(18px,3vw,40px);font:15px/1.55 system-ui,sans-serif}
      .insider-app *{box-sizing:border-box}.insider-app h1,.insider-app h2,.insider-app p{margin:0}.insider-app h1{font-size:32px;letter-spacing:-.04em}.insider-app h2{font-size:20px}.insider-app h3{font-size:13px;margin:14px 0 6px}.insider-app .cat-head{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:28px}.insider-app .cat-muted{overflow-wrap:anywhere;opacity:.76;font-size:13px}.insider-app .cat-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(340px,.85fr);gap:26px}.insider-app .cat-stack{min-width:0;display:grid;gap:14px;align-content:start}.insider-app .cat-panel{min-width:0;padding:22px;border:1px solid var(--cat-line);border-radius:16px;background:var(--cat-bg)}
      .insider-app button,.insider-app select,.insider-app input,.insider-app textarea{font:inherit;color:inherit;border:1px solid var(--cat-line);border-radius:8px;background:transparent;padding:9px 12px}.insider-app button{cursor:pointer}.insider-app button:hover{border-color:#76bdf6}.insider-app button:disabled{cursor:default;opacity:.45}.insider-app .cat-primary{background:#96cfff;color:#122331;border-color:#96cfff;font-weight:650}.insider-app button:focus-visible,.insider-app input:focus-visible,.insider-app select:focus-visible,.insider-app textarea:focus-visible{outline:2px solid #96cfff;outline-offset:3px}.insider-app [hidden]{display:none!important}
      .insider-app .cat-controls{display:flex;gap:10px;flex-wrap:wrap}.insider-app .cat-controls input{flex:1;min-width:160px}.insider-app select{width:100%;min-width:0;max-width:100%}.insider-app option{background:var(--cat-bg);color:var(--cat-text)}.insider-app label{min-width:0;display:grid;gap:6px;font-size:13px}.insider-app textarea{width:100%;min-height:128px;resize:vertical}.insider-app .cat-cards{display:grid;gap:10px}.insider-app .cat-card{border:1px solid var(--cat-line);padding:14px;border-radius:12px;display:grid;gap:10px}.insider-app .cat-card.is-selected{border-color:#96cfff;background:#96cfff0c}.insider-app .cat-card-title{font-weight:600;overflow-wrap:anywhere}.insider-app .cat-card-meta{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;opacity:.85}.insider-app .cat-badge{border:1px solid var(--cat-line);border-radius:5px;padding:1px 6px}.insider-app .cat-card[data-status=waiting_for_confirmation] .cat-badge{color:#ffdb85}.insider-app .cat-card[data-status=error] .cat-badge,.insider-app .cat-card[data-status=stuck] .cat-badge{color:#ffaba7}.insider-app .cat-card button{font-size:12px;padding:5px 9px}.insider-app .cat-target{border-left:3px solid #96cfff;padding:10px 12px;background:#96cfff0c;overflow-wrap:anywhere}.insider-app .cat-target code{font-size:12px}.insider-app .cat-notice{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.insider-app .cat-history{max-height:420px;overflow:auto;display:grid;gap:14px}.insider-app .cat-message{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;border-top:1px solid var(--cat-line);padding-top:10px}.insider-app .cat-message strong{display:block;font-size:12px;margin-bottom:5px;color:var(--cat-text)}.insider-app .cat-voice{font-size:12px;opacity:.7;border-top:1px solid var(--cat-line);padding-top:12px}.insider-app .cat-icon{font-size:26px;line-height:1.2;color:#aad5fa}
      @media(max-width:950px){.insider-app .cat-grid{grid-template-columns:1fr}.insider-app .cat-panel{padding:16px}}
    </style>
    <header class="cat-head"><div><h1 data-copy="title"></h1><p data-copy="subtitle" class="cat-muted"></p><p data-role="backend" class="cat-muted"></p></div><button data-action="refresh" data-copy="refresh"></button></header>
    <div class="cat-grid"><div class="cat-stack"><div class="cat-controls"><input data-action="search"><select data-action="project"></select></div><p data-role="coverage" class="cat-muted" role="status"></p><div data-role="cards" class="cat-cards"></div><button data-action="load-more" data-copy="loadMore" hidden></button></div>
    <aside class="cat-panel cat-stack"><div><span class="cat-icon" aria-hidden="true">ฅ^•ﻌ•^ฅ</span><h2 data-copy="cat"></h2><p data-copy="catIntro" class="cat-muted"></p></div>
    <label><span data-copy="controller"></span><select data-action="controller"></select></label><div class="cat-controls"><button data-action="new-cat" data-copy="newCat"></button><button data-action="open-controller" data-copy="full" hidden></button></div>
    <p data-role="cat-status" class="cat-muted" role="status"></p><label data-role="workspace-field"><span data-copy="workspace"></span><select data-action="workspace"></select><span data-copy="workspaceHelp" class="cat-muted"></span></label>
    <div data-role="target" class="cat-target" hidden></div><label><span data-copy="draft"></span><textarea data-action="draft"></textarea></label><div class="cat-controls"><button data-action="send" data-copy="send" class="cat-primary"></button><button data-action="checked" data-copy="checked" hidden></button></div>
    <p data-role="notice" class="cat-notice" role="status" aria-live="polite"></p><h3 data-copy="recent"></h3><div data-role="history" class="cat-history"></div><p data-copy="partialHistory" class="cat-muted"></p><p data-role="voice-help" class="cat-voice"></p></aside></div>`;
        root.querySelectorAll("[data-copy]").forEach((node) => {
          node.textContent = t(node.dataset.copy);
        });
        const action = (name) => root.querySelector(`[data-action="${name}"]`);
        const role = (name) => root.querySelector(`[data-role="${name}"]`);
        role("backend").textContent = t("backend", { id: host.backend.id });
        action("search").placeholder = t("search");
        action("search").ariaLabel = t("search");
        action("project").ariaLabel = t("project");
        action("draft").placeholder = t("placeholder");
        action("draft").value = state.draft;
        role("voice-help").textContent = t(
          host.registerCompanion ? "voiceHelp" : "voiceUnavailable",
        );
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
        const open = (id) =>
          navigate(`/conversations/${encodeURIComponent(id)}`);

        function renderControls() {
          if (!alive) return;
          syncCompanion?.();
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
          role("cat-status").textContent = !discoveryReady
            ? t("searching")
            : state.controller
              ? `${state.controller.id} · ${t(EXECUTION_STATUSES.has(state.controller.execution_status) ? state.controller.execution_status : "unknown")}`
              : t(
                  controllers.length > 1 && !state.newRequested
                    ? "choose"
                    : "newReady",
                );
        }
        function renderControllerChoices() {
          action("controller").replaceChildren(
            option("", t("chooseController")),
            ...controllers.map((c) =>
              option(c.id, `${c.title || t("cat")} · ${c.id}`),
            ),
          );
          action("controller").value = state.controller?.id || "";
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
            ...paths.map((path) => option(path, path)),
          );
          action("workspace").value = state.workspace;
        }
        function renderTarget() {
          const node = role("target");
          node.replaceChildren();
          node.hidden = !state.selected;
          if (!state.selected) return;
          const label = document.createElement("strong");
          label.textContent = t("selected");
          const title = document.createElement("div");
          title.textContent = state.selected.title || state.selected.id;
          const id = document.createElement("code");
          id.textContent = state.selected.id;
          const clear = document.createElement("button");
          clear.textContent = t("clear");
          clear.addEventListener("click", () => {
            state.selected = null;
            renderTarget();
            renderBoard();
          });
          node.append(label, title, id, document.createElement("br"), clear);
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
            project.textContent = workspaceOf(c) || t("noWorkspace");
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
              (path) => option(path, path),
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
              `${t("loaded", { count: board.length })} · ${cursor ? "" : `${t("complete")} · `}${t("refreshed", { time: new Date().toLocaleTimeString() })}`;
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
            state.controller = info;
            const history = role("history");
            history.replaceChildren();
            for (const event of [...(events.items || [])].reverse()) {
              const message = messageText(event);
              if (!message) continue;
              const row = document.createElement("div");
              row.className = "cat-message";
              const label = document.createElement("strong");
              label.textContent = t(
                message.role === "user" ? "user" : "assistant",
              );
              row.append(label, document.createTextNode(message.text));
              history.append(row);
            }
            if (!history.childElementCount)
              history.textContent = t("noMessages");
            if (noticeKind === "controller-read-error")
              notice(savedMutationNotice());
            renderControls();
          } catch (error) {
            if (alive && generation === readGeneration)
              notice(
                t("catError", { message: errorText(error) }),
                "controller-read-error",
              );
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
          if (voice.getSnapshot().status === "thinking") {
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
        };
        disposeCurrent = dispose;
        return dispose;
      });
    },
    { icon: "cat" },
  );
  return () => {
    unsubscribeContextChanges?.();
    voice.end();
    unregisterCompanion?.();
    disposeCurrent?.();
    unregister();
  };
}
