import { describe, expect, it } from "vitest";
import { catViewStyles } from "./src/cat-view.js";

const [tokens, ...rules] = catViewStyles.trim().split("\n");
const defs = Object.fromEntries(
  [...tokens.matchAll(/(--cat-[a-z-]+):([^;}]+)/g)].map((m) => [m[1], m[2]]),
);

describe("Insider styles follow the Canvas colour theme", () => {
  it("inherits the page colour scheme instead of forcing dark", () => {
    expect(catViewStyles).not.toMatch(/color-scheme\s*:/);
  });

  it("keeps hex colours in the token block only", () => {
    expect(rules.join("\n")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("takes light colours from the theme and keeps the dark palette", () => {
    const expected = {
      "--cat-muted": ["--oh-muted", "#b4b7ae"],
      "--cat-accent": ["--oh-accent", "#cad7b4"],
      "--cat-ink": ["--oh-accent-foreground", "#252e20"],
      "--cat-accent-hover": [null, "#d7e3c2"],
      "--cat-warn": ["--oh-feedback-warning", "#f0c697"],
      "--cat-error": ["--oh-feedback-error", "#f4aaa0"],
    };
    for (const [name, [themeVar, dark]] of Object.entries(expected)) {
      expect(defs[name]).toMatch(/^light-dark\(/);
      expect(defs[name].endsWith(`,${dark})`)).toBe(true);
      if (themeVar) expect(defs[name]).toContain(`var(${themeVar},`);
    }
  });

  it("never defines a token in terms of itself", () => {
    for (const [name, value] of Object.entries(defs))
      expect(value).not.toContain(`var(${name})`);
  });

  it("clamps a long ask so it cannot stretch the card", () => {
    const ask = rules.find((rule) => rule.includes(".cat-card-ask{"));
    expect(ask).toMatch(/display:\s*-webkit-box/);
    expect(ask).toMatch(/-webkit-line-clamp:\s*2/);
    expect(ask).toMatch(/overflow:\s*hidden/);
  });
});
