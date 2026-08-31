import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from './lib/api-client';
import { getDraftIdFromUrl, closeApp } from './lib/telegram';
import { copy } from './copy';
import { ComponentRow } from './components/ComponentRow';
import { SummaryTotals } from './components/SummaryTotals';
import { AddComponent } from './components/AddComponent';
import { FooterActions } from './components/FooterActions';
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
  // A single mutation failure shows an inline banner, not a full-screen
  // state — the rest of the screen (and the user's in-progress edits) stays
  // visible.
  const [mutationError, setMutationError] = useState<string | null>(null);
  // The Mini App's only "it worked" signal (D-03 removed every chat-side
  // confirmation message) — shown for ~800ms, then Telegram.WebApp.close().
  const [savedBanner, setSavedBanner] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

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
  const updateFromResponse = useCallback((next: DraftResponse) => {
    setMutationError(null);
    setScreen({ phase: 'ready', draft: next });
  }, []);

  const handleMutationError = useCallback((message: string) => {
    setMutationError(message);
  }, []);

  const handleSaved = useCallback(() => {
    setSavedBanner(true);
    closeTimerRef.current = setTimeout(() => {
      closeApp();
    }, 800);
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

  if (savedBanner) {
    return <FullScreenMessage text={copy.savedToDiary} />;
  }

  const isEmpty = draft.components.length === 0;

  return (
    <div>
      <header className="sticky-header">
        <p className="text-label">{copy.headerLevel1}</p>
        <SummaryTotals
          total={draft.total}
          contributingCount={draft.contributingCount}
          saved={draft.saved}
        />
      </header>
      <main>
        {mutationError ? <p className="text-body text-destructive">{mutationError}</p> : null}
        {isEmpty ? (
          <div>
            <p className="text-label">{copy.emptyStateHeading}</p>
            <p className="text-body">{copy.emptyStateBody}</p>
          </div>
        ) : (
          draft.components.map((component, index) => (
            // Keying on the positional index is deliberate: the whole list is
            // replaced wholesale from each API response (never reordered
            // in-place by React state), so the index-key reordering caveat
            // does not apply here.
            <ComponentRow
              key={index}
              draftId={draft.draftId}
              index={index}
              component={component}
              onUpdated={updateFromResponse}
              onError={handleMutationError}
            />
          ))
        )}
        <AddComponent draftId={draft.draftId} onUpdated={updateFromResponse} onError={handleMutationError} />
      </main>
      <FooterActions
        draftId={draft.draftId}
        saved={draft.saved}
        componentCount={draft.components.length}
        blockedComponent={draft.blockedComponent}
        onUpdated={updateFromResponse}
        onError={handleMutationError}
        onSaved={handleSaved}
      />
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
