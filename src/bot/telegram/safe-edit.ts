/**
 * safeEditMessageText / safeEditMessageReplyMarkup — redraw the correction
 * card (or its keyboard alone) without letting Telegram's "message is not
 * modified" rejection abort the caller.
 *
 * The exact error swallowed here is a `GrammyError` whose `description`
 * contains the literal substring `'message is not modified'`. Telegram
 * returns this 400 whenever an edit call would produce byte-identical
 * content to what is already on screen — and in this phase that is a
 * NORMAL user path, not an incident (04-RESEARCH.md Pitfall 1):
 *   - tapping `← Назад` back onto an unchanged level-1 screen
 *   - re-selecting the FDC candidate that is already chosen
 *
 * Only that specific error class is swallowed. `GrammyError`s carrying
 * `'message to edit not found'` (the message was deleted, or the chat/bot
 * was blocked) rethrow unchanged, as do plain transport errors — those are
 * real failures and must still reach the bot's global error handler.
 * Widening the swallow to every `GrammyError` would hide
 * "message to edit not found", which is a real bug worth surfacing
 * (T-04-18).
 *
 * Both parameters are structurally typed rather than importing grammY's
 * `Context`, mirroring `ack.ts`, so a real grammY `Context` satisfies them
 * structurally and the helpers stay unit-testable with a two-line fake.
 */
import { GrammyError } from 'grammy';

export interface EditableTextCtx {
  editMessageText: (text: string, other?: unknown) => Promise<unknown>;
}

export interface EditableMarkupCtx {
  editMessageReplyMarkup: (other?: unknown) => Promise<unknown>;
}

function isNotModifiedError(error: unknown): boolean {
  return error instanceof GrammyError && error.description.includes('message is not modified');
}

export async function safeEditMessageText(
  ctx: EditableTextCtx,
  text: string,
  other?: unknown,
): Promise<void> {
  try {
    await ctx.editMessageText(text, other);
  } catch (error) {
    if (isNotModifiedError(error)) {
      return;
    }
    throw error;
  }
}

export async function safeEditMessageReplyMarkup(
  ctx: EditableMarkupCtx,
  other?: unknown,
): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup(other);
  } catch (error) {
    if (isNotModifiedError(error)) {
      return;
    }
    throw error;
  }
}
