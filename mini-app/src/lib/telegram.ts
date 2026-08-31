/**
 * Thin wrapper over Telegram's own injected `window.Telegram.WebApp` global
 * (see mini-app/index.html's `telegram-web-app.js` script tag — always
 * available inside a real Telegram WebView, no install needed).
 *
 * HARD RULE (04.1-RESEARCH.md Pitfall 1): `initDataUnsafe` is a parsed,
 * client-controlled object. It may be read for COSMETIC purposes only
 * (e.g. showing a name) and must NEVER be sent to the API or used to decide
 * anything. Only the raw `initData` string, validated server-side via HMAC,
 * may ever determine identity. This module therefore exports no function
 * that returns a user id — only the opaque raw string.
 */

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: unknown;
        ready(): void;
        expand(): void;
        close(): void;
      };
    };
  }
}

/** The raw, still-signed `initData` string. Send this, and only this, to the API. */
export function getRawInitData(): string {
  return window.Telegram?.WebApp?.initData ?? '';
}

/**
 * Reads `draftId` from the URL query string. Returns `null` for anything
 * that is not a positive integer (missing param, non-numeric, zero,
 * negative, float) — there is no draft to guess at in that case.
 */
export function getDraftIdFromUrl(): number | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('draftId');
  if (raw === null) {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * Calls `ready()` then `expand()`, guarded so this module also works in a
 * plain browser (local `npm run miniapp:dev`, outside a real Telegram
 * WebView) without throwing.
 */
export function telegramReady(): void {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) {
    return;
  }
  webApp.ready();
  webApp.expand();
}

/** Hands control back to the chat. Guarded the same way as `telegramReady`. */
export function closeApp(): void {
  window.Telegram?.WebApp?.close();
}
