ALTER TABLE "diary" ADD COLUMN "draft_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "diary_drafts" ADD COLUMN "awaiting_input" jsonb;--> statement-breakpoint
ALTER TABLE "diary_drafts" ADD COLUMN "local_date" date;--> statement-breakpoint
ALTER TABLE "diary_drafts" ADD COLUMN "diary_id" integer;--> statement-breakpoint
ALTER TABLE "diary" ADD CONSTRAINT "diary_draft_id_diary_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."diary_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_drafts" ADD CONSTRAINT "diary_drafts_diary_id_diary_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."diary"("id") ON DELETE no action ON UPDATE no action;