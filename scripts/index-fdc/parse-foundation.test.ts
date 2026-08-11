import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFoundationFoods, FOUNDATION_DATA_TYPE } from './parse-foundation.js';
import { parseSrLegacyFoods } from './parse-sr-legacy.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const foundationFixture = path.join(dirname, '__fixtures__/food-foundation-sample.csv');
const srLegacyFixture = path.join(dirname, '__fixtures__/food-sr-legacy-sample.csv');

describe('parseFoundationFoods', () => {
  it('exports FOUNDATION_DATA_TYPE as foundation_food', () => {
    expect(FOUNDATION_DATA_TYPE).toBe('foundation_food');
  });

  it('keeps ONLY rows whose data_type is foundation_food', async () => {
    const result = await parseFoundationFoods(foundationFixture);
    expect(result.foods.every((f) => true)).toBe(true);
    expect(result.foods).toHaveLength(2);
  });

  it('excludes the brand-named market_acquisition SABRA row', async () => {
    const result = await parseFoundationFoods(foundationFixture);
    expect(result.foods.some((f) => /SABRA/i.test(f.description))).toBe(false);
  });

  it('excludes sample_food, sub_sample_food, and agricultural_acquisition rows', async () => {
    const result = await parseFoundationFoods(foundationFixture);
    const descriptions = result.foods.map((f) => f.description);
    expect(descriptions).not.toContain('HUMMUS, SABRA CLASSIC');
    expect(descriptions.some((d) => d.includes('sub sample'))).toBe(false);
    expect(descriptions.some((d) => d.includes('agricultural sample'))).toBe(false);
  });

  it('reports skippedByDataType counts for all four excluded data types', async () => {
    const result = await parseFoundationFoods(foundationFixture);
    expect(result.skippedByDataType.market_acquisition).toBe(1);
    expect(result.skippedByDataType.sample_food).toBe(1);
    expect(result.skippedByDataType.sub_sample_food).toBe(1);
    expect(result.skippedByDataType.agricultural_acquisition).toBe(1);
  });

  it('counts totalRows and keptRows correctly', async () => {
    const result = await parseFoundationFoods(foundationFixture);
    expect(result.totalRows).toBe(6);
    expect(result.keptRows).toBe(result.foods.length);
    expect(result.keptRows).toBe(2);
  });

  it('parses a quoted, comma-containing description as a single field', async () => {
    const result = await parseFoundationFoods(foundationFixture);
    const beans = result.foods.find((f) => f.fdcId === 2000001);
    expect(beans).toBeDefined();
    expect(beans?.description).toBe('Beans, snap, green, raw');
  });

  it('returns fdcId as a number, not a string', async () => {
    const result = await parseFoundationFoods(foundationFixture);
    for (const food of result.foods) {
      expect(typeof food.fdcId).toBe('number');
    }
  });

  it('stamps source as foundation_food', async () => {
    const result = await parseFoundationFoods(foundationFixture);
    for (const food of result.foods) {
      expect(food.source).toBe('foundation_food');
    }
  });
});

// WR-02: Number('') === 0 в JS, поэтому пустой fdc_id раньше проходил
// проверку и становился id = 0. `fdc_id` — ключ, по которому идёт upsert,
// так что две битые строки молча схлопывались бы в одну запись.
describe('parseFoundationFoods: проверка fdc_id', () => {
  async function parseCsvBody(rows: string): Promise<ReturnType<typeof parseFoundationFoods>> {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const csv = '"fdc_id","data_type","description","food_category_id","publication_date"\n' + rows;
    const tmpFile = path.join(os.tmpdir(), `fdc-id-check-${Date.now()}-${Math.random()}.csv`);
    fs.writeFileSync(tmpFile, csv);
    try {
      return await parseFoundationFoods(tmpFile);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }

  it.each([
    ['пустой', ''],
    ['только пробелы', '   '],
    ['не число', 'abc'],
    ['дробное', '12.5'],
    ['экспоненциальная запись', '1e3'],
    ['ноль', '0'],
    ['отрицательное', '-5'],
  ])('отвергает строку с fdc_id (%s) вместо превращения её в id = 0', async (_name, badId) => {
    await expect(
      parseCsvBody(`"${badId}","foundation_food","Beans, snap, green, raw","11","2019-04-01"\n`),
    ).rejects.toThrow(/is not a positive integer/);
  });

  it('две строки с пустым fdc_id не схлопываются в одну запись с id = 0 — парсер падает', async () => {
    await expect(
      parseCsvBody(
        '"","foundation_food","Первая битая строка","11","2019-04-01"\n' +
          '"","foundation_food","Вторая битая строка","11","2019-04-01"\n',
      ),
    ).rejects.toThrow(/is not a positive integer/);
  });

  it('нормальный числовой fdc_id по-прежнему проходит', async () => {
    const result = await parseCsvBody(
      '"2000001","foundation_food","Beans, snap, green, raw","11","2019-04-01"\n',
    );
    expect(result.foods).toEqual([
      { fdcId: 2000001, description: 'Beans, snap, green, raw', source: 'foundation_food' },
    ]);
  });

  it('битый fdc_id в ПРОПУЩЕННОЙ по data_type строке не мешает — она и так не попадает в индекс', async () => {
    const result = await parseCsvBody(
      '"","market_acquisition","HUMMUS, SABRA CLASSIC","16","2019-04-01"\n' +
        '"2000002","foundation_food","Hummus, commercial","16","2019-04-01"\n',
    );
    expect(result.foods.map((f) => f.fdcId)).toEqual([2000002]);
  });
});

describe('parseSrLegacyFoods', () => {
  it('keeps every row and stamps source sr_legacy_food', async () => {
    const result = await parseSrLegacyFoods(srLegacyFixture);
    expect(result.foods).toHaveLength(3);
    for (const food of result.foods) {
      expect(food.source).toBe('sr_legacy_food');
    }
  });

  it('throws when a row has an unexpected data_type', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const badCsv =
      '"fdc_id","data_type","description","food_category_id","publication_date"\n' +
      '"170099","branded_food","Mystery item","01","2019-04-01"\n';
    const tmpFile = path.join(os.tmpdir(), `bad-sr-legacy-${Date.now()}.csv`);
    fs.writeFileSync(tmpFile, badCsv);
    try {
      await expect(parseSrLegacyFoods(tmpFile)).rejects.toThrow(/branded_food/);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
