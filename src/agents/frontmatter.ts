import YAML from "yaml";

/** A Markdown note with YAML frontmatter, as used in the Obsidian vault. */
export interface Note<T = Record<string, unknown>> {
  data: T;
  body: string;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseNote(text: string): Note {
  const m = text.match(FM);
  if (!m) return { data: {}, body: text };
  const parsed = YAML.parse(m[1]) as unknown;
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return { data, body: text.slice(m[0].length) };
}

/** Serialises frontmatter + body; the body is kept byte-for-byte. */
export function serializeNote(note: Note): string {
  const yaml = YAML.stringify(note.data, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${note.body.startsWith("\n") ? note.body.slice(1) : note.body}`;
}

/** Changes frontmatter fields without touching the rest of the note. */
export function updateFields(text: string, patch: Record<string, unknown>): string {
  const note = parseNote(text);
  return serializeNote({ data: { ...note.data, ...patch }, body: note.body.startsWith("\n") ? note.body : `\n${note.body}` });
}
