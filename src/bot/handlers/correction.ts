/**
 * correction — the single `crc:` callback-query dispatcher for the whole
 * D-01..D-12 correction flow. Every button built by
 * `src/bot/keyboards/correction-keyboards.ts` routes through
 * `createCorrectionCallbackHandler(deps)`, which parses the tap, re-reads
 * the draft, enforces ownership and expiry, dispatches to the matching
 * `src/application/corrections.ts` / `src/application/confirm-meal.ts`
 * operation, and redraws the SAME message (D-01, Phase 3 D-13).
 *
 * GATE ORDER (this order is this handler's entire correctness story — the
 * analogue of `meal.ts`'s spend-control story; do not reorder without
 * re-reading 04-RESEARCH.md's Pattern 1/Pattern 2 and this file's threat
 * model in 04-09-PLAN.md):
 *   1. `ack(ctx)` first and unconditionally — the card lives in chat history
 *      forever, so a tap a day later gets "query is too old"; that must
 *      never abort the flow (CR-02's callback-query analogue).
 *   2. `parseCrc(ctx.callbackQuery?.data ?? '')` — `null` => return silently.
 *      A malformed or hand-crafted payload is ignored, never guessed at
 *      (T-04-06).
 *   3. Resolve identity: `ctx.from?.id` -> `findOnboardedUser`. Missing =>
 *      `pipelineCopy.notOnboarded` and return.
 *   4. `readDraft(db, cb.draftId, user.id)` — the FIRST thing done with the
 *      parsed id, and it is scoped (T-04-01). `null` =>
 *      `correctionCopy.notYours` (byte-identical to `expired`, T-04-17).
 *   5. Status/expiry gates: `status === 'abandoned'` => expired copy.
 *      `isDraftExpired(...)` => mark abandoned, expired copy (D-11/T-04-09).
 *   6. Dispatch on `cb.action`. NEVER compute the next screen from `cb`
 *      alone — the draft read in step 4 is the only source of truth
 *      (T-04-33).
 *
 * LEVEL-2 COMPONENT INDEX (the contract gap 04-06-SUMMARY.md flagged):
 * `buildLevel2Keyboard`'s `cand`/`gm`/`gp`/`gtype`/`rm`/`back` buttons do NOT
 * carry the component index in `callback_data` — only `cand` carries the
 * CANDIDATE index. Per the plan's option (b), this file persists the
 * selected component index ON THE DRAFT ROW instead of in `callback_data`:
 * `sel` writes `awaitingInput = { kind: 'typed_grams', componentIndex }`
 * (reusing the existing `DraftAwaitingInput` shape rather than widening the
 * schema — `kind: 'typed_grams'` here means "the next free-text reply for
 * this draft, if any, is grams for this component", which is exactly true
 * whether or not `gtype` has been tapped yet, since typing a number is the
 * only free-text action level 2 offers). `gtype` is therefore idempotent on
 * top of `sel`'s write, only adding the visible `askGrams` prompt. Every
 * exit from level 2 (`back`, `rm`, navigating to `add`/`cancel`/`confirm`)
 * clears it via `clearAwaitingInput` so this state never leaks into an
 * unrelated later message once the user has left the screen.
 *
 * Redraw discipline: EVERY edit goes through `safeEditMessageText` /
 * `safeEditMessageReplyMarkup` (plan 03) — never `ctx.editMessageText`
 * directly. A no-op redraw (`← Назад` onto an unchanged screen, re-tapping
 * the already-chosen candidate) surfaces Telegram's `400: message is not
 * modified`, which both safe wrappers swallow (04-RESEARCH.md Pitfall 1,
 * T-04-32). This handler never sends a new message (`ctx.reply` is never
 * called here) — the card is the message Phase 3 already owns and edits in
 * place (D-13).
 *
 * LOGGING RULE: on any operation failure, log the draft id and the action
 * token only — never the transcript, component names, or the callback
 * payload (T-04-07).
 */
import type { BotContext } from '../bot.js';
import type { Db } from '../../db/client.js';
import type { Embedder } from '../../adapters/embeddings/types.js';
import type { FdcRepository } from '../../domain/fdc-matching/index.js';
import { ack } from '../telegram/ack.js';
import { safeEditMessageText, type EditableTextCtx } from '../telegram/safe-edit.js';
import { findOnboardedUser as findOnboardedUserReal } from '../../application/limits.js';
import {
  clearAwaitingInput as clearAwaitingInputReal,
  claimAbandon as claimAbandonReal,
  findAwaitingDraft as findAwaitingDraftReal,
  markDraftStatus as markDraftStatusReal,
  readDraft as readDraftReal,
  setAwaitingInput as setAwaitingInputReal,
} from '../../application/draft-store.js';
import {
  addComponent as addComponentReal,
  adjustGrams as adjustGramsReal,
  applyTypedGrams as applyTypedGramsReal,
  GRAM_STEP,
  removeComponent as removeComponentReal,
  swapCandidate as swapCandidateReal,
} from '../../application/corrections.js';
import {
  confirmMeal as confirmMealReal,
  deleteSavedEntry as deleteSavedEntryReal,
  recomputeSavedEntry as recomputeSavedEntryReal,
} from '../../application/confirm-meal.js';
import { isDraftExpired, type PersistedDraft } from '../../application/types.js';
import { parseCrc } from '../keyboards/correction-keyboards.js';
import {
  buildConfirmedKeyboard,
  buildDeleteConfirmKeyboard,
  buildEmptyStateKeyboard,
  buildLevel1Keyboard,
  buildLevel2Keyboard,
} from '../keyboards/correction-keyboards.js';
import {
  buildComponentEditCard,
  buildConfirmedCard,
  buildCorrectionCard,
} from '../formatting/correction-card.js';
import { correctionCopy } from '../formatting/correction-copy.js';
import { pipelineCopy } from '../formatting/pipeline-copy.js';

/** Passed as `other` to `safeEditMessageText` to remove the inline keyboard
 * entirely — omitting `reply_markup` on an edit call LEAVES the previous
 * keyboard in place, it does not clear it. */
const NO_KEYBOARD = { reply_markup: { inline_keyboard: [] } };

export interface CorrectionHandlerDeps {
  db: Db;
  embedder: Embedder;
  repo: FdcRepository;
  /** Injectable overrides for tests — default to the real implementations. */
  findOnboardedUser?: typeof findOnboardedUserReal;
  readDraft?: typeof readDraftReal;
  setAwaitingInput?: typeof setAwaitingInputReal;
  clearAwaitingInput?: typeof clearAwaitingInputReal;
  markDraftStatus?: typeof markDraftStatusReal;
  claimAbandon?: typeof claimAbandonReal;
  swapCandidate?: typeof swapCandidateReal;
  adjustGrams?: typeof adjustGramsReal;
  removeComponent?: typeof removeComponentReal;
  confirmMeal?: typeof confirmMealReal;
  recomputeSavedEntry?: typeof recomputeSavedEntryReal;
  deleteSavedEntry?: typeof deleteSavedEntryReal;
  /** Plan 10: the D-04 text-gate's lookup — the most recent 'draft' row for
   * this user with `awaiting_input IS NOT NULL`. */
  findAwaitingDraft?: typeof findAwaitingDraftReal;
  /** Plan 10: the typed-grams and added-component operations the text gate
   * dispatches into (plan 07). */
  applyTypedGrams?: typeof applyTypedGramsReal;
  addComponent?: typeof addComponentReal;
  /** Injectable clock for D-11 expiry tests — defaults to `() => new Date()`. */
  now?: () => Date;
}

function resolveComponentIndex(draft: PersistedDraft): number | undefined {
  return draft.awaitingInput?.componentIndex;
}

export function createCorrectionCallbackHandler(d: CorrectionHandlerDeps) {
  const findOnboardedUser = d.findOnboardedUser ?? findOnboardedUserReal;
  const readDraft = d.readDraft ?? readDraftReal;
  const setAwaitingInput = d.setAwaitingInput ?? setAwaitingInputReal;
  const clearAwaitingInput = d.clearAwaitingInput ?? clearAwaitingInputReal;
  const markDraftStatus = d.markDraftStatus ?? markDraftStatusReal;
  const claimAbandon = d.claimAbandon ?? claimAbandonReal;
  const swapCandidate = d.swapCandidate ?? swapCandidateReal;
  const adjustGrams = d.adjustGrams ?? adjustGramsReal;
  const removeComponent = d.removeComponent ?? removeComponentReal;
  const confirmMeal = d.confirmMeal ?? confirmMealReal;
  const recomputeSavedEntry = d.recomputeSavedEntry ?? recomputeSavedEntryReal;
  const deleteSavedEntry = d.deleteSavedEntry ?? deleteSavedEntryReal;
  const now = d.now ?? (() => new Date());

  return async (ctx: BotContext): Promise<void> => {
    // Cast once: BotContext's real `editMessageText` overload set is
    // stricter (grammY's `Other<>` type) than the structurally-typed
    // `EditableTextCtx` safe-edit.ts declares, but a real Context always
    // satisfies it at runtime — the same pattern safe-edit.ts documents for
    // its own unit tests with a two-line fake.
    const editCtx = ctx as unknown as EditableTextCtx;
    const editText = (text: string, other?: unknown) => safeEditMessageText(editCtx, text, other);

    // 1. Ack first and unconditionally.
    await ack(ctx);

    // 2. Strict parse — never split(':'), never guessed at.
    const cb = parseCrc(ctx.callbackQuery?.data ?? '');
    if (!cb) {
      return;
    }

    // 3. Resolve identity.
    const telegramId = ctx.from?.id;
    if (telegramId === undefined) {
      console.error('correction handler: update carries no from.id, ignoring');
      return;
    }
    const user = await findOnboardedUser(d.db, telegramId);
    if (!user) {
      await editText(pipelineCopy.notOnboarded, NO_KEYBOARD);
      return;
    }

    // 4. Scoped draft read — the FIRST use of the parsed draftId.
    const draft = await readDraft(d.db, cb.draftId, user.id);
    if (!draft) {
      await editText(correctionCopy.notYours, NO_KEYBOARD);
      return;
    }

    // 5. Status/expiry gates.
    if (draft.status === 'abandoned') {
      await editText(correctionCopy.expired, NO_KEYBOARD);
      return;
    }
    if (isDraftExpired(draft.status, draft.createdAt, now())) {
      await markDraftStatus(d.db, cb.draftId, user.id, 'abandoned');
      await editText(correctionCopy.expired, NO_KEYBOARD);
      return;
    }

    const renderLevel1 = async (components: PersistedDraft['components'], suffix?: string): Promise<void> => {
      if (components.length === 0) {
        await editText(correctionCopy.emptyState, {
          reply_markup: buildEmptyStateKeyboard(cb.draftId),
        });
        return;
      }
      const text = suffix ? `${buildCorrectionCard(components)}\n\n${suffix}` : buildCorrectionCard(components);
      await editText(text, { reply_markup: buildLevel1Keyboard(components, cb.draftId) });
    };

    const renderLevel2 = async (
      components: PersistedDraft['components'],
      index: number,
      suffix?: string,
    ): Promise<void> => {
      const component = components[index];
      if (!component) {
        await renderLevel1(components);
        return;
      }
      const text = suffix
        ? `${buildComponentEditCard(components, index)}\n\n${suffix}`
        : buildComponentEditCard(components, index);
      await editText(text, { reply_markup: buildLevel2Keyboard(component, index, cb.draftId) });
    };

    // 6. Dispatch — always from `draft`, the fresh scoped read.
    switch (cb.action) {
      case 'sel': {
        const index = cb.index;
        if (index === undefined || !draft.components[index]) {
          await renderLevel1(draft.components);
          return;
        }
        await setAwaitingInput(d.db, cb.draftId, user.id, { kind: 'typed_grams', componentIndex: index });
        await renderLevel2(draft.components, index);
        return;
      }

      case 'cand': {
        const componentIndex = resolveComponentIndex(draft);
        if (componentIndex === undefined || cb.index === undefined) {
          await renderLevel1(draft.components);
          return;
        }
        const result = await swapCandidate(d.db, cb.draftId, user.id, componentIndex, cb.index, now());
        if (!result.ok) {
          console.error(`correction handler: swapCandidate failed for draft ${cb.draftId} (${result.reason})`);
          await renderLevel2(draft.components, componentIndex);
          return;
        }
        if (draft.status === 'confirmed') {
          await recomputeSavedEntry(d.db, cb.draftId, user.id);
        }
        await renderLevel2(result.components, componentIndex);
        return;
      }

      case 'gm':
      case 'gp': {
        const componentIndex = resolveComponentIndex(draft);
        if (componentIndex === undefined) {
          await renderLevel1(draft.components);
          return;
        }
        const delta = cb.action === 'gp' ? GRAM_STEP : -GRAM_STEP;
        const result = await adjustGrams(d.db, cb.draftId, user.id, componentIndex, delta, now());
        if (!result.ok) {
          console.error(`correction handler: adjustGrams failed for draft ${cb.draftId} (${result.reason})`);
          await renderLevel2(draft.components, componentIndex);
          return;
        }
        if (draft.status === 'confirmed') {
          await recomputeSavedEntry(d.db, cb.draftId, user.id);
        }
        await renderLevel2(result.components, componentIndex);
        return;
      }

      case 'gtype': {
        const componentIndex = resolveComponentIndex(draft);
        if (componentIndex === undefined) {
          await renderLevel1(draft.components);
          return;
        }
        const component = draft.components[componentIndex];
        await setAwaitingInput(d.db, cb.draftId, user.id, { kind: 'typed_grams', componentIndex });
        await renderLevel2(draft.components, componentIndex, component ? correctionCopy.askGrams(component.component) : undefined);
        return;
      }

      case 'rm': {
        const componentIndex = resolveComponentIndex(draft);
        if (componentIndex === undefined) {
          await renderLevel1(draft.components);
          return;
        }
        const result = await removeComponent(d.db, cb.draftId, user.id, componentIndex, now());
        if (!result.ok) {
          console.error(`correction handler: removeComponent failed for draft ${cb.draftId} (${result.reason})`);
          await renderLevel1(draft.components);
          return;
        }
        await clearAwaitingInput(d.db, cb.draftId, user.id);
        if (draft.status === 'confirmed') {
          await recomputeSavedEntry(d.db, cb.draftId, user.id);
        }
        await renderLevel1(result.components);
        return;
      }

      case 'back': {
        await clearAwaitingInput(d.db, cb.draftId, user.id);
        await renderLevel1(draft.components);
        return;
      }

      case 'add': {
        await setAwaitingInput(d.db, cb.draftId, user.id, { kind: 'add_component' });
        await renderLevel1(draft.components, correctionCopy.askComponent);
        return;
      }

      case 'cancel': {
        const claimed = await claimAbandon(d.db, cb.draftId, user.id, 'draft');
        if (!claimed) {
          console.error(`correction handler: cancel claimAbandon lost the race for draft ${cb.draftId}`);
          await renderLevel1(draft.components);
          return;
        }
        await editText(correctionCopy.cancelled, NO_KEYBOARD);
        return;
      }

      case 'confirm': {
        const result = await confirmMeal(d.db, cb.draftId, user.id, now());
        if (result.ok) {
          await clearAwaitingInput(d.db, cb.draftId, user.id);
          await editText(buildConfirmedCard(result.components, result.localDate), {
            reply_markup: buildConfirmedKeyboard(cb.draftId),
          });
          return;
        }
        if (result.reason === 'blocked') {
          await renderLevel1(draft.components, correctionCopy.blockedConfirm(result.blockedComponent ?? ''));
          return;
        }
        if (result.reason === 'empty') {
          await editText(correctionCopy.emptyState, {
            reply_markup: buildEmptyStateKeyboard(cb.draftId),
          });
          return;
        }
        if (result.reason === 'already_confirmed') {
          const fresh = await readDraft(d.db, cb.draftId, user.id);
          if (fresh && fresh.diaryId !== null && fresh.localDate !== null) {
            await editText(buildConfirmedCard(fresh.components, fresh.localDate), {
              reply_markup: buildConfirmedKeyboard(cb.draftId),
            });
            return;
          }
          await editText(correctionCopy.expired, NO_KEYBOARD);
          return;
        }
        if (result.reason === 'not_found' || result.reason === 'expired' || result.reason === 'no_local_date') {
          await editText(correctionCopy.expired, NO_KEYBOARD);
          return;
        }
        console.error(`correction handler: confirmMeal write_failed for draft ${cb.draftId}`);
        await editText(pipelineCopy.internalError, NO_KEYBOARD);
        return;
      }

      case 'edit': {
        await clearAwaitingInput(d.db, cb.draftId, user.id);
        await renderLevel1(draft.components);
        return;
      }

      case 'del': {
        await editText(correctionCopy.deletePrompt, {
          reply_markup: buildDeleteConfirmKeyboard(cb.draftId),
        });
        return;
      }

      case 'delno': {
        if (draft.diaryId === null || draft.localDate === null) {
          await editText(correctionCopy.expired, NO_KEYBOARD);
          return;
        }
        await editText(buildConfirmedCard(draft.components, draft.localDate), {
          reply_markup: buildConfirmedKeyboard(cb.draftId),
        });
        return;
      }

      case 'delyes': {
        const result = await deleteSavedEntry(d.db, cb.draftId, user.id, true, now());
        if (result.ok || result.reason === 'already_deleted') {
          await editText(correctionCopy.deleted, NO_KEYBOARD);
          return;
        }
        console.error(`correction handler: deleteSavedEntry failed for draft ${cb.draftId} (${result.reason})`);
        await editText(correctionCopy.expired, NO_KEYBOARD);
        return;
      }

      // Exhaustiveness: CrcAction is a closed union and every member is
      // handled above; a new action added to the codec without a case here
      // is a compile error.
      default: {
        const exhaustive: never = cb.action;
        console.error(`correction handler: unhandled crc action ${String(exhaustive)} for draft ${cb.draftId}`);
        return;
      }
    }
  };
}

/**
 * D-04 text gate (plan 10): given a draft whose `awaitingInput` is non-null
 * (`findAwaitingDraft` already guarantees this — see
 * `createCorrectionTextHandler` below), dispatches the just-typed message
 * text into the matching operation and redraws the correction card IN
 * PLACE.
 *
 * Every redraw here targets `draft.chatId`/`draft.messageId` — the
 * ORIGINAL card message (Phase 3, D-13), NOT the user's own just-sent text
 * message, which is left untouched in the chat. `ctx.editMessageText`
 * cannot be used directly for this (it resolves chat/message id from the
 * CURRENT update, which here is the plain text message, not the card), so
 * this builds a one-off `EditableTextCtx` around `ctx.api.editMessageText`
 * pinned to the draft's own chat/message id and still routes every edit
 * through `safeEditMessageText` (same Pitfall-1 swallow as the callback
 * handler above).
 *
 * LOGGING RULE (unchanged from the module header): failures log the draft
 * id and operation/reason only, never the user's typed text.
 */
export async function handleAwaitingText(
  d: CorrectionHandlerDeps,
  ctx: BotContext,
  user: { id: number },
  draft: PersistedDraft,
): Promise<void> {
  const applyTypedGrams = d.applyTypedGrams ?? applyTypedGramsReal;
  const addComponent = d.addComponent ?? addComponentReal;
  const clearAwaitingInput = d.clearAwaitingInput ?? clearAwaitingInputReal;
  const markDraftStatus = d.markDraftStatus ?? markDraftStatusReal;
  const recomputeSavedEntry = d.recomputeSavedEntry ?? recomputeSavedEntryReal;
  const now = d.now ?? (() => new Date());

  const text = ctx.message?.text ?? '';

  // Cast `other` once, mirroring `createCorrectionCallbackHandler`'s
  // `editCtx` cast above: grammY's real `editMessageText` overload (`Other<>`
  // parameter type) is not directly assignable to the deliberately loose
  // `other?: unknown` safe-edit.ts declares for its own testability.
  const pinnedCtx: EditableTextCtx = {
    editMessageText: (t: string, other?: unknown) =>
      ctx.api.editMessageText(
        draft.chatId,
        draft.messageId,
        t,
        other as Parameters<typeof ctx.api.editMessageText>[3],
      ),
  };
  const editText = (t: string, other?: unknown) => safeEditMessageText(pinnedCtx, t, other);

  // D-11: the draft was read a moment ago via findAwaitingDraft, but TTL is
  // time-based, not state-based — it can still have crossed the expiry
  // boundary between that read and this dispatch.
  if (isDraftExpired(draft.status, draft.createdAt, now())) {
    await markDraftStatus(d.db, draft.id, user.id, 'abandoned');
    await clearAwaitingInput(d.db, draft.id, user.id);
    await editText(correctionCopy.expired, NO_KEYBOARD);
    return;
  }

  const awaiting = draft.awaitingInput;
  if (!awaiting) {
    // findAwaitingDraft only ever returns rows with the flag set, but this
    // function's own contract documents the precondition — treat a caller
    // violating it as a silent no-op rather than throwing.
    return;
  }

  const renderLevel1 = async (components: PersistedDraft['components'], suffix?: string): Promise<void> => {
    if (components.length === 0) {
      await editText(correctionCopy.emptyState, { reply_markup: buildEmptyStateKeyboard(draft.id) });
      return;
    }
    const rendered = suffix ? `${buildCorrectionCard(components)}\n\n${suffix}` : buildCorrectionCard(components);
    await editText(rendered, { reply_markup: buildLevel1Keyboard(components, draft.id) });
  };

  const renderLevel2 = async (
    components: PersistedDraft['components'],
    index: number,
    suffix?: string,
  ): Promise<void> => {
    const component = components[index];
    if (!component) {
      await renderLevel1(components);
      return;
    }
    const rendered = suffix
      ? `${buildComponentEditCard(components, index)}\n\n${suffix}`
      : buildComponentEditCard(components, index);
    await editText(rendered, { reply_markup: buildLevel2Keyboard(component, index, draft.id) });
  };

  if (awaiting.kind === 'typed_grams') {
    const componentIndex = awaiting.componentIndex;
    if (componentIndex === undefined) {
      await renderLevel1(draft.components);
      return;
    }

    const result = await applyTypedGrams(d.db, draft.id, user.id, componentIndex, text, now());
    if (!result.ok) {
      if (result.reason === 'invalid_grams') {
        // CORRECT-04 retry path: applyTypedGrams did NOT clear the awaiting
        // flag on this path, so the user's next message is routed here
        // again without re-tapping the button.
        await renderLevel2(draft.components, componentIndex, correctionCopy.gramsRejected);
        return;
      }
      console.error(`correction text handler: applyTypedGrams failed for draft ${draft.id} (${result.reason})`);
      await editText(correctionCopy.expired, NO_KEYBOARD);
      return;
    }
    // CR-02 (gap closure 04-13): a text-based correction of an already-saved
    // entry must keep the durable `diary` row in sync, mirroring every
    // button handler's `if (draft.status === 'confirmed')` guard above.
    if (draft.status === 'confirmed') {
      await recomputeSavedEntry(d.db, draft.id, user.id);
    }
    await renderLevel2(result.components, componentIndex);
    return;
  }

  // awaiting.kind === 'add_component'
  const result = await addComponent(d.db, draft.id, user.id, text, { embedder: d.embedder, repo: d.repo }, now());
  if (!result.ok) {
    if (result.reason === 'text_too_long') {
      // Flag left set — addComponent did not clear it on this path — so the
      // user can simply type a shorter description next.
      await renderLevel1(draft.components, correctionCopy.componentTooLong);
      return;
    }
    if (result.reason === 'empty_text') {
      await renderLevel1(draft.components, correctionCopy.askComponent);
      return;
    }
    if (result.reason === 'match_failed') {
      console.error(`correction text handler: addComponent match_failed for draft ${draft.id}`);
      await renderLevel1(draft.components, correctionCopy.addNotFound(text.trim()));
      return;
    }
    console.error(`correction text handler: addComponent failed for draft ${draft.id} (${result.reason})`);
    await editText(correctionCopy.expired, NO_KEYBOARD);
    return;
  }

  // CR-02 (gap closure 04-13): same recompute guard as the typed_grams
  // branch above — a successful add-component correction on an
  // already-saved entry must also keep the diary row's totals in sync.
  if (draft.status === 'confirmed') {
    await recomputeSavedEntry(d.db, draft.id, user.id);
  }

  const added = result.components[result.components.length - 1];
  if (added && added.candidates.length === 0) {
    await renderLevel1(result.components, correctionCopy.addNotFound(added.component));
    return;
  }
  await renderLevel1(result.components);
}

/**
 * D-04 (plan 10): the thin wrapper `meal.ts`'s text handler calls as its
 * gate-0.5 `interceptCorrectionText`. Looks up the user's awaiting draft
 * (already user-scoped, T-04-01) and either dispatches it via
 * `handleAwaitingText` and reports `true` (the caller must return
 * immediately — no claim, no ack, no paid pipeline), or reports `false`
 * when there is nothing awaiting so `meal.ts` proceeds with its normal
 * gate sequence.
 */
export function createCorrectionTextHandler(d: CorrectionHandlerDeps) {
  const findAwaitingDraft = d.findAwaitingDraft ?? findAwaitingDraftReal;

  return async (ctx: BotContext, user: { id: number }): Promise<boolean> => {
    const draft = await findAwaitingDraft(d.db, user.id);
    if (!draft) {
      return false;
    }
    await handleAwaitingText(d, ctx, user, draft);
    return true;
  };
}
