import { afterEach, describe, expect, it, vi } from "vitest";
import { activate } from "./src/extension.js";

const mocked = vi.hoisted(() => ({ snapshot: {}, onChange: null }));
vi.mock("./src/voice-session.js", () => ({
  createVoiceSession: ({ onChange }) => {
    mocked.onChange = onChange;
    return {
      getSnapshot: () => mocked.snapshot,
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
  it("shows provider and latest transcripts as text, with supported controls only", () => {
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
    expect(query("provider").textContent).toBe("Codex");
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
    expect(query("provider").textContent).toBe("OpenAI API");
    expect(query("transcripts").hidden).toBe(true);
    expect(button("interrupt").hidden).toBe(false);
    unmount();
    dispose();
  });
});
