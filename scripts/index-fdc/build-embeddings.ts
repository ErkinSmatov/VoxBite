/**
 * Composes the embedding input text for each indexable record and calls the
 * shared Embedder in EMBEDDING_BATCH_SIZE-sized chunks, reporting progress
 * so a multi-minute run does not look frozen (owner is not backend-savvy —
 * "обработано 2000 из 8200" beats a silent hang).
 */
import { EMBEDDING_BATCH_SIZE, type Embedder } from '../../src/adapters/embeddings/types.js';
import type { IndexableRecord } from './load.js';

export interface EmbeddedRecord {
  record: IndexableRecord;
  embedding: number[];
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

export async function buildEmbeddings(
  embedder: Embedder,
  records: IndexableRecord[],
  onProgress?: (done: number, total: number, batchIndex: number, batchCount: number) => void,
): Promise<EmbeddedRecord[]> {
  if (records.length === 0) {
    return [];
  }

  const texts = records.map(embeddingInputFor);
  const batchCount = Math.ceil(texts.length / EMBEDDING_BATCH_SIZE);
  const allEmbeddings: number[][] = [];

  for (let b = 0; b < batchCount; b += 1) {
    const start = b * EMBEDDING_BATCH_SIZE;
    const end = Math.min(start + EMBEDDING_BATCH_SIZE, texts.length);
    const batchTexts = texts.slice(start, end);
    const batchEmbeddings = await embedder.embed(batchTexts);
    allEmbeddings.push(...batchEmbeddings);
    onProgress?.(allEmbeddings.length, texts.length, b + 1, batchCount);
  }

  if (allEmbeddings.length !== records.length) {
    throw new Error(
      `buildEmbeddings: expected ${records.length} embeddings, got ${allEmbeddings.length}.`,
    );
  }

  return records.map((record, i) => ({
    record,
    embedding: allEmbeddings[i] as number[],
  }));
}
