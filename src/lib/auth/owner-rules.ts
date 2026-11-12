/**
 * Pure owner-lock rules (no framework imports, so they are unit-testable).
 *
 * Agent Village is a single-owner app. A signed-in user is the owner only if:
 *  1. OWNER_EMAIL is configured (fail closed when it is missing), and
 *  2. one of the user's *verified* email addresses equals OWNER_EMAIL, and
 *  3. if OWNER_USER_ID is configured, the user id matches it as well.
 */

export interface OwnerConfig {
  ownerEmail: string | undefined;
  ownerUserId?: string | undefined;
}

export interface UserIdentity {
  userId: string;
  emails: ReadonlyArray<{ address: string; verified: boolean }>;
}

export type OwnerDecision =
  | { allowed: true }
  | { allowed: false; reason: "misconfigured" | "not_owner" };

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function decideOwner(user: UserIdentity, config: OwnerConfig): OwnerDecision {
  const ownerEmail = config.ownerEmail ? normalizeEmail(config.ownerEmail) : "";
  if (!ownerEmail || !ownerEmail.includes("@")) {
    return { allowed: false, reason: "misconfigured" };
  }

  const pinnedId = config.ownerUserId?.trim();
  if (pinnedId && pinnedId !== user.userId) {
    return { allowed: false, reason: "not_owner" };
  }

  const hasVerifiedOwnerEmail = user.emails.some(
    (e) => e.verified && normalizeEmail(e.address) === ownerEmail,
  );
  return hasVerifiedOwnerEmail ? { allowed: true } : { allowed: false, reason: "not_owner" };
}
