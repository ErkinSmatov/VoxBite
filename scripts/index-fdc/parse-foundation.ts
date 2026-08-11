/**
 * Streaming parser for the Foundation Foods `food.csv` bundle, plus the
 * shared CSV-streaming helper `parseSrLegacyFoods` (parse-sr-legacy.ts)
 * also uses — the row-streaming/mapping mechanics are identical between
 * the two datasets, only the filter/assert rule that decides which rows
 * survive differs, so that rule stays local to each file while the
 * mechanics are shared here.
 *
 * 01-RESEARCH.md's single most important finding for this plan: the real
 * `food.csv` (verified 2026-08-11 against the live download) has 87,991
 * data rows, of which only 469 (0.53%) have `data_type = 'foundation_food'`
 * — the rest are lab samples (`sample_food`, `sub_sample_food`), raw
 * agricultural intake records (`agricultural_acquisition`), and brand-named
 * retail purchases (`market_acquisition`, e.g. "HUMMUS, SABRA CLASSIC").
 * Indexing anything but `foundation_food` here would silently pull Branded
 * Foods-style retail products into the FDC index, which MATCH-02 and
 * PROJECT.md explicitly scope out of v1.
 *
 * If a real run ever keeps more than a few thousand Foundation rows, the
 * filter below has broken — stop and investigate before spending embedding
 * money on it.
 */
import * as fs from 'node:fs';
import { parse } from 'csv-parse';
import type { FdcSourceName } from './datasets.js';

export interface RawFood {
  fdcId: number;
  description: string;
  source: FdcSourceName;
}

export interface ParseResult {
  foods: RawFood[];
  totalRows: number;
  keptRows: number;
  skippedByDataType: Record<string, number>;
}

export interface FoodCsvRow {
  fdc_id: string;
  data_type: string;
  description: string;
  food_category_id?: string;
  publication_date?: string;
}

/**
 * Streams `foodCsvPath` row by row via `csv-parse` over a `createReadStream`
 * — never buffers the whole file into memory as a string. `decide` returns
 * 'keep' to include a row, 'skip' to exclude it (counted per data_type), or
 * throws to abort the whole parse (used by the SR Legacy
 * assert-only-expected-type rule).
 */
export async function streamFoodCsv(
  foodCsvPath: string,
  source: FdcSourceName,
  decide: (row: FoodCsvRow) => 'keep' | 'skip',
): Promise<ParseResult> {
  const foods: RawFood[] = [];
  const skippedByDataType: Record<string, number> = {};
  let totalRows = 0;

  const parser = fs.createReadStream(foodCsvPath).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true }),
  );

  for await (const record of parser as AsyncIterable<FoodCsvRow>) {
    totalRows += 1;
    const decision = decide(record);
    if (decision === 'skip') {
      skippedByDataType[record.data_type] = (skippedByDataType[record.data_type] ?? 0) + 1;
      continue;
    }

    // Number('') === 0 и Number('   ') === 0 в JS — пустой fdc_id проходил
    // бы проверку «конечное число» и превращался в id = 0. А `fdc_id` — это
    // ключ, по которому идёт upsert (см. load.ts), поэтому ДВЕ такие битые
    // строки молча схлопнулись бы в одну запись с id = 0. Отсекаем пустое
    // значение явно, до преобразования в число — так же, как это уже
    // сделано для amount в resolve-nutrients.ts.
    const rawFdcId = record.fdc_id?.trim() ?? '';
    // Только цифры: так отсеиваются и '12.5', и '1e3' (это 1000 — чужой id!),
    // и '-5', и '0x10'. Настоящие fdc_id в FDC — это просто числа из цифр.
    const fdcId = /^\d+$/.test(rawFdcId) ? Number(rawFdcId) : NaN;
    const description = record.description?.trim() ?? '';
    // Number.isInteger отсекает NaN и Infinity; fdcId > 0 отсекает '0' и
    // '000' — записи с id = 0 в FDC не бывает.
    if (!Number.isInteger(fdcId) || fdcId <= 0) {
      throw new Error(
        `Malformed row in ${foodCsvPath}: fdc_id "${record.fdc_id ?? ''}" is not a positive integer.`,
      );
    }
    if (description.length === 0) {
      throw new Error(`Malformed row in ${foodCsvPath}: fdc_id ${fdcId} has an empty description.`);
    }

    foods.push({ fdcId, description, source });
  }

  return { foods, totalRows, keptRows: foods.length, skippedByDataType };
}

/** The ONLY data_type value kept from Foundation Foods' food.csv. Named and
 * exported so the filter is greppable and cannot silently drift. */
export const FOUNDATION_DATA_TYPE = 'foundation_food';

export async function parseFoundationFoods(foodCsvPath: string): Promise<ParseResult> {
  return streamFoodCsv(foodCsvPath, 'foundation_food', (row) =>
    row.data_type === FOUNDATION_DATA_TYPE ? 'keep' : 'skip',
  );
}
