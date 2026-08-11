/**
 * fdc_foods — one row per indexed USDA FoodData Central food item.
 *
 * `embedding` is a real pgvector `vector(1536)` column: 1536 is the
 * OpenAI `dimensions` truncation requested from `text-embedding-3-large`
 * (native output 3072-dim, Matryoshka-truncated to 1536 via the API's own
 * `dimensions` parameter — not a client-side slice), chosen because
 * 3072 exceeds pgvector's 2000-dimension HNSW indexing limit. If the
 * embedding model is ever
 * changed, every row must be re-embedded and re-indexed — the
 * `embedding_model_version` column exists precisely so a re-index can
 * detect "these rows were embedded with a different model" instead of
 * silently mixing incompatible vectors in the same HNSW index.
 *
 * `sugar_g` (and the other macro columns) are intentionally NULLABLE:
 * TECH_SPEC.md §5.8 requires "no data" to be storable as distinct from
 * "zero grams of sugar" — many USDA records simply do not report sugar.
 * Coalescing a missing value to 0 would silently misinform the user.
 */
import { check, index, integer, pgTable, real, text, timestamp, vector } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const FDC_SOURCES = ['foundation_food', 'sr_legacy_food'] as const;
export type FdcSource = (typeof FDC_SOURCES)[number];

export const fdcFoods = pgTable(
  'fdc_foods',
  {
    fdcId: integer('fdc_id').primaryKey(),
    description: text('description').notNull(),
    source: text('source').notNull().$type<FdcSource>(),
    kcal: real('kcal'),
    proteinG: real('protein_g'),
    fatG: real('fat_g'),
    carbsG: real('carbs_g'),
    // Nullable — "нет данных" must stay distinguishable from 0 (TECH_SPEC §5.8).
    sugarG: real('sugar_g'),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    datasetVersion: text('dataset_version').notNull(),
    embeddingModelVersion: text('embedding_model_version').notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('fdc_foods_embedding_hnsw').using('hnsw', table.embedding.op('vector_cosine_ops')),
    index('fdc_foods_source_idx').on(table.source),
    check(
      'fdc_foods_source_check',
      sql`${table.source} in ('foundation_food','sr_legacy_food')`,
    ),
  ],
);

export type FdcFoodRow = typeof fdcFoods.$inferSelect;
export type NewFdcFood = typeof fdcFoods.$inferInsert;
