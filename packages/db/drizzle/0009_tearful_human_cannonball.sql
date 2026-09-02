CREATE TABLE "agent_session" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"opencode_session_id" text,
	"acp_session_id" text,
	"title" varchar(120) NOT NULL,
	"system_prompt" text,
	"model_id" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"parent_session_id" text,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_skill" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"skill_id" varchar(80) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"scope" varchar(20) DEFAULT 'workspace' NOT NULL,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_skill_agent_skill_scope_unique" UNIQUE("agent_id","skill_id","scope","session_id")
);
--> statement-breakpoint
ALTER TABLE "agent_registration" ADD COLUMN "system_prompt" text;--> statement-breakpoint
ALTER TABLE "agent_registration" ADD COLUMN "transport_flavor" varchar(20) DEFAULT 'opencode-http' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_agent_id_agent_registration_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_parent_session_id_agent_session_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "public"."agent_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill" ADD CONSTRAINT "agent_skill_agent_id_agent_registration_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill" ADD CONSTRAINT "agent_skill_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_session_agent_idx" ON "agent_session" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_session_channel_idx" ON "agent_session" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "agent_session_agent_channel_idx" ON "agent_session" USING btree ("agent_id","channel_id");--> statement-breakpoint
CREATE INDEX "agent_skill_agent_idx" ON "agent_skill" USING btree ("agent_id");