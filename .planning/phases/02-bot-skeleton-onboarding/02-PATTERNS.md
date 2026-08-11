# Phase 2: Bot skeleton + onboarding - Pattern Map

**Mapped:** 2026-08-11
**Files analyzed:** 20 (new) + 3 (modified)
**Analogs found:** 20 / 20 (all files have at least a role-match; `src/bot/**` files use structural/cross-cutting analogs since no bot code exists yet)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/config/env.ts` (MODIFY) | config | request-response (startup validation) | itself (extend in place) | exact |
| `.env.example` (MODIFY) | config | — | itself (extend in place) | exact |
| `src/config/env.test.ts` (MODIFY) | test | — | itself (extend in place) | exact |
| `src/db/schema/bot-sessions.ts` (NEW) | model | CRUD (key/value store) | `src/db/schema/diary.ts` | role-match |
| `src/db/schema/index.ts` (MODIFY) | model (barrel) | — | itself (extend in place) | exact |
| `drizzle/0003_bot_sessions.sql` (NEW, generated) | migration | batch | `drizzle/0001_init_schema.sql` (table shape), `drizzle/0002_enable_rls.sql` (RLS decision precedent) | exact |
| `src/db/client.ts` | — (consumed, not modified) | — | n/a — bot imports `createDb()`/`closeDb()` as-is | exact |
| `src/bot/storage/pg-storage-adapter.ts` (NEW) | service (repository/adapter) | CRUD | `src/adapters/fdc-repository.ts` | role-match |
| `src/bot/storage/pg-storage-adapter.test.ts` (NEW) | test | — | `src/domain/fdc-matching/match-ingredient.test.ts` (fake-port style) | role-match |
| `src/bot/middleware/allowlist.ts` (NEW) | middleware | request-response | `src/domain/nutrition/target-calories.ts` (pure-function shape) + `scripts/check-setup.ts` (Russian operator-facing log voice) | partial (no prior middleware in repo) |
| `src/bot/middleware/allowlist.test.ts` (NEW) | test | — | `src/domain/nutrition/target-calories.test.ts` | role-match |
| `src/bot/onboarding/parse-fields.ts` (NEW) | utility (pure domain-adjacent) | transform | `src/domain/nutrition/target-calories.ts` | exact |
| `src/bot/onboarding/parse-fields.test.ts` (NEW) | test | — | `src/domain/nutrition/target-calories.test.ts` / `bmr-tdee.test.ts` | exact |
| `src/bot/onboarding/assemble-profile.ts` (NEW) | utility (pure domain-adjacent) | transform | `src/domain/nutrition/calculate-targets.ts` | exact |
| `src/bot/onboarding/assemble-profile.test.ts` (NEW) | test | — | `src/domain/nutrition/calculate-targets.ts` consumer tests / `target-calories.test.ts` | exact |
| `src/bot/onboarding/rate-presets.ts` (NEW) | utility (constants + pure fn) | transform | `src/domain/nutrition/constants.ts` | exact |
| `src/bot/formatting/onboarding-copy.ts` (NEW) | utility (message templates) | transform | `scripts/check-setup.ts` (Russian, actionable copy voice) | partial (no prior message-template module) |
| `src/bot/formatting/onboarding-copy.test.ts` (NEW) | test | — | `src/domain/nutrition/*.test.ts` (assert-on-output style) | role-match |
| `src/bot/keyboards/onboarding-keyboards.ts` (NEW) | component (inline keyboard builder) | transform | `src/bot/onboarding/rate-presets.ts` (own new sibling) / no true analog | none (new territory) |
| `src/bot/conversations/onboarding.ts` (NEW) | controller (grammY conversation) | event-driven | `scripts/index-fdc/run.ts` (orchestrator that sequences pure steps + I/O, closest "orchestration calling pure functions + adapters" shape in repo) | partial |
| `src/bot/commands/start.ts` (NEW) | controller | request-response | none in repo — first Telegram command handler | none (new territory) |
| `src/bot/commands/whoami.ts` (NEW) | controller | request-response | `src/bot/commands/start.ts` (own new sibling) | none (new territory) |
| `src/bot/index.ts` (NEW) | provider (entrypoint/composition root) | event-driven | `scripts/check-setup.ts` (composition-root script: load env, run checks, print Russian summary, explicit exit codes) | partial |
| `package.json` (MODIFY) | config | — | itself — extend `scripts` block | exact |
| `.planning/phases/02-bot-skeleton-onboarding/MANUAL-CHECKLIST.md` (NEW) | test (manual doc) | — | `scripts/check-setup.ts`'s printed voice (no prior markdown checklist file exists in repo; closest analog is the *tone*, not a file) | none (new territory, tone-only analog) |

## Pattern Assignments

### `src/config/env.ts` (config, MODIFY)

**Analog:** itself — `src/config/env.ts` (read in full above, lines 1-78)

**Current shape to extend** (lines 1-13):
```typescript
import dotenvSafe from 'dotenv-safe';

export const REQUIRED_ENV_KEYS = ['DATABASE_URL', 'OPENAI_API_KEY'] as const;

export interface AppEnv {
  DATABASE_URL: string;
  OPENAI_API_KEY: string;
}
```

**Required change (per 02-RESEARCH.md Pitfall 4 — verified against this exact file):** add `TELEGRAM_BOT_TOKEN` to `REQUIRED_ENV_KEYS` (must be non-empty at startup — no bot without a token). Add a **second, parallel array** for `BETA_ALLOWLIST` since it must be legal-when-empty (fail-closed empty allowlist, D-04) and the existing `missingKeys` filter (lines 53-56) treats any empty string as missing for everything in `REQUIRED_ENV_KEYS`:

```typescript
export const REQUIRED_ENV_KEYS = ['DATABASE_URL', 'OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN'] as const;
export const OPTIONAL_ENV_KEYS = ['BETA_ALLOWLIST'] as const; // must be declared, empty is legal

export interface AppEnv {
  DATABASE_URL: string;
  OPENAI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  BETA_ALLOWLIST: string; // '' is a legal, meaningful value (fail-closed empty allowlist)
}
```

**`cachedEnv` assembly** (lines 62-67) must add both new keys:
```typescript
cachedEnv = {
  DATABASE_URL: process.env.DATABASE_URL as string,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY as string,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN as string,
  BETA_ALLOWLIST: process.env.BETA_ALLOWLIST ?? '',
};
```

**Missing-keys check** (lines 53-56) — `BETA_ALLOWLIST` must NOT be checked here; only `REQUIRED_ENV_KEYS` runs through `missingKeys`:
```typescript
const missingKeys = REQUIRED_ENV_KEYS.filter((key) => {
  const value = process.env[key];
  return value === undefined || value === '';
});
```

**Cache/error-message pattern** (lines 15-28, 39-68) — unchanged, keep the Russian "что делать" voice in `buildMissingKeysMessage`; the lazy-load / never-at-import-time / cached-singleton discipline (comment lines 30-38) must be preserved exactly for the same reasons (importable in tests without a `.env`).

---

### `.env.example` (config, MODIFY)

**Analog:** itself — read in full above.

**Pattern to copy exactly** (every existing entry has this three-part shape: a comment block explaining *where to get the value*, then the `KEY=placeholder` line):
```
# TELEGRAM_BOT_TOKEN — где взять:
# Открой Telegram, найди @BotFather, отправь /newbot, следуй инструкциям
# (укажи имя и юзернейм бота). BotFather пришлёт токен вида
# 123456789:AAExampleTokenText — скопируй его целиком.
TELEGRAM_BOT_TOKEN=123456789:REPLACE_ME

# BETA_ALLOWLIST — где взять:
# Список Telegram ID через запятую, кому разрешён доступ к боту в закрытой
# бете. Можно оставить пустым при первом запуске — тогда никто не будет
# допущен (это ожидаемо): запусти бота, отправь /start от своего аккаунта,
# скопируй свой telegram_id из строки терминала "отказ: telegram_id=...",
# впиши его сюда и перезапусти бота.
BETA_ALLOWLIST=
```
**Critical constraint (verified in `env.test.ts` lines 38-46):** `env.test.ts`'s existing assertion compares `.env.example`'s declared `KEY=` lines against `REQUIRED_ENV_KEYS` via exact array equality — this assertion MUST be updated (see below) to compare against `[...REQUIRED_ENV_KEYS, ...OPTIONAL_ENV_KEYS]` sorted, otherwise adding `BETA_ALLOWLIST=` to `.env.example` breaks the existing test even though the key itself is legal-empty.

---

### `src/config/env.test.ts` (test, MODIFY)

**Analog:** itself — read in full above (lines 1-79).

**Exact assertion to update** (lines 38-46):
```typescript
it('REQUIRED_ENV_KEYS matches exactly the keys declared in .env.example', async () => {
  const { REQUIRED_ENV_KEYS } = await import('./env');
  expect(REQUIRED_ENV_KEYS).toEqual(['DATABASE_URL', 'OPENAI_API_KEY']);

  const examplePath = path.resolve(import.meta.dirname, '../../.env.example');
  const exampleContent = readFileSync(examplePath, 'utf8');
  const declaredKeys = [...exampleContent.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);
  expect(declaredKeys.sort()).toEqual([...REQUIRED_ENV_KEYS].sort());
});
```
Must become (compare against `REQUIRED_ENV_KEYS` **plus** `OPTIONAL_ENV_KEYS` combined, sorted) — and `clearRequiredEnv()` (lines 17-20) must also delete `TELEGRAM_BOT_TOKEN` (but NOT `BETA_ALLOWLIST`, since that one is legal when absent/empty per D-04). Add a new test case asserting `loadEnv()` succeeds with `BETA_ALLOWLIST` unset or `''`, and a `parseAllowlist`-adjacent case is NOT this file's job (that belongs in `allowlist.test.ts`).

**Mocking pattern to keep** (lines 11-13) — `vi.mock('dotenv-safe', ...)` stays exactly as-is; it is what makes these tests hermetic regardless of the developer's real `.env`.

---

### `src/db/schema/bot-sessions.ts` (model, NEW)

**Analog:** `src/db/schema/diary.ts` (full file read above, lines 1-39) — closest existing table with a simple shape, a doc comment explaining *why the table exists yet is minimal*, and no RLS concerns baked into the table definition itself (RLS is a separate migration file, see below).

**Imports pattern** (diary.ts lines 11-12, adapted — bot_sessions needs no FK):
```typescript
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
```

**Doc-comment convention to copy** (diary.ts lines 1-10 — every schema file opens with a "why this table, why this shape, what's deferred" comment):
```typescript
/**
 * bot_sessions — durable key/value store backing grammY's session +
 * @grammyjs/conversations persistence (D-02/Anti-Pattern 3: conversation
 * state must survive process restarts, never live only in memory).
 * `key` is the grammY session key (per-chat or per-user, decided by the
 * `session()` config in src/bot/index.ts); `value` is the plugin's own
 * serialized JSON blob — this table has no direct end-user-facing read
 * path, so it does not get RLS-driven policies the way `users`/`diary` do
 * (see drizzle/0002_enable_rls.sql's rationale) — it still gets
 * ENABLE ROW LEVEL SECURITY for the same "everything in `public` is
 * PostgREST-exposed by default on Supabase" reason, just with zero
 * policies (deny-all), matching the existing precedent exactly.
 */
```

**Table pattern** (diary.ts lines 14-35, adapted to a key/value shape with no FK and no check constraints):
```typescript
export const botSessions = pgTable('bot_sessions', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type BotSessionRow = typeof botSessions.$inferSelect;
export type NewBotSessionRow = typeof botSessions.$inferInsert;
```
Note: RESEARCH.md's own sketch (line 442) proposed `value jsonb not null` — use Drizzle's `jsonb()` column helper (already available via `drizzle-orm/pg-core`, no new dependency) rather than `text()`, since the stored value is JSON and `jsonb` gets you Postgres-side JSON validation for free — a strict improvement on the research sketch's raw-`text` proposal, worth a deliberate planner decision but not a deviation from any locked CONTEXT.md decision.

---

### `src/db/schema/index.ts` (model barrel, MODIFY)

**Analog:** itself (full file, 3 lines):
```typescript
export * from './users';
export * from './diary';
export * from './fdc-foods';
```
Add one line: `export * from './bot-sessions';` — alphabetical-by-creation-order convention already established (not alphabetized by name — `users`, `diary`, `fdc-foods` in that historical order), so append at the end.

---

### `drizzle/0003_bot_sessions.sql` (migration, NEW — generated, not hand-written)

**Analog:** `drizzle/0001_init_schema.sql` (table `CREATE TABLE` shape) + `drizzle/0002_enable_rls.sql` (RLS-on-new-table precedent) — both read in full above.

**Critical process pattern (from `drizzle.config.ts` header comment, read in full above):** `drizzle-kit push` is **banned** in this repo. The only allowed flow is:
1. Write/edit `src/db/schema/bot-sessions.ts` and add it to `src/db/schema/index.ts`.
2. Run `npm run db:generate` (= `drizzle-kit generate`) — this produces the reviewable SQL file under `drizzle/`, auto-numbered following the existing `0000_`, `0001_`, `0002_` sequence (next will be `0003_<slug>.sql`, slug auto-generated by drizzle-kit from the diff, or supply one — check drizzle-kit's `--name` flag at implementation time).
3. **Read the generated SQL before applying it** — this is a hard project convention, not optional.
4. Run `npm run db:migrate` (= `drizzle-kit migrate`) to apply it.

**RLS decision to make explicitly (per 02-RESEARCH.md Open Question 2):** Following the `0002_enable_rls.sql` precedent (full file read above), a **second, small migration** (or appended statements in the same generated migration, planner's call) should apply the same `ENABLE ROW LEVEL SECURITY` treatment to `bot_sessions` for the identical reason stated in `0002`'s own comment (Supabase auto-exposes every `public` table via PostgREST) — with zero policies (deny-all), matching the existing `users`/`diary`/`fdc_foods` treatment exactly:
```sql
ALTER TABLE "bot_sessions" ENABLE ROW LEVEL SECURITY;
```
Do **not** hand-write the `CREATE TABLE` portion — that must come from `drizzle-kit generate` reading `bot-sessions.ts`, matching e.g. `0001_init_schema.sql`'s auto-generated `users`/`diary`/`fdc_foods` `CREATE TABLE` statements (full file read above) — a hand-written migration risks drifting from what Drizzle's own migration-tracking (`drizzle/meta/*_snapshot.json`) expects.

---

### `src/bot/storage/pg-storage-adapter.ts` (service/repository, NEW)

**Analog:** `src/adapters/fdc-repository.ts` (full file read above, lines 1-72) — the repo's only existing "wrap a Postgres/Drizzle query behind a small port interface" pattern.

**Imports pattern** (fdc-repository.ts lines 26-29, adapted):
```typescript
import { sql, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { botSessions } from '../../db/schema/bot-sessions.js';
import type { StorageAdapter } from 'grammy';
```

**Core CRUD pattern — factory function returning an object implementing an external interface** (fdc-repository.ts lines 31-72, this is the exact shape to copy: `createDrizzleFdcRepository(db: Db): FdcRepository` → `createPgStorageAdapter(db: Db): StorageAdapter<string>`):
```typescript
export function createPgStorageAdapter(db: Db): StorageAdapter<string> {
  return {
    async read(key) {
      const rows = await db.select({ value: botSessions.value }).from(botSessions).where(eq(botSessions.key, key));
      return rows[0]?.value as string | undefined;
    },
    async write(key, value) {
      await db
        .insert(botSessions)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: botSessions.key, set: { value, updatedAt: new Date() } });
    },
    async delete(key) {
      await db.delete(botSessions).where(eq(botSessions.key, key));
    },
  };
}
```
**Note:** RESEARCH.md's own Code Example (lines 434-461) used raw `sql\`...\`` with `on conflict`; prefer the Drizzle query-builder form above (matching `fdc-repository.ts`'s house style of using the builder, not raw SQL, except where the builder can't express the required index-friendly form — see fdc-repository.ts's own documented exception for cosine-distance ordering). Confirm the exact `StorageAdapter<T>` generic against the installed `@grammyjs/conversations`/`grammy` `.d.ts` at implementation time (RESEARCH.md Assumption A1).

**Doc-comment convention to copy** (fdc-repository.ts lines 1-25 — every adapter file explains *which domain/plugin port it implements* and *why the query is shaped this way*).

---

### `src/bot/storage/pg-storage-adapter.test.ts` (test, NEW)

**Analog:** `src/domain/fdc-matching/match-ingredient.test.ts` for the "fake the port, assert behavior" style — **however**, unlike `matchIngredient` (pure, fed a fake `FdcRepository`), `pg-storage-adapter.ts` itself touches real Postgres, so per D-09/D-08 this should be either (a) a real-DB integration test analogous to how `scripts/index-fdc/load.test.ts` verifies DB writes (worth a Read pass at implementation time if the planner picks this route), or (b) left to the manual check-list. Flag this choice for the planner explicitly — no single strong existing analog since this repo has no prior key/value-over-Postgres test.

---

### `src/bot/middleware/allowlist.ts` (middleware, NEW)

**Analog (pure-function shape):** `src/domain/nutrition/target-calories.ts` (full file read above) — same shape: typed input → typed output, throws/returns a discriminated result, zero I/O, described first by a doc comment naming which product rule it enforces.

**Analog (Russian, actionable operator-facing log voice):** `scripts/check-setup.ts` lines 42-84 (`explainError`) — same "plain Russian, tell the operator exactly what to do" register, to be matched for the rejection log line and the `409` handler in `src/bot/index.ts`.

**Core pure-parsing pattern to copy** (target-calories.ts's shape: validate inputs, clamp/filter, never throw on malformed *user* input — RESEARCH.md's own Code Example for this file, cross-checked against the target-calories.ts input-validation style at lines 35-49):
```typescript
export function parseAllowlist(raw: string | undefined): Set<number> {
  if (!raw || raw.trim() === '') return new Set(); // D-04: empty/unset = nobody allowed
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number)
      .filter((n) => Number.isFinite(n)),
  );
}
```

**Middleware wrapper + Russian log line pattern (D-06):**
```typescript
export function createAllowlistMiddleware(allowlist: Set<number>) {
  return async (ctx: Context, next: NextFunction) => {
    const id = ctx.from?.id;
    if (id !== undefined && allowlist.has(id)) {
      return next();
    }
    console.log(`отказ: telegram_id=${id ?? 'unknown'}, @${ctx.from?.username ?? '(нет username)'}`);
    await ctx.reply('Бот в закрытой бете. Обратись к владельцу за доступом.');
  };
}
```
Keep `parseAllowlist` exported and separate from the middleware factory — this split is the exact reason it's D-08 unit-testable (per RESEARCH.md's own note, matching how `target-calories.ts`'s pure function is separated from anything that would call it inside a conversation).

---

### `src/bot/middleware/allowlist.test.ts` (test, NEW)

**Analog:** `src/domain/nutrition/target-calories.test.ts` (full file read above) — same `it.each` table-driven style for edge cases (lines 6-13, 64-68 pattern: parametrize sex/goal combos → parametrize malformed allowlist strings).

**Pattern to copy:**
```typescript
describe('parseAllowlist', () => {
  it.each([
    [undefined, []],
    ['', []],
    ['   ', []],
    ['123,456', [123, 456]],
    ['123, 456,,abc', [123, 456]],
  ])('parseAllowlist(%j) -> %j', (input, expected) => {
    expect([...parseAllowlist(input)].sort()).toEqual(expected.sort());
  });
});
```

---

### `src/bot/onboarding/parse-fields.ts` (utility/pure, NEW)

**Analog:** `src/domain/nutrition/target-calories.ts` (full file read above, lines 1-71) — this is the closest existing "parse/validate typed numeric input, return either a value or a Russian-explained failure" shape in the repo, even though target-calories.ts throws on invalid input rather than returning a result type; parse-fields.ts needs the **result-type variant** because invalid *user* text input (not a programming error) must re-prompt, not crash — RESEARCH.md's own Pattern 1 code example (lines 289-299) shows the exact discriminated-union shape to use:

**Imports pattern (adapted from target-calories.ts's plain-function-file style, no grammY imports permitted — D-08):**
```typescript
// src/bot/onboarding/parse-fields.ts — zero grammY imports, mirrors
// src/domain/nutrition/target-calories.ts's "pure validated-input function" shape
export interface ParseResult<T> {
  ok: true;
  value: T;
} | { ok: false; error: string }
```
(Or two-type union per RESEARCH.md's sketch: `{ok:true,value} | {ok:false,error:string}`.)

**Core validation pattern (mirrors target-calories.ts's `Number.isFinite`/range-check-then-throw style, lines 35-49, but returns instead of throws):**
```typescript
export function parseAge(text: string): ParseResult<number> {
  const n = Number(text.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 10 || n > 100) {
    return { ok: false, error: 'Напиши число лет, например 29 (от 10 до 100).' };
  }
  return { ok: true, value: n };
}
```
Same plausibility-bounds discipline as `target-calories.ts`'s `tdee`/`desiredRateKgPerMonth` guards (lines 35-49) — "is a number" is not sufficient, per CONTEXT.md's explicit discretion note.

---

### `src/bot/onboarding/parse-fields.test.ts` (test, NEW)

**Analog:** `src/domain/nutrition/bmr-tdee.test.ts` (full file read above, lines 20-32) — its `it.each` table of invalid-input-throws-descriptive-error cases is the direct template, adapted from "throws a regex-matched error" to "returns `{ok:false, error}` matching a regex."

---

### `src/bot/onboarding/assemble-profile.ts` (utility/pure, NEW)

**Analog:** `src/domain/nutrition/calculate-targets.ts` (full file read above, lines 1-31) — same "assemble a typed domain object from several already-validated pieces, single composed function" shape. `assemble-profile.ts` is the mirror-image step one level up: raw parsed field values → `NutritionProfile` (the exact input type `calculateNutritionTargets` expects, per `src/domain/nutrition/types.ts` lines 9-18).

**Pattern to copy (composition-only function, delegates all math, no I/O):**
```typescript
// src/bot/onboarding/assemble-profile.ts
import type { NutritionProfile } from '../../domain/nutrition/index.js';

export interface OnboardingAnswers {
  sex: 'male' | 'female';
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activityLevel: NutritionProfile['activityLevel'];
  goal: NutritionProfile['goal'];
  desiredRateKgPerMonth?: number;
}

export function assembleProfile(answers: OnboardingAnswers): NutritionProfile {
  return { ...answers };
}
```
Import from the barrel (`src/domain/nutrition/index.ts`, not individual files) — matching the barrel's own comment ("Phase 2 onboarding imports from 'src/domain/nutrition', never from the individual files," line 2).

---

### `src/bot/onboarding/rate-presets.ts` (utility/constants, NEW)

**Analog:** `src/domain/nutrition/constants.ts` (referenced throughout `target-calories.ts`/`bmr-tdee.test.ts` above — e.g. `MAX_RATE_KG_PER_MONTH`, `MAX_RATE_KCAL_PER_DAY`, `CALORIE_FLOOR_MALE/FEMALE`) — same "small file of named, exported, tested numeric constants" shape.

**Pattern (RESEARCH.md's own Code Example, cross-checked against `constants.ts`'s naming convention — `MAX_RATE_KG_PER_MONTH` already exists there):**
```typescript
// src/bot/onboarding/rate-presets.ts
export const RATE_PRESETS_KG_PER_MONTH = [0.25, 0.5, 0.75, 1] as const;
```
**Note for the planner:** `MAX_RATE_KG_PER_MONTH` already lives in `src/domain/nutrition/constants.ts` — the last preset value (`1`) should be asserted equal to that constant in the test (not just hard-coded to `1` again), so the UI cap and the domain cap cannot silently drift apart. This is a concrete, cheap regression guard worth calling out to the planner.

---

### `src/bot/formatting/onboarding-copy.ts` (utility/message templates, NEW)

**Analog (Russian voice, actionable copy):** `scripts/check-setup.ts` — every user/operator-facing string in this repo (lines 19-27 in `env.ts`'s `buildMissingKeysMessage`, and throughout `check-setup.ts`) follows: plain Russian, states the fact, then states what to do next. No prior message-template *module* exists (all Russian strings so far are inlined at their call site) — this file is new territory structurally, but the **voice** must match exactly.

**Pattern to copy (function-per-message, returns a string, unit-testable by asserting substring presence — matches `env.ts`'s `buildMissingKeysMessage` shape, lines 17-28):**
```typescript
// src/bot/formatting/onboarding-copy.ts
export function disclaimerAndTargetsMessage(targets: NutritionTargets): string {
  return (
    `Твои цели:\n` +
    `Калории: ${targets.targetKcal} ккал\n` +
    `Белки: ${targets.proteinG} г, Жиры: ${targets.fatG} г, Углеводы: ${targets.carbsG} г\n\n` +
    `⚠️ Это не медицинская рекомендация — ...` // ONBOARD-06, owner sign-off required per CONTEXT.md
  );
}
```

---

### `src/bot/formatting/onboarding-copy.test.ts` (test, NEW)

**Analog:** `src/domain/nutrition/*.test.ts` (assert-on-output style, e.g. `target-calories.test.ts` lines 22-26) adapted to string-contains assertions:
```typescript
it('includes the non-medical-device disclaimer', () => {
  const msg = disclaimerAndTargetsMessage(sampleTargets);
  expect(msg).toMatch(/не медицинск/i);
});
```

---

### `src/bot/keyboards/onboarding-keyboards.ts` (component, NEW)

**No true analog exists in the repo** — first inline-keyboard code. Use RESEARCH.md's own verified Code Example (lines 500-518) directly, built on grammY core's `InlineKeyboard` (per RESEARCH.md Open Question 3's recommendation to skip `@grammyjs/menu` for this phase's linear flow — defer that plugin to Phase 4):
```typescript
import { InlineKeyboard } from 'grammy';
import { RATE_PRESETS_KG_PER_MONTH } from '../onboarding/rate-presets.js';

export function buildRateKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const rate of RATE_PRESETS_KG_PER_MONTH) {
    kb.text(`${rate} кг/мес`, `rate:${rate}`).row();
  }
  return kb;
}
```
Naming/doc-comment convention should still follow the rest of the repo (module comment explaining the constraint it encodes, matching `users.ts`'s check-constraint comment style, lines 1-11).

---

### `src/bot/conversations/onboarding.ts` (controller, NEW)

**Closest structural analog:** `scripts/index-fdc/run.ts` — the repo's only existing "orchestrator that sequences several pure/adapter steps in order, wraps I/O explicitly, delegates all actual logic to smaller pure modules" file (not read in full in this pass, but named directly in RESEARCH.md's architecture as the same *shape*: entrypoint → calls pure parse/build steps → calls DB write step). Recommend the planner do a full `Read` of `scripts/index-fdc/run.ts` at plan time for the exact orchestration style (error handling between steps, logging cadence) since it wasn't in this pattern-mapping pass's required-reading list but is directly relevant.

**Otherwise, follow RESEARCH.md's own verified Pattern 1/2 code example exactly** (lines 277-317) — this is sourced from grammY's own v2 docs, not an internal analog, and should be treated as authoritative for `conversation.waitFor()`/`conversation.external()` usage. Key excerpt:
```typescript
const targets = await conversation.external(() =>
  calculateNutritionTargets({ sex, ageYears: age!, /* ...rest */ }),
);
await conversation.external(() => saveOnboardedUser(ctx.from!.id, /* fields */, targets));
```
Every DB write and every call to `calculateNutritionTargets` must go through `conversation.external()` — this is the single most important correctness rule for this file (RESEARCH.md Pitfall 2).

---

### `src/bot/commands/start.ts`, `src/bot/commands/whoami.ts` (controllers, NEW)

**No analog exists** — first Telegram command handlers in the repo. Structure per RESEARCH.md's Recommended Project Structure (lines 253-255) and Pattern 3 (lines 325-338): thin functions, `ctx.reply(...)`, delegate any DB read (e.g. "already onboarded? show current targets") through the same `db` client import as everywhere else (`src/db/client.ts`'s `createDb()`), never open a second connection. `whoami.ts`'s reply body is the one-liner:
```typescript
await ctx.reply(`Твой telegram_id: ${ctx.from?.id}`);
```

---

### `src/bot/index.ts` (entrypoint/composition root, NEW)

**Closest analog:** `scripts/check-setup.ts` (full file read above) — the repo's only existing "composition root that loads env, wires dependencies, prints a Russian summary, and exits with an explicit code on failure" script.

**Pattern to copy (top-level error handling with explicit, actionable Russian output — mirrors `check-setup.ts`'s `main()` structure, lines 166-206, adapted to the 409 case per RESEARCH.md Pitfall 3):**
```typescript
import { Bot, GrammyError, HttpError } from 'grammy';
import { loadEnv } from '../config/env.js';

const env = loadEnv();
const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
// bot.use(allowlistMiddleware); session(); conversations(); createConversation(...); commands...

try {
  await bot.start({
    onStart: (botInfo) => console.log(`Бот запущен: @${botInfo.username}`),
  });
} catch (err) {
  if (err instanceof GrammyError && err.error_code === 409) {
    console.error('похоже, бот уже запущен в другом терминале — закрой его и запусти снова');
    process.exit(1);
  }
  if (err instanceof HttpError) {
    console.error('Не удалось подключиться к Telegram — проверь интернет-соединение:', err.message);
    process.exit(1);
  }
  throw err;
}
```
This is RESEARCH.md's own Pitfall 3 code example, cross-checked against `check-setup.ts`'s established "never print the raw error/secret, always print a fixed Russian remediation string" discipline (lines 42-84's `explainError`, and the security note in RESEARCH.md's Known Threat Patterns table about not `console.error(err)`-ing the raw 409 error object).

---

### `package.json` (config, MODIFY)

**Analog:** itself — existing `scripts` block (lines 9-21, full file read above). New entry follows the exact `tsx`-based convention already used for every executable entrypoint (`check-setup`, `index-fdc`, `verify-schema`, etc.):
```json
"bot": "tsx src/bot/index.ts"
```
New dependencies to add (per RESEARCH.md Standard Stack, verified versions):
```json
"grammy": "1.45.1",
"@grammyjs/conversations": "2.1.1"
```
(`@grammyjs/menu` — hold per RESEARCH.md Open Question 3's recommendation to defer to Phase 4 unless the planner overrides this.)

---

### `.planning/phases/02-bot-skeleton-onboarding/MANUAL-CHECKLIST.md` (test/manual doc, NEW)

**No file-shaped analog exists in the repo** (no prior manual checklist doc). **Voice analog:** `scripts/check-setup.ts`'s printed output — plain Russian, numbered/explicit "what should happen," explicit failure-mode callouts. Structure per RESEARCH.md's Validation Architecture (D-08, lines 578-607): one checklist item per phase success criterion, PLUS the four scenarios RESEARCH.md explicitly calls out as manual-only:
1. Full `/start` → 7 answers → sees targets (ONBOARD-01)
2. Rate preset buttons never exceed 1 кг/мес, no 5th option (ONBOARD-02)
3. Confirm persists `onboardedAt`; "заново" restarts without a partial row; **also** the mid-onboarding-restart replay-safety scenario from Pitfall 2 (kill the bot process mid-conversation, restart, confirm no duplicate/partial `users` row)
4. `npm run bot` run twice at once → plain-Russian 409 message, not a stack trace (D-03)
5. `/whoami` reply contains the caller's numeric ID (D-06)

## Shared Patterns

### Russian, actionable error/log voice
**Source:** `src/config/env.ts` (`buildMissingKeysMessage`, lines 17-28) and `scripts/check-setup.ts` (`explainError`, lines 42-84)
**Apply to:** `src/bot/index.ts` (409/HttpError handling), `src/bot/middleware/allowlist.ts` (rejection log + reply), `src/bot/onboarding/parse-fields.ts` (re-prompt errors), `src/bot/formatting/onboarding-copy.ts` (all user-facing copy)
```typescript
// buildMissingKeysMessage's shape: state the fact, then state exactly what to do
`VoxBite не может запуститься: не заданы переменные окружения ${missingKeys.join(', ')}.\n\n` +
`Что делать:\n1. ...`
```

### Lazy, cached singleton config/connection access — never at module import time
**Source:** `src/config/env.ts` (`loadEnv()`, lines 39-68) and `src/db/client.ts` (`createDb()`, lines 31-38)
**Apply to:** `src/bot/index.ts` must call `loadEnv()` and `createDb()` inside its own execution (not stored as a module-level side effect elsewhere), so any test importing `src/bot/**` modules never accidentally opens a socket or reads `.env`. Every new bot module that needs the DB imports `createDb()` from `src/db/client.js`, never opens its own `postgres()` connection.

### Barrel-import discipline for cross-layer consumption
**Source:** `src/domain/nutrition/index.ts` (barrel comment line 2: "Phase 2 onboarding imports from 'src/domain/nutrition', never from the individual files")
**Apply to:** All `src/bot/**` files that need `calculateNutritionTargets`/`NutritionProfile`/`NutritionTargets` — import exclusively from `src/domain/nutrition/index.js`, never `src/domain/nutrition/calculate-targets.js` etc. directly.

### ESM `.js` import specifiers on relative imports
**Source:** `src/db/client.ts` line 18 (`from '../config/env.js'`), `src/adapters/fdc-repository.ts` lines 27-29
**Apply to:** Every new file under `src/bot/**` — relative imports must use the `.js` extension even though the source file is `.ts` (project-wide `tsx`/ESM convention, not phase-specific).

### Doc-comment header explaining "why this shape" on every new module
**Source:** every schema file (`users.ts` lines 1-11, `diary.ts` lines 1-10), `src/db/client.ts` lines 1-15, `src/adapters/fdc-repository.ts` lines 1-25
**Apply to:** All new files — each should open with a comment naming the CONTEXT.md decision ID (D-0x) or requirement ID (ONBOARD-0x) it implements, matching this repo's established practice of traceability from code back to the decision doc.

### Pure-function-with-tested-edge-cases module shape
**Source:** `src/domain/nutrition/target-calories.ts` + `target-calories.test.ts`, `bmr-tdee.ts` + `bmr-tdee.test.ts`
**Apply to:** `src/bot/onboarding/parse-fields.ts`, `assemble-profile.ts`, `rate-presets.ts`, `src/bot/middleware/allowlist.ts`'s `parseAllowlist`, `src/bot/formatting/onboarding-copy.ts` — colocated `*.test.ts`, `it.each` tables for boundary/invalid cases, zero non-domain imports (no grammY types) for anything under `src/bot/onboarding/`.

## No Analog Found

Files with genuinely no structural precedent in the codebase — planner should lean on RESEARCH.md's Code Examples (all sourced from grammY's own v2 docs, fetched and verified 2026-08-11) rather than an internal analog:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/bot/commands/start.ts` | controller | request-response | First Telegram command handler in the repo — no prior `bot/` directory existed |
| `src/bot/commands/whoami.ts` | controller | request-response | Same as above |
| `src/bot/keyboards/onboarding-keyboards.ts` | component | transform | First inline-keyboard code; use RESEARCH.md's verified `InlineKeyboard` example directly |
| `src/bot/conversations/onboarding.ts` | controller | event-driven | First multi-step conversation; use RESEARCH.md's verified `@grammyjs/conversations` v2 Pattern 1/2 examples directly, and separately Read `scripts/index-fdc/run.ts` at plan time for orchestration-style cross-check |
| `.planning/phases/02-bot-skeleton-onboarding/MANUAL-CHECKLIST.md` | test (manual doc) | — | No prior manual checklist file in repo; voice-only analog (`check-setup.ts`) |

## Metadata

**Analog search scope:** `src/config/`, `src/db/`, `src/domain/nutrition/`, `src/domain/fdc-matching/`, `src/adapters/`, `scripts/`, `drizzle/`, `drizzle.config.ts`, `package.json`, `.env.example`
**Files scanned (read in full or targeted):** `src/config/env.ts`, `src/config/env.test.ts`, `src/db/schema/users.ts`, `src/db/schema/diary.ts`, `src/db/schema/index.ts`, `src/db/client.ts`, `src/domain/nutrition/index.ts`, `src/domain/nutrition/calculate-targets.ts`, `src/domain/nutrition/target-calories.ts`, `src/domain/nutrition/target-calories.test.ts`, `src/domain/nutrition/types.ts`, `src/domain/nutrition/bmr-tdee.test.ts`, `src/adapters/fdc-repository.ts`, `scripts/check-setup.ts`, `drizzle.config.ts`, `drizzle/0001_init_schema.sql`, `drizzle/0002_enable_rls.sql`, `.env.example`, `package.json`
**Pattern extraction date:** 2026-08-11

---
*Phase: 2-Bot skeleton + onboarding*
*Patterns mapped: 2026-08-11*
