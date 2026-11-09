import { describe, expect, it } from "vitest";
import {
  askOf,
  foldReactions,
  belongsToCat,
  conversationRefs,
  relativeAge,
  resolvedTags,
  groupByAttention,
  trackedTags,
  untrackedTags,
} from "./src/attention.js";

const cat = "22222222-2222-4222-8222-222222222222";
const item = (id, execution_status, extra = {}) => ({
  id,
  execution_status,
  ...extra,
});

describe("attention groups", () => {
  it("orders groups by what they need from the person and keeps load order", () => {
    const groups = groupByAttention([
      item("a", "idle"),
      item("b", "running"),
      item("c", "error"),
      item("d", "finished"),
      item("e", "waiting_for_confirmation"),
      item("f", "deleting"),
      item("g", undefined),
      item("h", "paused"),
      item("i", "stuck"),
    ]);
    expect(groups.map((g) => [g.id, g.items.map((c) => c.id)])).toEqual([
      ["needsYou", ["c", "e", "h", "i"]],
      ["working", ["b"]],
      ["finished", ["d"]],
      ["idle", ["a"]],
      ["other", ["f", "g"]],
    ]);
  });

  it("omits empty groups", () => {
    expect(groupByAttention([])).toEqual([]);
    expect(groupByAttention([item("a", "running")]).map((g) => g.id)).toEqual([
      "working",
    ]);
  });
});

describe("Cat tracking tags", () => {
  it("matches tagged workers and the Cat's own sub-conversations", () => {
    expect(belongsToCat({ tags: { insidercat: cat } }, cat)).toBe(true);
    expect(belongsToCat({ parent_conversation_id: cat }, cat)).toBe(true);
    expect(belongsToCat({ tags: { insidercat: "other" } }, cat)).toBe(false);
    expect(belongsToCat({ tags: { insidercat: cat } }, null)).toBe(false);
  });

  it("matches a Cat whichever way its id is written", () => {
    const hex = cat.replace(/-/g, "");
    expect(belongsToCat({ tags: { insidercat: cat } }, hex)).toBe(true);
    expect(belongsToCat({ parent_conversation_id: hex }, cat)).toBe(true);
    expect(belongsToCat({ tags: { insidercat: "other" } }, cat)).toBe(false);
  });

  it("adds and removes tracking without losing other tags", () => {
    const tracked = trackedTags({ team: "web" }, cat);
    expect(tracked).toEqual({
      team: "web",
      insidercat: cat,
      insiderrole: "worker",
    });
    expect(Object.keys(tracked).every((key) => /^[a-z0-9]+$/.test(key))).toBe(
      true,
    );
    expect(untrackedTags(tracked)).toEqual({ team: "web" });
    expect(untrackedTags({ insiderrole: "reviewer", insidercat: cat })).toEqual(
      { insiderrole: "reviewer" },
    );
    // Dropping the role would make this top-level conversation read as a Cat.
    expect(
      untrackedTags({
        smolpaws: "insider",
        insiderrole: "worker",
        insidercat: cat,
      }),
    ).toEqual({ smolpaws: "insider", insiderrole: "worker" });
  });
});

describe("resolved conversations", () => {
  it("wins over every state except needs-you and running work", () => {
    const resolved = { tags: { resolved: "user" } };
    const groups = groupByAttention([
      item("a", "finished", resolved),
      item("b", "idle", { tags: { resolved: "auto" } }),
      item("c", "waiting_for_confirmation", resolved),
      item("d", "running", { tags: { resolved: "maybe" } }),
      item("e", "running", resolved),
    ]);
    expect(groups.map((g) => [g.id, g.items.map((c) => c.id)])).toEqual([
      ["needsYou", ["c"]],
      ["working", ["d", "e"]],
      ["resolved", ["a", "b"]],
    ]);
  });

  it("sets and clears the shared resolved tag", () => {
    expect(resolvedTags({ team: "web" }, true)).toEqual({
      team: "web",
      resolved: "user",
    });
    expect(resolvedTags({ team: "web", resolved: "auto" }, false)).toEqual({
      team: "web",
    });
  });
});

describe("asks", () => {
  it("puts a turn that ended on a question under needs-you unless resolved", () => {
    const asked = (extra = {}) => ({
      tags: {
        turn: "asked",
        ask: "  Keep the redirects or remove them?  ",
        ...extra,
      },
    });
    const groups = groupByAttention([
      item("a", "finished", asked()),
      item("b", "idle", asked()),
      item("c", "running", asked()),
      item("d", "finished", asked({ resolved: "user" })),
      item("e", "finished", { tags: { ask: "stale", turn: "answered" } }),
    ]);
    expect(groups.map((g) => [g.id, g.items.map((c) => c.id)])).toEqual([
      ["needsYou", ["a", "b"]],
      ["working", ["c"]],
      ["finished", ["e"]],
      ["resolved", ["d"]],
    ]);
    expect(askOf(item("a", "finished", asked()))).toBe(
      "Keep the redirects or remove them?",
    );
    expect(askOf(item("e", "finished", { tags: { ask: "stale" } }))).toBe("");
  });
});

describe("conversation references", () => {
  it("finds dashed and plain IDs once each, in order, up to the limit", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222222242228222222222222222";
    expect(
      conversationRefs(`see ${a}, then ${b} and ${a.replace(/-/g, "")}`),
    ).toEqual([a, b]);
    expect(conversationRefs(`${a} ${b}`, 1)).toEqual([a]);
    expect(conversationRefs("no ids here")).toEqual([]);
  });

  it("formats a compact relative age", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    expect(relativeAge("2026-11-07T11:55:00Z", now, "en")).toBe("5m ago");
    expect(relativeAge("2026-11-07T09:00:00Z", now, "en")).toBe("3h ago");
    expect(relativeAge("not a date", now, "en")).toBe("");
    expect(relativeAge("2026-11-07T12:02:00Z", now, "en")).toBe("now");
  });
});

describe("foldReactions", () => {
  const r = (target_event_id, emoji, source, removed = false) => ({
    kind: "ReactionEvent",
    target_event_id,
    emoji,
    source,
    removed,
  });
  it("keeps the latest event per target, emoji and source", () => {
    const folded = foldReactions([
      r("m1", "eyes", "agent"),
      r("m1", "+1", "user"),
      r("m1", "eyes", "agent", true),
      r("m1", "+1", "agent"),
      r("m2", "eyes", "agent", true),
      r("m2", "eyes", "agent"),
      r("m3", "rocket", "agent"),
      { kind: "MessageEvent", id: "m1" },
    ]);
    expect(folded.get("m1")).toEqual([
      { emoji: "+1", sources: ["user", "agent"] },
    ]);
    expect(folded.get("m2")).toEqual([{ emoji: "eyes", sources: ["agent"] }]);
    expect(folded.has("m3")).toBe(false);
  });
});
