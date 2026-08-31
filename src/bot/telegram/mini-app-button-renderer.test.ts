import { describe, expect, it } from 'vitest';
import { pipelineCopy } from '../formatting/pipeline-copy.js';
import { createMiniAppButtonRenderer } from './mini-app-button-renderer.js';

interface InlineKeyboardLike {
  inline_keyboard: { text: string; web_app?: { url: string } }[][];
}

function singleButton(replyMarkup: unknown): { text: string; web_app?: { url: string } } {
  const buttons = (replyMarkup as InlineKeyboardLike).inline_keyboard.flat();
  expect(buttons).toHaveLength(1);
  return buttons[0]!;
}

describe('createMiniAppButtonRenderer().renderOpenButton', () => {
  it('returns text equal to pipelineCopy.analysisReady', () => {
    const renderer = createMiniAppButtonRenderer('https://example.vercel.app');

    const card = renderer.renderOpenButton(42);

    expect(card.text).toBe(pipelineCopy.analysisReady);
  });

  it('returns a replyMarkup with a single web_app button whose url ends in /?draftId=42', () => {
    const renderer = createMiniAppButtonRenderer('https://example.vercel.app');

    const card = renderer.renderOpenButton(42);

    const button = singleButton(card.replyMarkup);
    expect(button.web_app).toBeDefined();
    expect(button.web_app?.url.endsWith('/?draftId=42')).toBe(true);
  });

  it('a baseUrl with a trailing slash produces exactly one slash before the query string', () => {
    const renderer = createMiniAppButtonRenderer('https://example.vercel.app/');

    const card = renderer.renderOpenButton(7);

    const button = singleButton(card.replyMarkup);
    expect(button.web_app?.url).toBe('https://example.vercel.app/?draftId=7');
  });

  it('the returned object contains no component/candidate/nutrient data of any kind', () => {
    const renderer = createMiniAppButtonRenderer('https://example.vercel.app');

    const card = renderer.renderOpenButton(1);

    const serialized = JSON.stringify(card);
    expect(serialized).not.toMatch(/kcal|protein|fat|carbs|sugar|component|candidate/i);
  });
});
