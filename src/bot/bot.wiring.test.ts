/**
 * Static assertions about the composition root.
 *
 * NOTE: source-text order is a cheap tripwire, NOT proof of runtime order.
 * The binding proof that no handler can run before the allowlist gate lives
 * in `bot.wiring.runtime.test.ts`, which records the actual sequence of
 * registration calls `createBot()` makes.
 *
 * `createBot()` is not called here on purpose: constructing a `Bot` needs a
 * token, and the properties worth protecting are registration facts, not
 * runtime behaviour. This mirrors the check Plan 02-06 runs as its
 * `<automated>` step, and additionally pins the three CR fixes that live in
 * bot.ts so a future edit cannot quietly undo them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BOT_TS = fileURLToPath(new URL('./bot.ts', import.meta.url));
const MEAL_TS = fileURLToPath(new URL('./handlers/meal.ts', import.meta.url));
const CORRECTION_TS = fileURLToPath(new URL('./handlers/correction.ts', import.meta.url));

/** Strips `//` and `*`/`/*`-leading comment lines from a source file, so a
 * mention in prose does not count as the real call site. Shared by every
 * source-text tripwire below (bot.ts, meal.ts, correction.ts). */
function stripComments(path: string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n');
}

function botSource(): string {
  return stripComments(BOT_TS);
}

describe('bot.ts registration order (D-05 / T-02-23)', () => {
  it('registers allowlist -> session -> conversations', () => {
    const source = botSource();
    // Use the actual bot.use(createAllowlistMiddleware(...)) call site, not
    // just any occurrence of the identifier — the import declaration also
    // contains this string and always precedes every registration, which
    // would make this assertion pass even if the bot.use(...) call moved.
    const allowlist = source.indexOf('bot.use(createAllowlistMiddleware(');
    const sessionCall = source.indexOf('session(');
    // Match the CALL SITE, not the identifier: the import declaration also
    // contains this string. Matching the bare identifier is what previously
    // forced the import to be written halfway down bot.ts. The call is
    // generic (`createConversation<BotContext, BotContext>(`), so allow
    // either an immediate `(` or a type-argument list first.
    const conversation = source.search(/createConversation\s*[<(]/);

    expect(allowlist).toBeGreaterThanOrEqual(0);
    expect(allowlist).toBeLessThan(sessionCall);
    expect(sessionCall).toBeLessThan(conversation);
  });

  it('never starts the bot', () => {
    expect(botSource()).not.toMatch(/bot\.start\(/);
  });
});

describe('bot.ts Phase 3 meal-handler registrations (T-03-46 / T-03-44)', () => {
  it('registers every bot.on/bot.command/bot.callbackQuery call after createAllowlistMiddleware', () => {
    const source = botSource();
    // The literal string 'createAllowlistMiddleware' also appears in the
    // import declaration near the top of the file, which is always earlier
    // than every registration regardless of where bot.use(...) actually sits
    // — asserting against that index would never fail. The load-bearing
    // fact is the position of the CALL, bot.use(createAllowlistMiddleware(...)).
    const allowlistIndex = source.indexOf('bot.use(createAllowlistMiddleware(');
    expect(allowlistIndex).toBeGreaterThanOrEqual(0);

    const registrationIndices = [...source.matchAll(/bot\.(on|command|callbackQuery|hears)\(/g)].map(
      (m) => m.index,
    );
    expect(registrationIndices.length).toBeGreaterThan(0);
    for (const index of registrationIndices) {
      expect(index).toBeGreaterThan(allowlistIndex);
    }
  });

  it("registers 'message:voice' and 'message:text'", () => {
    const source = botSource();
    expect(source).toContain("'message:voice'");
    expect(source).toContain("'message:text'");
  });

  it('registers all six unsupported content-type filters', () => {
    const source = botSource();
    expect(source).toContain("'message:audio'");
    expect(source).toContain("'message:video_note'");
    expect(source).toContain("'message:photo'");
    expect(source).toContain("'message:document'");
    expect(source).toContain("'message:sticker'");
    expect(source).toContain("'message:video'");
  });

  it('constructs the meal handler deps via buildMealHandlerDeps', () => {
    const source = botSource();
    expect(source).toContain('buildMealHandlerDeps');
    expect(source).toContain('createVoiceHandler');
    expect(source).toContain('createTextHandler');
    expect(source).toContain('createUnsupportedHandler');
  });
});

describe('bot.ts Phase 4 correction registrations (T-04-08 / T-04-34)', () => {
  it('registers the crc: callbackQuery dispatcher after the allowlist gate call site', () => {
    const source = botSource();
    const allowlistIndex = source.indexOf('bot.use(createAllowlistMiddleware(');
    // Match the CALL SITE, not the bare identifier — CRC_PATTERN is also
    // named in the import declaration above every registration.
    const crcCallIndex = source.indexOf('bot.callbackQuery(CRC_PATTERN');

    expect(allowlistIndex).toBeGreaterThanOrEqual(0);
    expect(crcCallIndex).toBeGreaterThanOrEqual(0);
    expect(crcCallIndex).toBeGreaterThan(allowlistIndex);
  });

  it('registers exactly one message:text handler — no second, competing registration', () => {
    const source = botSource();
    const textRegistrations = [...source.matchAll(/bot\.on\('message:text'/g)];
    expect(textRegistrations).toHaveLength(1);
  });

  it("correction.ts never calls ctx.reply — every redraw edits the existing card (D-13)", () => {
    const source = stripComments(CORRECTION_TS);
    expect(source).not.toContain('ctx.reply(');
  });
});

describe('meal.ts D-04 spend-control gate order (the one ordering fact that costs real money)', () => {
  it('the awaiting-input interception precedes claimUpdate( inside createTextHandler', () => {
    const source = stripComments(MEAL_TS);

    // Scope to createTextHandler's own body: find its declaration, then the
    // NEXT `export function` (createUnsupportedHandler) marks the end, so a
    // match inside createVoiceHandler above it can never satisfy this check.
    const textHandlerStart = source.indexOf('export function createTextHandler(');
    expect(textHandlerStart).toBeGreaterThanOrEqual(0);
    const nextExportStart = source.indexOf('export function', textHandlerStart + 1);
    const textHandlerBody = nextExportStart >= 0 ? source.slice(textHandlerStart, nextExportStart) : source.slice(textHandlerStart);

    const interceptIndex = textHandlerBody.indexOf('interceptCorrectionText(ctx');
    const claimUpdateIndex = textHandlerBody.indexOf('claimUpdate(');

    expect(interceptIndex).toBeGreaterThanOrEqual(0);
    expect(claimUpdateIndex).toBeGreaterThan(interceptIndex);
  });
});

describe('bot.ts error and cancel wiring', () => {
  it('uses the shared error handler rather than a bare console.log (CR-01)', () => {
    const source = botSource();
    expect(source).toContain('bot.catch(createErrorHandler())');
    expect(source).not.toMatch(/bot\.catch\(\s*\(err\)\s*=>\s*\{\s*console\.log/);
  });

  it('acknowledges the restart callback through ack(), never bare (CR-02)', () => {
    const source = botSource();
    expect(source).toContain('await ack(ctx)');
    expect(source).not.toContain('ctx.answerCallbackQuery()');
  });

  it('registers /cancel and a bounded conversation config (CR-03)', () => {
    const source = botSource();
    expect(source).toContain("bot.command('cancel'");
    expect(source).toContain('ONBOARDING_CONVERSATION_CONFIG');
  });
});
