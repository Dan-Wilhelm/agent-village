CREATE TABLE "figma_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"figma_user_id" text NOT NULL,
	"figma_handle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "figma_accounts_company_id_unique" UNIQUE("company_id")
);
