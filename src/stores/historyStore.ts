import { create } from "zustand";

export interface HistoryRecord {
  id: string;
  oldDir: string;
  newDir: string;
  timestamp: number;
  name?: string;
}

interface HistoryState {
  records: HistoryRecord[];
  isCollapsed: boolean;

  setRecords: (records: HistoryRecord[]) => void;
  add: (oldDir: string, newDir: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  toggleCollapsed: () => void;
  rename: (id: string, name: string) => void;
  load: () => void;
  save: () => void;
}

const STORAGE_KEY = "excel-diff-history";

// Generate unique id
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// Max records to keep
const MAX_RECORDS = 5;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  records: [],
  isCollapsed: false,

  setRecords: (records) => set({ records }),

  add: (oldDir, newDir) => {
    const { records } = get();
    const now = Date.now();

    // Check for duplicate (same oldDir and newDir)
    const existingIndex = records.findIndex(
      (r) => r.oldDir === oldDir && r.newDir === newDir
    );

    let newRecords: HistoryRecord[];
    if (existingIndex >= 0) {
      // Move existing to front with new timestamp
      const existing = records[existingIndex];
      newRecords = [
        { ...existing, timestamp: now },
        ...records.slice(0, existingIndex),
        ...records.slice(existingIndex + 1),
      ];
    } else {
      // Add new to front
      newRecords = [
        { id: generateId(), oldDir, newDir, timestamp: now },
        ...records,
      ];
    }

    // Trim to max records
    if (newRecords.length > MAX_RECORDS) {
      newRecords = newRecords.slice(0, MAX_RECORDS);
    }

    set({ records: newRecords });
    get().save();
  },

  remove: (id) => {
    set((state) => ({ records: state.records.filter((r) => r.id !== id) }));
    get().save();
  },

  rename: (id, name) => {
    set((state) => ({
      records: state.records.map((r) => r.id === id ? { ...r, name } : r)
    }));
    get().save();
  },

  clear: () => {
    set({ records: [] });
    get().save();
  },

  toggleCollapsed: () => set((state) => ({ isCollapsed: !state.isCollapsed })),

  load: () => {
    try {
      const localStorageData = localStorage.getItem(STORAGE_KEY);
      if (localStorageData) {
        const data = JSON.parse(localStorageData);
        if (Array.isArray(data)) {
          set({ records: data });
        }
      }
    } catch (e) {
      console.warn("[History] Failed to load history:", e);
    }
  },

  save: () => {
    try {
      const recordsToSave = get().records;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recordsToSave));
    } catch (e) {
      console.error("[History] Failed to save history:", e);
    }
  },
}));
