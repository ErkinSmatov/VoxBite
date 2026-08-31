/**
 * FooterActions — the sticky footer (CORRECT-02/CORRECT-08): confirm a new
 * analysis, save/delete a reopened saved entry, and the empty-state cancel
 * escape hatch. Mirrors `findBlockingComponent`'s server-side refusal: the
 * primary action is disabled client-side too, with the reason shown above
 * it, so the user never taps into a 422 blind.
 *
 * Delete is two-step and entirely client-side (never the browser-native
 * confirmation dialog, unreliable inside Telegram's WebView) — only the
 * second tap's handler sends the confirmation flag to the server.
 */
import { useState } from 'react';
import { apiPost } from '../lib/api-client';
import { closeApp } from '../lib/telegram';
import { copy } from '../copy';
import type { DraftResponse } from '../types';

interface FooterActionsProps {
  draftId: number;
  saved: boolean;
  componentCount: number;
  blockedComponent: string | null;
  onUpdated(next: DraftResponse): void;
  onError(message: string): void;
  onSaved(): void;
}

export function FooterActions({
  draftId,
  saved,
  componentCount,
  blockedComponent,
  onUpdated,
  onError,
  onSaved,
}: FooterActionsProps) {
  const [inFlight, setInFlight] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  const isEmpty = componentCount === 0;
  const primaryDisabled = blockedComponent !== null || isEmpty || inFlight;

  // Server-side, findBlockingComponent refuses for the SAME two reasons
  // this button is disabled for — a named blocked component, or nothing
  // left to confirm. blockedConfirm() needs a component name, so an empty
  // list (blockedComponent === null) shows the empty-state reason instead.
  let reason: string | null = null;
  if (blockedComponent !== null) {
    reason = copy.blockedConfirm(blockedComponent);
  } else if (isEmpty) {
    reason = copy.emptyStateBody;
  }

  async function runAction(
    path: string,
    body: unknown,
    onSuccess: (data: DraftResponse) => void,
  ) {
    setInFlight(true);
    const result = await apiPost<DraftResponse>(`/api/drafts/${draftId}/${path}`, body);
    setInFlight(false);
    if (result.ok) {
      onSuccess(result.data);
      return;
    }
    onError(copy.saveFailed);
  }

  async function handleConfirm() {
    await runAction('confirm', undefined, (data) => {
      onUpdated(data);
      onSaved();
    });
  }

  async function handleRecompute() {
    await runAction('recompute', undefined, (data) => {
      onUpdated(data);
      onSaved();
    });
  }

  async function handleCancel() {
    setInFlight(true);
    const result = await apiPost<{ cancelled: true }>(`/api/drafts/${draftId}/cancel`);
    setInFlight(false);
    if (result.ok) {
      closeApp();
      return;
    }
    onError(copy.saveFailed);
  }

  async function handleDeleteYes() {
    setInFlight(true);
    const result = await apiPost<{ deleted: true }>(`/api/drafts/${draftId}/delete`, {
      confirmed: true,
    });
    setInFlight(false);
    if (result.ok) {
      closeApp();
      return;
    }
    setDeleteConfirming(false);
    onError(copy.saveFailed);
  }

  function handleDeleteNo() {
    setDeleteConfirming(false);
  }

  // A single sticky footer surface renders one of three action rows: the
  // two-step delete prompt, the saved-entry row, or the new-draft row —
  // never a second footer element for the delete-confirming state.
  let body: React.ReactNode;
  if (deleteConfirming) {
    body = (
      <>
        <p className="text-caption text-destructive">{copy.deletePrompt}</p>
        <button
          type="button"
          className="tap-target text-label text-destructive"
          onClick={handleDeleteYes}
          disabled={inFlight}
        >
          {copy.btnDeleteYes}
        </button>
        <button
          type="button"
          className="tap-target text-label"
          onClick={handleDeleteNo}
          disabled={inFlight}
        >
          {copy.btnDeleteNo}
        </button>
      </>
    );
  } else if (saved) {
    body = (
      <>
        {reason ? <p className="text-caption text-destructive">{reason}</p> : null}
        <button
          type="button"
          className="tap-target text-label"
          onClick={handleRecompute}
          disabled={primaryDisabled}
        >
          {copy.btnSaveChanges}
        </button>
        <button
          type="button"
          className="tap-target text-label text-destructive"
          onClick={() => setDeleteConfirming(true)}
          disabled={inFlight}
        >
          {copy.btnDelete}
        </button>
      </>
    );
  } else {
    body = (
      <>
        {reason ? <p className="text-caption text-destructive">{reason}</p> : null}
        <button
          type="button"
          className="tap-target text-label"
          onClick={handleConfirm}
          disabled={primaryDisabled}
        >
          {copy.btnConfirm}
        </button>
        {isEmpty ? (
          <button
            type="button"
            className="tap-target text-label"
            onClick={handleCancel}
            disabled={inFlight}
          >
            {copy.btnCancelDraft}
          </button>
        ) : null}
      </>
    );
  }

  return <footer className="sticky-footer">{body}</footer>;
}
