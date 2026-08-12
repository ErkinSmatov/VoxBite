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
 * (closes threat T-03-12).
 */
import type { MessageEditor } from '../../application/types.js';

export interface EditableApi {
  editMessageText(chatId: number, messageId: number, text: string): Promise<unknown>;
}

export function createMessageEditor(api: EditableApi): MessageEditor {
  return {
    async editMessage(chatId, messageId, text) {
      await api.editMessageText(chatId, messageId, text);
    },
  };
}
