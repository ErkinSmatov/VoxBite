/**
 * correction-keyboards — the `crc:` callback-data codec and the keyboard
 * builders for the whole D-01..D-12 correction flow (level 1: the meal,
 * level 2: a single component's candidate picker, the confirmed-entry
 * screen, the delete-confirmation screen, and the D-12 empty state).
 *
 * `@grammyjs/menu` is deliberately NOT adopted here. Its navigation state
 * lives partly in the menu object graph built at process startup, which is
 * exactly the out-of-Postgres state ARCHITECTURE.md Anti-Pattern 4 and
 * CORRECT-07 forbid — every screen in this phase must be re-derivable from
 * the draft row alone after a restart. A plain `InlineKeyboard` plus the
 * explicit `crc:<draftId>:<action>[:<index>]` codec below makes that
 * invariant obvious and testable (04-RESEARCH.md Alternatives Considered).
 *
 * `callback_data` is capped at 64 BYTES (not characters) by the Telegram
 * Bot API, and Cyrillic burns through that budget fast — so this codec
 * encodes only integers and short ASCII action tokens, never a description
 * or a component name (04-RESEARCH.md Pattern 2). Button LABELS may still
 * be Cyrillic and descriptive; only `callback_data` is budget-constrained.
 *
 * Parsing goes through the anchored `CRC_PATTERN` only — a loose
 * `split(':')` parse is forbidden (04-RESEARCH.md Security Domain V5,
 * T-04-06): a malformed or hand-crafted callback must be rejected (`null`),
 * never partially parsed or thrown on.
 */
import { InlineKeyboard } from 'grammy';
import type { DraftComponent } from '../../application/types.js';
import { correctionCopy } from '../formatting/correction-copy.js';

export const CRC_PREFIX = 'crc';

/**
 * One token per button this phase adds. `sel` (D-01 level-1 component pick),
 * `cand` (D-02 level-2 candidate pick), `gm`/`gp` (D-02 ±10 g), `gtype`
 * (D-04 typed grams), `rm` (D-02 remove component), `back` (D-02 return to
 * level 1), `add` (D-01/D-12 add component), `confirm` (D-01 save draft),
 * `cancel` (D-12 abandon draft), `edit` (D-05 reopen a saved entry), `del`
 * (D-08 start delete), `delyes`/`delno` (D-08 delete confirmation).
 */
export type CrcAction =
  | 'sel'
  | 'cand'
  | 'gm'
  | 'gp'
  | 'gtype'
  | 'rm'
  | 'back'
  | 'add'
  | 'confirm'
  | 'cancel'
  | 'edit'
  | 'del'
  | 'delyes'
  | 'delno';

const CRC_ACTIONS: ReadonlySet<string> = new Set<CrcAction>([
  'sel',
  'cand',
  'gm',
  'gp',
  'gtype',
  'rm',
  'back',
  'add',
  'confirm',
  'cancel',
  'edit',
  'del',
  'delyes',
  'delno',
]);

export interface CrcCallback {
  draftId: number;
  action: CrcAction;
  index?: number;
}

/** `crc:<draftId>:<action>` plus `:<index>` when an index is present. Throws
 * on a non-integer draftId/index — that is a builder bug, never a user
 * input path (user input only ever reaches `parseCrc`). */
export function encodeCrc(cb: CrcCallback): string {
  if (!Number.isInteger(cb.draftId) || cb.draftId < 0) {
    throw new Error(`encodeCrc: draftId must be a non-negative integer (got ${cb.draftId}).`);
  }
  if (cb.index !== undefined && (!Number.isInteger(cb.index) || cb.index < 0)) {
    throw new Error(`encodeCrc: index must be a non-negative integer (got ${cb.index}).`);
  }
  const base = `${CRC_PREFIX}:${cb.draftId}:${cb.action}`;
  return cb.index !== undefined ? `${base}:${cb.index}` : base;
}

/** STRICT, anchored pattern shared with plan 09's `bot.callbackQuery(...)`
 * registration, so the builder and the handler regex can never drift apart. */
export const CRC_PATTERN = /^crc:(\d+):([a-z]+)(?::(\d+))?$/;

/** Matches `CRC_PATTERN`, validates the action against the `CrcAction`
 * union, and bounds the parsed integers (`Number.isSafeInteger`,
 * non-negative). Returns `null` — never throws, never a partial object —
 * for anything unexpected, so a malformed or hand-crafted callback is
 * simply ignored by the handler. */
export function parseCrc(data: string): CrcCallback | null {
  const match = CRC_PATTERN.exec(data);
  if (!match) {
    return null;
  }

  const [, draftIdStr, actionStr, indexStr] = match;

  const draftId = Number(draftIdStr);
  if (!Number.isSafeInteger(draftId) || draftId < 0) {
    return null;
  }

  if (!actionStr || !CRC_ACTIONS.has(actionStr)) {
    return null;
  }
  const action = actionStr as CrcAction;

  if (indexStr === undefined) {
    return { draftId, action };
  }

  const index = Number(indexStr);
  if (!Number.isSafeInteger(index) || index < 0) {
    return null;
  }

  return { draftId, action, index };
}

const LEVEL1_LABEL_MAX_LENGTH = 40;

function truncateLabel(label: string): string {
  if (label.length <= LEVEL1_LABEL_MAX_LENGTH) {
    return label;
  }
  return `${label.slice(0, LEVEL1_LABEL_MAX_LENGTH - 1)}…`;
}

/** D-12: only Добавить and Отменить разбор — no Подтвердить, because there
 * is nothing to confirm. `buildLevel1Keyboard` delegates to this for an
 * empty component list rather than shipping a second, divergent path. */
export function buildEmptyStateKeyboard(draftId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(correctionCopy.btnAdd, encodeCrc({ draftId, action: 'add' }))
    .text(correctionCopy.btnCancelDraft, encodeCrc({ draftId, action: 'cancel' }));
}

/** D-01 level 1: one row per component (label carries the 1-based position,
 * the component name, and its rounded grams — the full FDC description
 * lives in the message body, so truncating this label is safe in a way
 * D-02 forbids for candidate descriptions), then Добавить + Подтвердить.
 * D-12: an empty draft renders `buildEmptyStateKeyboard` instead. */
export function buildLevel1Keyboard(components: DraftComponent[], draftId: number): InlineKeyboard {
  if (components.length === 0) {
    return buildEmptyStateKeyboard(draftId);
  }

  const kb = new InlineKeyboard();
  components.forEach((component, index) => {
    const grams = Math.round(component.grams);
    const label = truncateLabel(`${index + 1}. ${component.component} ${grams} г`);
    kb.text(label, encodeCrc({ draftId, action: 'sel', index }));
    kb.row();
  });

  kb.text(correctionCopy.btnAdd, encodeCrc({ draftId, action: 'add' })).text(
    correctionCopy.btnConfirm,
    encodeCrc({ draftId, action: 'confirm' }),
  );

  return kb;
}

/** D-01/D-02 level 2 for one component. Candidate buttons are numbered
 * ('1'/'2'/'3', never the description — D-02's whole point is that the raw-
 * vs-cooked signal lives in the message body text, not a truncatable button
 * label) carrying the CANDIDATE index; the component index is recoverable
 * from the draft row's level-2 selection state, so the codec stays a single
 * optional integer. Then ±10 g / typed grams, then Убрать / Назад. */
export function buildLevel2Keyboard(component: DraftComponent, index: number, draftId: number): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (component.candidates.length > 0) {
    component.candidates.forEach((_candidate, candidateIndex) => {
      kb.text(correctionCopy.btnCandidate(candidateIndex + 1), encodeCrc({ draftId, action: 'cand', index: candidateIndex }));
    });
    kb.row();
  }

  kb.text(correctionCopy.btnMinus10, encodeCrc({ draftId, action: 'gm' }))
    .text(correctionCopy.btnPlus10, encodeCrc({ draftId, action: 'gp' }))
    .text(correctionCopy.btnTypeGrams, encodeCrc({ draftId, action: 'gtype' }));
  kb.row();

  kb.text(correctionCopy.btnRemove, encodeCrc({ draftId, action: 'rm' })).text(
    correctionCopy.btnBack,
    encodeCrc({ draftId, action: 'back' }),
  );

  // `index` (the component's position within the draft) is accepted per
  // this plan's signature so callers do not need a second lookup step, even
  // though it is not encoded into callback_data here — see the doc comment
  // above.
  void index;

  return kb;
}

/** D-05: exactly Поправить (reopen the correction flow) and Удалить (start
 * the delete-confirmation flow). */
export function buildConfirmedKeyboard(draftId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(correctionCopy.btnEdit, encodeCrc({ draftId, action: 'edit' }))
    .text(correctionCopy.btnDelete, encodeCrc({ draftId, action: 'del' }));
}

/** D-08: exactly Да, удалить and Нет. */
export function buildDeleteConfirmKeyboard(draftId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(correctionCopy.btnDeleteYes, encodeCrc({ draftId, action: 'delyes' }))
    .text(correctionCopy.btnDeleteNo, encodeCrc({ draftId, action: 'delno' }));
}
