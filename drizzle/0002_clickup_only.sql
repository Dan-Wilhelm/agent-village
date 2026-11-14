DROP TABLE "clickup_folders" CASCADE;--> statement-breakpoint
DROP TABLE "clickup_lists" CASCADE;--> statement-breakpoint
DROP TABLE "clickup_spaces" CASCADE;--> statement-breakpoint
DROP TABLE "clickup_tasks" CASCADE;--> statement-breakpoint
ALTER TABLE "integration_accounts" DROP COLUMN "webhook_id";--> statement-breakpoint
ALTER TABLE "integration_accounts" DROP COLUMN "webhook_secret_ciphertext";--> statement-breakpoint
ALTER TABLE "integration_accounts" DROP COLUMN "last_full_sync_at";--> statement-breakpoint
ALTER TABLE "integration_accounts" DROP COLUMN "sync_cursor_ms";--> statement-breakpoint
ALTER TABLE "integration_accounts" DROP COLUMN "last_sync_error";