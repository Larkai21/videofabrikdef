CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text DEFAULT 'channel' NOT NULL,
	"channel_id" text,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"license" text NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"caption" text,
	"origin_query" text,
	"embedding" vector(384),
	"times_used" integer DEFAULT 0 NOT NULL,
	"last_video_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beats" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"idx" integer NOT NULL,
	"from_ms" integer NOT NULL,
	"to_ms" integer NOT NULL,
	"text" text NOT NULL,
	"visual_query" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"asset_id" text,
	"fit" jsonb,
	"chosen_score" double precision,
	"chosen_origin" text,
	"candidates" jsonb,
	"discard_reason" text
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"profile" jsonb,
	"profile_approved" boolean DEFAULT false NOT NULL,
	"profile_inputs" jsonb,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "components" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"path" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"status" text DEFAULT 'validated' NOT NULL,
	"log" text,
	"preview_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text,
	"channel_id" text,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"units" double precision DEFAULT 0 NOT NULL,
	"unit_cost" double precision DEFAULT 0 NOT NULL,
	"cost" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"cluster_id" text,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"angle" text,
	"why_now" text,
	"score" double precision DEFAULT 0 NOT NULL,
	"score_parts" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"discard_reason" text,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"url_canonical" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"published_at" timestamp with time zone,
	"metrics" jsonb,
	"lang" text,
	"hash" text NOT NULL,
	"embedding" vector(384),
	"cluster_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"config" jsonb,
	"cadence_minutes" integer DEFAULT 120 NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"query_norm" text NOT NULL,
	"provider" text NOT NULL,
	"results" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"idea_id" text NOT NULL,
	"state" text DEFAULT 'idea_aprobada' NOT NULL,
	"state_before_incident" text,
	"incident" jsonb,
	"title_chosen" text,
	"master" jsonb NOT NULL,
	"costs_total" double precision DEFAULT 0 NOT NULL,
	"output_dir" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beats" ADD CONSTRAINT "beats_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_channel_kind_idx" ON "assets" USING btree ("channel_id","kind");--> statement-breakpoint
CREATE INDEX "assets_embedding_idx" ON "assets" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "beats_video_idx_idx" ON "beats" USING btree ("video_id","idx");--> statement-breakpoint
CREATE UNIQUE INDEX "components_name_version_idx" ON "components" USING btree ("channel_id","name","version");--> statement-breakpoint
CREATE INDEX "cost_ledger_video_idx" ON "cost_ledger" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "ideas_channel_status_idx" ON "ideas" USING btree ("channel_id","status");--> statement-breakpoint
CREATE INDEX "ideas_embedding_idx" ON "ideas" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "raw_items_hash_idx" ON "raw_items" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "raw_items_cluster_idx" ON "raw_items" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "raw_items_embedding_idx" ON "raw_items" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "sources_channel_idx" ON "sources" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_cache_query_provider_idx" ON "stock_cache" USING btree ("query_norm","provider");--> statement-breakpoint
CREATE INDEX "videos_state_idx" ON "videos" USING btree ("state");--> statement-breakpoint
CREATE INDEX "videos_channel_idx" ON "videos" USING btree ("channel_id");