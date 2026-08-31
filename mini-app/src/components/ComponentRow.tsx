/**
 * ComponentRow — one component's whole row: name, matched candidate,
 * candidate picker, grams control, and the remove action
 * (CORRECT-01/03/04/05). Composes `CandidatePicker` and `GramsControl`;
 * every mutation handler here passes the server's `DraftResponse` straight
 * into the parent's `onUpdated` — nothing in this file builds a components
 * array locally (04.1-RESEARCH.md Anti-Patterns / Pitfall 3, CALC-01).
 *
 * Removing a component shows NO confirmation dialog — per
 * 04.1-UI-SPEC.md's Copywriting Contract it is reversible via
 * `➕ Добавить`, matching the pre-Mini-App chat behavior.
 */
import { useState } from 'react';
import { apiPost } from '../lib/api-client';
import { copy } from '../copy';
import type { DraftComponent, DraftResponse } from '../types';
import { CandidatePicker } from './CandidatePicker';
import { GramsControl } from './GramsControl';

interface ComponentRowProps {
  draftId: number;
  index: number;
  component: DraftComponent;
  onUpdated(next: DraftResponse): void;
  onError(message: string): void;
}

export function ComponentRow({ draftId, index, component, onUpdated, onError }: ComponentRowProps) {
  const [removing, setRemoving] = useState(false);

  // A corrupt row (chosenFdcId not present among this component's
  // candidates) renders noMatch rather than defaulting to the first
  // candidate in the list — an honest gap beats a confident wrong food
  // (T-04.1-41).
  const chosenCandidate = component.candidates.find(
    (candidate) => candidate.fdcId === component.chosenFdcId,
  );

  async function handleRemove() {
    setRemoving(true);
    const result = await apiPost<DraftResponse>(`/api/drafts/${draftId}/remove-component`, {
      componentIndex: index,
    });
    setRemoving(false);

    if (result.ok) {
      onUpdated(result.data);
      return;
    }
    onError(copy.saveFailed);
  }

  return (
    <div className="component-row-card">
      <div className="component-row-main">
        <div className="component-row-left">
          <p className="text-label">{component.component}</p>
          <p className="text-body text-hint">
            {chosenCandidate ? chosenCandidate.description : copy.noMatch}
          </p>
          <CandidatePicker
            draftId={draftId}
            componentIndex={index}
            candidates={component.candidates}
            chosenFdcId={component.chosenFdcId}
            onUpdated={onUpdated}
            onError={onError}
          />
        </div>
        <div className="component-row-right">
          <GramsControl
            draftId={draftId}
            componentIndex={index}
            grams={component.grams}
            onUpdated={onUpdated}
            onError={onError}
          />
        </div>
      </div>
      <div className="component-row-footer">
        <button
          type="button"
          className="tap-target text-label text-destructive"
          onClick={handleRemove}
          disabled={removing}
        >
          {copy.btnRemove}
        </button>
      </div>
    </div>
  );
}
