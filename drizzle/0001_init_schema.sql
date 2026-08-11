CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"telegram_id" bigint NOT NULL,
	"sex" text NOT NULL,
	"age_years" integer NOT NULL,
	"height_cm" integer NOT NULL,
	"weight_kg" real NOT NULL,
	"activity_level" text NOT NULL,
	"goal" text NOT NULL,
	"desired_rate_kg_per_month" real,
	"timezone" text DEFAULT 'Asia/Almaty' NOT NULL,
	"target_kcal" integer,
	"target_protein_g" integer,
	"target_fat_g" integer,
	"target_carbs_g" integer,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id"),
	CONSTRAINT "users_sex_check" CHECK ("users"."sex" in ('male','female')),
	CONSTRAINT "users_activity_level_check" CHECK ("users"."activity_level" in ('minimal','low','medium','high','very_high')),
	CONSTRAINT "users_goal_check" CHECK ("users"."goal" in ('gain','loss','maintain')),
	CONSTRAINT "users_desired_rate_check" CHECK ("users"."desired_rate_kg_per_month" is null or ("users"."desired_rate_kg_per_month" >= 0 and "users"."desired_rate_kg_per_month" <= 1))
);
--> statement-breakpoint
CREATE TABLE "diary" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "diary_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"eaten_at" timestamp with time zone DEFAULT now() NOT NULL,
	"local_date" date NOT NULL,
	"description" text NOT NULL,
	"kcal" real,
	"protein_g" real,
	"fat_g" real,
	"carbs_g" real,
	"sugar_g" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fdc_foods" (
	"fdc_id" integer PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"kcal" real,
	"protein_g" real,
	"fat_g" real,
	"carbs_g" real,
	"sugar_g" real,
	"embedding" vector(1536) NOT NULL,
	"dataset_version" text NOT NULL,
	"embedding_model_version" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fdc_foods_source_check" CHECK ("fdc_foods"."source" in ('foundation_food','sr_legacy_food'))
);
--> statement-breakpoint
ALTER TABLE "diary" ADD CONSTRAINT "diary_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diary_user_date_idx" ON "diary" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "fdc_foods_embedding_hnsw" ON "fdc_foods" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "fdc_foods_source_idx" ON "fdc_foods" USING btree ("source");