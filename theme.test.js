import { describe, expect, it } from "vitest";
import { catViewStyles } from "./src/cat-view.js";

describe("Insider styles follow the Canvas colour theme", () => {
  it("inherits the page colour scheme instead of forcing dark", () => {
    expect(catViewStyles).not.toMatch(/color-scheme\s*:/);
  });

  it("keeps hex colours in the token block only", () => {
    const [tokens, ...rules] = catViewStyles.trim().split("\n");
    expect(tokens).toMatch(/--cat-accent:light-dark\(var\(--oh-accent,/);
    expect(tokens).toMatch(/--cat-muted:light-dark\(var\(--oh-muted,/);
    expect(rules.join("\n")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
