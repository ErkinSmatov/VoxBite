/**
 * copy — every Russian string the Mini App shows a user, collected in one
 * module so the owner can review all wording in one place.
 *
 * Strings marked "reused verbatim" in 04.1-UI-SPEC.md's Copywriting
 * Contract table are copied byte-for-byte from
 * `src/bot/formatting/correction-copy.ts` (that module is deleted in plan
 * 11; its strings move here) — not retyped from the spec table, so there is
 * no chance of a typo introducing drift between the old chat wording and
 * this screen's wording.
 *
 * Tone: plain, direct, states the fact then states what to do, never blames
 * the user, never leaks an internal error string/id. All copy is Russian.
 */

/**
 * The draft-expired and not-yours messages MUST stay byte-identical to each
 * other. A user must not be able to tell "this draft expired" from "this
 * draft belongs to someone else" — that distinction would leak the
 * existence of another user's draft (the same IDOR-privacy rule documented
 * in `draft-store.ts`'s header, T-04.1-35). Defined once, referenced twice,
 * so the two cases can never literally drift apart in source.
 */
const EXPIRED_OR_NOT_YOURS = 'Этот разбор устарел, отправь сообщение заново.';

export const copy = {
  // ---- Button labels (reused verbatim from correctionCopy) -------------

  btnAdd: '➕ Добавить',
  btnConfirm: '✅ Подтвердить',
  btnRemove: '✕ Убрать',
  btnDelete: '🗑 Удалить',
  btnCancelDraft: '✕ Отменить разбор',
  btnMinus10: '−10 г',
  btnPlus10: '+10 г',
  btnDeleteYes: 'Да, удалить',
  btnDeleteNo: 'Нет',

  /**
   * New string (not in correctionCopy — the chat flow never distinguished
   * a first-time confirm from re-saving an already-saved entry). Used for
   * the primary CTA when editing an already-saved diary entry (CORRECT-08).
   */
  btnSaveChanges: 'Сохранить изменения',

  /** New string — the tap target that expands a component row's inline candidate picker. */
  btnChangeCandidate: 'Сменить вариант',

  // ---- Card fragments (reused verbatim) ---------------------------------

  headerLevel1: 'Проверь разбор:',
  previewPrefix: '≈',

  /**
   * CALC-02/TECH_SPEC §5.8 — shown instead of a number whenever a nutrient
   * value is genuinely absent from the matched FDC record. Never render "0"
   * for absent data.
   */
  noData: 'нет данных',

  /** The lower-bound total line shown when at least one matched component is missing nutrient data. */
  partialTotal(known: string, missing: number, total: number): string {
    return `≥ ${known} (у ${missing} из ${total} нет данных)`;
  },

  chosenMarker: '✓',

  /** The line for a component with no FDC candidates at all. */
  noMatch: 'не нашёл подходящую запись',

  // ---- Flow messages (reused verbatim) -----------------------------------

  /** 401/403/404/410 all render this SAME message — see EXPIRED_OR_NOT_YOURS above. */
  expired: EXPIRED_OR_NOT_YOURS,
  notYours: EXPIRED_OR_NOT_YOURS,

  emptyStateHeading: 'Компонентов не осталось.',
  emptyStateBody: 'Добавь один заново или отмени разбор.',

  blockedConfirm(componentName: string): string {
    return (
      `Не могу подтвердить: для «${componentName}» не нашёл подходящую запись. ` +
      'Убери этот компонент или опиши его иначе.'
    );
  },

  deletePrompt: 'Удалить запись? Это навсегда.',
  deleted: 'Запись удалена.',

  gramsRejected: 'Не понял количество. Напиши число в граммах, например 200.',
  componentTooLong: 'Слишком длинное описание. Опиши компонент покороче.',

  addNotFound(componentName: string): string {
    return `Не нашёл подходящую запись для «${componentName}». Попробуй описать иначе.`;
  },

  cancelled: 'Разбор отменён.',

  // ---- New strings (no chat equivalent existed — 04.1-UI-SPEC.md) -------

  loading: 'Загружаю…',

  /** Full-screen error when the initial fetch or a mutation's network call fails. */
  loadFailed: 'Не получилось загрузить. Проверь соединение и попробуй ещё раз.',
  saveFailed: 'Не получилось сохранить. Проверь соединение и попробуй ещё раз.',
  retry: 'Обновить',

  /** Short-lived (~800ms) inline confirmation shown right before Telegram.WebApp.close(). */
  savedToDiary: 'Сохранено в дневник',
} as const;
