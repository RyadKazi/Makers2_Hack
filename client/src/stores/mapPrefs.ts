import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const MAP_LAYERS = ['classrooms', 'entrances', 'elevators', 'stairs', 'ramps', 'toilets', 'accessible_toilets', 'facilities', 'status', 'closed'] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

type MapPrefs = {
  layers: Record<MapLayer, boolean>;
  toggleLayer: (layer: MapLayer) => void;
  setAll: (on: boolean) => void;
};

const ALL_ON = Object.fromEntries(MAP_LAYERS.map((l) => [l, true])) as Record<MapLayer, boolean>;

const storage = createJSONStorage(() => {
  try {
    const probe = '__cw__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
});

export const useMapPrefs = create<MapPrefs>()(
  persist(
    (set) => ({
      layers: ALL_ON,
      toggleLayer: (layer) => set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
      setAll: (on) => set({ layers: Object.fromEntries(MAP_LAYERS.map((l) => [l, on])) as Record<MapLayer, boolean> }),
    }),
    { name: 'campusway.map', storage, version: 1, merge: (persisted, current) => ({ ...current, layers: { ...ALL_ON, ...(persisted as Partial<MapPrefs>)?.layers } }) },
  ),
);

/** Saved places (rooms), kept on this device. */
type Saved = { rooms: string[]; toggleRoom: (code: string) => boolean };

export const useSaved = create<Saved>()(
  persist(
    (set, get) => ({
      rooms: [],
      toggleRoom: (code) => {
        const saved = !get().rooms.includes(code);
        set((s) => ({ rooms: saved ? [...s.rooms, code] : s.rooms.filter((c) => c !== code) }));
        return saved;
      },
    }),
    { name: 'campusway.saved', storage, version: 1 },
  ),
);
