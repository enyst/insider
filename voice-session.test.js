import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceSession } from "./src/voice-session.js";

const controller = {
  id: "controller-a",
  tags: { smolpaws: "insider", insiderrole: "controller" },
  execution_status: "idle",
};
let sessions;
let peers;
let microphone;
let track;
let media;

beforeEach(() => {
  vi.useFakeTimers();
  sessions = [];
  peers = [];
  track = { enabled: true, stop: vi.fn() };
  media = { getTracks: () => [track], getAudioTracks: () => [track] };
  microphone = vi.fn().mockResolvedValue(media);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: microphone } });
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      constructor() {
        this.channel = { readyState: "open", send: vi.fn(), close: vi.fn() };
        this.createDataChannel = vi.fn(() => this.channel);
        this.close = vi.fn();
        this.addTrack = vi.fn();
        this.setRemoteDescription = vi.fn().mockResolvedValue(undefined);
        peers.push(this);
      }
      createOffer() {
        return Promise.resolve({ type: "offer", sdp: "test-offer" });
      }
      setLocalDescription() {
        return Promise.resolve();
      }
    },
  );
});
afterEach(() => {
  sessions.forEach((session) => session.end());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(overrides = {}) {
  let executionStatus = "idle";
  let events = [
    {
      id: "old-answer",
      action: { kind: "FinishAction", message: "An old answer" },
    },
  ];
  const request = vi.fn(async (call) => {
    const overridden = await overrides.request?.(call);
    if (overridden !== undefined) return overridden;
    if (call.path.endsWith("/voice"))
      return {
        available: true,
        run_active: false,
        execution_status: executionStatus,
      };
    if (call.path.endsWith("/voice/realtime"))
      return {
        sdp: "test-answer",
        call_id: "rtc_call_a",
        model: "gpt-realtime-2.1",
      };
    if (call.method === "DELETE") return { success: true };
    if (call.path.includes("/events/search")) return { items: [...events] };
    if (call.path.endsWith("/events")) {
      executionStatus = "running";
      return { success: true };
    }
    return { ...controller, execution_status: executionStatus };
  });
  const audio = {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    srcObject: null,
  };
  const session = createVoiceSession({
    host: {
      backend: { id: "backend-a", orgId: null },
      agentServer: { request },
    },
    getContext: () => ({ selected_conversation: { id: "worker-b" } }),
    canSubmit: overrides.canSubmit,
  });
  sessions.push(session);
  const start = async () => {
    await session.start(controller, audio);
    peers.at(-1)?.channel.onopen?.();
    if (peers.at(-1)) {
      peers.at(-1).connectionState = "connected";
      peers.at(-1).onconnectionstatechange?.();
    }
  };
  const emit = (event) =>
    peers.at(-1).channel.onmessage({ data: JSON.stringify(event) });
  const sent = () =>
    peers.at(-1).channel.send.mock.calls.map(([data]) => JSON.parse(data));
  return {
    session,
    request,
    start,
    audio,
    emit,
    sent,
    setEvents: (next) => {
      events = next;
    },
    setStatus: (next) => {
      executionStatus = next;
    },
  };
}
const toolEvent = {
  type: "response.function_call_arguments.done",
  name: "send_to_insider",
  call_id: "tool-call-a",
  arguments: JSON.stringify({ request: "Explain the current state." }),
};

describe("Insider voice lifecycle", () => {
  it("preserves OpenAI calls whose SDP response has no remote call ID", async () => {
    const app = setup({
      request: (call) =>
        call.path.endsWith("/voice/realtime")
          ? { sdp: "test-answer", call_id: null }
          : undefined,
    });
    await app.start();
    expect(app.session.getSnapshot()).toMatchObject({
      status: "listening",
      provider: "openai",
    });
    expect(peers[0].setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "test-answer",
    });
    app.session.end();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(
      app.request.mock.calls.some(([call]) => call.method === "DELETE"),
    ).toBe(false);
  });

  it("shows only the latest spoken user and assistant text without submitting transcripts", async () => {
    const app = setup();
    await app.start();
    app.emit({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "What changed?",
    });
    app.emit({
      type: "response.output_audio_transcript.done",
      transcript: "I will ask your Cat.",
    });
    app.emit({
      type: "response.output_audio_transcript.done",
      transcript: "The Cat has saved the answer.",
    });
    expect(app.session.getSnapshot().transcripts).toEqual({
      user: "What changed?",
      assistant: "The Cat has saved the answer.",
    });
    expect(
      app.request.mock.calls.some(
        ([call]) => call.path.endsWith("/events") && call.method === "POST",
      ),
    ).toBe(false);
    app.session.end();
    expect(app.session.getSnapshot().transcripts).toEqual({});
  });

  it("honors an explicit end-call tool without cancelling saved work", async () => {
    const app = setup();
    await app.start();
    app.emit({
      type: "response.function_call_arguments.done",
      name: "end_voice_call",
      call_id: "end-tool",
      arguments: "{}",
    });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(app.session.getSnapshot().status).toBe("idle");
    expect(app.request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/conversations/controller-a/voice/realtime/rtc_call_a",
    });
    expect(
      app.request.mock.calls.some(
        ([call]) => call.path.endsWith("/events") && call.method === "POST",
      ),
    ).toBe(false);
  });

  it("preserves an in-flight typed submission when a spoken request arrives", async () => {
    let release;
    let canSubmit = true;
    const app = setup({
      canSubmit: () => canSubmit,
      request: (call) =>
        call.path.endsWith("/controller-a")
          ? new Promise((resolve) => {
              release = resolve;
            })
          : undefined,
    });
    await app.start();
    app.emit(toolEvent);
    await vi.advanceTimersByTimeAsync(0);
    canSubmit = false;
    release(controller);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      app.request.mock.calls.some(
        ([call]) => call.path.endsWith("/events") && call.method === "POST",
      ),
    ).toBe(false);
    const output = app
      .sent()
      .find((event) => event.type === "conversation.item.create");
    expect(JSON.parse(output.item.output)).toMatchObject({
      status: "busy",
      sent: false,
    });
  });

  it("releases the microphone on a data-channel failure and keeps the affected Cat visible", async () => {
    const app = setup();
    await app.start();
    peers[0].channel.onerror();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(app.session.getSnapshot()).toMatchObject({
      status: "error",
      controllerId: controller.id,
      error: "voiceConnectionFailed",
    });
    expect(app.request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/conversations/controller-a/voice/realtime/rtc_call_a",
    });
  });

  it("checks the configured provider before requesting a microphone", async () => {
    const app = setup({
      request: (call) =>
        call.path.endsWith("/voice")
          ? { available: false, reason: "missing_openai_api_key" }
          : undefined,
    });
    await app.start();
    expect(microphone).not.toHaveBeenCalled();
    expect(app.session.getSnapshot()).toMatchObject({
      status: "error",
      error: "voiceKeyMissing",
    });
  });

  it("stops a late microphone stream after cancellation without starting a call", async () => {
    let release;
    microphone.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const app = setup();
    const starting = app.start();
    await vi.advanceTimersByTimeAsync(0);
    app.session.end();
    release(media);
    await starting;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(peers).toHaveLength(0);
    expect(
      app.request.mock.calls.some(([call]) => call.method === "POST"),
    ).toBe(false);
  });

  it("hangs up a late broker response after cancellation", async () => {
    let release;
    const app = setup({
      request: (call) =>
        call.path.endsWith("/voice/realtime")
          ? new Promise((resolve) => {
              release = resolve;
            })
          : undefined,
    });
    const starting = app.start();
    await vi.advanceTimersByTimeAsync(0);
    app.session.end();
    release({ sdp: "late-answer", call_id: "rtc_late" });
    await starting;
    expect(peers[0].setRemoteDescription).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(app.request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/conversations/controller-a/voice/realtime/rtc_late",
    });
  });

  it("sends a tool request once and speaks only a newly saved controller answer", async () => {
    const app = setup();
    await app.start();
    app.emit(toolEvent);
    app.emit(toolEvent);
    await vi.advanceTimersByTimeAsync(0);
    const mutations = app.request.mock.calls.filter(
      ([call]) => call.path.endsWith("/events") && call.method === "POST",
    );
    expect(mutations).toHaveLength(1);
    expect(mutations[0][0].body).toMatchObject({ role: "user", run: true });
    expect(mutations[0][0].body.content[0].text).toContain("worker-b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      app.sent().some((event) => event.type === "conversation.item.create"),
    ).toBe(false);
    app.setEvents([
      {
        id: "new-answer",
        action: { kind: "FinishAction", message: "A newly saved answer" },
      },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      app.sent().some((event) => event.type === "conversation.item.create"),
    ).toBe(false);
    expect(app.request.mock.calls.slice(-2).map(([call]) => call.path)).toEqual(
      [
        "/api/conversations/controller-a/events/search?limit=50&sort_order=TIMESTAMP_DESC",
        "/api/conversations/controller-a",
      ],
    );
    app.setStatus("finished");
    await vi.advanceTimersByTimeAsync(1000);
    const output = app
      .sent()
      .find((event) => event.type === "conversation.item.create");
    expect(JSON.parse(output.item.output)).toMatchObject({
      status: "answered",
      conversation_id: controller.id,
      answer: "A newly saved answer",
    });
    expect(
      app.sent().filter((event) => event.type === "response.create"),
    ).toHaveLength(1);
  });

  it.each(["waiting_for_confirmation", "error", "stuck", "paused", "idle"])(
    "does not read a proposed Finish answer when the controller is %s",
    async (status) => {
      const app = setup();
      await app.start();
      app.emit(toolEvent);
      await vi.advanceTimersByTimeAsync(0);
      app.setEvents([
        {
          id: "proposed-answer",
          action: { kind: "FinishAction", message: "Everything succeeded." },
        },
        {
          id: "intermediate-message",
          llm_message: {
            role: "assistant",
            content: [
              { type: "text", text: "This is not a confirmed result." },
            ],
          },
        },
      ]);
      app.setStatus(status);
      await vi.advanceTimersByTimeAsync(1000);
      const output = app
        .sent()
        .find((event) => event.type === "conversation.item.create");
      const result = JSON.parse(output.item.output);
      expect(result.status).toBe(status);
      expect(result).not.toHaveProperty("answer");
      expect(result.message).toContain("has not confirmed completion");
      expect(output.item.output).not.toContain("Everything succeeded.");
      expect(output.item.output).not.toContain(
        "This is not a confirmed result.",
      );
    },
  );

  it("waits through a transient finished status and reads the output saved after the run settles", async () => {
    let runActive = true;
    const app = setup({
      request: (call) => {
        if (!call.path.endsWith("/voice")) return undefined;
        if (!runActive)
          app.setEvents([
            {
              id: "final-answer",
              action: {
                kind: "FinishAction",
                message: "The verified final answer.",
              },
            },
            {
              id: "rejected-answer",
              action: {
                kind: "FinishAction",
                message: "An earlier proposed answer.",
              },
            },
          ]);
        return {
          available: true,
          run_active: runActive,
          execution_status: "finished",
        };
      },
    });
    await app.start();
    app.emit(toolEvent);
    await vi.advanceTimersByTimeAsync(0);
    app.setStatus("finished");
    app.setEvents([
      {
        id: "rejected-answer",
        action: {
          kind: "FinishAction",
          message: "An earlier proposed answer.",
        },
      },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      app.sent().some((event) => event.type === "conversation.item.create"),
    ).toBe(false);
    runActive = false;
    await vi.advanceTimersByTimeAsync(1000);
    const output = app
      .sent()
      .find((event) => event.type === "conversation.item.create");
    expect(JSON.parse(output.item.output)).toMatchObject({
      status: "answered",
      answer: "The verified final answer.",
    });
    expect(output.item.output).not.toContain("An earlier proposed answer.");
  });

  it.each([{ available: true }, { available: true, run_active: false }])(
    "does not certify an answer with an older broker contract %j",
    async (availability) => {
      const app = setup({
        request: (call) =>
          call.path.endsWith("/voice") ? availability : undefined,
      });
      await app.start();
      app.emit(toolEvent);
      await vi.advanceTimersByTimeAsync(0);
      app.setStatus("finished");
      app.setEvents([
        {
          id: "proposed-answer",
          action: { kind: "FinishAction", message: "Done." },
        },
      ]);
      await vi.advanceTimersByTimeAsync(1000);
      const output = app
        .sent()
        .find((event) => event.type === "conversation.item.create");
      const result = JSON.parse(output.item.output);
      expect(result.status).toBe("unverified");
      expect(result).not.toHaveProperty("answer");
      expect(result.message).toContain("update Agent Server");
    },
  );

  it("reports approval from the settled run even when detail still says finished", async () => {
    const app = setup({
      request: (call) =>
        call.path.endsWith("/voice")
          ? {
              available: true,
              run_active: false,
              execution_status: "waiting_for_confirmation",
            }
          : undefined,
    });
    await app.start();
    app.emit(toolEvent);
    await vi.advanceTimersByTimeAsync(0);
    app.setStatus("finished");
    app.setEvents([
      {
        id: "proposed-answer",
        action: { kind: "FinishAction", message: "Done." },
      },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    const output = app
      .sent()
      .find((event) => event.type === "conversation.item.create");
    const result = JSON.parse(output.item.output);
    expect(result.status).toBe("waiting_for_confirmation");
    expect(result).not.toHaveProperty("answer");
  });

  it("interrupts only speech and keeps a pending durable request alive", async () => {
    const app = setup();
    await app.start();
    app.emit(toolEvent);
    await vi.advanceTimersByTimeAsync(0);
    app.session.setMuted(true);
    expect(track.enabled).toBe(false);
    app.session.interrupt();
    expect(track.stop).not.toHaveBeenCalled();
    expect(app.sent()).toContainEqual({ type: "response.cancel" });
    expect(
      app.request.mock.calls.some(([call]) =>
        /pause|stop|cancel/.test(call.path),
      ),
    ).toBe(false);
    app.setEvents([
      {
        id: "new-answer",
        action: {
          kind: "FinishAction",
          message: "Completed after the interruption",
        },
      },
    ]);
    app.setStatus("finished");
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      app.sent().some((event) => event.type === "conversation.item.create"),
    ).toBe(true);
    expect(app.sent().some((event) => event.type === "response.create")).toBe(
      false,
    );
    app.session.end();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(app.request).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/api/conversations/controller-a/voice/realtime/rtc_call_a",
    });
  });

  it("does not mutate a controller after its session ended during preflight", async () => {
    let release;
    const app = setup({
      request: (call) =>
        call.path.endsWith("/controller-a")
          ? new Promise((resolve) => {
              release = resolve;
            })
          : undefined,
    });
    await app.start();
    app.emit(toolEvent);
    await vi.advanceTimersByTimeAsync(0);
    app.session.end();
    release(controller);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      app.request.mock.calls.some(
        ([call]) => call.path.endsWith("/events") && call.method === "POST",
      ),
    ).toBe(false);
  });

  it("does not resume a controller waiting for approval", async () => {
    const app = setup({
      request: (call) =>
        call.path.endsWith("/controller-a")
          ? { ...controller, execution_status: "waiting_for_confirmation" }
          : undefined,
    });
    await app.start();
    app.emit(toolEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      app.request.mock.calls.some(
        ([call]) => call.path.endsWith("/events") && call.method === "POST",
      ),
    ).toBe(false);
    const output = app
      .sent()
      .find((event) => event.type === "conversation.item.create");
    expect(JSON.parse(output.item.output)).toMatchObject({
      status: "waiting_for_confirmation",
      sent: false,
    });
  });
});

function setupCodex(overrides = {}) {
  return setup({
    ...overrides,
    request: async (call) => {
      const result = await overrides.request?.(call);
      if (result !== undefined) return result;
      if (call.path.endsWith("/voice"))
        return { available: true, provider: "codex", delegation: "server" };
      if (call.path.endsWith("/voice/realtime"))
        return {
          sdp: "codex-answer",
          call_id: "codex_call_a",
          provider: "codex",
          delegation: "server",
        };
      if (call.method === "GET" && call.path.endsWith("/codex_call_a"))
        return {
          provider: "codex",
          status: "listening",
          transcripts: [],
          error: null,
        };
    },
  });
}

describe("Codex server-owned voice relay", () => {
  it("ignores a previous peer's delayed events after starting a fresh call", async () => {
    const app = setupCodex();
    await app.start();
    const firstPeer = peers[0];
    const endedTrack = track.onended;
    app.session.end();
    await app.start();
    firstPeer.connectionState = "closed";
    firstPeer.onconnectionstatechange();
    firstPeer.channel.onclose();
    firstPeer.channel.onerror();
    endedTrack();
    expect(app.session.getSnapshot()).toMatchObject({
      status: "listening",
      controllerId: controller.id,
      provider: "codex",
      error: null,
    });
    expect(peers[1].close).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "waits for scoped hangup before restarting (cancel restart: %s)",
    async (cancelRestart) => {
      let release;
      const app = setupCodex({
        request: (call) =>
          call.method === "DELETE"
            ? new Promise((resolve) => {
                release = resolve;
              })
            : undefined,
      });
      await app.start();
      app.session.end();
      expect(track.stop).toHaveBeenCalledOnce();
      const restarting = app.session.start(controller, app.audio);
      await vi.advanceTimersByTimeAsync(0);
      expect(microphone).toHaveBeenCalledOnce();
      expect(
        app.request.mock.calls.filter(([call]) => call.method === "POST"),
      ).toHaveLength(1);
      if (cancelRestart) app.session.end();
      release({ success: true });
      await restarting;
      expect(microphone).toHaveBeenCalledTimes(cancelRestart ? 1 : 2);
      expect(
        app.request.mock.calls.filter(([call]) => call.method === "POST"),
      ).toHaveLength(cancelRestart ? 1 : 2);
    },
  );

  it("waits for a canceled setup's late answer and hangup before restarting", async () => {
    let answer, cleanup;
    let calls = 0;
    const app = setupCodex({
      request: (call) => {
        if (call.path.endsWith("/voice/realtime") && ++calls === 1)
          return new Promise((resolve) => {
            answer = resolve;
          });
        if (call.method === "DELETE")
          return new Promise((resolve) => {
            cleanup = resolve;
          });
      },
    });
    const first = app.session.start(controller, app.audio);
    await vi.advanceTimersByTimeAsync(0);
    app.session.end();
    const second = app.session.start(controller, app.audio);
    await vi.advanceTimersByTimeAsync(0);
    expect(microphone).toHaveBeenCalledOnce();
    answer({
      provider: "codex",
      delegation: "server",
      call_id: "late-call",
      sdp: "late-answer",
    });
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(microphone).toHaveBeenCalledOnce();
    cleanup({ success: true });
    await second;
    expect(microphone).toHaveBeenCalledTimes(2);
    expect(peers[0].setRemoteDescription).not.toHaveBeenCalled();
  });

  it("negotiates the events channel but lets only the server dispatch work", async () => {
    const app = setupCodex({
      request: (call) =>
        call.method === "GET" && call.path.endsWith("/codex_call_a")
          ? {
              provider: "codex",
              status: "thinking",
              transcripts: [
                { id: "user-1", role: "user", text: "What changed?" },
                { id: "assistant-1", role: "assistant", text: "Checking." },
              ],
              error: null,
            }
          : undefined,
    });
    await app.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(peers[0].createDataChannel).toHaveBeenCalledWith("oai-events");
    expect(peers[0].setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "codex-answer",
    });
    expect(app.session.getSnapshot()).toMatchObject({
      status: "thinking",
      provider: "codex",
      transcripts: { user: "What changed?", assistant: "Checking." },
    });
    app.emit(toolEvent);
    app.emit({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "Do not submit me again.",
    });
    app.emit({
      type: "response.function_call_arguments.done",
      name: "end_voice_call",
      arguments: "{}",
    });
    app.session.interrupt();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.sent()).toEqual([]);
    expect(track.stop).not.toHaveBeenCalled();
    expect(
      app.request.mock.calls.filter(([call]) => call.method === "POST"),
    ).toEqual([
      [
        {
          path: "/api/conversations/controller-a/voice/realtime",
          method: "POST",
          body: { sdp: "test-offer" },
        },
      ],
    ]);
  });

  it.each([
    ["codex_not_installed", "voiceCodexMissing"],
    ["codex_not_signed_in", "voiceCodexSignIn"],
    ["codex_unavailable", "voiceCodexUnavailable"],
  ])("reports %s before requesting a microphone", async (reason, error) => {
    const app = setupCodex({
      request: (call) =>
        call.path.endsWith("/voice")
          ? {
              available: false,
              provider: "codex",
              delegation: "server",
              reason,
            }
          : undefined,
    });
    await app.start();
    expect(microphone).not.toHaveBeenCalled();
    expect(app.session.getSnapshot()).toMatchObject({
      status: "error",
      provider: "codex",
      error,
    });
  });

  it.each([
    { provider: "codex" },
    { provider: "codex", delegation: "client" },
    { provider: "unknown", delegation: "server" },
  ])(
    "rejects unsupported availability before microphone access: %j",
    async (owner) => {
      const app = setupCodex({
        request: (call) =>
          call.path.endsWith("/voice")
            ? { available: true, ...owner }
            : undefined,
      });
      await app.start();
      expect(microphone).not.toHaveBeenCalled();
      expect(app.session.getSnapshot().status).toBe("error");
    },
  );

  it("waits for WebRTC connection rather than a data-channel or broker status", async () => {
    const app = setupCodex();
    await app.session.start(controller, app.audio);
    peers[0].channel.onopen();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.session.getSnapshot().status).toBe("connecting");
    await vi.advanceTimersByTimeAsync(30000);
    expect(app.session.getSnapshot().status).toBe("error");
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it.each([
    { provider: "openai", delegation: "client" },
    { provider: "codex", delegation: "client" },
    {},
  ])("rejects a changed or ambiguous negotiated owner: %j", async (owner) => {
    const app = setupCodex({
      request: (call) =>
        call.path.endsWith("/voice/realtime")
          ? { sdp: "wrong-answer", call_id: "wrong_call", ...owner }
          : undefined,
    });
    await app.start();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(peers[0].setRemoteDescription).not.toHaveBeenCalled();
    expect(app.request).toHaveBeenCalledWith({
      path: "/api/conversations/controller-a/voice/realtime/wrong_call",
      method: "DELETE",
    });
    expect(app.session.getSnapshot().status).toBe("error");
  });

  it("cleans up a server-ended call and stops status polling", async () => {
    let closed = false;
    const app = setupCodex({
      request: (call) =>
        call.method === "GET" && call.path.endsWith("/codex_call_a")
          ? {
              provider: "codex",
              status: closed ? "closed" : "listening",
              transcripts: [],
              error: null,
            }
          : undefined,
    });
    await app.start();
    await vi.advanceTimersByTimeAsync(0);
    closed = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.session.getSnapshot().status).toBe("idle");
    expect(track.stop).toHaveBeenCalledOnce();
    const count = app.request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(app.request.mock.calls).toHaveLength(count);
  });

  it("ignores a late status snapshot after the call ends", async () => {
    let release;
    const app = setupCodex({
      request: (call) =>
        call.method === "GET" && call.path.endsWith("/codex_call_a")
          ? new Promise((resolve) => {
              release = resolve;
            })
          : undefined,
    });
    await app.start();
    await vi.advanceTimersByTimeAsync(0);
    app.session.end();
    release({
      provider: "codex",
      status: "speaking",
      transcripts: [{ id: "late", role: "assistant", text: "Old call." }],
      error: null,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.session.getSnapshot()).toMatchObject({
      status: "idle",
      transcripts: {},
    });
  });

  it("releases media on polling failure without exposing raw errors", async () => {
    const app = setupCodex({
      request: (call) => {
        if (call.method === "GET" && call.path.endsWith("/codex_call_a"))
          throw new Error("Private backend detail");
      },
    });
    await app.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(app.session.getSnapshot()).toMatchObject({
      status: "error",
      provider: "codex",
      error: "voiceCodexUnavailable",
    });
  });
});
