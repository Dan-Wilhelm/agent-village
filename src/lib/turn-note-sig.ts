import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Per-turn system notes travel through the browser (the conversation lives there).
 * They are signed so the browser can't add or change system-level instructions.
 */
function key() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured");
  return createHash("sha256").update(`turn-note:${secret}`).digest();
}

export function signTurnNote(content: string) {
  return createHmac("sha256", key()).update(content).digest("base64url");
}

export function verifyTurnNote(content: string, sig: unknown) {
  if (typeof sig !== "string" || sig.length > 100) return false;
  const expected = Buffer.from(signTurnNote(content));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
