/**
 * Composes the embedding input text for each indexable record, calls the
 * shared Embedder in EMBEDDING_BATCH_SIZE-sized chunks, and — критично —
 * СРАЗУ пишет каждую полученную пачку в базу, до того как уйдёт запрос за
 * следующей.
 *
 * Почему именно так (CR-02): раньше все ~8 200 эмбеддингов копились в
 * памяти и записывались в базу одним куском в самом конце. Если прогон
 * падал на 80-й пачке из 83 (кончилась квота OpenAI, оборвалась сеть,
 * нажали Ctrl-C), всё уже ОПЛАЧЕННОЕ пропадало вместе с процессом, а
 * скрипт бодро советовал «просто перезапусти» — и владелец платил за те же
 * 8 200 эмбеддингов второй раз. Теперь пачка из 100 записей становится
 * долговечной (лежит в базе) сразу после того, как за неё заплатили:
 * падение на 80-й пачке оставляет пачки 1-79 в базе, а повторный запуск
 * пропустит их на шаге 5 (сверка dataset+model версий) и доплатит только
 * за остаток.
 *
 * Прогресс печатается по каждой пачке — многоминутный прогон не должен
 * выглядеть зависшим («записано 2000 из 8200» лучше молчания).
 */
import { EMBEDDING_BATCH_SIZE, type Embedder } from '../../src/adapters/embeddings/types.js';
import type { IndexableRecord } from './load.js';

export interface EmbeddedRecord {
  record: IndexableRecord;
  embedding: number[];
}

export interface EmbedAndStoreProgress {
  /** Номер только что записанной пачки, начиная с 1. */
  batchIndex: number;
  /** Сколько всего будет пачек. */
  batchCount: number;
  /** Сколько записей уже лежит в базе (накопительно). */
  written: number;
  /** Сколько записей всего в этом прогоне. */
  total: number;
}

/**
 * The embedding input is the BARE `description` string only.
 *
 * 01-RESEARCH.md Open Question #2: do NOT prepend category/source yet. If
 * Plan 08's 10-name spot-check shows category confusion (e.g. a raw
 * ingredient outranked by a visually similar prepared dish), that is the
 * first thing to try — but it is a deliberate follow-up experiment, not a
 * default baked in here.
 */
function embeddingInputFor(record: IndexableRecord): string {
  return record.description;
}

/**
 * Embeds `records` пачками и после КАЖДОЙ пачки вызывает `writeBatch`,
 * который обязан сделать запись долговечной (в этом проекте — upsert в
 * `fdc_foods`). Возвращает суммарное число записанных строк.
 *
 * Инварианты:
 * - следующий (платный) запрос к OpenAI уходит только после того, как
 *   предыдущая пачка успешно записана;
 * - если эмбеддингов пришло не столько, сколько записей в пачке, или
 *   какой-то из них пустой — бросаем ошибку ДО записи этой пачки
 *   (уже записанные пачки при этом остаются в базе);
 * - `writeBatch` не вызывается для пустого списка.
 */
export async function embedAndStore(
  embedder: Embedder,
  records: IndexableRecord[],
  writeBatch: (batch: EmbeddedRecord[]) => Promise<number>,
  onProgress?: (progress: EmbedAndStoreProgress) => void,
): Promise<number> {
  if (records.length === 0) {
    return 0;
  }

  const batchCount = Math.ceil(records.length / EMBEDDING_BATCH_SIZE);
  let written = 0;

  for (let b = 0; b < batchCount; b += 1) {
    const start = b * EMBEDDING_BATCH_SIZE;
    const slice = records.slice(start, start + EMBEDDING_BATCH_SIZE);
    const vectors = await embedder.embed(slice.map(embeddingInputFor));

    if (vectors.length !== slice.length) {
      throw new Error(
        `Пачка ${b + 1} из ${batchCount}: получено ${vectors.length} эмбеддингов на ` +
          `${slice.length} записей. Эта пачка не записана; всё, что записалось раньше ` +
          `(${written} записей), осталось в базе.`,
      );
    }

    const batch: EmbeddedRecord[] = slice.map((record, i) => {
      const embedding = vectors[i];
      if (embedding === undefined || embedding.length === 0) {
        throw new Error(
          `Пачка ${b + 1} из ${batchCount}: для записи fdcId=${record.fdcId} эмбеддинг не ` +
            `получен. Эта пачка не записана; всё, что записалось раньше (${written} записей), ` +
            `осталось в базе.`,
        );
      }
      return { record, embedding };
    });

    written += await writeBatch(batch);
    onProgress?.({ batchIndex: b + 1, batchCount, written, total: records.length });
  }

  return written;
}
