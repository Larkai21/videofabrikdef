CREATE TABLE "shorts" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"idx" integer NOT NULL,
	"state" text DEFAULT 'propuesto' NOT NULL,
	"state_before_incident" text,
	"incident" jsonb,
	"from_ms" integer NOT NULL,
	"to_ms" integer NOT NULL,
	"title" text NOT NULL,
	"hook" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"master" jsonb NOT NULL,
	"output_dir" text,
	"published_at" timestamp with time zone,
	"discard_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shorts" ADD CONSTRAINT "shorts_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shorts" ADD CONSTRAINT "shorts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shorts_video_idx_idx" ON "shorts" USING btree ("video_id","idx");--> statement-breakpoint
CREATE INDEX "shorts_state_idx" ON "shorts" USING btree ("state");--> statement-breakpoint
CREATE INDEX "shorts_channel_idx" ON "shorts" USING btree ("channel_id");