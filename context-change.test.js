import { afterEach, describe, expect, it, vi } from "vitest";
import { activate } from "./src/extension.js";

const { voice } = vi.hoisted(() => ({
  voice: { getSnapshot: vi.fn(), end: vi.fn() },
}));

vi.mock("./src/voice-session.js", () => ({
  createVoiceSession: () => voice,
}));

afterEach(() => vi.resetAllMocks());

describe("Host conversation context changes", () => {
  it("ends only the bound call while the App page is unmounted and unsubscribes on disposal", () => {
    let listener;
    const unsubscribe = vi.fn(() => {
      listener = null;
    });
    voice.getSnapshot.mockReturnValue({ controllerId: "cat-a" });
    const unregisterPage = vi.fn();
    const dispose = activate({
      apiVersion: "1",
      backend: { id: "backend-a", orgId: null },
      registerPage: () => unregisterPage,
      onConversationContextChangeRequested: (callback) => {
        listener = callback;
        return unsubscribe;
      },
    });

    // The shell subscription remains active without mounting the Projects page.
    listener({ conversationId: "cat-b", reason: "condense" });
    expect(voice.end).not.toHaveBeenCalled();
    listener({ conversationId: "cat-a", reason: "condense" });
    expect(voice.end).toHaveBeenCalledOnce();
    voice.getSnapshot.mockReturnValue({ controllerId: null });
    listener({ conversationId: "cat-a", reason: "condense" });
    expect(voice.end).toHaveBeenCalledOnce();

    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(listener).toBeNull();
    expect(unregisterPage).toHaveBeenCalledOnce();
  });
});
