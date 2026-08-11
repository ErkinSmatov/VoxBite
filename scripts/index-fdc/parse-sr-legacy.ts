/**
 * Streaming parser for the SR Legacy `food.csv` bundle.
 *
 * Unlike Foundation Foods, SR Legacy needs no data_type filter — all rows
 * are `sr_legacy_food` (verified 2026-08-11 against the live download:
 * 7,793 data rows, all `sr_legacy_food`). Instead of filtering, this parser
 * asserts that invariant: if a row ever shows an unexpected `data_type`,
 * that means USDA changed the bundle's shape and the "no filter needed"
 * assumption no longer holds — better to fail loudly than silently index
 * something the bundle never used to contain.
 */
import { streamFoodCsv, type ParseResult } from './parse-foundation.js';

const SR_LEGACY_DATA_TYPE = 'sr_legacy_food';

export async function parseSrLegacyFoods(foodCsvPath: string): Promise<ParseResult> {
  return streamFoodCsv(foodCsvPath, 'sr_legacy_food', (row) => {
    if (row.data_type !== SR_LEGACY_DATA_TYPE) {
      throw new Error(
        `Unexpected data_type "${row.data_type}" in SR Legacy food.csv (fdc_id ${row.fdc_id}). ` +
          `SR Legacy was assumed to contain only "${SR_LEGACY_DATA_TYPE}" rows — USDA may have ` +
          `changed the bundle's shape; re-check before indexing.`,
      );
    }
    return 'keep';
  });
}
