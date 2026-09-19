import { catAvatarMarkup, catAvatarStyles, catPose } from "./cat-avatar.js";

// The page and the travelling companion are two views of one Voice session.
// Neither view owns the audio element, microphone, or peer connection.
export function mountCatVoice({
  container,
  t,
  voice,
  getState,
  start,
  canStart,
  navigate,
  compact = false,
  conversationControls = null,
}) {
  const root = document.createElement("section");
  root.className = `cat-voice-view${compact ? " cat-voice-compact" : ""}`;
  root.innerHTML = `<style>${catAvatarStyles}</style>
    <div class="cat-presence">
      <div class="insider-cat-avatar" data-pose="sleeping">${catAvatarMarkup()}</div>
      <div class="cat-presence-copy"><${compact ? "strong" : "h1"} data-role="name"></${compact ? "strong" : "h1"}><p data-role="voice-status" role="status" aria-live="polite"></p></div>
    </div>
    <div class="cat-voice-actions"><button data-action="${compact ? "start" : "voice-start"}" class="cat-talk"></button><button data-action="mute"></button><button data-action="interrupt"></button><button data-action="end"></button><button data-action="setup" hidden></button>${compact ? '<button data-action="open"></button>' : ""}</div>
    <p data-role="voice-help" class="cat-muted" hidden></p>
    <details data-role="transcripts" class="cat-transcripts" hidden><summary></summary><div data-role="transcript-lines"></div></details>`;
  const action = (name) => root.querySelector(`[data-action="${name}"]`);
  const role = (name) => root.querySelector(`[data-role="${name}"]`);
  if (conversationControls)
    root.querySelector(".cat-voice-actions").before(conversationControls);
  const startButton = action(compact ? "start" : "voice-start");
  startButton.textContent = t("voiceStart");
  startButton.onclick = start;
  action("mute").onclick = () => voice.setMuted(!voice.getSnapshot().muted);
  action("interrupt").textContent = t("voiceInterrupt");
  action("interrupt").onclick = () => voice.interrupt();
  action("end").textContent = t("voiceEnd");
  action("end").onclick = () => voice.end();
  action("setup").textContent = t("voiceSetup");
  action("setup").onclick = () => navigate("/settings/secrets");
  if (compact) {
    action("open").textContent = t("full");
    action("open").onclick = () => {
      const id = voice.getSnapshot().controllerId || getState().controller?.id;
      if (id) navigate(`/conversations/${encodeURIComponent(id)}`);
    };
  }
  root.querySelector("summary").textContent = t("liveTranscript");
  const transcriptNodes = Object.fromEntries(
    ["user", "assistant"].map((speaker) => {
      const line = document.createElement("p");
      const label = document.createElement("strong");
      label.textContent = `${t(speaker)}: `;
      const text = document.createElement("span");
      line.append(label, text);
      role("transcript-lines").append(line);
      return [speaker, { line, text }];
    }),
  );
  const sync = () => {
    const state = getState();
    const current = voice.getSnapshot();
    const connected = !["idle", "error"].includes(current.status);
    const pose =
      state.controllerInvalid || state.controllerStatusUnknown
        ? "attention"
        : catPose({
            voice: current,
            controller: state.controller,
            busy: state.busy,
          });
    root.querySelector(".insider-cat-avatar").dataset.pose = pose;
    role("name").textContent = compact
      ? state.controller?.title || t("cat")
      : t("cat");
    role("name").title = state.controller?.title || t("cat");
    // Always surface a real error/approval before a decorative resting state.
    const execution = state.controller?.execution_status;
    const needsAttention = [
      "paused",
      "waiting_for_confirmation",
      "error",
      "stuck",
      "deleting",
    ].includes(execution);
    const status = current.error
      ? t(current.error, { name: "OPENAI_API_KEY" })
      : state.controllerInvalid
        ? t("invalidController")
        : state.controllerStatusUnknown
          ? t("unknown")
          : needsAttention
            ? t(execution)
            : pose === "working"
              ? t("voiceThinking")
              : pose === "speaking"
                ? t("voiceSpeaking")
                : current.muted && connected
                  ? t("voiceMuted")
                  : t(
                      {
                        idle: "resting",
                        error: "error",
                        connecting: "voiceConnecting",
                        listening: "voiceListening",
                        thinking: "voiceThinking",
                        speaking: "voiceSpeaking",
                      }[current.status] || "resting",
                    );
    role("voice-status").textContent = status;
    root.dataset.attention = String(pose === "attention");
    startButton.hidden = connected;
    startButton.disabled = !canStart();
    action("mute").hidden = !connected;
    action("mute").disabled = current.status === "connecting";
    action("mute").textContent = t(current.muted ? "voiceUnmute" : "voiceMute");
    action("mute").setAttribute("aria-pressed", String(Boolean(current.muted)));
    action("interrupt").hidden = !connected || current.provider === "codex";
    action("end").hidden = !connected;
    action("setup").hidden = current.error !== "voiceKeyMissing";
    if (compact)
      action("open").disabled = !(current.controllerId || state.controller?.id);
    const help = role("voice-help");
    help.hidden =
      compact ||
      connected ||
      (Boolean(state.controller) && state.voiceSupported);
    help.textContent = t(
      state.voiceSupported ? "voiceChoose" : "voiceUnavailable",
      { newCat: t("newCat") },
    );
    for (const [speaker, nodes] of Object.entries(transcriptNodes)) {
      nodes.text.textContent = current.transcripts?.[speaker] || "";
      nodes.line.hidden = !nodes.text.textContent;
    }
    role("transcripts").hidden = !Object.values(current.transcripts || {}).some(
      Boolean,
    );
  };
  container.append(root);
  sync();
  return { root, sync };
}

export const catViewStyles = `
.insider-app,.insider-voice{--cat-bg:var(--oh-surface,#20211f);--cat-line:var(--oh-border,#42443f);--cat-text:var(--oh-foreground,#efeee7);--cat-muted:#b4b7ae;--cat-accent:#cad7b4;--cat-ink:#252e20;color:var(--cat-text);font:14px/1.5 system-ui,sans-serif;color-scheme:dark}
.insider-app *,.insider-voice *{box-sizing:border-box}
.insider-app{width:100%;max-width:1240px;margin-inline:auto;padding:clamp(16px,3vw,36px)}
.insider-app h1,.insider-app h2,.insider-app p,.insider-voice p{margin:0}
.insider-app h1{font-size:clamp(24px,3vw,30px);font-weight:580;letter-spacing:-.035em}
.insider-app h2{font-size:18px;letter-spacing:-.015em;font-weight:600}
.insider-app h3{font-size:12px;font-weight:500;margin:0;color:var(--cat-muted)}
.insider-app .cat-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-block-end:24px}
.insider-app .cat-head>p{font-size:14px;font-weight:500;color:var(--cat-muted)}
.insider-app .cat-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,1fr);gap:clamp(24px,4vw,48px);align-items:start}
.insider-app .cat-panel{min-width:0;padding:clamp(18px,2.5vw,28px);border:1px solid var(--cat-line);border-radius:22px;background:var(--cat-bg)}
.insider-app .cat-stack{min-width:0;display:grid;gap:18px;align-content:start}
.insider-app .cat-muted,.insider-voice .cat-muted{font-size:12px;color:var(--cat-muted);overflow-wrap:anywhere}
.insider-app button,.insider-app select,.insider-app input,.insider-app textarea,.insider-voice button{font:inherit;color:inherit;border:1px solid var(--cat-line);border-radius:10px;background:transparent;min-height:44px;padding:9px 12px}
.insider-app button,.insider-voice button{cursor:pointer;touch-action:manipulation}
.insider-app button:hover,.insider-voice button:hover{border-color:var(--cat-accent);background:#cad7b40a}
.insider-app button:disabled,.insider-voice button:disabled{cursor:default;opacity:.45}
.insider-app .cat-primary,.insider-app .cat-talk,.insider-voice .cat-talk{background:var(--cat-accent);color:var(--cat-ink);border-color:var(--cat-accent);font-weight:650}
.insider-app :is(button,input,select,textarea,summary):focus-visible,.insider-voice :is(button,summary):focus-visible{outline:2px solid var(--cat-accent);outline-offset:3px}
.insider-app [hidden],.insider-voice[hidden],.insider-voice [hidden]{display:none!important}
.insider-app .cat-controls,.cat-voice-view .cat-voice-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.insider-app select,.insider-app input{width:100%;min-width:0;max-width:100%;text-overflow:ellipsis}
.insider-app :is(input,select,textarea){font-size:16px}
.insider-app option{background:var(--cat-bg);color:var(--cat-text)}
.insider-app label{min-width:0;display:grid;gap:6px;font-size:12px;color:var(--cat-muted)}
.insider-app label :is(select,textarea){color:var(--cat-text)}
.insider-app .cat-picker{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
.insider-app .cat-picker label{display:block}
.insider-app .cat-voice-view{display:grid;gap:16px}
.cat-voice-view .cat-presence{display:flex;align-items:center;gap:18px;min-width:0}
.cat-voice-view .insider-cat-avatar{width:132px;flex:0 0 132px}
.cat-voice-view .cat-presence-copy{min-width:0}
.cat-voice-view [data-role=voice-status]{font-size:13px;color:var(--cat-muted);margin-block-start:4px;overflow-wrap:anywhere}
.cat-voice-view[data-attention=true] [data-role=voice-status]{color:#f0c697}
.cat-voice-view .cat-transcripts{font-size:12px;overflow-wrap:anywhere;color:var(--cat-muted)}
.cat-voice-view .cat-transcripts summary{cursor:pointer;min-height:32px;align-content:center}
.cat-voice-view [data-role=transcript-lines]{max-height:140px;overflow:auto;padding-block:8px;display:grid;gap:8px}
.insider-app .cat-conversation{display:grid;gap:10px}
.insider-app .cat-history-head{display:flex;align-items:center;justify-content:space-between;gap:8px;border-block-start:1px solid var(--cat-line);padding-block-start:16px}
.insider-app .cat-history-head button{border:0;padding-inline:0;color:var(--cat-accent);font-size:12px}
.insider-app .cat-history{max-height:340px;overflow:auto;display:grid;gap:16px;overscroll-behavior:contain;scrollbar-width:thin}
.insider-app .cat-history:empty{display:none}
.insider-app .cat-message{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;padding-inline-end:8px}
.insider-app .cat-message strong{display:block;font-size:11px;font-weight:600;margin-block-end:5px;color:var(--cat-muted)}
.insider-app .cat-message[data-speaker=user]{margin-inline-start:28px;border-radius:12px;background:#ffffff07;padding:12px}
.insider-app .cat-composer{display:grid;gap:8px;border:1px solid var(--cat-line);border-radius:14px;padding:10px}
.insider-app .cat-composer:focus-within{border-color:var(--cat-accent)}
.insider-app textarea{width:100%;min-height:84px;max-height:260px;resize:vertical;border:0;padding:6px;background:transparent}
.insider-app textarea:focus-visible{outline:0}
.insider-app .cat-composer .cat-controls{justify-content:flex-end}
.insider-app .cat-work-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.insider-app .cat-work-head button{font-size:12px;border:0;color:var(--cat-muted)}
.insider-app .cat-filters{display:grid;gap:8px}
.insider-app .cat-cards{display:grid}
.insider-app .cat-card{padding:16px 0;border-block-start:1px solid var(--cat-line);display:grid;gap:9px;min-width:0}
.insider-app .cat-card.is-selected{border-inline-start:2px solid var(--cat-accent);padding-inline-start:12px}
.insider-app .cat-card-title{font-weight:550;overflow-wrap:anywhere}
.insider-app .cat-card-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--cat-muted)}
.insider-app .cat-card-meta>span:last-child{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.insider-app .cat-badge::before{content:"";display:inline-block;width:5px;height:5px;margin-inline-end:6px;border-radius:50%;background:currentColor;vertical-align:middle}
.insider-app .cat-card[data-status=waiting_for_confirmation] .cat-badge{color:#f0c697}
.insider-app .cat-card:is([data-status=error],[data-status=stuck]) .cat-badge{color:#f4aaa0}
.insider-app .cat-card[data-status=running] .cat-badge{color:var(--cat-accent)}
.insider-app .cat-card button{font-size:12px;min-height:40px;padding:7px 10px}
.insider-app .cat-target{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#cad7b40a;border-radius:10px;border-inline-start:2px solid var(--cat-accent);font-size:12px;min-width:0}
.insider-app .cat-target>span{min-width:0;overflow-wrap:anywhere;flex:1}
.insider-app .cat-target button{font-size:12px;flex-shrink:0}
.insider-app .cat-notice{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.insider-app .cat-notice:empty{display:none}
.insider-app .cat-sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.insider-voice{box-sizing:border-box;width:min(540px,calc(100vw - 32px));max-width:calc(100% - 32px);margin:8px 16px 12px;padding:10px 14px;border:1px solid var(--cat-line);border-radius:16px;background:var(--cat-bg)}
.insider-voice .cat-voice-compact{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.insider-voice .cat-presence{flex:1 1 160px;min-width:0}
.insider-voice .cat-voice-actions{flex:0 1 auto}
.insider-voice .cat-presence{gap:10px}
.insider-voice .insider-cat-avatar{width:52px;flex-basis:52px}
.insider-voice [data-role=name]{display:block;max-width:100%;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.insider-voice [data-role=voice-status]{font-size:12px}
.insider-voice button{font-size:12px;padding:7px 10px}
.insider-voice .cat-transcripts{flex:1 1 100%;min-width:0}
@media(max-width:900px){.insider-app .cat-grid{grid-template-columns:1fr}.insider-app{max-width:680px}.insider-app .cat-work{margin-block-start:8px}}
@media(max-width:480px){.insider-app .cat-presence{gap:12px}.insider-app .insider-cat-avatar{width:96px;flex-basis:96px}.insider-app .cat-picker{grid-template-columns:minmax(0,1fr) auto}.insider-app .cat-picker button{padding-inline:9px}.insider-voice .cat-voice-actions{flex-basis:100%}}
@media(prefers-reduced-motion:reduce){.insider-app *,.insider-voice *{scroll-behavior:auto!important}}
`;

export const catPageMarkup = `<style>${catViewStyles}</style>
  <header class="cat-head"><p data-copy="title"></p></header>
  <div class="cat-grid">
    <section class="cat-panel cat-stack">
      <div data-role="voice"></div>
      <div class="cat-picker"><label><span data-copy="controller" class="cat-sr-only"></span><select data-action="controller"></select></label><button data-action="new-cat" data-copy="newCat"></button></div>
      <p data-role="cat-status" class="cat-muted" role="status"></p>
      <label data-role="workspace-field"><span data-copy="workspace"></span><select data-action="workspace"></select></label>
      <div class="cat-conversation" data-role="conversation">
        <div class="cat-history-head"><h3 data-copy="recent"></h3><button data-action="open-controller" data-copy="full" hidden></button></div>
        <div data-role="history" class="cat-history"></div>
      </div>
      <div data-role="target" class="cat-target" hidden></div>
      <div class="cat-composer"><label><span data-copy="draft" class="cat-sr-only"></span><textarea data-action="draft"></textarea></label><div class="cat-controls"><button data-action="send" data-copy="send" class="cat-primary"></button></div></div>
      <p data-role="notice" class="cat-notice" role="status" aria-live="polite"></p><button data-action="checked" data-copy="checked" hidden></button>
    </section>
    <section class="cat-stack cat-work">
      <div class="cat-work-head"><h2 data-copy="workTitle"></h2><button data-action="refresh" data-copy="refresh"></button></div>
      <div class="cat-filters"><input data-action="search" type="search"><select data-action="project"></select></div>
      <p data-role="coverage" class="cat-muted" role="status"></p><div data-role="cards" class="cat-cards"></div><button data-action="load-more" data-copy="loadMore" hidden></button>
    </section>
  </div>`;
