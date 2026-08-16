/**
 * createMessageEditor — the grammY-backed implementation of
 * `src/application/types.ts`'s `MessageEditor` port (D-13). The pipeline
 * edits its ack message in place ("Секунду, разбираю 🎧" -> result/failure),
 * and this is the only place that turns that decision into a real Telegram
 * API call.
 *
 * The `api` parameter is typed structurally (only `editMessageText`) rather
 * than importing grammY's `Api` type, so this stays unit-testable with a
 * one-line fake and keeps the orchestration layer transport-agnostic.
 *
 * Sent as plain text with no `parse_mode` — plan 03-03's result card is
 * deliberately plain text so that FDC descriptions or model output
 * containing markup characters (`_`, `*`, etc.) can never break rendering
 * (closes threat T-03-12/T-04-12).
 *
 * 04-12: `editMessageText`'s optional 4th parameter mirrors grammY's real
 * `editMessageText(chat_id, message_id, text, other?)` signature.
 * `createMessageEditor` forwards `replyMarkup` as `{ reply_markup: replyMarkup }`
 * ONLY when it is defined; when `replyMarkup` is `undefined`, `editMessageText`
 * is called with exactly three arguments, byte-for-byte identical to before
 * this change, so every existing failure path (which never had a keyboard)
 * stays unchanged. This one line is what the whole 04-12 gap closure rides
 * on — see `message-editor.test.ts`.
 */
import type { MessageEditor } from '../../application/types.js';

export interface EditableApi {
  editMessageText(chatId: number, messageId: number, text: string, other?: unknown): Promise<unknown>;
}

export function createMessageEditor(api: EditableApi): MessageEditor {
  return {
    async editMessage(chatId, messageId, text, replyMarkup) {
      if (replyMarkup !== undefined) {
        await api.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
      } else {
        await api.editMessageText(chatId, messageId, text);
      }
    },
  };
}
