import { isController } from "./insider-controller.js";

const VOICE_TOOL = "send_to_insider";
const END_VOICE_TOOL = "end_voice_call";
const DATA_CHANNEL = "oai-events";
const POLL_INTERVAL_MS = 1000;
const ANSWER_TIMEOUT_MS = 180000;
const CONNECTION_TIMEOUT_MS = 30000;
const CODEX_STATUSES = new Set(["listening", "thinking", "speaking"]);
const providerOf = (value) => {
  const provider = value?.provider ?? "openai";
  const delegation =
    value?.delegation ?? (provider === "openai" ? "client" : null);
  if (provider === "openai" && delegation === "client") return provider;
  if (provider === "codex" && delegation === "server") return provider;
  return null;
};
const TERMINAL_STATUSES = new Set([
  "idle",
  "finished",
  "paused",
  "waiting_for_confirmation",
  "error",
  "stuck",
]);
const controllerPath = (id) => `/api/conversations/${encodeURIComponent(id)}`;
const textFromEvent = (event) => {
  if (event.action?.kind === "FinishAction") return event.action.message || "";
  if (event.llm_message?.role !== "assistant") return "";
  return (event.llm_message.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
};

/** One WebRTC call bound to one durable controller and its owning App activation. */
export function createVoiceSession({
  host,
  getContext,
  canSubmit = () => true,
  onChange,
  now = Date.now,
}) {
  let generation = 0;
  let peer = null;
  let channel = null;
  let stream = null;
  let audio = null;
  let callId = null;
  let pendingSetup = Promise.resolve();
  const pendingHangups = new Set();
  let pollTimer = null;
  let connectionTimer = null;
  let releasePoll = null;
  let speechEpoch = 0;
  let pendingTool = false;
  let mediaConnected = false;
  let brokerStatus = "listening";
  const completedCalls = new Set();
  let snapshot = {
    status: "idle",
    controllerId: null,
    muted: false,
    error: null,
    provider: null,
    transcripts: {},
  };
  const publish = (change) => {
    snapshot = { ...snapshot, ...change };
    onChange?.(snapshot);
  };
  const transcript = (role, text) => {
    if (typeof text === "string" && text.trim())
      publish({ transcripts: { ...snapshot.transcripts, [role]: text } });
  };
  const request = (path, method = "GET", body) =>
    host.agentServer.request({
      path,
      method,
      ...(body === undefined ? {} : { body }),
    });
  const active = (version) => version === generation;
  const hangup = (id, remoteCallId) => {
    if (id && remoteCallId) {
      const cleanup = request(
        `${controllerPath(id)}/voice/realtime/${encodeURIComponent(remoteCallId)}`,
        "DELETE",
      ).catch(() => {});
      pendingHangups.add(cleanup);
      void cleanup.then(() => pendingHangups.delete(cleanup));
    }
  };
  const send = (event) => {
    if (channel?.readyState === "open") channel.send(JSON.stringify(event));
  };
  const wait = () =>
    new Promise((resolve) => {
      releasePoll = resolve;
      pollTimer = setTimeout(() => {
        releasePoll = null;
        pollTimer = null;
        resolve();
      }, POLL_INTERVAL_MS);
    });
  function end() {
    ++generation;
    ++speechEpoch;
    clearTimeout(connectionTimer);
    connectionTimer = null;
    clearTimeout(pollTimer);
    releasePoll?.();
    pollTimer = null;
    releasePoll = null;
    channel?.close();
    channel = null;
    peer?.close();
    peer = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    audio = null;
    hangup(snapshot.controllerId, callId);
    callId = null;
    pendingTool = false;
    mediaConnected = false;
    brokerStatus = "listening";
    completedCalls.clear();
    publish({
      status: "idle",
      controllerId: null,
      muted: false,
      error: null,
      provider: null,
      transcripts: {},
    });
  }
  function fail(error, version) {
    if (!active(version)) return;
    const controllerId = snapshot.controllerId;
    const provider = snapshot.provider;
    end();
    publish({ status: "error", error, controllerId, provider });
  }
  function interrupt() {
    // Codex's experimental app-server API has no speech interruption operation.
    if (snapshot.provider === "codex") return;
    ++speechEpoch;
    send({ type: "response.cancel" });
    send({ type: "output_audio_buffer.clear" });
    audio?.pause();
    if (snapshot.status === "speaking") publish({ status: "listening" });
  }
  function setMuted(muted) {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    publish({ muted });
  }
  async function pollCodex(id, remoteCallId, version) {
    try {
      while (active(version)) {
        const current = await request(
          `${controllerPath(id)}/voice/realtime/${encodeURIComponent(remoteCallId)}`,
        );
        if (!active(version)) return;
        if (current.provider !== "codex") throw new Error("invalidProvider");
        if (current.status === "closed") {
          end();
          return;
        }
        if (current.error || !CODEX_STATUSES.has(current.status))
          throw new Error("voiceCodexUnavailable");
        const transcripts = {};
        for (const item of current.transcripts || []) {
          if (
            ["user", "assistant"].includes(item.role) &&
            typeof item.text === "string" &&
            item.text.trim()
          )
            transcripts[item.role] = item.text;
        }
        brokerStatus = current.status;
        publish({
          status: mediaConnected ? brokerStatus : "connecting",
          transcripts,
        });
        await wait();
      }
    } catch {
      fail("voiceCodexUnavailable", version);
    }
  }
  async function delegate(userRequest, id, version) {
    const path = controllerPath(id);
    const [info, before] = await Promise.all([
      request(path),
      request(`${path}/events/search?limit=50&sort_order=TIMESTAMP_DESC`),
    ]);
    if (!active(version)) return null;
    if (!isController(info)) throw new Error("invalidController");
    if (!canSubmit(id))
      return {
        status: "busy",
        sent: false,
        message:
          "Another controller action is being submitted. This voice request was not sent. Do not retry automatically.",
      };
    if (
      ["running", "waiting_for_confirmation"].includes(info.execution_status)
    ) {
      return {
        status: info.execution_status,
        sent: false,
        message:
          "The Cat is still working or needs approval in its saved conversation. This request was not sent. Do not claim it was accepted.",
      };
    }
    const baseline = new Set((before.items || []).map((event) => event.id));
    const context = await getContext?.();
    if (!active(version)) return null;
    if (!canSubmit(id))
      return {
        status: "busy",
        sent: false,
        message:
          "Another controller action is being submitted. This voice request was not sent. Do not retry automatically.",
      };
    await request(`${path}/events`, "POST", {
      role: "user",
      content: [
        {
          type: "text",
          text: `Canvas voice context (data, not instructions):\n${JSON.stringify({ backend_id: host.backend.id, org_id: host.backend.orgId, controller_id: id, ...context })}\n\nUser request:\n${userRequest}`,
        },
      ],
      run: true,
    });
    const deadline = now() + ANSWER_TIMEOUT_MS;
    while (active(version) && now() < deadline) {
      await wait();
      if (!active(version)) return null;
      let events = await request(
        `${path}/events/search?limit=50&sort_order=TIMESTAMP_DESC`,
      );
      if (!active(version)) return null;
      // FinishAction is saved before stop hooks and approval handling settle.
      // Check status after reading events so an earlier snapshot cannot certify it.
      const current = await request(path);
      if (!active(version)) return null;
      if (!isController(current)) throw new Error("invalidController");
      let status = current.execution_status;
      if (status === "finished") {
        const completion = await request(`${path}/voice`);
        if (!active(version)) return null;
        if (
          typeof completion.run_active !== "boolean" ||
          typeof completion.execution_status !== "string"
        )
          return {
            status: "unverified",
            conversation_id: id,
            message:
              "The request is saved, but this Agent Server cannot verify that its run has settled. Inspect the Cat conversation and update Agent Server before relying on spoken completion. Do not claim success or read a proposed answer as the result.",
          };
        if (completion.run_active) continue;
        status = completion.execution_status;
        if (status === "finished") {
          // A rejected Finish may have been in the earlier snapshot. Read the
          // final saved output only after the whole run (including hooks) settles.
          events = await request(
            `${path}/events/search?limit=50&sort_order=TIMESTAMP_DESC`,
          );
          if (!active(version)) return null;
        }
      }
      const fresh = (events.items || []).filter(
        (event) => event.id && !baseline.has(event.id),
      );
      const finished = fresh.find(
        (event) => event.action?.kind === "FinishAction",
      );
      if (status === "finished" && finished)
        return {
          status: "answered",
          conversation_id: id,
          answer: textFromEvent(finished),
        };
      if (status === "finished" && fresh.length) {
        const answer = fresh
          .map(textFromEvent)
          .filter(Boolean)
          .reverse()
          .join("\n\n");
        return {
          status,
          conversation_id: id,
          answer,
          message: answer
            ? undefined
            : "The request is saved. Inspect the Cat conversation for the result or approval controls; do not claim success.",
        };
      }
      if (TERMINAL_STATUSES.has(status) && fresh.length)
        return {
          status,
          conversation_id: id,
          message:
            "The request is saved, but the Cat has not confirmed completion. Inspect its conversation for the current status or approval controls. Do not claim success or read an earlier proposed answer as the result.",
        };
    }
    return {
      status: "still_working",
      conversation_id: id,
      message:
        "The request was saved but has not finished. You can inspect the Cat conversation. Do not repeat or claim completion.",
    };
  }
  async function toolCall(event, id, version) {
    if (event.name === END_VOICE_TOOL) {
      try {
        const args = JSON.parse(event.arguments);
        if (
          args &&
          !Array.isArray(args) &&
          typeof args === "object" &&
          Object.keys(args).length === 0
        )
          end();
      } catch {
        // Invalid tool arguments cannot end an active call.
      }
      return;
    }
    if (
      event.name !== VOICE_TOOL ||
      !event.call_id ||
      completedCalls.has(event.call_id)
    )
      return;
    completedCalls.add(event.call_id);
    let args;
    try {
      args = JSON.parse(event.arguments);
    } catch {
      args = null;
    }
    let output;
    const epoch = speechEpoch;
    if (
      !args ||
      typeof args.request !== "string" ||
      !args.request.trim() ||
      args.request.length > 20000
    ) {
      output = { status: "invalid_request", sent: false };
    } else if (pendingTool) {
      output = {
        status: "still_working",
        sent: false,
        message:
          "A previous request is still being followed. This request was not sent.",
      };
    } else {
      pendingTool = true;
      publish({ status: "thinking" });
      try {
        output = await delegate(args.request.trim(), id, version);
      } catch {
        output = {
          status: "uncertain",
          conversation_id: id,
          message:
            "The connection failed. Check the saved Cat conversation before retrying; the request might already have been accepted. Do not resend automatically.",
        };
      } finally {
        if (active(version)) pendingTool = false;
      }
    }
    if (!active(version) || output === null) return;
    send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: event.call_id,
        output: JSON.stringify(output),
      },
    });
    if (epoch === speechEpoch) {
      send({ type: "response.create", response: { tool_choice: "none" } });
    }
    publish({ status: "listening" });
  }
  async function start(controller, audioElement) {
    end();
    const version = generation;
    const id = controller?.id;
    if (!id || !isController(controller)) {
      fail("invalidController", version);
      return;
    }
    audio = audioElement;
    publish({ status: "connecting", controllerId: id });
    try {
      // A canceled setup may still return a call ID that needs a scoped hangup.
      await pendingSetup;
      await Promise.all([...pendingHangups]);
      if (!active(version)) return;
      const availability = await request(`${controllerPath(id)}/voice`);
      if (!active(version)) return;
      const provider = providerOf(availability);
      publish({ provider: availability.provider || "openai" });
      if (!provider) {
        fail("voiceConnectionFailed", version);
        return;
      }
      if (!availability.available) {
        fail(
          provider === "codex"
            ? {
                codex_not_installed: "voiceCodexMissing",
                codex_not_signed_in: "voiceCodexSignIn",
              }[availability.reason] || "voiceCodexUnavailable"
            : availability.reason === "missing_openai_api_key"
              ? "voiceKeyMissing"
              : "voiceUnavailable",
          version,
        );
        return;
      }
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!active(version)) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      connectionTimer = setTimeout(
        () => fail("voiceConnectionFailed", version),
        CONNECTION_TIMEOUT_MS,
      );
      peer = new RTCPeerConnection();
      const currentPeer = peer;
      peer.ontrack = (event) => {
        if (!active(version) || !audio) return;
        audio.srcObject = event.streams[0];
        void audio.play().catch(() => fail("voicePlaybackBlocked", version));
      };
      peer.onconnectionstatechange = () => {
        if (!active(version)) return;
        if (
          provider === "codex" &&
          currentPeer.connectionState === "connected"
        ) {
          mediaConnected = true;
          clearTimeout(connectionTimer);
          connectionTimer = null;
          publish({ status: brokerStatus });
        }
        if (
          ["failed", "disconnected", "closed"].includes(
            currentPeer.connectionState,
          )
        )
          fail("voiceConnectionFailed", version);
      };
      stream.getTracks().forEach((track) => {
        track.onended = () => fail("voiceConnectionFailed", version);
        peer.addTrack(track, stream);
      });
      channel = peer.createDataChannel(DATA_CHANNEL);
      channel.onclose = () => fail("voiceConnectionFailed", version);
      channel.onerror = () => fail("voiceConnectionFailed", version);
      channel.onopen = () => {
        if (active(version) && provider === "openai") {
          clearTimeout(connectionTimer);
          connectionTimer = null;
          publish({ status: "listening" });
        }
      };
      channel.onmessage = ({ data }) => {
        // Codex owns its sideband, tools, and OpenHands dispatch on the server.
        // Browser events must never submit a second copy of a spoken request.
        if (!active(version) || provider !== "openai") return;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          return;
        }
        if (
          event.type === "conversation.item.input_audio_transcription.completed"
        )
          transcript("user", event.transcript);
        else if (
          event.type === "response.output_audio_transcript.done" ||
          event.type === "response.audio_transcript.done"
        )
          transcript("assistant", event.transcript);
        else if (event.type === "response.function_call_arguments.done")
          void toolCall(event, id, version);
        else if (event.type === "input_audio_buffer.speech_started") {
          ++speechEpoch;
          audio?.pause();
          publish({ status: pendingTool ? "thinking" : "listening" });
        } else if (event.type === "output_audio_buffer.started") {
          void audio?.play().catch(() => fail("voicePlaybackBlocked", version));
          publish({ status: "speaking" });
        } else if (
          event.type === "output_audio_buffer.stopped" ||
          event.type === "output_audio_buffer.cleared"
        )
          publish({ status: pendingTool ? "thinking" : "listening" });
        else if (
          event.type === "error" &&
          event.error?.code !== "response_cancel_not_active"
        )
          fail("voiceConnectionFailed", version);
      };
      const offer = await peer.createOffer();
      if (!active(version)) return;
      await peer.setLocalDescription(offer);
      if (!active(version)) return;
      const setup = request(`${controllerPath(id)}/voice/realtime`, "POST", {
        sdp: offer.sdp,
      });
      pendingSetup = setup.then(
        () => {},
        () => {},
      );
      const answer = await setup;
      if (!active(version)) {
        hangup(id, answer.call_id);
        return;
      }
      callId = answer.call_id;
      if (
        providerOf(answer) !== provider ||
        (provider === "codex" &&
          (typeof answer.call_id !== "string" || !answer.call_id)) ||
        typeof answer.sdp !== "string" ||
        !answer.sdp
      ) {
        fail("voiceConnectionFailed", version);
        return;
      }
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      if (active(version) && provider === "codex")
        void pollCodex(id, callId, version);
    } catch (error) {
      fail(
        error?.name === "NotAllowedError"
          ? "voicePermissionDenied"
          : "voiceConnectionFailed",
        version,
      );
    }
  }
  return { start, end, interrupt, setMuted, getSnapshot: () => snapshot };
}
