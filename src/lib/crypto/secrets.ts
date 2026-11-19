import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for secrets at rest (integration tokens).
 *
 * - AES-256-GCM with a random 96-bit IV per value.
 * - `context` is bound as additional authenticated data (AAD), e.g.
 *   "clickup-token:<accountId>", so a ciphertext copied to another row or
 *   purpose fails to decrypt.
 * - Format: "v1.<iv>.<tag>.<ciphertext>" (base64url parts).
 * - The 32-byte key comes from ENCRYPTION_KEY (base64) and never leaves the server.
 */

const VERSION = "v1";

function loadKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("ENCRYPTION_KEY is not configured");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptSecret(plaintext: string, context: string, rawKey = process.env.ENCRYPTION_KEY): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, context: string, rawKey = process.env.ENCRYPTION_KEY): string {
  const key = loadKey(rawKey);
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Unsupported secret format");
  const [, ivB64, tagB64, ctB64] = parts;
  const tag = Buffer.from(tagB64, "base64url");
  if (tag.length !== 16) throw new Error("Invalid secret");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}

export const secretContext = {
  clickupToken: (accountId: string) => `clickup-token:${accountId}`,
};
