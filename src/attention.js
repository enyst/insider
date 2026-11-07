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
export const COLLAPSED_GROUPS = new Set(["idle"]);

const groupOf = new Map(
  ATTENTION_GROUPS.flatMap((group) =>
    group.statuses.map((status) => [status, group.id]),
  ),
);

/** Return non-empty groups in attention order; unknown states go to "other". */
export function groupByAttention(conversations) {
  const buckets = new Map(
    [...ATTENTION_GROUPS.map((group) => group.id), "other"].map((id) => [
      id,
      [],
    ]),
  );
  for (const conversation of conversations)
    buckets
      .get(groupOf.get(conversation?.execution_status) || "other")
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
