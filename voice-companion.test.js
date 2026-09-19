import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { activate } from "./src/extension.js";

const mocked = vi.hoisted(() => ({ snapshot: {}, onChange: null }));
vi.mock("./src/voice-session.js", () => ({
  createVoiceSession: ({ onChange }) => {
    mocked.onChange = onChange;
    mocked.start = vi.fn();
    return {
      getSnapshot: () => mocked.snapshot,
      start: mocked.start,
      end: vi.fn(),
      interrupt: vi.fn(),
      setMuted: vi.fn(),
    };
  },
}));
vi.mock("./i18n.jsx", () => ({
  mountLocalizedApp: (container, mount) =>
    mount({ container, t: (key) => key }),
}));

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("Voice companion", () => {
  it("keeps page voice discoverable before selection and starts only the chosen Cat", async () => {
    const cats = ["cat-a", "cat-b"].map((id) => ({
      id,
      title: id,
      tags: { smolpaws: "insider", insiderrole: "controller" },
      execution_status: "idle",
    }));
    mocked.snapshot = { status: "idle", controllerId: null };
    let mountPage;
    const request = vi.fn(async ({ path }) => {
      if (path.startsWith("/api/conversations/search"))
        return { items: cats, next_page_id: null };
      if (path === "/api/workspaces") return { workspaces: [] };
      if (path.includes("/events/search")) return { items: [] };
      return cats.find((cat) => path === `/api/conversations/${cat.id}`);
    });
    const dispose = activate({
      apiVersion: "1",
      backend: { id: "backend-a", orgId: null },
      agentServer: { request },
      registerCompanion: () => vi.fn(),
      registerPage: (_, mount) => {
        mountPage = mount;
        return vi.fn();
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const unmount = mountPage({ container, navigate: vi.fn() });
    try {
      const query = (action) =>
        container.querySelector(`[data-action="${action}"]`);
      await waitFor(() => expect(query("controller").options.length).toBe(3));
      expect(query("voice-start").textContent).toBe("voiceStart");
      expect(query("voice-start").disabled).toBe(true);
      expect(container.textContent).toContain("voiceChoose");
      query("voice-start").click();
      expect(mocked.start).not.toHaveBeenCalled();

      query("controller").value = "cat-b";
      query("controller").dispatchEvent(new Event("change"));
      await waitFor(() => expect(query("voice-start").disabled).toBe(false));
      query("voice-start").click();
      expect(mocked.start).toHaveBeenCalledWith(
        cats[1],
        expect.any(HTMLAudioElement),
      );

      mocked.snapshot = { status: "connecting", controllerId: "cat-b" };
      mocked.onChange();
      expect(query("voice-start").disabled).toBe(true);
      query("voice-start").click();
      expect(mocked.start).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      dispose();
    }
  });

  it.each(["speaking", "listening"])(
    "keeps typed requests out while voice is %s with a pending controller request",
    async (status) => {
      const controller = {
        id: "cat-a",
        title: "Insider Cat",
        tags: { smolpaws: "insider", insiderrole: "controller" },
        execution_status: "idle",
      };
      mocked.snapshot = {
        status,
        controllerId: controller.id,
        provider: "openai",
        requestPending: true,
      };
      let mountPage;
      const request = vi.fn(async ({ path }) => {
        if (path.startsWith("/api/conversations/search"))
          return { items: [controller], next_page_id: null };
        if (path === "/api/workspaces") return { workspaces: [] };
        if (path.includes("/events/search")) return { items: [] };
        if (path.endsWith("/events")) return { success: true };
        if (path === "/api/conversations/cat-a") return controller;
        throw new Error(`Unexpected path: ${path}`);
      });
      const dispose = activate({
        apiVersion: "1",
        backend: { id: "backend-a", orgId: null },
        agentServer: { request },
        registerPage: (_, mount) => {
          mountPage = mount;
          return vi.fn();
        },
      });
      const container = document.createElement("div");
      document.body.append(container);
      const unmount = mountPage({ container, navigate: vi.fn() });
      try {
        const query = (action) =>
          container.querySelector(`[data-action="${action}"]`);
        await waitFor(() => expect(query("controller").value).toBe("cat-a"));
        query("draft").value = "A typed follow-up";
        query("draft").dispatchEvent(new Event("input", { bubbles: true }));
        query("send").click();
        expect(
          request.mock.calls.some(([call]) => call.method === "POST"),
        ).toBe(false);
        expect(container.textContent).toContain("voiceThinking");
        expect(query("draft").value).toBe("A typed follow-up");

        mocked.snapshot = { ...mocked.snapshot, requestPending: false };
        mocked.onChange();
        query("send").click();
        await waitFor(() =>
          expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
              path: "/api/conversations/cat-a/events",
              method: "POST",
            }),
          ),
        );
      } finally {
        unmount();
        dispose();
      }
    },
  );

  it("keeps transcripts optional and safely rendered, with supported controls only", () => {
    mocked.snapshot = {
      status: "listening",
      controllerId: "cat-a",
      provider: "codex",
      transcripts: { user: "<b>Hello</b>", assistant: "The Cat is working." },
    };
    let mountCompanion;
    const dispose = activate({
      apiVersion: "1",
      backend: { id: "backend-a", orgId: null },
      registerPage: () => vi.fn(),
      registerCompanion: ({ mount }) => {
        mountCompanion = mount;
        return vi.fn();
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const unmount = mountCompanion({ container, navigate: vi.fn() });
    const query = (role) => container.querySelector(`[data-role="${role}"]`);
    const button = (action) =>
      container.querySelector(`[data-action="${action}"]`);
    expect(query("provider")).toBeNull();
    expect(query("transcripts").open).toBe(false);
    expect(query("transcripts").textContent).toContain("user: <b>Hello</b>");
    expect(query("transcripts").querySelector("b")).toBeNull();
    expect(button("interrupt").hidden).toBe(true);
    expect(button("mute").hidden).toBe(false);
    expect(button("end").hidden).toBe(false);

    mocked.snapshot = {
      ...mocked.snapshot,
      provider: "openai",
      transcripts: {},
    };
    mocked.onChange();
    expect(query("provider")).toBeNull();
    expect(query("transcripts").hidden).toBe(true);
    expect(button("interrupt").hidden).toBe(false);
    mocked.snapshot = { ...mocked.snapshot, muted: true, status: "speaking" };
    mocked.onChange();
    expect(query("voice-status").textContent).toBe("voiceSpeaking");
    expect(container.querySelector(".insider-cat-avatar").dataset.pose).toBe(
      "speaking",
    );
    expect(button("mute").getAttribute("aria-pressed")).toBe("true");
    mocked.snapshot = {
      ...mocked.snapshot,
      status: "listening",
      requestPending: true,
    };
    mocked.onChange();
    expect(query("voice-status").textContent).toBe("voiceThinking");
    expect(container.querySelector(".insider-cat-avatar").dataset.pose).toBe(
      "working",
    );
    mocked.snapshot = { status: "idle", requestPending: false };
    mocked.onChange();
    expect(container.querySelector(".insider-cat-avatar").dataset.pose).toBe(
      "sleeping",
    );
    unmount();
    dispose();
  });
});
