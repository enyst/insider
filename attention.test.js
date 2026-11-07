import { describe, expect, it } from "vitest";
import {
  belongsToCat,
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
  });
});
