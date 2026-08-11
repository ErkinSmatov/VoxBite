import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Single source of truth for the two USDA FoodData Central (FDC) bulk CSV
 * bundles this project indexes: Foundation Foods and SR Legacy.
 *
 * These filenames were verified against
 * https://fdc.nal.usda.gov/download-datasets on 2026-08-10. USDA refreshes
 * Foundation Foods every April/December — SR Legacy is a frozen, final
 * dataset (last published April 2018) and will not change.
 *
 * If a download 404s, open https://fdc.nal.usda.gov/download-datasets,
 * copy the current filename for the affected dataset, and update BOTH
 * `zipName` and `datasetVersion` below together — `datasetVersion` is
 * written into every `fdc_foods` row and is how a stale index gets
 * detected later.
 */

/** Directory (git-ignored) all downloaded/extracted FDC data lives under. */
export const DATA_DIR = 'data/fdc';

export interface FdcDataset {
  source: 'foundation_food' | 'sr_legacy_food';
  /** Written to fdc_foods.dataset_version. */
  datasetVersion: string;
  zipName: string;
  url: string;
  /** data/fdc/foundation | data/fdc/sr-legacy */
  extractDir: string;
  /** Resolved path to food.csv (searched for recursively at use time). */
  foodCsv: string;
  /** Resolved path to food_nutrient.csv (searched for recursively at use time). */
  foodNutrientCsv: string;
}

export type FdcSourceName = FdcDataset['source'];

function dataset(input: {
  source: FdcDataset['source'];
  datasetVersion: string;
  zipName: string;
  extractDir: string;
}): FdcDataset {
  return {
    source: input.source,
    datasetVersion: input.datasetVersion,
    zipName: input.zipName,
    url: `https://fdc.nal.usda.gov/fdc-datasets/${input.zipName}`,
    extractDir: input.extractDir,
    // These are resolved by searching extractDir recursively at use time —
    // the archives unpack into a nested, version-named folder, so a fixed
    // path here would be wrong the moment USDA renames that inner folder.
    foodCsv: `${input.extractDir}/food.csv`,
    foodNutrientCsv: `${input.extractDir}/food_nutrient.csv`,
  };
}

export const FDC_DATASETS: readonly [FdcDataset, FdcDataset] = [
  dataset({
    source: 'foundation_food',
    datasetVersion: '2026-04-30',
    zipName: 'FoodData_Central_foundation_food_csv_2026-04-30.zip',
    extractDir: `${DATA_DIR}/foundation`,
  }),
  dataset({
    source: 'sr_legacy_food',
    datasetVersion: '2018-04',
    zipName: 'FoodData_Central_sr_legacy_food_csv_2018-04.zip',
    extractDir: `${DATA_DIR}/sr-legacy`,
  }),
];

/**
 * The two archives unpack into a nested, version-named inner folder (e.g.
 * `data/fdc/foundation/FoodData_Central_foundation_food_csv_2026-04-30/food.csv`),
 * so `dataset.foodCsv` / `dataset.foodNutrientCsv` above are best-effort
 * defaults only. Call this AFTER extraction to get the real paths by
 * searching `extractDir` recursively — used by download.ts (to print/verify
 * paths) and by Plan 06's run.ts/load.ts (to know what to parse).
 */
export function findFileRecursive(dir: string, filename: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, filename);
      if (found) return found;
    } else if (entry.isFile() && entry.name === filename) {
      return full;
    }
  }
  return undefined;
}

export function resolveExtractedCsvPaths(
  ds: FdcDataset,
): { foodCsv: string | undefined; foodNutrientCsv: string | undefined } {
  return {
    foodCsv: findFileRecursive(ds.extractDir, 'food.csv'),
    foodNutrientCsv: findFileRecursive(ds.extractDir, 'food_nutrient.csv'),
  };
}
