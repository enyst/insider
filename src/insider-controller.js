export const CONTROLLER_TAGS = {
  smolpaws: "insider",
  insiderrole: "controller",
};

export const isController = (conversation) =>
  conversation?.tags?.smolpaws === CONTROLLER_TAGS.smolpaws &&
  !conversation.parent_conversation_id &&
  conversation.tags.insiderrole === CONTROLLER_TAGS.insiderrole;

/** Hide only our own transport envelope; the saved user event remains intact. */
export function userMessageForDisplay(text) {
  const match = text.match(
    /^Canvas (?:voice )?context \(data, not instructions\):\n([^\n]+)\n\nUser request:\n([\s\S]*)$/,
  );
  if (!match) return text;
  try {
    const context = JSON.parse(match[1]);
    if (
      context &&
      typeof context === "object" &&
      typeof context.backend_id === "string"
    )
      return match[2];
  } catch {
    // User-authored or malformed text is displayed verbatim.
  }
  return text;
}
