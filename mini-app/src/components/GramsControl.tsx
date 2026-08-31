/**
 * GramsControl — the `−10 г` / tap-to-edit-number / `+10 г` row (CORRECT-04).
 *
 * The two stepper buttons send a `direction`, never a delta number — the
 * ±10 г step size is a server-side product rule (`GRAM_STEP` in
 * `src/application/corrections.ts`), so this file never sends anything
 * resembling a computed delta.
 *
 * The typed-value path sends the raw string EXACTLY as the user typed it to
 * `/api/drafts/:id/typed-grams`. `parseGrams` on the server
 * (`src/application/corrections.ts`) is the single parser for this value
 * across the whole product — no `parseInt`/`parseFloat`/`Number(...)`,
 * trimming, comma-to-dot replacement, or rounding happens here. A
 * client-side pre-parse would be a second implementation that drifts from
 * the server's.
 */
import { useState } from 'react';
import { apiPost } from '../lib/api-client';
import { copy } from '../copy';
import type { DraftResponse } from '../types';

interface GramsControlProps {
  draftId: number;
  componentIndex: number;
  grams: number;
  onUpdated(next: DraftResponse): void;
  onError(message: string): void;
}

export function GramsControl({ draftId, componentIndex, grams, onUpdated, onError }: GramsControlProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [pending, setPending] = useState(false);
  const [rejected, setRejected] = useState(false);

  async function sendDirection(direction: 'up' | 'down') {
    setPending(true);
    const result = await apiPost<DraftResponse>(`/api/drafts/${draftId}/adjust-grams`, {
      componentIndex,
      direction,
    });
    setPending(false);

    if (result.ok) {
      onUpdated(result.data);
      return;
    }
    onError(copy.saveFailed);
  }

  function startEditing() {
    setInputValue(String(grams));
    setRejected(false);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setRejected(false);
  }

  async function submitTyped() {
    setPending(true);
    const result = await apiPost<DraftResponse>(`/api/drafts/${draftId}/typed-grams`, {
      componentIndex,
      raw: inputValue,
    });
    setPending(false);

    if (result.ok) {
      onUpdated(result.data);
      setEditing(false);
      setRejected(false);
      return;
    }

    if (result.kind === 'api' && result.code === 'invalid_grams') {
      setRejected(true);
      return;
    }

    onError(copy.saveFailed);
  }

  return (
    <div>
      <div className="grams-control">
        <button
          type="button"
          className="tap-target text-body"
          onClick={() => sendDirection('down')}
          disabled={pending}
        >
          {copy.btnMinus10}
        </button>
        {editing ? (
          <input
            className="tap-target text-body"
            type="text"
            inputMode="numeric"
            autoFocus
            value={inputValue}
            disabled={pending}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                submitTyped();
              } else if (event.key === 'Escape') {
                cancelEditing();
              }
            }}
            onBlur={() => submitTyped()}
          />
        ) : (
          <button
            type="button"
            className="tap-target text-body"
            onClick={startEditing}
            disabled={pending}
          >
            {grams} г
          </button>
        )}
        <button
          type="button"
          className="tap-target text-body"
          onClick={() => sendDirection('up')}
          disabled={pending}
        >
          {copy.btnPlus10}
        </button>
      </div>
      {rejected ? <p className="text-caption text-hint">{copy.gramsRejected}</p> : null}
    </div>
  );
}
