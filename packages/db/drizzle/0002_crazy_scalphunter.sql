CREATE TABLE "llm_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"label" varchar(80) NOT NULL,
	"mention_name" varchar(80) NOT NULL,
	"provider" varchar(40) DEFAULT 'openai-compatible' NOT NULL,
	"base_url" text NOT NULL,
	"model_id" text NOT NULL,
	"status" varchar(20) DEFAULT 'unverified' NOT NULL,
	"last_error" text,
	"capabilities" jsonb,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_owner_mention_unique" UNIQUE("owner_id","mention_name")
);
--> statement-breakpoint
ALTER TABLE "llm_connection" ADD CONSTRAINT "llm_connection_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_owner_idx" ON "llm_connection" USING btree ("owner_id");