ALTER TABLE "shorts" ALTER COLUMN "video_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shorts" ADD COLUMN "episode_id" text;--> statement-breakpoint
ALTER TABLE "shorts" ADD CONSTRAINT "shorts_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shorts_episode_idx_idx" ON "shorts" USING btree ("episode_id","idx");