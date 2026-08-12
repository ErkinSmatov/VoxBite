/**
 * verify-stt.ts
 *
 * Settles decision D-03 empirically instead of by opinion: transcribes every
 * voice recording the owner drops into `samples/voice/` with BOTH STT models
 * (STT_MODEL and STT_COMPARISON_MODEL) and prints the two transcripts side
 * by side, so the owner can eyeball which one handles Kazakh dish names
 * (бешбармак, куырдак, плов) better. This is also phase success criterion 2
 * ("STT accuracy on ~10 real sample recordings").
 *
 * This script is NOT part of the running bot (D-04): it imports no
 * Telegram-bot-framework code, no database code, and touches no bot-side
 * idempotency or draft tables. It only reads local files and calls OpenAI.
 *
 * Запускается командой: npm run verify-stt
 *
 * Пояснения для тех, кто впервые это делает:
 * - Папка `samples/voice/` — это ТВОЯ личная папка на твоём компьютере с
 *   голосовыми записями. Она добавлена в .gitignore, то есть файлы из неё
 *   НИКОГДА не попадут в git и никуда не отправятся, кроме OpenAI (для
 *   распознавания речи).
 * - Скрипт отправляет каждую запись в OpenAI ДВАЖДЫ — один раз с дешёвой
 *   моделью (gpt-4o-mini-transcribe), один раз с более дорогой
 *   (gpt-4o-transcribe) — чтобы сравнить качество распознавания вживую, а не
 *   гадать.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createOpenAITranscriber,
  estimateTranscriptionCostUsd,
} from '../src/adapters/stt/openai-transcribe.js';
import { STT_COMPARISON_MODEL, STT_MODEL } from '../src/adapters/stt/types.js';

const SAMPLES_DIR = join(process.cwd(), 'samples', 'voice');
const ALLOWED_EXTENSIONS = ['.ogg', '.oga', '.m4a', '.mp3', '.wav'];

// Rough, clearly-labelled heuristic: Telegram OGG/OPUS voice messages are
// typically encoded around 16 kbps for speech. This is used ONLY to derive
// an approximate duration from file size for the cost estimate printed
// below — it is not an accurate measurement, and the printed line always
// says "approximate".
const ASSUMED_OGG_OPUS_BITRATE_KBPS = 16;

interface Failure {
  message: string;
  remediation: string;
}

function argvHas(flag: string): boolean {
  return process.argv.includes(flag);
}

function estimateSecondsFromFileSize(bytes: number): number {
  const bits = bytes * 8;
  const kbps = ASSUMED_OGG_OPUS_BITRATE_KBPS * 1000;
  return bits / kbps;
}

function printSetupInstructions(): void {
  console.log(`
Папка с голосовыми записями пуста или не существует: samples/voice/

Что нужно сделать (пошагово):

1. Путь к папке внутри проекта: samples/voice/
2. Создай её командой (если ещё не создана): mkdir -p samples/voice
3. Запиши ~10 голосовых сообщений в Telegram, где ты обычным своим языком
   описываешь, что съел — включая блюда вроде бешбармак, куырдак, плов.
4. Перешли каждое голосовое сообщение себе в "Избранное" (Saved Messages),
   нажми на три точки (меню) у сообщения и выбери "Сохранить в загрузки" /
   "Save to Downloads".
5. Перемести сохранённые файлы в папку samples/voice/ этого проекта.
6. Эта папка добавлена в .gitignore — файлы из неё никогда не попадут в git
   и никуда, кроме OpenAI (для распознавания речи).
7. Запусти снова: npm run verify-stt
`);
}

async function main(): Promise<void> {
  const jsonMode = argvHas('--json');
  const failures: Failure[] = [];

  let entries: string[];
  try {
    entries = await readdir(SAMPLES_DIR);
  } catch {
    if (!jsonMode) {
      printSetupInstructions();
    } else {
      console.log(JSON.stringify({ ok: false, failures: [{ message: 'samples/voice/ не найдена', remediation: 'mkdir -p samples/voice' }] }, null, 2));
    }
    process.exit(1);
    return;
  }

  const files = entries
    .filter((f) => ALLOWED_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    if (!jsonMode) {
      printSetupInstructions();
    } else {
      console.log(JSON.stringify({ ok: false, failures: [{ message: 'samples/voice/ пуста', remediation: 'Добавь .ogg/.m4a/.mp3/.wav файлы, см. инструкцию' }] }, null, 2));
    }
    process.exit(1);
    return;
  }

  // Pre-flight: figure out total estimated cost BEFORE spending anything
  // (CLAUDE.md — explain paid actions in advance, not after).
  let totalEstimatedCost = 0;
  const fileSizes: Record<string, number> = {};
  for (const file of files) {
    const stat = await readFile(join(SAMPLES_DIR, file));
    fileSizes[file] = stat.length;
    const seconds = estimateSecondsFromFileSize(stat.length);
    totalEstimatedCost += estimateTranscriptionCostUsd(seconds, STT_MODEL);
    totalEstimatedCost += estimateTranscriptionCostUsd(seconds, STT_COMPARISON_MODEL);
  }

  if (!jsonMode) {
    console.log(`\n=== npm run verify-stt ===`);
    console.log(
      `Найдено файлов: ${files.length}. Каждый будет отправлен в OpenAI ДВАЖДЫ ` +
        `(модели ${STT_MODEL} и ${STT_COMPARISON_MODEL}). ` +
        `Примерная суммарная стоимость: $${totalEstimatedCost.toFixed(4)} (это оценка, не точный счёт).`,
    );
  }

  const miniTranscriber = createOpenAITranscriber();
  const fullTranscriber = createOpenAITranscriber({ model: STT_COMPARISON_MODEL });

  for (const file of files) {
    const path = join(SAMPLES_DIR, file);
    let buffer: Buffer;
    try {
      buffer = await readFile(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({
        message: `Не удалось прочитать файл "${file}": ${message}`,
        remediation: 'Проверь, что файл существует и доступен для чтения',
      });
      continue;
    }

    const seconds = estimateSecondsFromFileSize(buffer.length);

    let miniResult: { text: string } | undefined;
    let fullResult: { text: string } | undefined;

    try {
      miniResult = await miniTranscriber.transcribe(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({
        message: `"${file}" (${STT_MODEL}): распознавание не удалось — ${message}`,
        remediation: message.includes('баланс') || message.includes('OPENAI_API_KEY')
          ? message
          : `Этот формат файла, возможно, не принят OpenAI — попробуй пересохранить как .ogg или .m4a`,
      });
    }

    try {
      fullResult = await fullTranscriber.transcribe(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({
        message: `"${file}" (${STT_COMPARISON_MODEL}): распознавание не удалось — ${message}`,
        remediation: message.includes('баланс') || message.includes('OPENAI_API_KEY')
          ? message
          : `Этот формат файла, возможно, не принят OpenAI — попробуй пересохранить как .ogg или .m4a`,
      });
    }

    if (!jsonMode && (miniResult || fullResult)) {
      const costMini = estimateTranscriptionCostUsd(seconds, STT_MODEL);
      const costFull = estimateTranscriptionCostUsd(seconds, STT_COMPARISON_MODEL);
      console.log(`\n--- ${file} (${fileSizes[file]} байт, ~${seconds.toFixed(1)} сек, приблизительно) ---`);
      console.log(`  [${STT_MODEL}] (примерная стоимость $${costMini.toFixed(5)}):`);
      console.log(`    ${miniResult?.text ?? '(ошибка, см. список ниже)'}`);
      console.log(`  [${STT_COMPARISON_MODEL}] (примерная стоимость $${costFull.toFixed(5)}):`);
      console.log(`    ${fullResult?.text ?? '(ошибка, см. список ниже)'}`);
    }
  }

  const ok = failures.length === 0;

  if (jsonMode) {
    console.log(JSON.stringify({ ok, failures }, null, 2));
  } else if (ok) {
    console.log(
      '\nVERIFY-STT OK\n\n' +
        'Что делать дальше: прочитай обе колонки выше для каждой записи. ' +
        `Если "${STT_COMPARISON_MODEL}" заметно лучше распознаёт названия блюд ` +
        '(бешбармак, куырдак и т.п.), поменяй ОДНУ строку STT_MODEL в файле ' +
        'src/adapters/stt/types.ts на этот более дорогой вариант. Если разница ' +
        `не видна — оставь по умолчанию "${STT_MODEL}" (он дешевле).`,
    );
  } else {
    console.log('\nПроверка не пройдена. Что делать:');
    failures.forEach((f, i) => console.log(`${i + 1}. ${f.message} — ${f.remediation}`));
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
