CREATE TABLE "reels" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"state" text DEFAULT 'nuevo' NOT NULL,
	"state_before_incident" text,
	"incident" jsonb,
	"title" text NOT NULL,
	"formato" text DEFAULT '9:16' NOT NULL,
	"aroll_path" text,
	"guion" jsonb NOT NULL,
	"plan" jsonb,
	"build_dir" text,
	"output_dir" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reels" ADD CONSTRAINT "reels_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reels_state_idx" ON "reels" USING btree ("state");--> statement-breakpoint
CREATE INDEX "reels_channel_idx" ON "reels" USING btree ("channel_id");