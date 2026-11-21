/**
 * The optional right panel of the shell. Pages open it with useRightPanel().open(...);
 * the shell renders it as a 400 px column (desktop), an overlay drawer (tablet)
 * or a bottom sheet (mobile).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type PanelContent = { title: ReactNode; body: ReactNode; footer?: ReactNode };

type PanelApi = { panel: PanelContent | null; open: (content: PanelContent) => void; close: () => void };

const Ctx = createContext<PanelApi>({ panel: null, open: () => undefined, close: () => undefined });

export function RightPanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<PanelContent | null>(null);
  const open = useCallback((content: PanelContent) => setPanel(content), []);
  const close = useCallback(() => setPanel(null), []);
  const value = useMemo(() => ({ panel, open, close }), [panel, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRightPanel(): PanelApi {
  return useContext(Ctx);
}
