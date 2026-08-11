/**
 * ack — answer a callback query without ever letting the answer abort the
 * caller (CR-02).
 *
 * `answerCallbackQuery` is a purely cosmetic acknowledgement: it stops the
 * spinner Telegram shows on the tapped inline button. It is not part of any
 * business rule, nothing downstream depends on it, and a failed call loses
 * the user nothing except a spinner that times out client-side after ~30 s.
 *
 * Telegram nevertheless rejects it with
 * `400: query is too old and response timeout expired or query ID is
 * invalid` whenever the tapped message is old, or with "query already
 * answered" on a double tap. The onboarding conversation waits for a button
 * press indefinitely, so "the user opens the chat the next day and taps a
 * keyboard still sitting in their history" is a mainstream path — and an
 * unguarded rejection thrown out of the conversation makes the conversations
 * plugin exit the conversation and discard every answer collected so far.
 *
 * Hence: swallow. There is deliberately no rethrow and no `console.error`
 * here — a stale button press is normal user behaviour, not an incident.
 *
 * The parameter is structurally typed rather than `Context` so this helper
 * can be called with any grammY context flavour, and unit-tested with a
 * two-line fake.
 */
export interface AnswerableCallbackQuery {
  answerCallbackQuery: (...args: never[]) => Promise<unknown>;
}

export async function ack(ctx: AnswerableCallbackQuery): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // "query is too old" / "query already answered" / transient network
    // failure. The spinner times out on its own. Never abort the flow.
  }
}
