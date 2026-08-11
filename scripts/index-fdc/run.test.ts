/**
 * CLI-флаги `npm run index-fdc` — тесты на то, что опечатка ОСТАНАВЛИВАЕТ
 * прогон, а не выбирает молча другой (более дорогой) датасет.
 *
 * Тесты полностью офлайновые: parseArgs/selectedDatasets — чистые функции,
 * ни OpenAI, ни база данных здесь не участвуют.
 */
import { describe, expect, it } from 'vitest';
import { parseArgs, selectedDatasets, VALID_SOURCES } from './run.js';

describe('parseArgs --source', () => {
  it('без флага берёт оба датасета', () => {
    expect(parseArgs([]).source).toBe('both');
    expect(selectedDatasets(parseArgs([])).map((d) => d.source).sort()).toEqual([
      'foundation_food',
      'sr_legacy_food',
    ]);
  });

  it.each(VALID_SOURCES)('принимает документированное значение %s', (value) => {
    expect(parseArgs([`--source=${value}`]).source).toBe(value);
  });

  it('--source=foundation выбирает ТОЛЬКО Foundation Foods', () => {
    const datasets = selectedDatasets(parseArgs(['--source=foundation']));
    expect(datasets.map((d) => d.source)).toEqual(['foundation_food']);
  });

  it('--source=sr-legacy выбирает ТОЛЬКО SR Legacy (по имени, а не через fallthrough)', () => {
    const datasets = selectedDatasets(parseArgs(['--source=sr-legacy']));
    expect(datasets.map((d) => d.source)).toEqual(['sr_legacy_food']);
  });

  it.each(['Foundation', 'srlegacy', 'fondation', 'sr_legacy', '', 'both '])(
    'ошибается на неизвестном значении "%s" вместо молчаливого выбора SR Legacy',
    (bad) => {
      expect(() => parseArgs([`--source=${bad}`])).toThrow(/--source/);
      expect(() => parseArgs([`--source=${bad}`])).toThrow(/foundation, sr-legacy, both/);
    },
  );

  it('в тексте ошибки перечислены все допустимые значения', () => {
    try {
      parseArgs(['--source=Foundation']);
      throw new Error('parseArgs должен был бросить ошибку');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const value of VALID_SOURCES) {
        expect(message).toContain(value);
      }
    }
  });
});

describe('parseArgs --limit', () => {
  it('без флага limit не задан', () => {
    expect(parseArgs([]).limit).toBeUndefined();
  });

  it('принимает положительное целое', () => {
    expect(parseArgs(['--limit=10']).limit).toBe(10);
    expect(parseArgs(['--limit= 25 ']).limit).toBe(25);
  });

  it.each(['abc', '', '   ', '0', '-5', '2.5', 'NaN', 'Infinity'])(
    'ошибается на недопустимом значении "%s"',
    (bad) => {
      expect(() => parseArgs([`--limit=${bad}`])).toThrow(/--limit/);
    },
  );
});

describe('parseArgs прочие флаги', () => {
  it('распознаёт --force и --dry-run', () => {
    const opts = parseArgs(['--force', '--dry-run', '--source=foundation', '--limit=3']);
    expect(opts).toEqual({ force: true, dryRun: true, source: 'foundation', limit: 3 });
  });

  it('по умолчанию force и dryRun выключены', () => {
    const opts = parseArgs([]);
    expect(opts.force).toBe(false);
    expect(opts.dryRun).toBe(false);
  });
});
