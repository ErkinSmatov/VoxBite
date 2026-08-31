/**
 * mini-app-button-renderer — the bot-layer implementation of
 * `src/application/types.ts`'s `OpenCorrectionRenderer` port (04.1-02),
 * which replaces Phase 4's draft-card-renderer port.
 *
 * This file exists SOLELY to keep the grammY `InlineKeyboard` import out of
 * `src/application/`: `src/application/types.ts` rule 1 forbids the
 * application layer from importing grammY or any grammY type — same reason
 * `draft-card-renderer.ts` (now deleted) existed.
 *
 * `createMiniAppButtonRenderer()` is the ONLY renderer `voice-pipeline.ts`
 * is allowed to call.
 */
import { InlineKeyboard } from 'grammy';
import type { OpenCorrectionRenderer, RenderedCard } from '../../application/types.js';
import { pipelineCopy } from '../formatting/pipeline-copy.js';

export function createMiniAppButtonRenderer(baseUrl: string): OpenCorrectionRenderer {
  // Strip trailing slashes defensively so a `.env` value ending in `/`
  // cannot produce `//?draftId=...`.
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  return {
    renderOpenButton(draftId): RenderedCard {
      const url = `${normalizedBaseUrl}/?draftId=${draftId}`;
      return {
        text: pipelineCopy.analysisReady,
        replyMarkup: new InlineKeyboard().webApp('🔧 Открыть для коррекции', url),
      };
    },
  };
}
