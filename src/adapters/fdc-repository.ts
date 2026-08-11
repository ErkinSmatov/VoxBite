/**
 * Drizzle + pgvector implementation of `FdcRepository` (the domain port
 * defined in src/domain/fdc-matching/types.ts).
 *
 * `findNearest` runs the cosine search server-side in Postgres, ordered by
 * the `similarity` expression — this is exactly what lets Postgres use the
 * HNSW `vector_cosine_ops` index created in Plan 03 (see
 * src/db/schema/fdc-foods.ts's `fdc_foods_embedding_hnsw` index). Never
 * reimplement cosine distance in JavaScript, and never `select *` all rows
 * and sort in Node — both would throw away the index entirely
 * (01-RESEARCH.md "Don't Hand-Roll").
 *
 * Every nullable nutrient (kcal/proteinG/fatG/carbsG/sugarG) is passed
 * through as-is — no `?? 0` anywhere in this file. TECH_SPEC §5.8 requires
 * "no data" to survive as `null`, never silently become 0.
 */
import { cosineDistance, desc, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { fdcFoods } from '../db/schema/fdc-foods.js';
import { ALLOWED_SOURCES, type FdcCandidate, type FdcRepository } from '../domain/fdc-matching/types.js';

export function createDrizzleFdcRepository(db: Db): FdcRepository {
  return {
    async findNearest(embedding: number[], limit: number): Promise<FdcCandidate[]> {
      const similarity = sql<number>`1 - (${cosineDistance(fdcFoods.embedding, embedding)})`;

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
        .orderBy((t) => desc(t.similarity))
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
