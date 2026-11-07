// Group work by what it needs from the person, not by recency alone.
// Each group keeps the incoming order (the board loads newest first).
export const ATTENTION_GROUPS = [
  {
    id: "needsYou",
    statuses: ["waiting_for_confirmation", "paused", "error", "stuck"],
  },
  { id: "working", statuses: ["running"] },
  // An ended run is not a claim that the task succeeded: it is ready to check.
  { id: "finished", statuses: ["finished"] },
  { id: "idle", statuses: ["idle"] },
];
// Groups that start collapsed because they rarely need the person.
export const COLLAPSED_GROUPS = new Set(["idle", "resolved"]);

// Shared with Agent Server Projects: "user" from the Resolve button, "auto"
// from a server-side hook. Resolved wins over every state except needs-you
// and working.
export const RESOLVED_TAG = "resolved";
export const isResolved = (conversation) =>
  ["user", "auto"].includes(conversation?.tags?.[RESOLVED_TAG]);

/** Tags that mark a conversation resolved or reopen it, keeping its other tags. */
export function resolvedTags(tags, resolved) {
  const next = { ...(tags || {}) };
  if (resolved) next[RESOLVED_TAG] = "user";
  else delete next[RESOLVED_TAG];
  return next;
}

const groupOf = new Map(
  ATTENTION_GROUPS.flatMap((group) =>
    group.statuses.map((status) => [status, group.id]),
  ),
);

/** The board group a conversation belongs to. */
export function groupFor(conversation) {
  const group = groupOf.get(conversation?.execution_status) || "other";
  // Running work was just reopened by a new message, matching Agent Server.
  return isResolved(conversation) && !["needsYou", "working"].includes(group)
    ? "resolved"
    : group;
}

/** Return non-empty groups in attention order; unknown states go to "other". */
export function groupByAttention(conversations) {
  const buckets = new Map(
    [...ATTENTION_GROUPS.map((group) => group.id), "other", "resolved"].map(
      (id) => [id, []],
    ),
  );
  for (const conversation of conversations)
    buckets
      .get(groupFor(conversation))
      .push(conversation);
  return [...buckets]
    .filter(([, items]) => items.length)
    .map(([id, items]) => ({ id, items }));
}

// Workers a Cat started or adopted carry the Cat's conversation ID.
// Keys must stay lowercase alphanumeric for Agent Server tag validation.
export const WORKER_CAT_TAG = "insidercat";
export const WORKER_ROLE = "worker";

/** True when this conversation is work tracked by the given Cat. */
export const belongsToCat = (conversation, controllerId) =>
  Boolean(controllerId) &&
  (conversation?.tags?.[WORKER_CAT_TAG] === controllerId ||
    conversation?.parent_conversation_id === controllerId);

/** Tags that attach a conversation to a Cat, keeping its other tags. */
export function trackedTags(tags, controllerId) {
  return {
    ...(tags || {}),
    [WORKER_CAT_TAG]: controllerId,
    insiderrole: tags?.insiderrole || WORKER_ROLE,
  };
}

/** Tags that detach a conversation from its Cat, keeping its other tags. */
export function untrackedTags(tags) {
  const next = { ...(tags || {}) };
  delete next[WORKER_CAT_TAG];
  // Without a role, a top-level smolpaws:insider conversation reads as a Cat.
  if (next.insiderrole === WORKER_ROLE && next.smolpaws !== "insider")
    delete next.insiderrole;
  return next;
}

const UUID_TEXT =
  /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi;
/** Compare conversation IDs whether or not the API wrote them with dashes. */
export const idKey = (id) => String(id || "").toLowerCase().replace(/-/g, "");

/** Conversation IDs mentioned in a message, first mention first, deduplicated. */
export function conversationRefs(text, limit = 6) {
  const seen = new Set();
  const refs = [];
  for (const match of String(text || "").matchAll(UUID_TEXT)) {
    const key = idKey(match[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(match[0]);
    if (refs.length >= limit) break;
  }
  return refs;
}

/** A compact, localized "5 min. ago" for a conversation's last update. */
export function relativeAge(value, now = Date.now(), locale) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  // A server clock slightly ahead of ours still reads as "now".
  const seconds = Math.min(0, Math.round((time - now) / 1000));
  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "narrow",
  });
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size)
      return format.format(Math.round(seconds / size), unit);
  return format.format(0, "second");
}

// Agent Server reactions: shortcodes from its allowlist, shown as emoji.
export const REACTION_EMOJI = {
  eyes: "👀",
  "+1": "👍",
  white_check_mark: "✅",
  tada: "🎉",
  thinking_face: "🤔",
  heart: "❤️",
};

/**
 * Fold ReactionEvents (oldest first) into the reactions each event shows now:
 * Map<target event id, [{ emoji, sources: ["agent" | "user", ...] }]>.
 * The latest event per target, emoji and source wins; unknown emoji are skipped.
 */
export function foldReactions(events) {
  const latest = new Map();
  for (const event of events || []) {
    if (event?.kind !== "ReactionEvent" || !event.target_event_id) continue;
    if (!REACTION_EMOJI[event.emoji]) continue;
    const key = JSON.stringify([event.target_event_id, event.emoji, event.source]);
    latest.delete(key);
    latest.set(key, event);
  }
  const byTarget = new Map();
  for (const event of latest.values()) {
    if (event.removed) continue;
    const chips = byTarget.get(event.target_event_id) || [];
    let chip = chips.find((item) => item.emoji === event.emoji);
    if (!chip) chips.push((chip = { emoji: event.emoji, sources: [] }));
    chip.sources.push(event.source === "user" ? "user" : "agent");
    byTarget.set(event.target_event_id, chips);
  }
  return byTarget;
}
