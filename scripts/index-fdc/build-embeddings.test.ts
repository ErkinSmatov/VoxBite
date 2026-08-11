/**
 * CR-02: доказательство того, что оплаченные эмбеддинги не пропадают.
 *
 * Тесты полностью офлайновые: вместо OpenAI — поддельный Embedder, вместо
 * базы — функция, складывающая записи в массив. Ни одного сетевого вызова,
 * ни одного подключения к базе.
 */
import { describe, expect, it } from 'vitest';
import { EMBEDDING_BATCH_SIZE, type Embedder } from '../../src/adapters/embeddings/types.js';
import { embedAndStore, type EmbeddedRecord } from './build-embeddings.js';
import type { IndexableRecord } from './load.js';

function makeRecords(count: number): IndexableRecord[] {
  return new Array(count).fill(0).map((_, i) => ({
    fdcId: 1000 + i,
    description: `food ${i}`,
    source: 'foundation_food' as const,
    kcal: 100,
    proteinG: 10,
    fatG: 1,
    carbsG: 2,
    sugarG: null,
  }));
}

/** Поддельный эмбеддер: считает пачки и по желанию падает на N-й. */
function fakeEmbedder(options: { throwOnBatch?: number } = {}): {
  embedder: Embedder;
  batchesRequested: number[];
} {
  const batchesRequested: number[] = [];
  let batch = 0;
  const embedder: Embedder = {
    async embed(texts: string[]): Promise<number[][]> {
      batch += 1;
      batchesRequested.push(texts.length);
      if (options.throwOnBatch === batch) {
        throw new Error('на счету OpenAI закончились деньги — пополни баланс');
      }
      return texts.map((_, i) => [batch, i]);
    },
  };
  return { embedder, batchesRequested };
}

/** Поддельная «база»: копит всё, что в неё записали. */
function fakeStore(): {
  writeBatch: (batch: EmbeddedRecord[]) => Promise<number>;
  stored: EmbeddedRecord[];
  writeCalls: number[];
} {
  const stored: EmbeddedRecord[] = [];
  const writeCalls: number[] = [];
  return {
    stored,
    writeCalls,
    writeBatch: async (batch) => {
      stored.push(...batch);
      writeCalls.push(batch.length);
      return batch.length;
    },
  };
}

describe('embedAndStore', () => {
  it('пустой список: ноль запросов к OpenAI и ноль записей в базу', async () => {
    const { embedder, batchesRequested } = fakeEmbedder();
    const store = fakeStore();
    const written = await embedAndStore(embedder, [], store.writeBatch);
    expect(written).toBe(0);
    expect(batchesRequested).toEqual([]);
    expect(store.writeCalls).toEqual([]);
  });

  it('режет на пачки по 100 и пишет каждую пачку отдельно', async () => {
    const { embedder, batchesRequested } = fakeEmbedder();
    const store = fakeStore();
    const written = await embedAndStore(embedder, makeRecords(250), store.writeBatch);

    expect(batchesRequested).toEqual([100, 100, 50]);
    expect(store.writeCalls).toEqual([100, 100, 50]);
    expect(written).toBe(250);
    expect(store.stored.length).toBe(250);
  });

  it('пишет пачку в базу ДО того, как уйдёт запрос за следующей (порядок операций)', async () => {
    const order: string[] = [];
    let batch = 0;
    const embedder: Embedder = {
      async embed(texts) {
        batch += 1;
        order.push(`embed ${batch}`);
        return texts.map(() => [batch]);
      },
    };
    let writes = 0;
    await embedAndStore(embedder, makeRecords(250), async (b) => {
      writes += 1;
      order.push(`write ${writes}`);
      return b.length;
    });

    expect(order).toEqual(['embed 1', 'write 1', 'embed 2', 'write 2', 'embed 3', 'write 3']);
  });

  // ЭТО и есть суть CR-02: падение на 3-й пачке НЕ должно стирать
  // результат пачек 1-2, за которые уже заплачено.
  it('падение на 3-й пачке оставляет пачки 1-2 записанными', async () => {
    const { embedder, batchesRequested } = fakeEmbedder({ throwOnBatch: 3 });
    const store = fakeStore();

    await expect(
      embedAndStore(embedder, makeRecords(500), store.writeBatch),
    ).rejects.toThrow(/пополни баланс/);

    // Заплатили за 3 пачки (третья не вернулась), записаны первые две.
    expect(batchesRequested).toEqual([100, 100, 100]);
    expect(store.writeCalls).toEqual([100, 100]);
    expect(store.stored.length).toBe(2 * EMBEDDING_BATCH_SIZE);
    // Именно первые 200 записей по порядку — не случайный срез.
    expect(store.stored.map((e) => e.record.fdcId)).toEqual(
      makeRecords(200).map((r) => r.fdcId),
    );
    // И ни одного запроса после падения — деньги дальше не тратятся.
    expect(batchesRequested.length).toBe(3);
  });

  it('падение самой записи в базу тоже не стирает предыдущие пачки', async () => {
    const { embedder } = fakeEmbedder();
    const stored: EmbeddedRecord[] = [];
    let call = 0;

    await expect(
      embedAndStore(embedder, makeRecords(300), async (batch) => {
        call += 1;
        if (call === 3) {
          throw new Error('соединение с базой разорвано');
        }
        stored.push(...batch);
        return batch.length;
      }),
    ).rejects.toThrow(/соединение с базой/);

    expect(stored.length).toBe(200);
  });

  it('не пишет пачку, если эмбеддингов пришло меньше, чем записей', async () => {
    const embedder: Embedder = {
      async embed(texts) {
        return texts.slice(0, texts.length - 1).map(() => [1]);
      },
    };
    const store = fakeStore();
    await expect(embedAndStore(embedder, makeRecords(10), store.writeBatch)).rejects.toThrow(
      /9 эмбеддингов на 10 записей/,
    );
    expect(store.stored).toEqual([]);
  });

  it('не пишет пачку, если один из эмбеддингов пустой/отсутствует', async () => {
    const embedder: Embedder = {
      async embed(texts) {
        // дырка на второй позиции — ровно то, что раньше доезжало до базы
        // как невнятная ошибка «null value in column embedding»
        return texts.map((_, i) => (i === 1 ? (undefined as unknown as number[]) : [1]));
      },
    };
    const store = fakeStore();
    await expect(embedAndStore(embedder, makeRecords(5), store.writeBatch)).rejects.toThrow(
      /fdcId=1001/,
    );
    expect(store.stored).toEqual([]);
  });

  it('сообщает прогресс по каждой пачке накопительно', async () => {
    const { embedder } = fakeEmbedder();
    const store = fakeStore();
    const progress: string[] = [];
    await embedAndStore(embedder, makeRecords(250), store.writeBatch, (p) => {
      progress.push(`${p.batchIndex}/${p.batchCount} ${p.written}/${p.total}`);
    });
    expect(progress).toEqual(['1/3 100/250', '2/3 200/250', '3/3 250/250']);
  });

  it('в текст ошибки попадает, сколько записей уже уцелело в базе', async () => {
    let call = 0;
    // Первые две пачки в порядке, третья приходит короткой.
    const embedder: Embedder = {
      async embed(texts) {
        call += 1;
        const full = texts.map(() => [1]);
        return call === 3 ? full.slice(0, 1) : full;
      },
    };
    const store = fakeStore();

    const error = await embedAndStore(embedder, makeRecords(300), store.writeBatch).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/осталось в базе/);
    expect((error as Error).message).toMatch(/200 записей/);
    expect(store.stored.length).toBe(200);
  });
});
