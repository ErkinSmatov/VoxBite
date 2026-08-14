/**
 * pipeline-copy — every Russian string the voice pipeline (voice message /
 * text meal-logging flow) shows a user, collected in one module so the owner
 * can review copy in one place (D-06, D-08, D-11, D-13, D-14, D-15). Matches
 * the repo's established "state the fact, then state what to do" voice
 * (see onboarding-copy.ts, error-copy.ts): plain, direct, no marketing tone,
 * never blames the user, never leaks an internal error string — the
 * technical detail goes to the log only.
 *
 * Zero grammY imports — this module only returns strings, it never touches a
 * Telegram ctx (D-08).
 */

export const pipelineCopy = {
  /**
   * D-13/VOICE-02 — the single acknowledgement sent immediately on receiving
   * a voice/text meal message. Every terminal outcome below (success,
   * no-food, any failure) is later edited into this same message via
   * `MessageEditor`, so the user never sees two separate bot messages for
   * one meal report.
   */
  ack: 'Секунду, разбираю 🎧',

  /**
   * D-08 — a well-formed empty decomposition (the LLM understood the
   * transcript but found no food in it) is a NORMAL answer, not a failure.
   * Must not read like an error.
   */
  noFood:
    'Не расслышал, что из еды ты описал. Отправь голосовое или текст с ' +
    'названием блюда и примерным количеством, например «омлет из двух яиц».',

  /** Transcription failed after retries. */
  sttFailed: 'Не получилось распознать голосовое сообщение. Попробуй отправить его ещё раз.',

  /**
   * DECOMP-03 terminal case after one retry — concrete hint: name the dish
   * and roughly how much.
   */
  decompositionFailed:
    'Не смог разобрать сообщение на ингредиенты. Опиши иначе: назови блюдо и ' +
    'примерное количество, например «гречка с курицей, тарелка».',

  /** DB or unexpected failure — ours, not theirs. */
  internalError: 'Что-то пошло не так на моей стороне. Отправь сообщение ещё раз.',

  /** D-14 — over 60 seconds. */
  tooLong: 'Голосовое слишком длинное. Опиши покороче, до 60 секунд.',

  /**
   * Text-side twin of `tooLong`. Refusing beats silently truncating: a
   * truncated description is analysed as if it were the whole meal, so the
   * user gets a confidently wrong answer with no hint that half their food
   * was dropped.
   */
  textTooLong: 'Сообщение слишком длинное. Опиши приём пищи покороче, до 1000 символов.',

  /**
   * D-15 — friendly framing as a runaway-processing safety limit, explicitly
   * not a paid tariff (tariff limits are v2). States that it resets.
   */
  dailyCapReached:
    'На сегодня достигнут лимит обработки сообщений — это защита от ' +
    'случайного зацикливания, а не платное ограничение. Лимит обновится ' +
    'завтра.',

  /** D-06 — refusal for audio files, video notes, photos, documents, stickers. */
  unsupportedMessage:
    'Такой тип сообщения я пока не умею обрабатывать. Отправь голосовое ' +
    'сообщение или напиши текстом, что ты съел.',

  /**
   * D-11 — told at startup to anyone whose row was still `processing` when
   * the bot restarted: the recording is gone, ask them to resend.
   */
  interruptedByRestart:
    'Обработку прошлого сообщения прервал перезапуск бота, запись не ' +
    'сохранилась. Отправь сообщение ещё раз.',

  /** The user is allowlisted but has no `users` row yet. */
  notOnboarded: 'Сначала нужно пройти короткий опрос. Отправь /start.',
} as const;
