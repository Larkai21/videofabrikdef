CREATE TABLE "episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"state" text DEFAULT 'nuevo' NOT NULL,
	"state_before_incident" text,
	"incident" jsonb,
	"source_url" text NOT NULL,
	"source_platform" text NOT NULL,
	"source_video_id" text,
	"source_title" text,
	"source_channel_name" text,
	"source_channel_url" text,
	"source_published_at" timestamp with time zone,
	"license_status" text DEFAULT 'ajeno_sin_acuerdo' NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"media_path" text,
	"audio_path" text,
	"transcript_path" text,
	"focus" jsonb,
	"beats" jsonb,
	"stt_meta" jsonb,
	"downloaded_at" timestamp with time zone,
	"transcribed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD COLUMN "episode_id" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_source_idx" ON "episodes" USING btree ("source_platform","source_video_id");--> statement-breakpoint
CREATE INDEX "episodes_state_idx" ON "episodes" USING btree ("state");--> statement-breakpoint
CREATE INDEX "episodes_channel_idx" ON "episodes" USING btree ("channel_id");--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;