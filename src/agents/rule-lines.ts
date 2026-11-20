/**
 * Finding and replacing ONE rule line in a playbook note (Craft.md / Context.md /
 * Test cases.md). Pure functions — the agent quotes a rule, the server finds the
 * exact line; ambiguity is an error, never a guess.
 */

/** Comparable form: no list marker, no markdown stars/underscores, no "(learned …)" stamp, lower case. */
export function normaliseRuleText(text: string) {
  return text
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/_?\((?:learned|changed) [^)]*\)_?/gi, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** All list-item lines that contain the quoted text (min. 10 characters to avoid accidental matches). */
export function findRuleLines(content: string, quote: string): string[] {
  const q = normaliseRuleText(quote);
  if (q.length < 10) return [];
  return content.split("\n").filter((line) => /^\s*[-*+]\s+/.test(line) && normaliseRuleText(line).includes(q));
}

/** Replaces (or removes, if `replacement` is null) exactly this line; throws if it is no longer there. */
export function replaceRuleLine(content: string, line: string, replacement: string | null) {
  const lines = content.split("\n");
  const idx = lines.indexOf(line);
  if (idx < 0) throw new Error("That rule changed in the meantime — nothing was changed. Please ask the agent again.");
  if (replacement === null) lines.splice(idx, 1);
  else lines[idx] = replacement;
  return lines.join("\n");
}
