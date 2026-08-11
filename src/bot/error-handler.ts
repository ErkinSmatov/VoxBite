/**
 * error-handler — the bot's single error surface (CR-01).
 *
 * Before this existed, `bot.catch` logged one line to stdout and told the
 * user nothing: from their side the bot simply stopped responding
 * mid-questionnaire, and the only trace was a line in a terminal the owner is
 * not watching. That is a data-loss path, not a UX wart — a throw inside the
 * onboarding conversation makes the conversations plugin exit the
 * conversation and delete its replay state.
 *
 * SECURITY — the logging invariant this module exists to keep:
 * only the *error* is described, never `err.ctx`. The update object carries
 * the user's message text, which in this product is health data (what they
 * ate, their weight, their age), and the bot token is reachable from the
 * context's `api` config. So: no `console.log(err)`, no `JSON.stringify(ctx)`,
 * no `err.ctx.update`. `GrammyError.payload` is deliberately not logged
 * either — for a `sendMessage` failure it contains the full outgoing text.
 */
import { GrammyError, HttpError, type BotError, type Context } from 'grammy';
import { GENERIC_ERROR_TEXT } from './formatting/error-copy.js';

/**
 * Pure — turns a thrown value into one Russian log line that names the kind
 * of failure, so the owner can tell "Telegram said no" from "the network is
 * down" from "our own code threw" without reading a stack trace.
 */
export function describeError(error: unknown): string {
  if (error instanceof GrammyError) {
    return `Telegram отклонил вызов ${error.method}: ${error.error_code} ${error.description}`;
  }
  if (error instanceof HttpError) {
    return `Нет связи с Telegram: ${error.message}`;
  }
  if (error instanceof Error) {
    return `Ошибка обработчика: ${error.message}`;
  }
  return `Ошибка обработчика: ${String(error)}`;
}

export interface ErrorHandlerOptions {
  /** Injectable for tests; defaults to stderr, not stdout (see IN-04). */
  log?: (line: string) => void;
}

/**
 * Builds the `bot.catch` handler: log one line, then tell the user in Russian
 * that the failure was ours and that their last answers may not have been
 * saved. The user must never be left believing a profile was stored when it
 * was not.
 *
 * The reply itself is wrapped: `ctx.reply` throws for updates that carry no
 * chat (inline queries, poll answers) and for a user who blocked the bot.
 * An error handler that throws is the one place a throw has nowhere left to
 * go, so it must not.
 */
export function createErrorHandler(options: ErrorHandlerOptions = {}) {
  const log = options.log ?? ((line: string) => console.error(line));

  return async <C extends Context>(err: BotError<C>): Promise<void> => {
    log(describeError(err.error));
    try {
      await err.ctx.reply(GENERIC_ERROR_TEXT);
    } catch {
      // No chat on this update, or the user blocked the bot. The log line
      // above is the record we need; there is nothing further to do.
    }
  };
}
