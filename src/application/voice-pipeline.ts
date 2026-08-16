/**
 * voice-pipeline — `processMeal()`, the single Telegram-agnostic orchestrator
 * that turns either an audio Buffer or a typed string into a persisted draft
 * and a rendered result card (VOICE-04: voice and text are the SAME pipeline
 * from the moment a transcript exists).
 *
 * Order of operations (this order is the contract — see 03-06-PLAN.md):
 * 1. Obtain the transcript — the ONLY branch between voice and text.
 * 2. decomposer.decompose(transcript).
 * 3. Empty decomposition (D-08 Phase 3) — edit into `noFood`, mark done, log, return.
 * 4. Batch-embed every `component_en` in ONE `embedder.embed()` call, then
 *    run `matchIngredient` for each in parallel (03-RESEARCH.md Pitfall 2).
 * 5. Build `DraftComponent[]` — every component survives, weak or absent
 *    matches are flagged, never dropped (D-21).
 * 6. `saveDraft` the row.
 * 7. `editor.editMessage` with `cardRenderer.renderLevel1` — the Phase 4
 *    level-1 correction card WITH its `crc:` keyboard, same message edited
 *    in place (D-13 Phase 3 / D-01 Phase 4). 04-12: this replaces the old
 *    keyboardless `buildResultCard` render, which was 04-UAT.md's blocker —
 *    a card with no buttons made the entire Phase 4 correction UI
 *    unreachable from the product's only entry point.
 * 8. `markUpdateStatus(..., 'done')` and one `logCost(...)` call.
 *
 * FAILURE HANDLING (03-RESEARCH.md Pitfall 6 — the governing rule): this
 * function is invoked as a detached promise from the bot layer, so
 * `bot.catch()` will never see its errors. `processMeal` therefore MUST
 * NEVER REJECT — every failure path edits the ack message into the right
 * Russian copy, marks the ledger row `failed`, and logs one short operator
 * line naming only the failure kind and the update id (never the transcript,
 * never a token, never the ctx — the `error-handler.ts` invariant, T-03-30).
 * If the ack edit itself fails, the failure is logged and swallowed — there
 * is no better recovery, and throwing would recreate exactly the unhandled
 * rejection this design exists to prevent.
 *
 * The audio Buffer is passed to `transcriber.transcribe` and then dropped —
 * never stored, never logged, never written to `diary_drafts` (D-05). The
 * transcript IS persisted; it is Phase 4's input and the only way to tell an
 * STT error from an LLM error after the fact.
 *
 * Matching goes exclusively through `src/domain/fdc-matching`'s
 * `matchIngredient` barrel — this file never queries pgvector directly and
 * never re-ranks (the repository's vector-distance ordering is a Phase 1
 * invariant hand-written query code would silently regress).
 *
 * Zero grammY imports — the only way this function touches Telegram is
 * through the injected `MessageEditor` (plan 03-03).
 */
import { matchIngredient, type FdcRepository } from '../domain/fdc-matching/index.js';
import type { Db } from '../db/client.js';
import type { Embedder } from '../adapters/embeddings/types.js';
import type { Transcriber } from '../adapters/stt/types.js';
import {
  DECOMPOSITION_MODEL,
  DecompositionFailedError,
  type DishDecomposer,
} from '../adapters/llm/types.js';
import { markUpdateStatus } from './idempotency.js';
import { saveDraft } from './draft-store.js';
import { deriveLocalDate } from './local-date.js';
import { logCost, type CostInputs } from './cost-log.js';
import {
  isWeakMatch,
  type DraftCardRenderer,
  type DraftComponent,
  type MealDraft,
  type MessageEditor,
} from './types.js';
import { pipelineCopy } from '../bot/formatting/pipeline-copy.js';
import type { ProcessedUpdateStatus } from '../db/schema/processed-updates.js';

export interface PipelineDeps {
  db: Db;
  transcriber: Transcriber;
  decomposer: DishDecomposer;
  embedder: Embedder;
  repo: FdcRepository;
  editor: MessageEditor;
  cardRenderer: DraftCardRenderer;
}

export type ProcessMealInput =
  | { kind: 'voice'; audio: Buffer; durationSeconds: number }
  | { kind: 'text'; text: string };

export interface ProcessMealArgs {
  updateId: number;
  telegramId: number;
  userId: number;
  chatId: number;
  ackMessageId: number;
  input: ProcessMealInput;
  /** The Telegram message's own timestamp (D-07) -- never `new Date()`. */
  receivedAt: Date;
  /** The user's IANA timezone, from `findOnboardedUser` (04-05). */
  timezone: string;
}

/**
 * Edits the ack message into `copy`, marks the ledger row `status`, logs one
 * operator line naming only `kind` and the update id, and — when `cost` is
 * supplied — the D-17 cost line for whatever was already spent before the
 * failure. Never throws — the whole point of this helper is to be the
 * terminal step of every failure path in a function that must not reject.
 *
 * Passing `cost` is not optional in spirit: a failure path that omits it
 * makes spend invisible exactly when a user is retrying a broken message
 * over and over, which is when the bill grows fastest.
 */
async function finish(
  deps: PipelineDeps,
  args: ProcessMealArgs,
  copy: string,
  status: ProcessedUpdateStatus,
  kind: string,
  cost?: CostInputs,
): Promise<void> {
  try {
    await deps.editor.editMessage(args.chatId, args.ackMessageId, copy);
  } catch {
    console.error(`voice-pipeline: failed to edit ack message for update ${args.updateId} (kind=${kind})`);
  }
  try {
    await markUpdateStatus(deps.db, args.updateId, status);
  } catch {
    console.error(`voice-pipeline: failed to mark update ${args.updateId} status=${status} (kind=${kind})`);
  }
  console.error(`voice-pipeline: ${kind} for update ${args.updateId}`);
  if (cost) {
    try {
      logCost(cost);
    } catch {
      // A cost line must never break the pipeline (see cost-log.ts).
      console.error(`voice-pipeline: failed to log cost for update ${args.updateId} (kind=${kind})`);
    }
  }
}

export async function processMeal(deps: PipelineDeps, args: ProcessMealArgs): Promise<void> {
  // Tracked across the whole run so a failure late in the flow can tell
  // "nothing reached the user yet" from "the user already has a correct card".
  let draftSaved = false;
  let cardDelivered = false;

  try {
    // 1. Obtain the transcript — the ONLY branch between voice and text.
    let transcript: string;
    let source: MealDraft['source'];
    let sttSeconds: number | null = null;
    let sttUsage: unknown = null;
    let sttModel: string | null = null;

    if (args.input.kind === 'voice') {
      try {
        const result = await deps.transcriber.transcribe(args.input.audio);
        transcript = result.text;
        sttModel = result.model;
        sttUsage = result.usage;
        sttSeconds = args.input.durationSeconds;
      } catch {
        // The STT call failed, so nothing is reliably billable and the LLM was
        // never reached — but still emit a line so the run is not invisible.
        await finish(deps, args, pipelineCopy.sttFailed, 'failed', 'stt_failed', {
          sttSeconds: args.input.durationSeconds,
          sttUsage: null,
          sttModel: null,
          llmUsage: null,
          llmModel: null,
          embeddedCount: 0,
          componentCount: 0,
        });
        return;
      }
      source = 'voice';
    } else {
      transcript = args.input.text;
      source = 'text';
    }

    // 2. Decompose.
    let decomposition;
    let llmUsage: unknown;
    let llmModel: string;
    try {
      const result = await deps.decomposer.decompose(transcript);
      decomposition = result.decomposition;
      llmUsage = result.usage;
      llmModel = result.model;
    } catch (err) {
      // STT was already paid for by this point, and DECOMP-03 means up to two
      // LLM attempts may also have been billed — the usage for those is lost
      // with the throw, so tokens render as unknown rather than as zero.
      const failureCost: CostInputs = {
        sttSeconds,
        sttUsage,
        sttModel,
        llmUsage: null,
        llmModel: DECOMPOSITION_MODEL,
        embeddedCount: 0,
        componentCount: 0,
      };
      if (err instanceof DecompositionFailedError) {
        await finish(
          deps,
          args,
          pipelineCopy.decompositionFailed,
          'failed',
          'decomposition_failed',
          failureCost,
        );
      } else {
        await finish(deps, args, pipelineCopy.internalError, 'failed', 'internal_error', failureCost);
      }
      return;
    }

    // 3. D-08: a well-formed empty decomposition is a normal answer.
    if (decomposition.items.length === 0) {
      try {
        await deps.editor.editMessage(args.chatId, args.ackMessageId, pipelineCopy.noFood);
      } catch {
        console.error(`voice-pipeline: failed to edit ack message for update ${args.updateId} (kind=no_food)`);
      }
      try {
        await markUpdateStatus(deps.db, args.updateId, 'done');
      } catch {
        console.error(`voice-pipeline: failed to mark update ${args.updateId} status=done (kind=no_food)`);
      }
      logCost({
        sttSeconds,
        sttUsage,
        sttModel,
        llmUsage,
        llmModel,
        embeddedCount: 0,
        componentCount: 0,
      });
      return;
    }

    // 4-8: embedding, matching, persisting and rendering — any failure here
    // is an internal error (D-13's catch-all).
    try {
      // ONE batched embed call (03-RESEARCH.md Pitfall 2) — never one
      // round-trip per component.
      const embeddings = await deps.embedder.embed(decomposition.items.map((item) => item.component_en));

      const matchedCandidates = await Promise.all(
        embeddings.map((embedding) => matchIngredient({ embedding, repo: deps.repo })),
      );

      const draftComponents: DraftComponent[] = decomposition.items.map((item, i) => {
        const candidates = matchedCandidates[i] ?? [];
        return {
          component: item.component,
          componentEn: item.component_en,
          grams: item.grams,
          candidates,
          chosenFdcId: candidates[0]?.fdcId ?? null,
          weakMatch: isWeakMatch(candidates),
        };
      });

      const successCost: CostInputs = {
        sttSeconds,
        sttUsage,
        sttModel,
        llmUsage,
        llmModel,
        embeddedCount: decomposition.items.length,
        componentCount: draftComponents.length,
      };

      // D-07 / 04-RESEARCH.md Pitfall 4: the diary day is frozen HERE, from
      // the message's own timestamp -- never from `new Date()` (that would
      // be "when the pipeline happened to run", not "when the user sent the
      // message"). Every later step (confirm, edit) only ever copies this
      // stored value.
      const localDate = deriveLocalDate(args.receivedAt, args.timezone);

      const draftId = await saveDraft(deps.db, {
        userId: args.userId,
        updateId: args.updateId,
        chatId: args.chatId,
        messageId: args.ackMessageId,
        source,
        transcript,
        components: draftComponents,
        status: 'draft',
        localDate,
      });
      draftSaved = true;

      const card = deps.cardRenderer.renderLevel1(draftComponents, draftId);
      await deps.editor.editMessage(args.chatId, args.ackMessageId, card.text, card.replyMarkup);
      cardDelivered = true;

      // Past this point the user already has a correct result card and the
      // draft is persisted. Nothing below may be allowed to overwrite that
      // card with an error, so each remaining step swallows its own failure
      // rather than falling into the catch below.
      try {
        await markUpdateStatus(deps.db, args.updateId, 'done');
      } catch {
        console.error(`voice-pipeline: failed to mark update ${args.updateId} status=done after delivering the card`);
      }
      try {
        logCost(successCost);
      } catch {
        console.error(`voice-pipeline: failed to log cost for update ${args.updateId}`);
      }
    } catch {
      await handleLateFailure(deps, args, {
        sttSeconds,
        sttUsage,
        sttModel,
        llmUsage,
        llmModel,
        embeddedCount: decomposition.items.length,
        componentCount: 0,
      });
    }
  } catch {
    // Defensive outer catch: guarantees processMeal never rejects even if
    // something unexpected escapes every inner handler above.
    await handleLateFailure(deps, args, null);
  }

  /**
   * Failure handling for the stage after decomposition.
   *
   * The naive version edited the ack into `internalError` unconditionally.
   * That was wrong once the card had already been delivered: a hiccup in a
   * later step (marking the ledger row, logging) replaced a correct result
   * the user could see with an error message, while the persisted draft
   * stayed behind as an orphan. A delivered card is never overwritten.
   */
  async function handleLateFailure(
    d: PipelineDeps,
    a: ProcessMealArgs,
    cost: CostInputs | null,
  ): Promise<void> {
    if (cardDelivered) {
      console.error(`voice-pipeline: post-delivery failure for update ${a.updateId} — result card left intact`);
      return;
    }
    if (draftSaved) {
      // The draft row exists but the user never saw a card. Phase 4 owns
      // draft lifecycle; surface it so the row is not silently orphaned.
      console.error(`voice-pipeline: draft persisted but card not delivered for update ${a.updateId}`);
    }
    await finish(d, a, pipelineCopy.internalError, 'failed', 'internal_error', cost ?? undefined);
  }
}
