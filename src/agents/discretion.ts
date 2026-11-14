/**
 * Discretion guard: text that goes into a company's work environment (comments,
 * DMs, task texts) must never reveal the village, agents or AI. Applied
 * server-side to every outgoing text, regardless of what the model wrote.
 */
const FORBIDDEN: Array<{ re: RegExp; label: string }> = [
  { re: /agent[\s_-]*village/i, label: "Agent Village" },
  { re: /\bvillage\b/i, label: "village" },
  { re: /\b(ai|a\.i\.|ki)\b/i, label: "AI" },
  { re: /\b(claude|anthropic|chatgpt|gpt)\b/i, label: "AI product names" },
  { re: /\b(agent|agents|bot|assistant)\b/i, label: "agent/bot" },
  { re: /künstliche intelligenz|artificial intelligence|automat(ed|isch|ion)/i, label: "automation" },
];

export function findDiscretionViolations(text: string): string[] {
  return FORBIDDEN.filter((f) => f.re.test(text)).map((f) => f.label);
}

export function assertDiscreet(text: string) {
  const hits = findDiscretionViolations(text);
  if (hits.length) {
    throw new Error(`Blocked: the text would mention ${hits.join(", ")}. Rephrase it as Dan would write it.`);
  }
}
