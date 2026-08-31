/**
 * AddComponent — the inline "add a missing component" control (CORRECT-06).
 * Collapsed: a single button. Expanded (in place — no modal, no navigation,
 * per UI-SPEC item 3): a text field + submit button.
 *
 * The typed text is sent to the server EXACTLY as typed — `addComponent` on
 * the server already splits a trailing gram number and runs the sanctioned
 * FDC search (src/application/corrections.ts); this file must not
 * re-implement any part of that (no trim/replace/split here).
 */
import { useState } from 'react';
import { apiPost } from '../lib/api-client';
import { copy } from '../copy';
import type { DraftResponse } from '../types';

// Mirrors MAX_COMPONENT_TEXT_LENGTH from src/application/corrections.ts —
// this file cannot import from src/ (separate build, see types.ts header).
const MAX_COMPONENT_TEXT_LENGTH = 100;

interface AddComponentProps {
  draftId: number;
  onUpdated(next: DraftResponse): void;
  onError(message: string): void;
}

type InlineError =
  | { kind: 'text_too_long' }
  | { kind: 'not_found'; message: string }
  | null;

export function AddComponent({ draftId, onUpdated, onError }: AddComponentProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<InlineError>(null);

  function collapse() {
    setExpanded(false);
    setText('');
    setInlineError(null);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setInlineError(null);
    const result = await apiPost<DraftResponse>(`/api/drafts/${draftId}/add-component`, {
      raw: text,
    });
    setSubmitting(false);

    if (result.ok) {
      onUpdated(result.data);
      collapse();
      return;
    }

    if (result.kind === 'api' && result.code === 'text_too_long') {
      setInlineError({ kind: 'text_too_long' });
      return;
    }
    if (result.kind === 'api' && (result.code === 'match_failed' || result.code === 'empty_text')) {
      setInlineError({ kind: 'not_found', message: copy.addNotFound(text) });
      return;
    }
    onError(copy.saveFailed);
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className="tap-target text-label"
        onClick={() => setExpanded(true)}
      >
        {copy.btnAdd}
      </button>
    );
  }

  return (
    <div>
      <input
        type="text"
        inputMode="text"
        placeholder={copy.askComponent}
        maxLength={MAX_COMPONENT_TEXT_LENGTH}
        value={text}
        disabled={submitting}
        onChange={(event) => setText(event.target.value)}
        className="text-body"
      />
      {submitting ? (
        <span className="text-caption text-hint">…</span>
      ) : (
        <button
          type="button"
          className="tap-target text-label"
          onClick={handleSubmit}
          disabled={text.length === 0}
        >
          {copy.btnAdd}
        </button>
      )}
      {inlineError?.kind === 'text_too_long' ? (
        <p className="text-caption text-destructive">{copy.componentTooLong}</p>
      ) : null}
      {inlineError?.kind === 'not_found' ? (
        <p className="text-caption text-destructive">{inlineError.message}</p>
      ) : null}
    </div>
  );
}
