import {
  bigserial,
  boolean,
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
    webhookId: text("webhook_id"),
    webhookSecretCiphertext: text("webhook_secret_ciphertext"),
    lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
    /** High-water mark (ClickUp date_updated) for incremental syncs. */
    syncCursorMs: text("sync_cursor_ms"),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("integration_accounts_ws_provider").on(t.workspaceId, t.provider)],
);

export type StatusDef = { status: string; type: string; color: string; orderindex: number };

export const clickupSpaces = pgTable("clickup_spaces", {
  id: text("id").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => integrationAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  statuses: jsonb("statuses").$type<StatusDef[]>().notNull().default([]),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clickupFolders = pgTable("clickup_folders", {
  id: text("id").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => integrationAccounts.id, { onDelete: "cascade" }),
  spaceId: text("space_id").notNull(),
  name: text("name").notNull(),
  hidden: boolean("hidden").notNull().default(false),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clickupLists = pgTable(
  "clickup_lists",
  {
    id: text("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    folderId: text("folder_id"),
    name: text("name").notNull(),
    statuses: jsonb("statuses").$type<StatusDef[] | null>(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clickup_lists_space").on(t.spaceId)],
);

export type TaskAssignee = { id: string; username: string; initials?: string; color?: string };

export const clickupTasks = pgTable(
  "clickup_tasks",
  {
    id: text("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    folderId: text("folder_id"),
    listId: text("list_id").notNull(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    status: text("status").notNull(),
    statusType: text("status_type"),
    statusColor: text("status_color"),
    priority: integer("priority"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    startAt: timestamp("start_at", { withTimezone: true }),
    createdAtRemote: timestamp("created_at_remote", { withTimezone: true }),
    updatedAtRemote: timestamp("updated_at_remote", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    assignees: jsonb("assignees").$type<TaskAssignee[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    url: text("url"),
    descriptionMd: text("description_md"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clickup_tasks_account").on(t.accountId),
    index("clickup_tasks_list").on(t.listId),
    index("clickup_tasks_due").on(t.dueAt),
  ],
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
