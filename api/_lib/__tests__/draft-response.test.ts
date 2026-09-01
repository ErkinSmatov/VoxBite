import { describe, expect, it } from 'vitest';
import { buildComponentsResponse, buildDraftResponse } from '../draft-response';
import type { DraftComponent, PersistedDraft } from '../../../src/application/types';

const FIXED_NOW = new Date('2026-08-15T12:00:00Z');

function makeComponent(overrides: Partial<DraftComponent> = {}): DraftComponent {
  return {
    component: 'курица',
    componentEn: 'chicken',
    grams: 150,
    candidates: [
      {
        fdcId: 1,
        description: 'Chicken, breast, raw',
        source: 'foundation_food',
        similarity: 0.9,
        kcal: 120,
        proteinG: 22,
        fatG: 3,
        carbsG: 0,
        sugarG: null,
      },
    ],
    chosenFdcId: 1,
    weakMatch: false,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
  return {
    id: 7,
    userId: 42,
    chatId: 100,
    messageId: 999,
    source: 'voice',
    transcript: 'курица 150 грамм',
    components: [makeComponent()],
    status: 'draft',
    localDate: '2026-08-15',
    diaryId: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

describe('buildDraftResponse', () => {
  it('returns the full envelope shape', () => {
    const draft = makeDraft();
    const response = buildDraftResponse(draft);

    expect(response).toEqual({
      draftId: 7,
      status: 'draft',
      saved: false,
      localDate: '2026-08-15',
      components: draft.components,
      total: response.total,
      contributingCount: 1,
      blockedComponent: null,
    });
  });

  it('saved is true only when status is confirmed AND diaryId is not null', () => {
    const confirmedWithDiary = buildDraftResponse(makeDraft({ status: 'confirmed', diaryId: 5 }));
    expect(confirmedWithDiary.saved).toBe(true);

    const confirmedNoDiary = buildDraftResponse(makeDraft({ status: 'confirmed', diaryId: null }));
    expect(confirmedNoDiary.saved).toBe(false);

    const draftStatus = buildDraftResponse(makeDraft({ status: 'draft', diaryId: 5 }));
    expect(draftStatus.saved).toBe(false);
  });

  it('total is exactly summarizeDraft(components).total', () => {
    const draft = makeDraft();
    const response = buildDraftResponse(draft);
    expect(response.total.kcal).toBe(180); // 150g * 120kcal/100g
    expect(response.total.sugarG).toBeNull();
  });

  it('blockedComponent is findBlockingComponent(components)?.component ?? null', () => {
    const blocked = makeComponent({ component: 'манго', chosenFdcId: null });
    const draft = makeDraft({ components: [blocked, makeComponent()] });
    const response = buildDraftResponse(draft);
    expect(response.blockedComponent).toBe('манго');

    const noBlock = buildDraftResponse(makeDraft());
    expect(noBlock.blockedComponent).toBeNull();
  });

  it('a null sugarG survives JSON.stringify as the literal null (CALC-02)', () => {
    const draft = makeDraft();
    const response = buildDraftResponse(draft);
    const serialised = JSON.stringify(response);
    const reparsed = JSON.parse(serialised);
    expect(reparsed.total.sugarG).toBeNull();
    expect(serialised).toContain('"sugarG":null');
  });
});

describe('buildComponentsResponse', () => {
  it('funnels through the same envelope shape as buildDraftResponse', () => {
    const components = [makeComponent()];
    const response = buildComponentsResponse(7, 'draft', false, '2026-08-15', components);

    expect(response).toEqual({
      draftId: 7,
      status: 'draft',
      saved: false,
      localDate: '2026-08-15',
      components,
      total: response.total,
      contributingCount: 1,
      blockedComponent: null,
    });
  });
});
