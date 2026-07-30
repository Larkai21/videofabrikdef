CREATE TABLE "caption_cache" (
	"ref" text PRIMARY KEY NOT NULL,
	"caption" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
