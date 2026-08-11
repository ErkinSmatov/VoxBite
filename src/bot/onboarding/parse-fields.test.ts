import { describe, expect, it } from 'vitest';
import { AGE_MAX, AGE_MIN, HEIGHT_MAX_CM, HEIGHT_MIN_CM, WEIGHT_MAX_KG, WEIGHT_MIN_KG } from './parse-fields';
import { parseAge, parseHeight, parseWeight } from './parse-fields';
import type { ParseResult } from './parse-fields';

function expectOk<T>(result: ParseResult<T>, value: T): void {
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toBe(value);
  }
}

function expectRejected<T>(result: ParseResult<T>): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.length).toBeGreaterThan(0);
    expect(result.error).toMatch(/[0-9]/);
  }
}

describe('parseAge', () => {
  it.each([
    ['29', 29],
    ['  29 ', 29],
    [String(AGE_MIN), AGE_MIN],
    [String(AGE_MAX), AGE_MAX],
  ])('parseAge(%j) -> ok value %d', (text, expected) => {
    expectOk(parseAge(text), expected);
  });

  it.each([
    ['29.5'],
    ['двадцать девять'],
    [''],
    ['NaN'],
    ['Infinity'],
    ['-Infinity'],
    [String(AGE_MIN - 1)],
    [String(AGE_MAX + 1)],
    ['0x10'],
    ['1e3'],
    ['   '],
  ])('parseAge(%j) -> rejected with Russian message containing a number', (text) => {
    expectRejected(parseAge(text));
  });
});

describe('parseHeight', () => {
  it.each([
    ['178', 178],
    [String(HEIGHT_MIN_CM), HEIGHT_MIN_CM],
    [String(HEIGHT_MAX_CM), HEIGHT_MAX_CM],
  ])('parseHeight(%j) -> ok value %d', (text, expected) => {
    expectOk(parseHeight(text), expected);
  });

  it.each([
    ['1.78'],
    ['0'],
    ['300'],
    ['not a number'],
    [''],
    [String(HEIGHT_MIN_CM - 1)],
    [String(HEIGHT_MAX_CM + 1)],
    ['NaN'],
    ['Infinity'],
  ])('parseHeight(%j) -> rejected', (text) => {
    expectRejected(parseHeight(text));
  });
});

describe('parseWeight', () => {
  it.each([
    ['72', 72],
    ['72,5', 72.5],
    ['72.5', 72.5],
    [String(WEIGHT_MIN_KG), WEIGHT_MIN_KG],
    [String(WEIGHT_MAX_KG), WEIGHT_MAX_KG],
  ])('parseWeight(%j) -> ok value %d', (text, expected) => {
    expectOk(parseWeight(text), expected);
  });

  it.each([
    ['72.55'],
    ['72,55'],
    [String(WEIGHT_MIN_KG - 1)],
    [String(WEIGHT_MAX_KG + 1)],
    ['not a number'],
    [''],
    ['NaN'],
    ['Infinity'],
  ])('parseWeight(%j) -> rejected', (text) => {
    expectRejected(parseWeight(text));
  });
});

describe('robustness', () => {
  it('never throws for empty or very long strings', () => {
    expect(() => parseAge('')).not.toThrow();
    expect(() => parseHeight('')).not.toThrow();
    expect(() => parseWeight('')).not.toThrow();
    const long = '9'.repeat(10000);
    expect(() => parseAge(long)).not.toThrow();
    expect(() => parseHeight(long)).not.toThrow();
    expect(() => parseWeight(long)).not.toThrow();
  });
});
