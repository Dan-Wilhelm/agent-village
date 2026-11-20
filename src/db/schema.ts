import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Work environments. The MVP uses exactly one ("Default"); the model supports many.
 */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One connected account per provider and workspace. Secrets are stored ONLY as
 * ciphertext produced by src/lib/crypto/secrets.ts (AES-256-GCM, bound to the row id).
 * No task content is ever stored: tools are read live ("ClickUp only").
 */
export const integrationAccounts = pgTable(
  "integration_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["clickup"] }).notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    externalUserId: text("external_user_id").notNull(),
    externalUserName: text("external_user_name").notNull(),
    /** ClickUp "team" = the ClickUp Workspace that is synced. */
    teamId: text("team_id"),
    teamName: text("team_name"),
    selectedSpaceIds: jsonb("selected_space_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("integration_accounts_ws_provider").on(t.workspaceId, t.provider)],
);

/** Append-only audit log of everything that happens (owner, system and agents). */
export const activityLog = pgTable(
  "activity_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("activity_log_at").on(t.at)],
);

// Better Auth tables (login): user, session, account, verification, passkey, rateLimit
export * from "./auth-schema";

/**
 * Agent visits created by triggers (schedule, before a calendar event). Holds
 * NO content — only who, a generic reason, priority and timing. The content is
 * built live when the owner opens the visit.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: text("agent_id").notNull(),
    reason: text("reason").notNull(),
    priority: text("priority", { enum: ["urgent", "high", "normal", "low"] }).notNull(),
    /** Dedupe key, e.g. "acme-daily-briefing:schedule:2026-11-16T08:00". */
    triggerKey: text("trigger_key").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["pending", "delivered", "expired"] }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("visits_trigger_key").on(t.triggerKey), index("visits_status_due").on(t.status, t.dueAt)],
);

/** Web Push endpoints of the owner's devices (for generic notifications only). */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Fixed-window request counters for app-level rate limits (no content, only a bucket name). */
export const appRateLimits = pgTable("app_rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
});

/**
 * Figma personal access tokens — one per company (strict isolation: an agent only
 * gets its own company's Figma account). Encrypted like the ClickUp token.
 */
export const figmaAccounts = pgTable("figma_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Company id from the vault (e.g. "sqvm"). */
  companyId: text("company_id").notNull().unique(),
  tokenCiphertext: text("token_ciphertext").notNull(),
  figmaUserId: text("figma_user_id").notNull(),
  figmaHandle: text("figma_handle").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
