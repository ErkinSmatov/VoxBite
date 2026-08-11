---
phase: 02-bot-skeleton-onboarding
reviewed: 2026-08-11T00:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - drizzle/0003_grey_anthem.sql
  - drizzle/0004_bot_sessions_rls.sql
  - scripts/verify-schema.ts
  - src/bot/bot.ts
  - src/bot/commands/start.test.ts
  - src/bot/commands/start.ts
  - src/bot/commands/whoami.ts
  - src/bot/conversations/onboarding.ts
  - src/bot/formatting/onboarding-copy.test.ts
  - src/bot/formatting/onboarding-copy.ts
  - src/bot/index.ts
  - src/bot/keyboards/onboarding-keyboards.test.ts
  - src/bot/keyboards/onboarding-keyboards.ts
  - src/bot/middleware/allowlist.test.ts
  - src/bot/middleware/allowlist.ts
  - src/bot/onboarding/assemble-profile.test.ts
  - src/bot/onboarding/assemble-profile.ts
  - src/bot/onboarding/options.test.ts
  - src/bot/onboarding/options.ts
  - src/bot/onboarding/parse-fields.test.ts
  - src/bot/onboarding/parse-fields.ts
  - src/bot/onboarding/rate-presets.test.ts
  - src/bot/onboarding/rate-presets.ts
  - src/bot/onboarding/save-user.test.ts
  - src/bot/onboarding/save-user.ts
  - src/bot/storage/pg-storage-adapter.test.ts
  - src/bot/storage/pg-storage-adapter.ts
  - src/config/env.test.ts
  - src/config/env.ts
  - src/db/schema/bot-sessions.ts
  - src/db/schema/index.ts
findings:
  critical: 3
  warning: 15
  info: 8
  total: 26
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-08-11
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

The security-critical invariants the phase set out to protect mostly hold under
direct attack. Verified by tracing, not by reading comments:

- `parseAllowlist` returns an empty `Set` for `undefined`/`''`/whitespace, and
  `createAllowlistMiddleware` calls `next()` **only** on a positive `Set.has`
  hit — there is no code path where an empty or malformed list admits anybody.
  It is registered as the first `bot.use()`, ahead of `session()`,
  `conversations()` and every handler, so a rejected update triggers no session
  read and no `users` write.
- `decodeOption` and `decodeRate` are pure allowlist lookups. There is no
  `split(':')[1]`, no `Number(callbackData)`, no cast. A forged `rate:2` or
  `rate:1.0001` returns `undefined`; the conversation additionally re-checks
  membership in `RATE_PRESETS_KG_PER_MONTH` (onboarding.ts:121). The 1 kg/month
  cap survives all three layers (presets → `Math.min` clamp in
  `calculateTargetCalories` → `users_desired_rate_check`).
- No secret is logged. `bot.catch` prints `err.message` only; grammY's
  `BotError.message` is `"<Name> in middleware: <message>"` and `GrammyError.message`
  is `"Call to '<method>' failed! (<code>: <description>)"` — neither embeds the
  update or the token. `.env` is gitignored and only `.env.example` is tracked.
- No LLM anywhere near the arithmetic; all numbers come from
  `calculateNutritionTargets`.
- The `sess:` / `conv:` key-namespacing fix is correct and covered by a
  regression test. No other shared-key collision was found (there is exactly
  one conversation, and `conversations()` is given explicit storage so it does
  not fall back to `ctx.session`).

What is **not** sound is the failure behaviour. The bot has no error surface at
all: `bot.catch` logs one line and tells the user nothing, unguarded
`answerCallbackQuery()` calls throw on stale button presses, and a thrown error
inside the conversation terminates it and discards every answer collected so
far. Combined, a user who pauses onboarding overnight and taps the old keyboard
loses all their answers and sees no message whatsoever. Separately, there is no
way out of the conversation once entered — commands are unreachable and no
cancel path exists, so an abandoned onboarding is a permanent trap that
survives restarts.

Also flagged: a health disclaimer that is required "by construction" during
onboarding but is silently dropped on the `/start` return path, a
`floorApplied` message that displays a rate the bot did not actually use, a
`Number()`-based allowlist parser that admits `0x10` as ID 16, and a
`verify-schema` check labelled "desired_rate ≤ 1" that only greps for the
column name.

---

## Critical Issues

### CR-01: Every runtime error is invisible to the user, and inside the conversation it destroys all collected answers

**File:** `src/bot/bot.ts:92-94`, `src/bot/conversations/onboarding.ts:162-249`

**Issue:** `bot.catch` is the only error surface in the whole bot and it does
nothing but `console.log` one line:

```ts
bot.catch((err) => {
  console.log(`Ошибка обработчика: ${err.message}`);
});
```

`@grammyjs/conversations` v2 handles a throw inside the conversation function by
returning `{ status: "error" }` from `resumeConversation`, which makes the
plugin **exit the conversation and rethrow** (verified in
`node_modules/@grammyjs/conversations/out/plugin.js:490-503`). So any throw —
Postgres unreachable during `saveOnboardedUser`, a rejected
`answerCallbackQuery` (see CR-02), a Telegram 5xx on a `ctx.reply` — has three
compounding effects:

1. the conversation is terminated and its replay state deleted, so all seven
   answers the user just typed are gone;
2. the user receives **no message at all** — from their side the bot simply
   stopped responding mid-questionnaire;
3. the only trace is a Russian log line in a terminal the owner is not watching.

This is the exact failure mode the phase's own docs call out as unacceptable
for a backend-inexperienced owner debugging alone, and it is a data-loss path
(collected profile answers), not merely a UX wart.

**Fix:** make `bot.catch` tell the user something, and distinguish error kinds
without ever printing the update or the token:

```ts
bot.catch(async (err) => {
  // err.ctx is available; err.error is the original throw.
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error(`Telegram отклонил вызов ${e.method}: ${e.error_code} ${e.description}`);
  } else if (e instanceof HttpError) {
    console.error(`Нет связи с Telegram: ${e.message}`);
  } else {
    console.error(`Ошибка обработчика: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await err.ctx.reply(
      'Что-то пошло не так на моей стороне. Отправь /start, чтобы начать заново.',
    );
  } catch {
    // The user may have blocked the bot — nothing more we can do.
  }
});
```

Additionally, wrap the persistence step in the conversation so a DB failure is
recoverable instead of fatal:

```ts
const saved = await conversation.external(() =>
  saveOnboardedUser(db, { telegramId, answers: completeAnswers, targets })
    .then(() => true)
    .catch(() => false),
);
if (!saved) {
  await ctx.reply('Не удалось сохранить — нажми «Всё верно» ещё раз.');
  continue; // keeps the answers, re-shows the confirm screen
}
```

---

### CR-02: Unguarded `answerCallbackQuery()` turns a stale button press into total loss of onboarding progress

**File:** `src/bot/conversations/onboarding.ts:96`, `:119`, `:223`; `src/bot/bot.ts:85`

**Issue:** Four call sites call `answerCallbackQuery()` with no error handling:

```ts
const update = await conversation.waitFor('callback_query:data', { ... });
await update.answerCallbackQuery();          // onboarding.ts:96, :119, :223
```

```ts
bot.callbackQuery(RESTART_ONBOARDING_CALLBACK, async (ctx) => {
  await ctx.answerCallbackQuery();            // bot.ts:85
  await ctx.conversation.enter(ONBOARDING_CONVERSATION_ID);
});
```

Telegram rejects `answerCallbackQuery` with `400: query is too old and response
timeout expired or query ID is invalid` for a callback query whose originating
message is old. The conversation deliberately waits **indefinitely** (`for (;;)`
with no timeout, and `maxMillisecondsToWait` is not set), so "user opens the
chat the next day and taps the sex/goal/rate button that is still sitting in
their history" is a mainstream path, not an exotic one. Each of these throws a
`GrammyError` out of the conversation, which per CR-01 kills the conversation
and silently discards every answer.

Note the failure is not confined to the *first* question: because a rejection at
line 223 (the confirm screen) happens after all seven answers are collected but
before the write, the user loses the maximum possible amount of work.

**Fix:** answering a callback query is a cosmetic acknowledgement (it stops the
client-side spinner); it must never be able to abort the flow.

```ts
async function ack(ctx: { answerCallbackQuery: () => Promise<unknown> }): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // "query is too old" / already answered — the spinner will time out
    // client-side. Never let this abort the conversation.
  }
}
```

Replace all four `await …answerCallbackQuery()` calls with `await ack(…)`.
Inside the conversation, wrap it in `conversation.external()` if you want the
suppression to be replay-stable.

---

### CR-03: A user who abandons onboarding is permanently trapped — no cancel path, and commands are unreachable

**File:** `src/bot/bot.ts:74-87`, `src/bot/conversations/onboarding.ts:136-154`, `:170`

**Issue:** `createConversation` is registered with the default `parallel: false`,
which means that while a conversation is active it consumes the update and
**does not call downstream middleware** (`plugin.js` — the conversation
middleware returns without `next()` when it handles the update). The command
handlers at `bot.ts:82-87` are registered *after* it. Consequently:

- `/start` sent mid-onboarding is delivered to `askNumber`'s
  `waitFor('message:text')` as an ordinary text answer, fails `parseAge`, and
  produces `"Напиши свой возраст целым числом лет…"`. It never reaches
  `createStartHandler`.
- `askNumber` (onboarding.ts:144-153) is an unbounded `for (;;)` with "no
  attempt limit" by design and offers **no button and no keyword** that exits.
- The conversation state is persisted in `bot_sessions` under `conv:<chatId>`,
  so this survives `npm run bot` restarts.

A user who starts onboarding, gets to "рост в сантиметрах" and walks away is
permanently stuck: every subsequent message — for the lifetime of the row —
is answered with the height question. The only remedy is the owner manually
deleting a Postgres row. There is no `conversation.halt()` call anywhere in the
codebase (`grep` confirms), and `maxMillisecondsToWait` is never configured.

**Fix:** give the conversation an explicit exit and a bounded lifetime.

```ts
// In every wait step, treat /cancel as an exit rather than an answer:
const update = await conversation.waitFor('message:text', {
  otherwise: (otherCtx) => otherCtx.reply(question),
});
if (update.message.text.trim() === '/cancel') {
  await ctx.reply('Анкета отменена. Отправь /start, когда захочешь пройти её заново.');
  await conversation.halt();          // exits and clears the persisted state
}
```

and cap the wait so an abandoned conversation self-clears:

```ts
bot.use(
  createConversation<BotContext, BotContext>(
    (conversation, ctx) => onboardingConversation(conversation, ctx, deps.db),
    { id: ONBOARDING_CONVERSATION_ID, maxMillisecondsToWait: 24 * 60 * 60 * 1000 },
  ),
);
```

Also register a `bot.command('cancel', …)` so the command is discoverable when
no conversation is active.

---

## Warnings

### WR-01: `parseAllowlist` accepts hex and exponent notation, silently admitting a different Telegram ID than the owner typed

**File:** `src/bot/middleware/allowlist.ts:35-42`

**Issue:** `.map(Number)` is applied to arbitrary text. `Number('0x10')` is
`16`, `Number('1e3')` is `1000`, `Number('  12')` is `12`, `Number('12.0')` is
`12` — all pass `Number.isSafeInteger(n) && n > 0` and are inserted into the
allowlist. The module's own doc comment promises "malformed configuration input
should fail closed (drop the bad entry)", but these entries are not dropped;
they are silently converted into a *valid, different* Telegram ID. A typo in
`.env` therefore does not fail closed — it grants access to an unrelated
account. `allowlist.test.ts:4-13` never exercises any of these forms.

**Fix:** validate the literal shape before converting.

```ts
const ids = raw
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => /^\d+$/.test(entry))   // digits only — no 0x, no e, no sign, no dot
  .map(Number)
  .filter((n) => Number.isSafeInteger(n) && n > 0);
```

Add `['0x10,1e3,+12,12.0', []]` to `PARSE_CASES`.

---

### WR-02: The ONBOARD-06 disclaimer is dropped on the `/start` return path

**File:** `src/bot/commands/start.ts:40-48`, `:60-62`

**Issue:** `buildExistingTargetsMessage` renders calories and all three macros
to a returning user with no disclaimer:

```ts
'С возвращением! Вот твои текущие цели:',
`Калории: ${user.targetKcal} ккал`,
`Белки: ${user.targetProteinG} г, Жиры: ${user.targetFatG} г, Углеводы: ${user.targetCarbsG} г`,
```

This directly contradicts the invariant `onboarding.ts:213-214` states about
itself — "The disclaimer is part of this string by construction (ONBOARD-06) —
never composed separately, never optional" — and it is the path a returning user
hits *every single time*, whereas the disclaimed path fires once. For a product
that is explicitly not a medical device and hands out calorie targets, the
"never optional" wording should be enforced, not aspirational.

**Fix:** append `DISCLAIMER_TEXT` in `buildExistingTargetsMessage`, or better,
route both screens through one helper so a third caller cannot forget:

```ts
import { DISCLAIMER_TEXT } from '../formatting/onboarding-copy.js';

export function buildExistingTargetsMessage(user: OnboardedUserRow): string {
  return [
    'С возвращением! Вот твои текущие цели:',
    `Калории: ${user.targetKcal} ккал`,
    `Белки: ${user.targetProteinG} г, Жиры: ${user.targetFatG} г, Углеводы: ${user.targetCarbsG} г`,
    '',
    'Можешь пройти анкету заново, если что-то изменилось.',
    '',
    DISCLAIMER_TEXT,
  ].join('\n');
}
```

Add a test asserting `buildExistingTargetsMessage(row)` contains
`DISCLAIMER_TEXT`.

---

### WR-03: When the calorie floor is applied, the bot displays and persists a rate it did not actually use

**File:** `src/bot/formatting/onboarding-copy.ts:31-42`, `src/bot/onboarding/save-user.ts:58`

**Issue:** `calculateTargetCalories` returns `rateKgPerMonth` = the *requested*
(clamped) rate even when the safety floor overrode the deficit
(`target-calories.ts`: `return { targetKcal, floorApplied: raw < floor, rateKgPerMonth }`
— `rateKgPerMonth` is not recomputed from the floored `targetKcal`). The message
therefore reads, contradictorily:

```
Скорость изменения веса: 1 кг/мес
Запрошенный темп снижения веса пришлось скорректировать: ...
```

The user is told a number that is factually wrong about their own plan — in a
health context, where the whole point of the floor is to be honest about what
the bot will actually do. `save-user.ts:58` then persists that same unachievable
rate into `users.desired_rate_kg_per_month`, so the stored profile misrepresents
the plan too, despite the file comment claiming it stores "what was actually
calculated against".

**Fix (formatting layer, minimum):** suppress or restate the rate line when the
floor was applied.

```ts
if (t.rateKgPerMonth > 0 && !t.floorApplied) {
  lines.push(`Скорость изменения веса: ${t.rateKgPerMonth} кг/мес`);
}
```

**Fix (correct):** have `calculateTargetCalories` derive the effective rate from
the floored target and return that, so display and persistence both tell the
truth:

```ts
const effectiveDelta = tdee - targetKcal;                      // after the floor
const effectiveRate = (effectiveDelta * DAYS_PER_MONTH) / KCAL_PER_KG_BODY_MASS;
return { targetKcal, floorApplied: raw < floor, rateKgPerMonth: effectiveRate };
```

(Phase 1 domain change — coordinate, but the display fix above is safe to land
independently.)

---

### WR-04: A missing rate silently defaults to the *maximum* allowed rate rather than failing or defaulting conservatively

**File:** `src/bot/onboarding/assemble-profile.ts:31-35`, `src/domain/nutrition/target-calories.ts` (`desiredRateKgPerMonth ?? MAX_RATE_KG_PER_MONTH`)

**Issue:** `assembleProfile` returns
`{ …, desiredRateKgPerMonth }` for any non-`maintain` goal, including when the
field is `undefined` — the type allows it (`desiredRateKgPerMonth?: number`) and
nothing rejects it. `calculateTargetCalories` then resolves it as
`desiredRateKgPerMonth ?? MAX_RATE_KG_PER_MONTH`, i.e. the fastest rate the
product permits. The 1 kg/month figure is still respected, so this is not a cap
breach — but it is a fail-*open* default on the one axis the project treats as
a safety constraint: an omission produces the most aggressive plan instead of
the mildest. Today only the conversation's control flow (`onboarding.ts:196-198`)
prevents this; a future caller (a settings-edit flow, an import script) gets no
guard.

**Fix:** make the omission explicit rather than implicit.

```ts
if (goal !== 'maintain' && desiredRateKgPerMonth === undefined) {
  throw new Error('assembleProfile: desiredRateKgPerMonth is required for gain/loss goals');
}
```

and change the domain default to the mildest preset rather than the maximum if
a default must exist at all.

---

### WR-05: Callback queries that no handler matches are never answered — the client spinner hangs

**File:** `src/bot/bot.ts:82-87`, `src/bot/conversations/onboarding.ts:145-147`

**Issue:** There is no catch-all `bot.on('callback_query')`. Concretely:

- Double-tapping "Всё верно": the first press finishes the conversation
  (`onboarding.ts:243` returns), the second arrives with no active conversation
  and `data === 'confirm:yes'`, which matches neither
  `bot.callbackQuery(RESTART_ONBOARDING_CALLBACK)` nor anything else. It falls
  off the end of the middleware stack unanswered.
- `askNumber`'s `otherwise` (line 146) re-sends the question but never calls
  `answerCallbackQuery`, so a button press during a text step also hangs.

Telegram keeps the loading indicator spinning on the button for ~30 s in these
cases, which reads to the user as "the bot froze".

**Fix:** register a terminal fallback after all other handlers, and answer in
the `otherwise` branches.

```ts
bot.on('callback_query', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
  } catch {
    /* stale query */
  }
});
```

---

### WR-06: The allowlist middleware replies without checking a chat exists

**File:** `src/bot/middleware/allowlist.ts:61-64`

**Issue:** `await ctx.reply(...)` is called for every rejected update. `ctx.reply`
resolves the target chat via `ctx.chatId` and throws
`"Cannot reply: getChatId is not available"` when the update carries a `from`
but no chat — `inline_query`, `poll_answer`, `chosen_inline_result`,
`my_chat_member` for a channel. The middleware is the very first `bot.use()`,
so any such update from a non-allowlisted user throws straight into the silent
`bot.catch` from CR-01. `allowlist.test.ts` only ever exercises a fake ctx whose
`reply` always succeeds, so this is untested.

A secondary point: because the reply is unconditional, a non-allowlisted user
can drive one outbound Telegram API call plus one log line per message they
send, indefinitely — worth a rate limit before this is exposed beyond a closed
beta.

**Fix:**

```ts
const username = ctx.from?.username ?? '(нет username)';
console.log(`отказ: telegram_id=${id ?? 'unknown'}, @${username}`);
if (ctx.chat !== undefined) {
  try {
    await ctx.reply('Бот сейчас в закрытой бете. Попроси доступ у владельца бота.');
  } catch {
    // Blocked the bot / chat gone — the log line above is the record we need.
  }
}
return undefined;
```

---

### WR-07: `verify-schema` reports the 1 kg/month cap as verified when it only matched the column name

**File:** `scripts/verify-schema.ts:235-255`

**Issue:**

```ts
const checks: Array<[string, RegExp]> = [
  ['sex (male/female)', /'male'/],
  ['activity_level (5 уровней)', /'minimal'/],
  ['goal (gain/loss/maintain)', /'gain'/],
  ['desired_rate_kg_per_month <= 1', /desired_rate_kg_per_month/],
];
```

All four regexes are matched against `defs`, the concatenation of *every* check
constraint on `users`. The rate check passes if the column name appears
anywhere — a constraint of `desired_rate_kg_per_month >= 0` with no upper bound
would report `[ok] CHECK-ограничения на users … потолок темпа набора/снижения
веса (1 кг/месяц)`. This is the automated verifier for the phase's headline
safety invariant, and it verifies nothing about the bound. The `'male'` /
`'minimal'` / `'gain'` regexes are similarly weak (they do not confirm the
*other* allowed literals are present, nor that no extra literal was added).

**Fix:** assert on the bound, normalising whitespace:

```ts
const defs = rows.map((r) => r.consrc).join('\n').replace(/\s+/g, ' ');
const checks: Array<[string, RegExp]> = [
  ['sex (male/female)', /sex.*in \('male', ?'female'\)/],
  ['activity_level (5 уровней)', /activity_level.*'minimal'.*'very_high'/],
  ['goal (gain/loss/maintain)', /goal.*'gain'.*'loss'.*'maintain'/],
  ['desired_rate_kg_per_month <= 1', /desired_rate_kg_per_month <= \(?1/],
];
```

---

### WR-08: `verify-schema --json` emits human-readable lines before the JSON, so the output is not parseable

**File:** `scripts/verify-schema.ts:56-60`, `:287-319`

**Issue:** `record()` unconditionally does `console.log(\`${label} ${name} — ${detail}\`)`.
In `--json` mode those seven `[ok]`/`[FAIL]` lines are printed to stdout ahead of
`JSON.stringify(output)`, so `npm run verify-schema -- --json | jq` fails to
parse. The flag's stated purpose ("полезно для скриптов") is not met. The
`jsonMode` flag is read at line 287 but only used to suppress the banner at 298.

**Fix:** thread the mode through, or simplest — suppress the per-check line when
`--json` is set:

```ts
const jsonMode = process.argv.includes('--json');

function record(name: string, ok: boolean, detail: string, remediation?: string): void {
  results.push({ name, ok, detail, remediation });
  if (!jsonMode) {
    console.log(`${ok ? '[ok]' : '[FAIL]'} ${name} — ${detail}`);
  }
}
```

(Hoist `jsonMode` to module scope; it is currently a local in `main()`.)

---

### WR-09: The empty `catch {}` around `dotenvSafe.config()` disables the entire reason `dotenv-safe` was chosen

**File:** `src/config/env.ts:55-62`

**Issue:**

```ts
try {
  dotenvSafe.config({ example: '.env.example', allowEmptyValues: false });
} catch {
  // ...fall through...
}
```

Every failure mode of `dotenv-safe` is swallowed: `.env.example` missing or
unreadable, `.env` unreadable, and — the intended one — a declared variable
being absent. `STACK.md` selected `dotenv-safe` specifically because it "fails
fast if a required env var is missing"; with this catch, that behaviour is dead
and the only real enforcement is the hand-rolled `REQUIRED_ENV_KEYS` loop below.
The design also depends on an undocumented ordering detail inside `dotenv-safe`
(that `dotenv.config()` has already populated `process.env` before the
validation throw); if that ordering ever changes, `loadEnv()` will report every
key as missing even though `.env` is correct.

Note the trigger is self-inflicted: `BETA_ALLOWLIST` is declared in
`.env.example` and is legally empty, so `allowEmptyValues: false` makes
`dotenv-safe` throw on the *normal* first-run configuration.

**Fix:** stop pretending to use `dotenv-safe`'s validation — use plain `dotenv`
for loading and keep the explicit, Russian-messaged check as the single
enforcement point:

```ts
import dotenv from 'dotenv';
// ...
const result = dotenv.config();
if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
  throw new Error(`Не удалось прочитать файл .env: ${result.error.message}`);
}
```

Then drop the `dotenv-safe` dependency and its `@types` package. Keep the
`.env.example`-parity test in `env.test.ts` — that is the check actually
providing value.

---

### WR-10: The entrypoint guard silently no-ops on any path containing a space or non-ASCII character

**File:** `src/bot/index.ts:97`

**Issue:**

```ts
if (import.meta.url === `file://${process.argv[1]}`) {
```

`import.meta.url` is a percent-encoded URL. For a checkout at
`/Users/x/My Projects/VoxBite`, `import.meta.url` is
`file:///Users/x/My%20Projects/VoxBite/src/bot/index.ts` while the right-hand
side is `file:///Users/x/My Projects/VoxBite/src/bot/index.ts`. They differ, the
condition is false, and `npm run bot` exits **0 with no output at all** — the
worst possible failure for the target user of this project, who has no way to
tell "started and idle" from "did nothing". The same happens for Cyrillic
directory names and on Windows (`C:\…` vs `file:///C:/…`).

**Fix:**

```ts
import { pathToFileURL } from 'node:url';

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch(/* ... */);
}
```

---

### WR-11: `createPgStorageAdapter`'s default empty `keyPrefix` re-opens the collision that was just fixed

**File:** `src/bot/storage/pg-storage-adapter.ts:46`

**Issue:** `keyPrefix = ''` is a default parameter. The bug this phase fixed was
precisely "two consumers of this table using the same raw key". The default
makes "no prefix" the path of least resistance, so the next consumer added to
`bot_sessions` (a rate-limit store, a draft-diary store in Phase 3) collides
with whatever else defaults to `''`. Making the invariant depend on every future
caller remembering to pass an argument is what caused the original incident.
`pg-storage-adapter.test.ts:74`, `:84`, `:94` etc. all call it without a prefix,
so the unsafe form is also the one the tests normalise.

**Fix:** make the namespace mandatory and typed to the known set.

```ts
export type StorageNamespace = 'sess:' | 'conv:';

export function createPgStorageAdapter<T>(db: Db, keyPrefix: StorageNamespace): StorageAdapter<T> {
```

The compiler then rejects any new caller that forgets, and extending the union
forces a deliberate decision. Update the tests to pass an explicit namespace.

---

### WR-12: `bot_sessions` rows containing partial health data are never expired

**File:** `src/db/schema/bot-sessions.ts:28-32`, `src/bot/storage/pg-storage-adapter.ts:58-71`

**Issue:** The adapter has `read`/`write`/`delete` but nothing ever prunes. The
`conversations` plugin deletes its row when a conversation completes normally,
but an abandoned conversation (which per CR-03 is common and permanent) leaves
a `conv:<chatId>` row holding the user's partially-entered sex, age, height and
weight — indefinitely. The `sess:<chatId>` rows are never deleted at all, since
nothing ever sets `ctx.session` to null. `updatedAt` exists on the table but is
read by nobody.

This conflicts with the project's stated privacy posture (CLAUDE.md: sensitive
health data, minimal retention). RLS protects it from the PostgREST API, but
retention is a separate obligation.

**Fix:** add a startup or scheduled sweep using the column that already exists:

```ts
export async function pruneStaleSessions(db: Db, olderThanDays = 30): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  await db.delete(botSessions).where(lt(botSessions.updatedAt, cutoff));
}
```

Call it once from `src/bot/index.ts` at startup. Pair with
`maxMillisecondsToWait` from CR-03 so the plugin also gives up on its own.

---

### WR-13: The `REVOKE` guard checks only one of the two roles it revokes from

**File:** `drizzle/0004_bot_sessions_rls.sql:24-29`

**Issue:**

```sql
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
  REVOKE ALL ON TABLE "bot_sessions" FROM anon, authenticated;
END IF;
```

The existence check covers `anon`; the statement also names `authenticated`. On
any database where `anon` exists but `authenticated` does not (a hand-rolled
PostgREST setup, a partially-provisioned instance, a restored dump), the
`REVOKE` raises `role "authenticated" does not exist`, the DO block aborts, and
`drizzle-kit migrate` fails — leaving the journal in an ambiguous state for an
owner with no backend experience. The comment explicitly claims the guard makes
this "a no-op (does not error)", which is only true for the both-present and
both-absent cases.

**Fix:** guard each role independently.

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "bot_sessions" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "bot_sessions" FROM authenticated;
  END IF;
END $$;
```

---

### WR-14: Migration `0004` is in the journal but has no snapshot, unlike the equivalent hand-written `0002`

**File:** `drizzle/meta/_journal.json` (entry idx 4), `drizzle/0004_bot_sessions_rls.sql`

**Issue:** `drizzle/meta/` contains `0000_`–`0003_snapshot.json` but no
`0004_snapshot.json`, while `_journal.json` declares an `idx: 4` entry with
`when: 1786465795114` (one millisecond after 0003 — hand-edited). The precedent
set by the previous hand-written RLS migration, `0002_enable_rls`, is that a
snapshot file *is* present. `drizzle-kit generate` locates the previous schema
state by the journal's last entry; a journal entry with no matching snapshot is
an inconsistency that will surface the next time the owner runs
`npm run db:generate` — either as a crash or as a diff computed against the
wrong baseline. Given the owner's stated inexperience, a confusing drizzle-kit
error at the start of Phase 3 is an avoidable trap.

**Fix:** copy `0003_snapshot.json` to `0004_snapshot.json` and update its `id` /
`prevId` fields to match the pattern used by `0002_snapshot.json` (0004 makes no
DDL change drizzle tracks, so the schema content is identical to 0003). Verify
with `npm run db:generate` producing an empty/`0005` migration rather than an
error, before committing.

---

### WR-15: Extensionless relative imports in shipped source diverge from the repo's `.js` convention

**File:** `src/db/schema/index.ts:1-4`; also `src/domain/nutrition/calculate-targets.ts`, `src/bot/onboarding/options.test.ts`, `rate-presets.test.ts`, others

**Issue:**

```ts
export * from './users';
export * from './diary';
export * from './fdc-foods';
export * from './bot-sessions';
```

Every other module under `src/bot/**` uses explicit `.js` specifiers
(`'./middleware/allowlist.js'`, `'../../db/client.js'`). The extensionless form
only resolves because `tsconfig.json` sets `moduleResolution: "Bundler"` and the
project is executed exclusively through `tsx`. `package.json` declares
`"type": "module"` and `tsc` is configured with `noEmit`, so the moment anyone
adds a real build step (or runs under plain `node` with type stripping) these
specifiers fail at **runtime**, not at typecheck — and `src/db/schema/index.ts`
is on the import path of essentially everything, so the failure is total and
appears only at deploy time.

**Fix:** add the extension everywhere in `src/`:

```ts
export * from './users.js';
export * from './diary.js';
export * from './fdc-foods.js';
export * from './bot-sessions.js';
```

Consider switching `moduleResolution` to `"NodeNext"` so the compiler enforces
this rather than leaving it to convention.

---

## Info

### IN-01: Dead null-coalesce on `timezone`, with a comment asserting the opposite

**File:** `src/bot/conversations/onboarding.ts:200-203`

`askOption` returns `Promise<T>` and its `for (;;)` loop only exits via
`return decoded` inside `if (decoded !== undefined)`. It can never resolve to
`undefined`, so `answers.timezone = answers.timezone ?? DEFAULT_TIMEZONE;` is
unreachable-by-construction, and the comment ("falls back to DEFAULT_TIMEZONE
only if this step somehow yields nothing") documents behaviour that cannot
occur. Delete both lines, or delete `DEFAULT_TIMEZONE` from the import if it
becomes unused here.

---

### IN-02: `session()` is registered but `ctx.session` is never read or written

**File:** `src/bot/bot.ts:27-30`, `:51-56`

`interface SessionData {}` is empty and nothing in the codebase touches
`ctx.session` (`grep -r 'ctx.session' src/` returns nothing). grammY's
non-lazy session eagerly `load()`s on every update, so each allowlisted update
costs one `SELECT` against `bot_sessions` plus a permanent `sess:<chatId>` row
whose value is `{}`. An empty TS interface is also structurally `{}` — it
accepts any object, so it provides no type safety either. Either remove the
middleware until something needs it, or leave a comment stating it is a
deliberate placeholder for Phase 3.

---

### IN-03: `answers as OnboardingAnswers` is an unchecked assertion

**File:** `src/bot/conversations/onboarding.ts:205`

`const completeAnswers = answers as OnboardingAnswers;` erases the `Partial<>`
without any runtime check. It is correct today only because the preceding lines
happen to assign every required field. A reordering or an early `continue`
added later would produce `undefined` values flowing into `assembleProfile` and
then into the `users` insert, where `NOT NULL` would reject them at the DB layer
rather than at the boundary. A cheap explicit guard (or building the object
via a typed local instead of a `Partial`) removes the assertion entirely.

---

### IN-04: `bot.catch` and the allowlist rejection use `console.log` for error-level output

**File:** `src/bot/bot.ts:93`, `src/bot/middleware/allowlist.ts:62`

Errors go to stdout, not stderr, so `npm run bot 2>error.log` captures nothing
and any future log shipper cannot distinguish severity. `console.error` for the
`bot.catch` line at minimum. (The `отказ:` line is arguably informational and
can stay on stdout — the owner is meant to read it.)

---

### IN-05: Chatless updates all share the storage key `conv:undefined`

**File:** `src/bot/bot.ts:61-68` (interaction with `@grammyjs/conversations`)

`node_modules/@grammyjs/conversations/out/storage.js:86` computes
`const key = prefix + getStorageKey(ctx)`, and `defaultStorageKey` returns
`ctx.chatId?.toString()`. String concatenation makes the result the literal
`"undefined"` when there is no chat, and the plugin's subsequent
`key === undefined` guard can therefore never fire. For any allowlisted update
without a chat, all users share the single row `conv:undefined`. Impact today is
nil (no conversation is entered from such updates and the plugin deletes empty
state), but if a future phase passes a custom `getStorageKey`, note that
returning `undefined` is not a safe way to opt out. Consider passing an explicit
`getStorageKey` that throws or returns a per-user key.

---

### IN-06: The RLS check verifies the switch, not the policy count

**File:** `scripts/verify-schema.ts:258-279`

`checkRls` reads `pg_class.relrowsecurity` only. The security property the
migrations actually rely on is "RLS enabled **and zero policies**" — a
permissive `FOR SELECT USING (true)` policy added later would keep
`relrowsecurity = true` and still expose every row through PostgREST. Also
unchecked: `relforcerowsecurity`, which matters if the app ever connects as the
table owner without `BYPASSRLS`. Add a `select count(*) from pg_policies where
tablename = …` assertion expecting 0.

---

### IN-07: `verify-schema`'s top-level handler blames `DATABASE_URL` for every failure

**File:** `scripts/verify-schema.ts:338-351`

The `main().catch()` message is a five-step guide to fixing the connection
string, but it also fires for failures thrown *inside* a check (a permissions
error on `pg_attribute`, a `regclass` cast failing because `public.users` does
not exist yet). The owner would then be sent to debug a connection string that
is fine. Split the connect step from the check steps and only print the
connection guidance when the failure occurred before the first successful
query.

---

### IN-08: `/whoami`'s copy is addressed to a user who cannot see it

**File:** `src/bot/commands/whoami.ts:14-18`

The reply says "впиши его в BETA_ALLOWLIST в файле .env и перезапусти бота", but
the command sits behind the allowlist gate, so the only person who can reach it
is already in `BETA_ALLOWLIST` — the instruction is a no-op for its entire
audience. The file's own doc comment acknowledges this ("This command exists
purely for an already-allowlisted owner's own convenience"), so the message text
should match: `Твой telegram_id: ${id}`.

---

## Fixes applied

**Applied:** 2026-08-12
**Scope:** four findings, chosen by the owner. The other 22 findings in this
report were **deliberately deferred** and remain open — nothing below marks
them as resolved.

| Finding | Commit | What changed |
|---------|--------|--------------|
| CR-01 | `2088b2f` | `bot.catch` replaced with `src/bot/error-handler.ts`: one log line that distinguishes a Telegram rejection from a network failure from our own throw, plus a Russian reply telling the user the failure was ours and their last answers may not have been saved. Separately, `saveOnboardedUser` is now caught inside `conversation.external()` — a failed write reports itself and re-shows the confirm screen with the answers still in hand instead of terminating the conversation and discarding all seven. |
| CR-02 | `c766506` | New `src/bot/telegram/ack.ts` answers a callback query and swallows the rejection. All four unguarded `answerCallbackQuery()` call sites (three in the conversation, one on the "Пройти анкету заново" button) now route through it, so a `400: query is too old` can no longer abort the flow. |
| CR-03 | `4980eb4` | The conversation recognises `/cancel` and «отмена» at every step — text steps, button steps and the confirm screen — and exits via the plugin's own `conversation.halt()`, which clears the persisted `conv:<chatId>` state. Button steps now wait for text alongside the callback query so the word is not swallowed. The conversation is registered with `maxMillisecondsToWait = 24h` so an abandoned run self-clears. The escape hatch is announced once before the first question, and `bot.command('cancel')` is registered for when nothing is running. |
| WR-02 | `7598cbd` | `buildExistingTargetsMessage` now appends `DISCLAIMER_TEXT` — the owner-approved constant, reused verbatim, no second variant. |

**Verification:** `npx tsc --noEmit` clean; `npm test` green (351 tests, up from
305). Plan 02-06's `<automated>` registration-order check passes verbatim, and
is now also pinned inside `npm test` by `src/bot/bot.wiring.test.ts`. Every
fix has a regression test that was confirmed to fail against the pre-fix code.
The allowlist's fail-closed behaviour, the three-layer 1 kg/month cap, the
`callback_data` allowlist lookups and the `sess:` / `conv:` key namespacing are
all untouched. No bot process was started.

**Still open (22), deferred by the owner:** WR-01, WR-03 through WR-15
(14 warnings) and IN-01 through IN-08 (8 info). All three Critical findings
are fixed; `status: issues_found` in the frontmatter stays accurate because
these 22 remain.

---

_Reviewed: 2026-08-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Partial fix pass: 2026-08-12 (CR-01, CR-02, CR-03, WR-02)_
