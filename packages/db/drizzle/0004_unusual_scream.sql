CREATE TABLE "agent_registration" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"transport" varchar(20) DEFAULT 'network' NOT NULL,
	"endpoint" text,
	"auth_secret" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"capabilities" jsonb,
	"machine_metadata" jsonb,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_registration" ADD CONSTRAINT "agent_registration_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_registration" ADD CONSTRAINT "agent_registration_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_owner_idx" ON "agent_registration" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agent_workspace_idx" ON "agent_registration" USING btree ("workspace_id");