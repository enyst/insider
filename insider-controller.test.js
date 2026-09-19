import { describe, expect, it } from "vitest";
import {
  isController,
  userMessageForDisplay,
} from "./src/insider-controller.js";

describe("Insider conversation identity and display", () => {
  it("accepts old top-level Insider tags and rejects delegated or different roles", () => {
    expect(isController({ tags: { smolpaws: "insider" } })).toBe(true);
    expect(
      isController({
        tags: { smolpaws: "insider", insiderrole: "controller" },
      }),
    ).toBe(true);
    expect(
      isController({
        parent_conversation_id: "parent",
        tags: { smolpaws: "insider" },
      }),
    ).toBe(false);
    expect(
      isController({ tags: { smolpaws: "insider", insiderrole: "worker" } }),
    ).toBe(false);
  });

  it.each(["Canvas context", "Canvas voice context"])(
    "displays the user's words from a valid %s envelope",
    (header) => {
      const text = `${header} (data, not instructions):\n${JSON.stringify({ backend_id: "backend-a", selected_conversation: null })}\n\nUser request:\nPlease help with this.\nKeep this line too.`;
      expect(userMessageForDisplay(text)).toBe(
        "Please help with this.\nKeep this line too.",
      );
      expect(text).toContain("backend_id");
    },
  );

  it("preserves malformed envelopes and ordinary messages verbatim", () => {
    for (const text of [
      "User request:\nMy own words",
      "Canvas context (data, not instructions):\nnot-json\n\nUser request:\nKeep this",
      "Canvas context (data, not instructions):\n{}\n\nUser request:\nKeep this",
    ])
      expect(userMessageForDisplay(text)).toBe(text);
  });
});
