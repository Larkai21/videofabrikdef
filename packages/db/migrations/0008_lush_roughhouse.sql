CREATE INDEX "assets_source_ref_idx" ON "assets" USING btree ("source_ref");--> statement-breakpoint
CREATE INDEX "beats_asset_idx" ON "beats" USING btree ("asset_id");