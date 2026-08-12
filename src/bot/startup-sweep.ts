/**
 * startup-sweep — the D-11 crash-recovery notice. On every boot, finds every
 * `processed_updates` row still in status `processing` — the only trace a
 * previous run left behind if it died mid-pipeline (Ctrl+C, a closed
 * laptop, a crash) — apologises to the affected chat, and moves the row to
 * the terminal `interrupted` status. There is deliberately NO auto-resume
 * path: this module never imports `processMeal`, `downloadVoice` or any
 * transcription function, because the audio was never written to disk
 * (D-05) and there is nothing left to re-transcribe.
 *
 * Failure handling: `runStartupSweep` NEVER rejects. A briefly-unreachable
 * database at startup must produce one Russian summary line and a zeroed
 * report, not a crashed `npm run bot` (T-03-50). A single failed `notify`
 * call must not stop the remaining rows from being notified, and every
 * found row — notified or not — still reaches `markInterrupted` so it can
 * never resurface on a later restart (T-03-52).
 *
 * Logging invariant (T-03-49, matching src/bot/error-handler.ts): every log
 * line here carries counts and an error kind only — never a chat id, never
 * a telegram id, never message content.
 */
import { findInterruptedUpdates, markInterrupted } from '../application/idempotency.js';
import type { Db } from '../db/client.js';
import { pipelineCopy } from './formatting/pipeline-copy.js';

export interface StartupSweepDeps {
  db: Db;
  notify(chatId: number, text: string): Promise<unknown>;
}

export interface SweepReport {
  found: number;
  notified: number;
  notifyFailed: number;
}

const ZERO_REPORT: SweepReport = { found: 0, notified: 0, notifyFailed: 0 };

function logSummary(report: SweepReport): void {
  console.log(
    `Проверка прерванных анализов при старте: найдено ${report.found}, ` +
      `уведомлено ${report.notified}, не удалось уведомить ${report.notifyFailed}.`,
  );
}

export async function runStartupSweep(deps: StartupSweepDeps): Promise<SweepReport> {
  try {
    let rows: { updateId: number; chatId: number; telegramId: number }[];
    try {
      rows = await findInterruptedUpdates(deps.db);
    } catch {
      console.error('Проверка прерванных анализов при старте не удалась (нет связи с базой данных) — бот всё равно запускается.');
      return { ...ZERO_REPORT };
    }

    if (rows.length === 0) {
      logSummary(ZERO_REPORT);
      return { ...ZERO_REPORT };
    }

    let notified = 0;
    let notifyFailed = 0;

    for (const row of rows) {
      try {
        await deps.notify(row.chatId, pipelineCopy.interruptedByRestart);
        notified += 1;
      } catch {
        notifyFailed += 1;
      }
    }

    try {
      await markInterrupted(
        deps.db,
        rows.map((r) => r.updateId),
      );
    } catch {
      console.error('Не удалось отметить прерванные анализы как обработанные — они могут появиться в проверке снова при следующем запуске.');
    }

    const report: SweepReport = { found: rows.length, notified, notifyFailed };
    logSummary(report);
    return report;
  } catch {
    console.error('Проверка прерванных анализов при старте завершилась неожиданной ошибкой — бот всё равно запускается.');
    return { ...ZERO_REPORT };
  }
}
