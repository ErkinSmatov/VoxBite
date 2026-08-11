/**
 * Idempotent download + unzip of the two USDA FDC bulk CSV bundles
 * (Foundation Foods, SR Legacy) into the git-ignored `data/fdc/` directory.
 *
 * Safe and cheap to re-run: an already-downloaded zip is skipped, an
 * already-extracted directory is skipped, unless `--force` is passed. The
 * zips are never deleted after extraction — keeping them is what makes a
 * re-run fast and offline-safe.
 *
 * Usage:
 *   npm run fdc:download                  # download + extract both datasets
 *   npm run fdc:download -- --force       # re-download and re-extract both
 *   npm run fdc:download -- --only=foundation
 *   npm run fdc:download -- --only=sr-legacy
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR, FDC_DATASETS, findFileRecursive, type FdcDataset } from './datasets.js';

const execFile = promisify(execFileCb);

const FIVE_MB = 5 * 1024 * 1024;

interface DownloadOptions {
  force: boolean;
  only?: 'foundation' | 'sr-legacy';
}

function parseArgs(argv: string[]): DownloadOptions {
  const force = argv.includes('--force');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? (onlyArg.split('=')[1] as 'foundation' | 'sr-legacy') : undefined;
  return { force, only };
}

function datasetKey(ds: FdcDataset): 'foundation' | 'sr-legacy' {
  return ds.source === 'foundation_food' ? 'foundation' : 'sr-legacy';
}

async function downloadZip(ds: FdcDataset, zipPath: string): Promise<void> {
  const res = await fetch(ds.url);
  if (!res.ok || !res.body) {
    throw new Error(
      `Не удалось скачать ${ds.zipName}: ${ds.url} вернул статус ${res.status}. ` +
        `Возможно, USDA опубликовал новый датасет — открой ` +
        `https://fdc.nal.usda.gov/download-datasets, скопируй актуальное имя файла ` +
        `для ${ds.source === 'foundation_food' ? 'Foundation Foods' : 'SR Legacy'} и обнови ` +
        `scripts/index-fdc/datasets.ts (поля zipName и datasetVersion вместе).`,
    );
  }

  const tmpPath = `${zipPath}.part`;
  const fileStream = fs.createWriteStream(tmpPath);

  let downloaded = 0;
  let lastLoggedAt = 0;
  const nodeStream = Readable.fromWeb(res.body as never) as NodeJS.ReadableStream;
  nodeStream.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    if (downloaded - lastLoggedAt >= FIVE_MB) {
      lastLoggedAt = downloaded;
      console.log(`  ... ${ds.zipName}: ${(downloaded / (1024 * 1024)).toFixed(1)} MB downloaded`);
    }
  });

  await pipeline(nodeStream, fileStream);
  fs.renameSync(tmpPath, zipPath);
}

async function extractZip(zipPath: string, extractDir: string): Promise<void> {
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    await execFile('unzip', ['-q', '-o', zipPath, '-d', extractDir]);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      throw new Error(
        `Команда unzip не найдена. Распакуй архив вручную: открой ${zipPath} двойным ` +
          `кликом и перемести содержимое в ${extractDir}.`,
      );
    }
    throw err;
  }
}

interface DatasetRunResult {
  dataset: FdcDataset;
  downloaded: 'downloaded' | 'skipped';
  extracted: 'extracted' | 'skipped';
  foodCsv: string;
  foodNutrientCsv: string;
}

async function processDataset(ds: FdcDataset, opts: DownloadOptions): Promise<DatasetRunResult> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const zipPath = path.join(DATA_DIR, ds.zipName);

  let downloaded: 'downloaded' | 'skipped' = 'skipped';
  const zipExists = fs.existsSync(zipPath) && fs.statSync(zipPath).size > 0;
  if (!zipExists || opts.force) {
    console.log(`[fetch] ${ds.zipName} ...`);
    await downloadZip(ds, zipPath);
    downloaded = 'downloaded';
  } else {
    console.log(`[skip] ${ds.zipName} already downloaded`);
  }

  let extracted: 'extracted' | 'skipped' = 'skipped';
  const alreadyExtracted = !!findFileRecursive(ds.extractDir, 'food.csv');
  if (!alreadyExtracted || opts.force) {
    console.log(`[extract] ${ds.zipName} -> ${ds.extractDir} ...`);
    await extractZip(zipPath, ds.extractDir);
    extracted = 'extracted';
  } else {
    console.log(`[skip] ${ds.extractDir} already extracted`);
  }

  const foodCsv = findFileRecursive(ds.extractDir, 'food.csv');
  const foodNutrientCsv = findFileRecursive(ds.extractDir, 'food_nutrient.csv');
  if (!foodCsv || !foodNutrientCsv) {
    throw new Error(
      `После распаковки ${ds.zipName} не найден food.csv и/или food_nutrient.csv внутри ` +
        `${ds.extractDir}. Проверь архив вручную.`,
    );
  }

  const foodCsvSize = fs.statSync(foodCsv).size;
  const foodNutrientCsvSize = fs.statSync(foodNutrientCsv).size;
  console.log(
    `  food.csv: ${foodCsv} (${(foodCsvSize / (1024 * 1024)).toFixed(1)} MB)\n` +
      `  food_nutrient.csv: ${foodNutrientCsv} (${(foodNutrientCsvSize / (1024 * 1024)).toFixed(1)} MB)`,
  );

  return { dataset: ds, downloaded, extracted, foodCsv, foodNutrientCsv };
}

export async function downloadDatasets(opts: DownloadOptions = { force: false }): Promise<DatasetRunResult[]> {
  const targets = FDC_DATASETS.filter((ds) => !opts.only || datasetKey(ds) === opts.only);
  const results: DatasetRunResult[] = [];
  for (const ds of targets) {
    results.push(await processDataset(ds, opts));
  }

  console.log('\n=== Итог ===');
  for (const r of results) {
    console.log(
      `${r.dataset.source}: скачано=${r.downloaded === 'downloaded' ? 'да' : 'пропущено'}, ` +
        `распаковано=${r.extracted === 'extracted' ? 'да' : 'пропущено'}\n` +
        `  ${r.foodCsv}\n  ${r.foodNutrientCsv}`,
    );
  }

  return results;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  try {
    await downloadDatasets(opts);
    process.exit(0);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
