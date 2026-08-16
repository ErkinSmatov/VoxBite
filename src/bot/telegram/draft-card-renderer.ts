/**
 * draft-card-renderer — the bot-layer implementation of
 * `src/application/types.ts`'s `DraftCardRenderer` port (04-12).
 *
 * This file exists SOLELY to keep the grammY `InlineKeyboard` import out of
 * `src/application/`: `buildLevel1Keyboard` (correction-keyboards.ts) imports
 * grammY's `InlineKeyboard`, and `src/application/types.ts` rule 1 forbids
 * the application layer from importing grammY or any grammY type. The
 * pipeline already imports the grammY-free formatters (`pipeline-copy.ts`),
 * but that precedent does NOT extend to a module that imports grammY —
 * hence this bot-layer adapter, constructed once at the composition root
 * (`src/bot/pipeline-wiring.ts`) and injected into `PipelineDeps`.
 *
 * `createDraftCardRenderer()` is the ONLY renderer `voice-pipeline.ts` is
 * allowed to call.
 */
import { buildCorrectionCard } from '../formatting/correction-card.js';
import { buildLevel1Keyboard } from '../keyboards/correction-keyboards.js';
import type { DraftCardRenderer, RenderedCard } from '../../application/types.js';

export function createDraftCardRenderer(): DraftCardRenderer {
  return {
    renderLevel1(components, draftId): RenderedCard {
      return {
        text: buildCorrectionCard(components),
        replyMarkup: buildLevel1Keyboard(components, draftId),
      };
    },
  };
}
