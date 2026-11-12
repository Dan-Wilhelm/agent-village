import { describe, expect, it } from "vitest";

import { decideOwner } from "@/lib/auth/owner-rules";

const user = (emails: Array<[string, boolean]>, userId = "user_1") => ({
  userId,
  emails: emails.map(([address, verified]) => ({ address, verified })),
});

describe("decideOwner", () => {
  it("fails closed when OWNER_EMAIL is missing or invalid", () => {
    expect(decideOwner(user([["a@b.co", true]]), { ownerEmail: undefined })).toEqual({ allowed: false, reason: "misconfigured" });
    expect(decideOwner(user([["a@b.co", true]]), { ownerEmail: "  " })).toEqual({ allowed: false, reason: "misconfigured" });
    expect(decideOwner(user([["a@b.co", true]]), { ownerEmail: "not-an-email" })).toEqual({ allowed: false, reason: "misconfigured" });
  });

  it("allows a verified matching email, case- and whitespace-insensitive", () => {
    expect(decideOwner(user([["Owner@Example.com", true]]), { ownerEmail: " owner@example.com " })).toEqual({ allowed: true });
  });

  it("rejects an unverified matching email", () => {
    expect(decideOwner(user([["owner@example.com", false]]), { ownerEmail: "owner@example.com" })).toEqual({ allowed: false, reason: "not_owner" });
  });

  it("rejects other users", () => {
    expect(decideOwner(user([["intruder@example.com", true]]), { ownerEmail: "owner@example.com" })).toEqual({ allowed: false, reason: "not_owner" });
  });

  it("enforces the pinned user id when configured", () => {
    const u = user([["owner@example.com", true]], "user_other");
    expect(decideOwner(u, { ownerEmail: "owner@example.com", ownerUserId: "user_1" })).toEqual({ allowed: false, reason: "not_owner" });
    expect(decideOwner(u, { ownerEmail: "owner@example.com", ownerUserId: "user_other" })).toEqual({ allowed: true });
  });
});
