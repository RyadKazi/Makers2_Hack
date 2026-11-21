import '@testing-library/jest-dom/vitest';
import { transferableAbortController } from 'node:util';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@/i18n';

// The campus map renders hundreds of accessible markers; give async queries
// enough time on slower CI machines without changing product behaviour.
configure({ asyncUtilTimeout: 5000 });

// React Router creates navigation requests with Node's Request implementation.
// Make jsdom use Node-compatible abort signals so click-driven navigations are
// exercised in tests instead of failing before the route can change.
const nodeAbortController = transferableAbortController();
Object.defineProperties(globalThis, {
  AbortController: { value: nodeAbortController.constructor, configurable: true },
  AbortSignal: { value: nodeAbortController.signal.constructor, configurable: true },
});
Object.defineProperties(window, {
  AbortController: { value: nodeAbortController.constructor, configurable: true },
  AbortSignal: { value: nodeAbortController.signal.constructor, configurable: true },
});

// In Node 22+, globalThis.localStorage exists but throws without --localstorage-file.
// Provide an in-memory Storage implementation for tests.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
}

try {
  const probe = '__cw_test__';
  window.localStorage.setItem(probe, probe);
  window.localStorage.removeItem(probe);
} catch {
  const memStorage = new MemoryStorage();
  Object.defineProperty(window, 'localStorage', { value: memStorage, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: memStorage, configurable: true, writable: true });
}

afterEach(() => {
  cleanup();
});

// jsdom lacks matchMedia and getClientRects-based layout.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addEventListener: () => { }, removeEventListener: () => { }, addListener: () => { }, removeListener: () => { }, dispatchEvent: () => false }) as MediaQueryList;
}
