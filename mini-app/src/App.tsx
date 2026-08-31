import { useCallback, useEffect, useState } from 'react';
import { apiGet } from './lib/api-client';
import { getDraftIdFromUrl } from './lib/telegram';
import { copy } from './copy';
import type { DraftResponse } from './types';

type Screen =
  | { phase: 'loading' }
  | { phase: 'error'; kind: 'gone' | 'network' }
  | { phase: 'ready'; draft: DraftResponse };

/**
 * Statuses that all mean "there is nothing here this user may see" — a
 * missing draft, someone else's draft, and an expired draft are
 * deliberately indistinguishable to the caller (T-04.1-35 / IDOR-privacy
 * rule already established for the bot's chat-side `expired`/`notYours`
 * copy). All four map to the exact same full-screen message.
 */
function isGoneStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ phase: 'loading' });
  const [draftId] = useState<number | null>(() => getDraftIdFromUrl());

  const load = useCallback(async (id: number) => {
    setScreen({ phase: 'loading' });
    const result = await apiGet<DraftResponse>('/api/drafts/' + id);
    if (result.ok) {
      setScreen({ phase: 'ready', draft: result.data });
      return;
    }
    if (result.kind === 'api' && isGoneStatus(result.status)) {
      setScreen({ phase: 'error', kind: 'gone' });
      return;
    }
    // Network failure, or an API failure that isn't one of the "gone"
    // statuses (e.g. a 5xx) — both are retryable, not identity-revealing.
    setScreen({ phase: 'error', kind: 'network' });
  }, []);

  useEffect(() => {
    if (draftId === null) {
      return;
    }
    load(draftId);
  }, [draftId, load]);

  /**
   * Every later mutation (plans 09/10) must call this with the API's fresh
   * response and re-render the WHOLE screen from it — never patch the
   * component list or totals locally. No `.tsx` file in this app may ever
   * contain arithmetic combining `grams` with a nutrient value
   * (04.1-RESEARCH.md Anti-Patterns / Pitfall 3, CALC-01) — the API's
   * `calculateTotal()` is the only place totals are computed.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- wired into props once plans 09/10 add mutating children
  const updateFromResponse = useCallback((next: DraftResponse) => {
    setScreen({ phase: 'ready', draft: next });
  }, []);

  if (draftId === null) {
    return <FullScreenMessage text={copy.expired} />;
  }

  if (screen.phase === 'loading') {
    return (
      <div className="screen-centered">
        <p className="text-caption text-hint">{copy.loading}</p>
      </div>
    );
  }

  if (screen.phase === 'error') {
    if (screen.kind === 'gone') {
      return <FullScreenMessage text={copy.expired} />;
    }
    return (
      <FullScreenMessage text={copy.loadFailed}>
        <button
          type="button"
          className="tap-target text-label"
          onClick={() => load(draftId)}
        >
          {copy.retry}
        </button>
      </FullScreenMessage>
    );
  }

  const { draft } = screen;

  return (
    <div>
      <header className="sticky-header">
        <p className="text-label">{copy.headerLevel1}</p>
      </header>
      <main>
        {draft.components.map((component, index) => {
          const chosenCandidate = component.candidates.find(
            (candidate) => candidate.fdcId === component.chosenFdcId,
          );
          return (
            <div key={index} className="component-row">
              <p className="text-label">{component.component}</p>
              <p className="text-body">{component.grams} г</p>
              <p className="text-body text-hint">
                {chosenCandidate ? chosenCandidate.description : copy.noMatch}
              </p>
            </div>
          );
        })}
      </main>
      <footer className="sticky-footer" />
    </div>
  );
}

function FullScreenMessage({
  text,
  children,
}: {
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="screen-centered">
      <p className="text-body">{text}</p>
      {children}
    </div>
  );
}
