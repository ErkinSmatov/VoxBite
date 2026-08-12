CREATE TABLE "processed_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"chat_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_updates_status_check" CHECK ("processed_updates"."status" in ('processing','done','interrupted','failed')),
	CONSTRAINT "processed_updates_kind_check" CHECK ("processed_updates"."kind" in ('voice','text'))
);
--> statement-breakpoint
CREATE TABLE "diary_drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "diary_drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"update_id" bigint NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"source" text NOT NULL,
	"transcript" text NOT NULL,
	"components" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diary_drafts_update_id_key" UNIQUE("update_id"),
	CONSTRAINT "diary_drafts_status_check" CHECK ("diary_drafts"."status" in ('draft','confirmed','abandoned')),
	CONSTRAINT "diary_drafts_source_check" CHECK ("diary_drafts"."source" in ('voice','text'))
);
--> statement-breakpoint
ALTER TABLE "diary_drafts" ADD CONSTRAINT "diary_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processed_updates_user_day_idx" ON "processed_updates" USING btree ("telegram_id","created_at");--> statement-breakpoint
CREATE INDEX "diary_drafts_user_idx" ON "diary_drafts" USING btree ("user_id","created_at");