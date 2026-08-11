import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_OPTIONS,
  GOAL_OPTIONS,
  SEX_OPTIONS,
  TIMEZONE_OPTIONS,
  decodeOption,
} from '../onboarding/options';
import { RATE_PRESETS_KG_PER_MONTH, decodeRate } from '../onboarding/rate-presets';
import {
  CONFIRM_CALLBACK,
  RESTART_CALLBACK,
  buildConfirmKeyboard,
  buildOptionKeyboard,
  buildRateKeyboard,
} from './onboarding-keyboards';

describe('buildOptionKeyboard', () => {
  const allLists = [
    { name: 'sex', list: SEX_OPTIONS },
    { name: 'activity', list: ACTIVITY_OPTIONS },
    { name: 'goal', list: GOAL_OPTIONS },
    { name: 'tz', list: TIMEZONE_OPTIONS },
  ];

  it.each(allLists)('$name: every rendered callback_data decodes back to that option\'s value', ({ list }) => {
    const kb = buildOptionKeyboard(list);
    const flat = kb.inline_keyboard.flat();
    expect(flat).toHaveLength(list.length);
    for (const option of list) {
      const rendered = flat.find((btn) => 'callback_data' in btn && btn.callback_data === option.callbackData);
      expect(rendered).toBeDefined();
      expect(rendered && 'callback_data' in rendered ? decodeOption(list, rendered.callback_data) : undefined).toBe(
        option.value,
      );
      expect(rendered?.text).toBe(option.label);
    }
  });

  it('defaults to one option per row', () => {
    const kb = buildOptionKeyboard(SEX_OPTIONS);
    expect(kb.inline_keyboard).toHaveLength(SEX_OPTIONS.length);
    for (const row of kb.inline_keyboard) {
      expect(row).toHaveLength(1);
    }
  });

  it('perRow: 2 groups options two per row', () => {
    const kb = buildOptionKeyboard(ACTIVITY_OPTIONS, 2);
    expect(kb.inline_keyboard[0]).toHaveLength(2);
    expect(kb.inline_keyboard[1]).toHaveLength(2);
    const lastRow = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    expect(lastRow!.length).toBeLessThanOrEqual(2);
    const total = kb.inline_keyboard.reduce((sum, row) => sum + row.length, 0);
    expect(total).toBe(ACTIVITY_OPTIONS.length);
  });

  it('invents no label or value of its own', () => {
    const kb = buildOptionKeyboard(GOAL_OPTIONS);
    const flat = kb.inline_keyboard.flat();
    for (const btn of flat) {
      expect(GOAL_OPTIONS.some((o) => o.label === btn.text)).toBe(true);
    }
  });
});

describe('buildRateKeyboard', () => {
  it('renders exactly 4 buttons', () => {
    const kb = buildRateKeyboard();
    const flat = kb.inline_keyboard.flat();
    expect(flat).toHaveLength(4);
  });

  it('every label contains its numeric value and кг/мес', () => {
    const kb = buildRateKeyboard();
    const flat = kb.inline_keyboard.flat();
    for (const rate of RATE_PRESETS_KG_PER_MONTH) {
      const btn = flat.find((b) => b.text.includes(String(rate)));
      expect(btn).toBeDefined();
      expect(btn?.text).toContain('кг/мес');
    }
  });

  it('every rendered callback_data decodes through decodeRate to a member of RATE_PRESETS_KG_PER_MONTH, all <= 1', () => {
    const kb = buildRateKeyboard();
    const flat = kb.inline_keyboard.flat();
    for (const btn of flat) {
      const data = 'callback_data' in btn ? btn.callback_data : undefined;
      const decoded = decodeRate(data);
      expect(decoded).toBeDefined();
      expect(RATE_PRESETS_KG_PER_MONTH).toContain(decoded);
      expect(decoded!).toBeLessThanOrEqual(1);
    }
  });
});

describe('buildConfirmKeyboard', () => {
  it('renders exactly 2 buttons with the known callback constants and Russian labels', () => {
    const kb = buildConfirmKeyboard();
    const flat = kb.inline_keyboard.flat();
    expect(flat).toHaveLength(2);
    const dataValues = flat.map((b) => ('callback_data' in b ? b.callback_data : undefined));
    expect(dataValues.sort()).toEqual([CONFIRM_CALLBACK, RESTART_CALLBACK].sort());

    const confirmBtn = flat.find((b) => 'callback_data' in b && b.callback_data === CONFIRM_CALLBACK);
    const restartBtn = flat.find((b) => 'callback_data' in b && b.callback_data === RESTART_CALLBACK);
    expect(confirmBtn?.text).toBe('Всё верно');
    expect(restartBtn?.text).toBe('Изменить');
  });
});
