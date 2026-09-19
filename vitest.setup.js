import { vi } from "vitest";

// Localized App tests use React's act() around lifecycle and locale updates.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Node's experimental global storage may shadow jsdom's browser storage.
if (typeof window !== "undefined") {
  const values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  });
}
