import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";

const key = randomBytes(32).toString("base64");

describe("secrets", () => {
  it("round-trips and never contains the plaintext", () => {
    const c = encryptSecret("pk_123_SECRET", "ctx:a", key);
    expect(c.startsWith("v1.")).toBe(true);
    expect(c).not.toContain("pk_123_SECRET");
    expect(decryptSecret(c, "ctx:a", key)).toBe("pk_123_SECRET");
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret("x", "ctx", key)).not.toBe(encryptSecret("x", "ctx", key));
  });

  it("rejects a different context (ciphertext moved to another row)", () => {
    const c = encryptSecret("secret", "ctx:a", key);
    expect(() => decryptSecret(c, "ctx:b", key)).toThrow();
  });

  it("rejects tampering and a wrong key", () => {
    const c = encryptSecret("secret", "ctx", key);
    const parts = c.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 1;
    parts[3] = flipped.toString("base64url");
    expect(() => decryptSecret(parts.join("."), "ctx", key)).toThrow();
    expect(() => decryptSecret(c, "ctx", randomBytes(32).toString("base64"))).toThrow();
  });

  it("refuses missing or short keys", () => {
    expect(() => encryptSecret("x", "ctx", undefined)).toThrow(/ENCRYPTION_KEY/);
    expect(() => encryptSecret("x", "ctx", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
