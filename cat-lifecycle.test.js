import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { activate } from "./src/extension.js";

// Use the actual React/i18next mounts: changing language disposes and rebuilds
// both views, which must not dispose the activation-owned Voice session.
vi.unmock("react-i18next");

const mocked = vi.hoisted(() => ({ snapshot: {}, onChange: null }));
vi.mock("./src/voice-session.js", () => ({
  createVoiceSession: vi.fn(({ onChange }) => {
    mocked.onChange = onChange;
    mocked.start = vi.fn((controller, audio) => {
      mocked.audio = audio;
      mocked.stream = { id: "test-remote-stream" };
      audio.srcObject = mocked.stream;
      mocked.snapshot = {
        status: "listening",
        controllerId: controller.id,
        provider: "codex",
        muted: false,
        requestPending: false,
        transcripts: {},
      };
      onChange();
    });
    mocked.end = vi.fn(() => {
      mocked.snapshot = { status: "idle", controllerId: null };
      onChange();
    });
    mocked.setMuted = vi.fn((muted) => {
      mocked.snapshot = { ...mocked.snapshot, muted };
      onChange();
    });
    return {
      getSnapshot: () => mocked.snapshot,
      start: mocked.start,
      end: mocked.end,
      setMuted: mocked.setMuted,
      interrupt: vi.fn(),
    };
  }),
}));

const CAT_ID = "8d5267f2-6e54-4e69-a95d-9475dd85e676";
const controller = {
  id: CAT_ID,
  title: "Saved Insider",
  tags: { smolpaws: "insider", insiderrole: "controller" },
  parent_conversation_id: null,
  execution_status: "finished",
};
const detailPath = `/api/conversations/${CAT_ID}`;
const cleanups = [];
const action = (container, name) =>
  container.querySelector(`[data-action="${name}"]`);
const pose = (container) =>
  container.querySelector(".insider-cat-avatar").dataset.pose;

beforeEach(() => {
  mocked.snapshot = { status: "idle", controllerId: null };
  mocked.audio = null;
  mocked.stream = null;
  localStorage.setItem("i18nextLng", "en");
});

afterEach(async () => {
  await act(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });
  vi.useRealTimers();
  document.body.replaceChildren();
  localStorage.clear();
  vi.clearAllMocks();
});

async function mountHarness({ readDetail = () => ({ ...controller }) } = {}) {
  let mountPage;
  let mountCompanion;
  const navigate = vi.fn();
  const request = vi.fn(async ({ path }) => {
    if (path.startsWith("/api/conversations/search"))
      return { items: [{ ...controller }], next_page_id: null };
    if (path === "/api/workspaces") return { workspaces: [] };
    if (path.includes("/events/search"))
      return { items: [], next_page_id: null };
    if (path === detailPath) return readDetail();
    if (path === `${detailPath}/events`) return { success: true };
    throw new Error(`Unexpected test request: ${path}`);
  });
  const dispose = activate({
    apiVersion: "1",
    backend: { id: "lifecycle-backend", orgId: null },
    agentServer: { request },
    registerPage: (_, mount) => {
      mountPage = mount;
      return vi.fn();
    },
    registerCompanion: ({ mount }) => {
      mountCompanion = mount;
      return vi.fn();
    },
  });
  cleanups.push(dispose);

  const mount = async (callback) => {
    const container = document.createElement("div");
    document.body.append(container);
    let cleanup;
    await act(async () => {
      cleanup = callback({ container, navigate });
    });
    let mounted = true;
    const unmount = () => {
      if (!mounted) return;
      mounted = false;
      cleanup();
      container.remove();
    };
    cleanups.push(unmount);
    return { container, unmount };
  };
  const companion = await mount(mountCompanion);
  const page = await mount(mountPage);
  await waitFor(() => {
    expect(action(page.container, "controller").value).toBe(CAT_ID);
    expect(action(page.container, "voice-start").disabled).toBe(false);
  });
  return {
    page,
    companion,
    request,
    navigate,
    mountPage: () => mount(mountPage),
  };
}

function expectSamePlayback(audio, stream) {
  expect(document.querySelectorAll("audio")).toHaveLength(1);
  expect(document.querySelector("audio")).toBe(audio);
  expect(audio.parentElement).toBe(document.body);
  expect(audio.srcObject).toBe(stream);
  expect(mocked.start).toHaveBeenCalledTimes(1);
  expect(mocked.end).not.toHaveBeenCalled();
}

describe("Cat page and companion lifecycle", () => {
  it("moves controls between Projects and the companion without restarting or detaching audio", async () => {
    const { page, companion, mountPage, navigate } = await mountHarness();
    const companionRoot = companion.container.querySelector(".insider-voice");
    expect(companionRoot.hidden).toBe(true);
    act(() => action(page.container, "voice-start").click());
    const { audio, stream } = mocked;
    expectSamePlayback(audio, stream);

    act(() => page.unmount());
    expect(companionRoot.hidden).toBe(false);
    expect(action(companion.container, "end").hidden).toBe(false);
    act(() => action(companion.container, "mute").click());
    expect(mocked.setMuted).toHaveBeenCalledWith(true);
    action(companion.container, "open").click();
    expect(navigate).toHaveBeenCalledWith(`/conversations/${CAT_ID}`);
    expectSamePlayback(audio, stream);

    const restored = await mountPage();
    expect(companionRoot.hidden).toBe(true);
    expect(
      action(restored.container, "mute").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(action(restored.container, "end").hidden).toBe(false);
    expectSamePlayback(audio, stream);
  });

  it("ignores an old page's late disposal while a newer Projects page is mounted", async () => {
    const { page, companion, mountPage } = await mountHarness();
    act(() => action(page.container, "voice-start").click());
    const { audio, stream } = mocked;
    const newer = await mountPage();
    act(() => page.unmount());
    expect(companion.container.querySelector(".insider-voice").hidden).toBe(
      true,
    );

    act(() => {
      mocked.snapshot = { ...mocked.snapshot, status: "speaking" };
      mocked.onChange();
    });
    expect(pose(newer.container)).toBe("speaking");
    expectSamePlayback(audio, stream);

    act(() => newer.unmount());
    expect(companion.container.querySelector(".insider-voice").hidden).toBe(
      false,
    );
    expectSamePlayback(audio, stream);
  });

  it.each([
    ["fr", "ltr", "storage"],
    ["ar", "rtl", "focus"],
  ])(
    "preserves the draft, muted call, and pending request across a real %s language remount",
    async (language, direction, event) => {
      const { page, companion, request } = await mountHarness();
      act(() => action(page.container, "voice-start").click());
      const { audio, stream } = mocked;
      const previousRoot = page.container.querySelector(".insider-app");
      const draft = "Keep this draft until the spoken request finishes";
      act(() => {
        action(page.container, "draft").value = draft;
        action(page.container, "draft").dispatchEvent(new Event("input"));
        mocked.snapshot = {
          ...mocked.snapshot,
          muted: true,
          requestPending: true,
          transcripts: { user: "A spoken request", assistant: "A saved reply" },
        };
        mocked.onChange();
      });

      await act(async () => {
        localStorage.setItem("i18nextLng", language);
        window.dispatchEvent(
          event === "storage"
            ? new StorageEvent("storage", { key: "i18nextLng" })
            : new Event("focus"),
        );
      });
      await waitFor(() =>
        expect(page.container.firstElementChild.lang).toBe(language),
      );
      expect(page.container.firstElementChild.dir).toBe(direction);
      expect(page.container.querySelector(".insider-app")).not.toBe(
        previousRoot,
      );
      expect(companion.container.firstElementChild.lang).toBe(language);
      expect(companion.container.querySelector(".insider-voice").hidden).toBe(
        true,
      );
      expect(action(page.container, "controller").value).toBe(CAT_ID);
      expect(action(page.container, "draft").value).toBe(draft);
      expect(action(page.container, "mute").getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(action(page.container, "interrupt").hidden).toBe(true);
      expect(
        page.container.querySelector('[data-role="transcript-lines"]')
          .textContent,
      ).toContain("A saved reply");
      expectSamePlayback(audio, stream);

      await act(async () => action(page.container, "send").click());
      expect(request.mock.calls.some(([args]) => args.method === "POST")).toBe(
        false,
      );
      expect(action(page.container, "draft").value).toBe(draft);
      expect(
        page.container.querySelector('[data-role="notice"]').textContent,
      ).not.toBe("");
      act(() => action(page.container, "end").click());
      expect(mocked.end).toHaveBeenCalledTimes(1);
    },
  );

  it("refreshes away status, cancels the away poll on return, and ignores its late result", async () => {
    let status = "finished";
    let nextDetail = null;
    const { page, companion, mountPage, request } = await mountHarness({
      readDetail: () => {
        if (nextDetail) {
          const pending = nextDetail;
          nextDetail = null;
          return pending;
        }
        return { ...controller, execution_status: status };
      },
    });
    vi.useFakeTimers();
    act(() => page.unmount());
    expect(pose(companion.container)).toBe("sleeping");
    status = "running";
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(pose(companion.container)).toBe("working");
    status = "finished";
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(pose(companion.container)).toBe("sleeping");

    let resolveLate;
    nextDetail = new Promise((resolve) => {
      resolveLate = resolve;
    });
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    const restored = await mountPage();
    await act(async () =>
      resolveLate({
        ...controller,
        execution_status: "waiting_for_confirmation",
      }),
    );
    expect(pose(restored.container)).toBe("sleeping");
    expect(companion.container.querySelector(".insider-voice").hidden).toBe(
      true,
    );

    // Only the page's next detail/history pair remains scheduled. A stale away
    // callback must not schedule a second detail-only polling loop.
    request.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(
      request.mock.calls.filter(([args]) => args.path === detailPath),
    ).toHaveLength(1);
    expect(
      request.mock.calls.filter(([args]) =>
        args.path.includes("/events/search"),
      ),
    ).toHaveLength(1);
    act(() => restored.unmount());
    expect(pose(companion.container)).toBe("sleeping");
    expect(mocked.start).not.toHaveBeenCalled();
    expect(mocked.end).not.toHaveBeenCalled();
  });

  it.each([
    ["voiceKeyMissing", "OPENAI_API_KEY", true],
    ["voiceCodexSignIn", "sign in", false],
  ])(
    "keeps %s visible in the integrated controls while the companion is hidden",
    async (error, text, hasSetup) => {
      const { page, companion, navigate } = await mountHarness();
      act(() => {
        mocked.snapshot = { status: "error", controllerId: CAT_ID, error };
        mocked.onChange();
      });
      expect(companion.container.querySelector(".insider-voice").hidden).toBe(
        true,
      );
      expect(pose(page.container)).toBe("attention");
      expect(
        page.container
          .querySelector('[data-role="voice-status"]')
          .textContent.toLowerCase(),
      ).toContain(text.toLowerCase());
      expect(action(page.container, "setup").hidden).toBe(!hasSetup);
      expect(action(page.container, "voice-start").hidden).toBe(false);
      if (hasSetup) {
        action(page.container, "setup").click();
        expect(navigate).toHaveBeenCalledWith("/settings/secrets");
      }
      action(page.container, "open-controller").click();
      expect(navigate).toHaveBeenCalledWith(`/conversations/${CAT_ID}`);
    },
  );
});
