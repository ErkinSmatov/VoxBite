import { describe, expect, it } from 'vitest';
import { correctionCopy } from './correction-copy.js';

const MARKDOWN_HAZARD = /[*_]/;

function collectStrings(): string[] {
  const out: string[] = [];
  for (const value of Object.values(correctionCopy)) {
    if (typeof value === 'string') {
      out.push(value);
    }
  }
  // Sample outputs of every function entry too.
  out.push(correctionCopy.btnCandidate(1));
  out.push(correctionCopy.partialTotal('12 г', 1, 5));
  out.push(correctionCopy.savedOn('15 августа'));
  out.push(correctionCopy.blockedConfirm('Говядина'));
  out.push(correctionCopy.askGrams('Рис'));
  out.push(correctionCopy.addNotFound('Тофу'));
  return out;
}

describe('correctionCopy — required keys', () => {
  it('has every button label as a non-empty string', () => {
    expect(correctionCopy.btnAdd.length).toBeGreaterThan(0);
    expect(correctionCopy.btnConfirm.length).toBeGreaterThan(0);
    expect(correctionCopy.btnBack.length).toBeGreaterThan(0);
    expect(correctionCopy.btnRemove.length).toBeGreaterThan(0);
    expect(correctionCopy.btnMinus10.length).toBeGreaterThan(0);
    expect(correctionCopy.btnPlus10.length).toBeGreaterThan(0);
    expect(correctionCopy.btnTypeGrams.length).toBeGreaterThan(0);
    expect(correctionCopy.btnEdit.length).toBeGreaterThan(0);
    expect(correctionCopy.btnDelete.length).toBeGreaterThan(0);
    expect(correctionCopy.btnDeleteYes.length).toBeGreaterThan(0);
    expect(correctionCopy.btnDeleteNo.length).toBeGreaterThan(0);
    expect(correctionCopy.btnCancelDraft.length).toBeGreaterThan(0);
  });

  it('btnCandidate returns "1"/"2"/"3" for the numbered candidate buttons', () => {
    expect(correctionCopy.btnCandidate(1)).toBe('1');
    expect(correctionCopy.btnCandidate(2)).toBe('2');
    expect(correctionCopy.btnCandidate(3)).toBe('3');
  });

  it('has every card fragment as a non-empty string or function', () => {
    expect(correctionCopy.headerLevel1.length).toBeGreaterThan(0);
    expect(correctionCopy.notSavedMarker.length).toBeGreaterThan(0);
    expect(correctionCopy.previewPrefix.length).toBeGreaterThan(0);
    expect(correctionCopy.noData.length).toBeGreaterThan(0);
    expect(correctionCopy.chosenMarker.length).toBeGreaterThan(0);
    expect(correctionCopy.noMatch.length).toBeGreaterThan(0);
    expect(correctionCopy.savedOn('15 августа').length).toBeGreaterThan(0);
  });

  it('partialTotal renders the "≥ … (у N из M нет данных)" shape', () => {
    const text = correctionCopy.partialTotal('12 г', 1, 5);
    expect(text).toMatch(/^≥ 12 г \(у 1 из 5 нет данных\)$/);
  });

  it('blockedConfirm names the offending component', () => {
    expect(correctionCopy.blockedConfirm('Говядина')).toContain('Говядина');
  });

  it('has every flow message as a non-empty string or function', () => {
    expect(correctionCopy.expired.length).toBeGreaterThan(0);
    expect(correctionCopy.emptyState.length).toBeGreaterThan(0);
    expect(correctionCopy.deletePrompt.length).toBeGreaterThan(0);
    expect(correctionCopy.deleted.length).toBeGreaterThan(0);
    expect(correctionCopy.askGrams('Рис').length).toBeGreaterThan(0);
    expect(correctionCopy.askComponent.length).toBeGreaterThan(0);
    expect(correctionCopy.gramsRejected.length).toBeGreaterThan(0);
    expect(correctionCopy.componentTooLong.length).toBeGreaterThan(0);
    expect(correctionCopy.addNotFound('Тофу').length).toBeGreaterThan(0);
    expect(correctionCopy.cancelled.length).toBeGreaterThan(0);
    expect(correctionCopy.notYours.length).toBeGreaterThan(0);
  });

  it('notYours is byte-identical to expired (must not leak draft-existence)', () => {
    expect(correctionCopy.notYours).toBe(correctionCopy.expired);
  });

  it('contains no Markdown hazard characters ("*" or "_") anywhere', () => {
    for (const text of collectStrings()) {
      expect(text).not.toMatch(MARKDOWN_HAZARD);
    }
  });
});
