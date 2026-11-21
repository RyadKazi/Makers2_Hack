/**
 * Screen-reader announcements through two persistent live regions (they must exist
 * before content is inserted, otherwise some screen readers ignore the change).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type Politeness = 'polite' | 'assertive';
type AnnounceFn = (message: string, politeness?: Politeness) => void;

const Ctx = createContext<AnnounceFn>(() => undefined);

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  const announce = useCallback<AnnounceFn>((message, politeness = 'polite') => {
    const set = politeness === 'assertive' ? setAssertive : setPolite;
    // Clear then set, so the same message twice is announced twice.
    set('');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set(message), 60);
  }, []);

  const value = useMemo(() => announce, [announce]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="announcer-polite">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="announcer-assertive">
        {assertive}
      </div>
    </Ctx.Provider>
  );
}

export function useAnnounce(): AnnounceFn {
  return useContext(Ctx);
}
