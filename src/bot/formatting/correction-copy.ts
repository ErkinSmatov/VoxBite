/**
 * correctionCopy — every Russian string and button label the correction
 * flow (confirm/correct/save loop, ingredient swap, ±10 g, add/remove,
 * delete) shows a user, collected in one module so the owner can review all
 * wording in one place. Each entry below is doc-commented with the
 * decision id (D-01..D-12, 04-CONTEXT.md) it implements.
 *
 * Matches the repo's established "state the fact, then state what to do"
 * voice (see pipeline-copy.ts, onboarding-copy.ts): plain, direct, no
 * marketing tone, never blames the user, never leaks an internal error
 * string or id.
 *
 * Zero grammY imports — this module only returns strings, it never touches
 * a Telegram ctx (D-08). Every string is sent with no `parse_mode`, so none
 * may contain Markdown control characters that would need escaping.
 */

export const correctionCopy = {
  // ---- Button labels (D-01/D-02/D-05/D-08/D-12) ----------------------

  /** D-01 — level-1 keyboard: add another component to the draft. */
  btnAdd: '➕ Добавить',

  /** D-01 — level-1 keyboard: confirm the draft and save it to the diary. */
  btnConfirm: '✅ Подтвердить',

  /** D-02 — level-2 keyboard: return to the level-1 card unchanged. */
  btnBack: '← Назад',

  /** D-02 — level-2 keyboard: remove this component from the draft. */
  btnRemove: '✕ Убрать',

  /** D-02 — level-2 keyboard: nudge the component's grams down by 10. */
  btnMinus10: '−10 г',

  /** D-02 — level-2 keyboard: nudge the component's grams up by 10. */
  btnPlus10: '+10 г',

  /** D-02 — level-2 keyboard: switch to typing an exact gram amount. */
  btnTypeGrams: '⌨ Ввести граммы',

  /** D-05 — post-save keyboard: reopen the correction flow on a saved entry. */
  btnEdit: '✎ Поправить',

  /** D-08 — post-save keyboard: start the delete-confirmation flow. */
  btnDelete: '🗑 Удалить',

  /** D-08 — delete-confirmation keyboard: proceed with the delete. */
  btnDeleteYes: 'Да, удалить',

  /** D-08 — delete-confirmation keyboard: abandon the delete. */
  btnDeleteNo: 'Нет',

  /** D-12 — empty-state keyboard: abandon the whole draft. */
  btnCancelDraft: '✕ Отменить разбор',

  /**
   * D-02 — level-2 keyboard's numbered candidate buttons. Kept as a
   * function (not three separate constants) so the keyboard builder never
   * hardcodes digits.
   */
  btnCandidate(index: number): string {
    return String(index);
  },

  // ---- Card fragments --------------------------------------------------

  /** D-01 — the line above the component list on the level-1 card. */
  headerLevel1: 'Проверь разбор:',

  /** D-03/D-05 — marker shown beside the ≈ preview before the entry is saved. */
  notSavedMarker: 'пока не сохранено',

  /** D-03 — leading token of the running-total preview line. */
  previewPrefix: '≈',

  /**
   * CALC-02/TECH_SPEC §5.8 — shown instead of a number whenever a nutrient
   * value is genuinely absent from the matched FDC record. Never render "0"
   * for absent data — that would silently claim a food has zero of a
   * nutrient the source data simply doesn't carry.
   */
  noData: 'нет данных',

  /**
   * D-09 — the lower-bound total line shown when at least one matched
   * component is missing nutrient data, e.g. "≥ 12 г (у 1 из 5 нет
   * данных)". A function, not a template constant, so no later plan can
   * assemble a second variant of this sentence.
   */
  partialTotal(known: string, missing: number, total: number): string {
    return `≥ ${known} (у ${missing} из ${total} нет данных)`;
  },

  /** D-02 — mark placed beside the currently chosen FDC candidate. */
  chosenMarker: '✓',

  /**
   * The line for a component with no FDC candidates at all. Reuses the
   * existing wording from `result-card.ts` verbatim so the pre- and
   * post-confirm cards never disagree.
   */
  noMatch: 'не нашёл подходящую запись',

  /** D-05 — names the local day an entry was saved to. */
  savedOn(localDate: string): string {
    return `Сохранено в дневник за ${localDate}`;
  },

  // ---- Flow messages -----------------------------------------------------

  /** D-11 — shown when a callback targets a draft that has expired/is gone. */
  expired: 'Этот разбор устарел, отправь сообщение заново.',

  /**
   * D-12 — shown when the user has removed every component from the draft.
   * States what to do next: add one back, or cancel the whole draft.
   */
  emptyState: 'Компонентов не осталось. Добавь один заново или отмени разбор.',

  /**
   * D-10 — blocks confirming a draft while a component still has no FDC
   * match. Names the offending component and offers exactly the two ways
   * out; must never suggest confirming anyway.
   */
  blockedConfirm(componentName: string): string {
    return (
      `Не могу подтвердить: для «${componentName}» не нашёл подходящую запись. ` +
      'Убери этот компонент или опиши его иначе.'
    );
  },

  /** D-08 — the delete-confirmation prompt, paired with btnDeleteYes/btnDeleteNo. */
  deletePrompt: 'Удалить запись? Это навсегда.',

  /** D-08 — the line shown after a delete completes. */
  deleted: 'Запись удалена.',

  /** D-04 — prompt shown after tapping btnTypeGrams. */
  askGrams(componentName: string): string {
    return `Сколько граммов «${componentName}»? Напиши число.`;
  },

  /** D-04 — prompt shown after tapping btnAdd. */
  askComponent: 'Что добавить? Напиши название компонента.',

  /**
   * The Russian retry message for an unparseable/zero/negative/absurd
   * typed gram amount (see plan 07 for the parsing rule). States what a
   * valid answer looks like.
   */
  gramsRejected: 'Не понял количество. Напиши число в граммах, например 200.',

  /**
   * Refusal for an over-long added-component text, mirroring
   * `pipelineCopy.textTooLong`'s refuse-don't-truncate stance — a truncated
   * name would be matched against FDC as if it were the whole thing.
   */
  componentTooLong: 'Слишком длинное описание. Опиши компонент покороче.',

  /** Shown when `matchIngredient` returns no candidates for added text. */
  addNotFound(componentName: string): string {
    return `Не нашёл подходящую запись для «${componentName}». Попробуй описать иначе.`;
  },

  /** The line shown after tapping btnCancelDraft. */
  cancelled: 'Разбор отменён.',

  /**
   * The neutral response when a callback's draft does not belong to the
   * tapping user (plan 09's IDOR guard, T-04-17). Deliberately
   * byte-identical to `expired` — a tapping user must not be able to
   * distinguish "this draft id does not exist" from "this draft belongs to
   * someone else", which would otherwise leak the existence of another
   * user's draft.
   */
  notYours: 'Этот разбор устарел, отправь сообщение заново.',
} as const;
