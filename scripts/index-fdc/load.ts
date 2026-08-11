/**
 * Idempotent loader: upserts resolved+embedded FDC records into `fdc_foods`.
 *
 * Decision (01-RESEARCH.md Assumption A2 — an explicit choice, not a silent
 * default): records with NO protein, fat AND carbs at all (42 of the 469
 * Foundation Foods records, per 01-RESEARCH.md Pattern 3) are EXCLUDED from
 * the index. An all-null-macro candidate is useless and confusing in the
 * 3-candidate picker (TECH_SPEC §5.6) — there is nothing to compute KBJU
 * from even if a user picks it. `run.ts` logs the excluded fdcId+description
 * list so the owner can review it once; re-indexing is cheap, so this rule
 * can be revisited later without any migration.
 */
import { sql } from 'drizzle-orm';
import { fdcFoods, type FdcSource, type NewFdcFood } from '../../src/db/schema/fdc-foods.js';
import type { Db } from '../../src/db/client.js';

export interface IndexableRecord {
  fdcId: number;
  description: string;
  source: FdcSource;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  sugarG: number | null;
}

export function isIndexable(r: IndexableRecord): boolean {
  if (!r.description || r.description.trim().length === 0) {
    return false;
  }
  return r.proteinG !== null || r.fatG !== null || r.carbsG !== null;
}

export interface ExistingVersion {
  datasetVersion: string;
  embeddingModelVersion: string;
}

/**
 * Reads every already-indexed row's (fdcId -> dataset/model version) so
 * `run.ts` can skip re-embedding rows that already match the current
 * dataset+model — the money saver and the resumability mechanism (D-03:
 * a half-finished run is safe to just re-run).
 */
export async function loadExistingVersions(db: Db): Promise<Map<number, ExistingVersion>> {
  const rows = await db
    .select({
      fdcId: fdcFoods.fdcId,
      datasetVersion: fdcFoods.datasetVersion,
      embeddingModelVersion: fdcFoods.embeddingModelVersion,
    })
    .from(fdcFoods);

  const map = new Map<number, ExistingVersion>();
  for (const row of rows) {
    map.set(row.fdcId, {
      datasetVersion: row.datasetVersion,
      embeddingModelVersion: row.embeddingModelVersion,
    });
  }
  return map;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Upserts `rows` into `fdc_foods`, targeting `fdc_id` on conflict so a
 * re-run with a newer dataset corrects existing rows instead of duplicating
 * them. Chunked at `chunkSize` (default 500) — one statement per chunk
 * rather than one per row; 500 rows * ~11 columns keeps well under
 * Postgres' 65535 bind-parameter-per-statement limit.
 *
 * Uses the Drizzle query builder throughout (never string-concatenated
 * SQL) — every value, including CSV-derived descriptions, is parameterized
 * (T-01-22).
 */
export async function upsertFdcFoods(db: Db, rows: NewFdcFood[], chunkSize = 500): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  let written = 0;
  for (const batch of chunkArray(rows, chunkSize)) {
    await db
      .insert(fdcFoods)
      .values(batch)
      .onConflictDoUpdate({
        target: fdcFoods.fdcId,
        set: {
          description: sql`excluded.description`,
          source: sql`excluded.source`,
          kcal: sql`excluded.kcal`,
          proteinG: sql`excluded.protein_g`,
          fatG: sql`excluded.fat_g`,
          carbsG: sql`excluded.carbs_g`,
          sugarG: sql`excluded.sugar_g`,
          embedding: sql`excluded.embedding`,
          datasetVersion: sql`excluded.dataset_version`,
          embeddingModelVersion: sql`excluded.embedding_model_version`,
          indexedAt: sql`now()`,
        },
      });
    written += batch.length;
  }
  return written;
}
