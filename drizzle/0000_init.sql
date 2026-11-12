CREATE TABLE "activity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clickup_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clickup_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"space_id" text NOT NULL,
	"folder_id" text,
	"name" text NOT NULL,
	"statuses" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clickup_spaces" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"statuses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clickup_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"space_id" text NOT NULL,
	"folder_id" text,
	"list_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"status_type" text,
	"status_color" text,
	"priority" integer,
	"due_at" timestamp with time zone,
	"start_at" timestamp with time zone,
	"created_at_remote" timestamp with time zone,
	"updated_at_remote" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"assignees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" text,
	"description_md" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"external_user_id" text NOT NULL,
	"external_user_name" text NOT NULL,
	"team_id" text,
	"team_name" text,
	"selected_space_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"webhook_id" text,
	"webhook_secret_ciphertext" text,
	"last_full_sync_at" timestamp with time zone,
	"sync_cursor_ms" text,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clickup_folders" ADD CONSTRAINT "clickup_folders_account_id_integration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clickup_lists" ADD CONSTRAINT "clickup_lists_account_id_integration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clickup_spaces" ADD CONSTRAINT "clickup_spaces_account_id_integration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clickup_tasks" ADD CONSTRAINT "clickup_tasks_account_id_integration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_at" ON "activity_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "clickup_lists_space" ON "clickup_lists" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "clickup_tasks_account" ON "clickup_tasks" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "clickup_tasks_list" ON "clickup_tasks" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "clickup_tasks_due" ON "clickup_tasks" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_accounts_ws_provider" ON "integration_accounts" USING btree ("workspace_id","provider");