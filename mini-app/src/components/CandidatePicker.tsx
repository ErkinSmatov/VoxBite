/**
 * CandidatePicker — the inline accordion that lets a user swap which FDC
 * record a component is matched to (CORRECT-03). Deliberately not a modal
 * dialog element and not a native browser dropdown control (04.1-UI-SPEC.md
 * Screen Layout item 2) — an inline panel that expands beneath the
 * affordance and updates the row from the server's response the moment a
 * candidate is chosen.
 *
 * Candidate ORDER is exactly the order the API returned (`candidates` prop,
 * as received) — this component never sorts or filters that array. Only
 * `candidate.description` and the chosen-marker are shown here; per-record
 * nutrient numbers and match-quality scores were never surfaced in the chat
 * flow either (see `src/bot/formatting/correction-card.ts`'s
 * `buildComponentEditCard`), and per-candidate arithmetic has no business in
 * a picker row.
 */
import { useState } from 'react';
import { apiPost } from '../lib/api-client';
import { copy } from '../copy';
import type { DraftResponse, FdcCandidate } from '../types';

interface CandidatePickerProps {
  draftId: number;
  componentIndex: number;
  candidates: FdcCandidate[];
  chosenFdcId: number | null;
  onUpdated(next: DraftResponse): void;
  onError(message: string): void;
}

export function CandidatePicker({
  draftId,
  componentIndex,
  candidates,
  chosenFdcId,
  onUpdated,
  onError,
}: CandidatePickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  if (candidates.length === 0) {
    return <p className="text-caption text-hint">{copy.noMatch}</p>;
  }

  async function handleSelect(candidateIndex: number, candidate: FdcCandidate) {
    if (candidate.fdcId === chosenFdcId) {
      // Already the chosen one — collapsing is the whole action, no request.
      setExpanded(false);
      return;
    }

    setPendingIndex(candidateIndex);
    const result = await apiPost<DraftResponse>(`/api/drafts/${draftId}/swap-candidate`, {
      componentIndex,
      candidateIndex,
    });
    setPendingIndex(null);

    if (result.ok) {
      onUpdated(result.data);
      setExpanded(false);
      return;
    }

    // Leave the accordion open so the user can retry.
    onError(copy.saveFailed);
  }

  return (
    <div>
      <button
        type="button"
        className="tap-target text-body candidate-picker-affordance"
        onClick={() => setExpanded((prev) => !prev)}
        disabled={pendingIndex !== null}
      >
        {copy.btnChangeCandidate}
      </button>
      {expanded ? (
        <div className="candidate-picker-panel" role="group">
          {candidates.map((candidate, candidateIndex) => {
            const isChosen = candidate.fdcId === chosenFdcId;
            const isPending = pendingIndex === candidateIndex;
            return (
              <button
                key={candidate.fdcId}
                type="button"
                className="tap-target text-body candidate-picker-row"
                onClick={() => handleSelect(candidateIndex, candidate)}
                disabled={pendingIndex !== null}
              >
                <span>{candidate.description}</span>
                {isChosen ? (
                  <span className="candidate-picker-marker" style={{ color: 'var(--color-accent)' }}>
                    {copy.chosenMarker}
                  </span>
                ) : null}
                {isPending ? <span className="text-caption text-hint">…</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
