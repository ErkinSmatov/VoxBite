/**
 * Drizzle + pgvector implementation of `FdcRepository` (the domain port
 * defined in src/domain/fdc-matching/types.ts).
 *
 * `findNearest` runs the cosine search server-side in Postgres, ordered by
 * the raw `cosineDistance` expression (ascending) — this is exactly what
 * lets Postgres use the HNSW `vector_cosine_ops` index created in Plan 03
 * (see src/db/schema/fdc-foods.ts's `fdc_foods_embedding_hnsw` index). Never
 * reimplement cosine distance in JavaScript, and never `select *` all rows
 * and sort in Node — both would throw away the index entirely
 * (01-RESEARCH.md "Don't Hand-Roll").
 *
 * IMPORTANT (gap-closure fix, verified via EXPLAIN): ordering by a computed
 * `1 - distance` alias with `desc()` — the original form of this query —
 * defeats the planner's ability to recognize the index-friendly ORDER BY
 * pattern and silently falls back to a full `Seq Scan`. Ordering by the raw
 * `cosineDistance(...)` expression ascending is the only form Postgres
 * reliably plans as `Index Scan using fdc_foods_embedding_hnsw`. The
 * `similarity` value is still computed and selected for the caller, but it
 * must never be the sort key.
 *
 * Every nullable nutrient (kcal/proteinG/fatG/carbsG/sugarG) is passed
 * through as-is — no `?? 0` anywhere in this file. TECH_SPEC §5.8 requires
 * "no data" to survive as `null`, never silently become 0.
 */
import { cosineDistance, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { fdcFoods } from '../db/schema/fdc-foods.js';
import { ALLOWED_SOURCES, type FdcCandidate, type FdcRepository } from '../domain/fdc-matching/types.js';

export function createDrizzleFdcRepository(db: Db): FdcRepository {
  return {
    async findNearest(embedding: number[], limit: number): Promise<FdcCandidate[]> {
      const distance = cosineDistance(fdcFoods.embedding, embedding);
      const similarity = sql<number>`1 - (${distance})`;

      const rows = await db
        .select({
          fdcId: fdcFoods.fdcId,
          description: fdcFoods.description,
          source: fdcFoods.source,
          kcal: fdcFoods.kcal,
          proteinG: fdcFoods.proteinG,
          fatG: fdcFoods.fatG,
          carbsG: fdcFoods.carbsG,
          sugarG: fdcFoods.sugarG,
          similarity,
        })
        .from(fdcFoods)
        // Order by the raw distance expression (ascending), NOT the
        // computed `similarity` alias descending — see the module comment.
        .orderBy(distance)
        .limit(limit);

      return rows.map((r) => ({
        fdcId: r.fdcId,
        description: r.description,
        // Cast: the Postgres check constraint (fdc_foods_source_check) plus
        // MATCH-02's loader-side filtering guarantee only ALLOWED_SOURCES
        // values ever land in this column; matchIngredient() re-filters
        // against ALLOWED_SOURCES anyway as defence in depth.
        source: r.source as (typeof ALLOWED_SOURCES)[number],
        kcal: r.kcal,
        proteinG: r.proteinG,
        fatG: r.fatG,
        carbsG: r.carbsG,
        sugarG: r.sugarG,
        similarity: r.similarity,
      }));
    },
  };
}
