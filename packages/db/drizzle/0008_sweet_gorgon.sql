CREATE TABLE "push_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "agent_registration" ADD COLUMN "auth_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "search_vector" tsvector;--> statement-breakpoint
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_token_user_idx" ON "push_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_token_token_idx" ON "push_token" USING btree ("token");--> statement-breakpoint
-- backfill existing messages and add FTS trigger + GIN index
UPDATE "message" SET "search_vector" = to_tsvector('english', coalesce("content", '')) WHERE "search_vector" IS NULL;--> statement-breakpoint
CREATE INDEX "message_search_vector_gin" ON "message" USING gin ("search_vector");--> statement-breakpoint
CREATE OR REPLACE FUNCTION message_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.content, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS message_search_vector_trigger ON "message";--> statement-breakpoint
CREATE TRIGGER message_search_vector_trigger BEFORE INSERT OR UPDATE OF content ON "message" FOR EACH ROW EXECUTE FUNCTION message_search_vector_update();