import { create } from "zustand";
import type { CellData, CellValue, FileEntry, FilePair, ParsedWorkbook, Row } from "../types/excel";
import type { DiffResult } from "../types/diff";

type ViewMode = "directory" | "diff";

// Compare rows by value only (ignoring formula metadata differences)
function rowsEqual(a: Row[], b: Row[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) {
      const av = a[i][j]?.value;
      const bv = b[i][j]?.value;
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    }
  }
  return true;
}

interface DiffState {
  currentView: ViewMode;
  oldDir: string;
  newDir: string;
  oldFiles: FileEntry[];
  newFiles: FileEntry[];
  filePairs: FilePair[];
  selectedFilePair: FilePair | null;
  oldWorkbook: ParsedWorkbook | null;
  newWorkbook: ParsedWorkbook | null;
  currentSheet: string;
  diffResult: DiffResult | null;
  keyColumnIndices: number[];
  hasUnsavedChanges: boolean;
  // Effective new rows (with user edits applied)
  effectiveNewRows: Row[] | null;
  // Cache for parsed workbooks: filePath -> { data, size, modified }
  _workbookCache: Map<string, { data: ParsedWorkbook; size: number; modified: number | null }>;

  setView: (view: ViewMode) => void;
  setOldDir: (dir: string) => void;
  setNewDir: (dir: string) => void;
  setOldFiles: (files: FileEntry[]) => void;
  setNewFiles: (files: FileEntry[]) => void;
  setFilePairs: (pairs: FilePair[]) => void;
  buildFilePairs: () => Promise<void>;
  verifyAllFiles: () => Promise<void>;
  selectFilePair: (pair: FilePair | null) => void;
  setOldWorkbook: (wb: ParsedWorkbook | null) => void;
  setNewWorkbook: (wb: ParsedWorkbook | null) => void;
  setCurrentSheet: (sheet: string) => void;
  setDiffResult: (result: DiffResult | null) => void;
  setKeyColumnIndices: (indices: number[]) => void;
  setHasUnsavedChanges: (has: boolean) => void;
  setEffectiveNewRows: (rows: Row[] | null) => void;
  updateNewCell: (rowIndex: number, colIndex: number, value: CellValue) => void;
  markFileAsIdentical: (relativePath: string) => void;
}

export const useDiffStore = create<DiffState>((set, get) => ({
  currentView: "directory",
  oldDir: "",
  newDir: "",
  oldFiles: [],
  newFiles: [],
  filePairs: [],
  selectedFilePair: null,
  oldWorkbook: null,
  newWorkbook: null,
  currentSheet: "",
  diffResult: null,
  keyColumnIndices: [],
  hasUnsavedChanges: false,
  effectiveNewRows: null,
  _workbookCache: new Map(),

  setView: (view) => set({ currentView: view }),
  setOldDir: (dir) => set({ oldDir: dir }),
  setNewDir: (dir) => set({ newDir: dir }),
  setOldFiles: (files) => set({ oldFiles: files }),
  setNewFiles: (files) => set({ newFiles: files }),
  setFilePairs: (pairs) => set({ filePairs: pairs }),

  buildFilePairs: async () => {
    const { oldFiles, newFiles, oldDir, newDir, filePairs: existingPairs } = get();
    const oldMap = new Map(oldFiles.map((f) => [f.relativePath, f]));
    const newMap = new Map(newFiles.map((f) => [f.relativePath, f]));
    const allPaths = new Set([...oldMap.keys(), ...newMap.keys()]);

    // Build pairs with INSTANT size-based comparison (no Python reads)
    const pairs: FilePair[] = Array.from(allPaths)
      .sort()
      .map((relPath) => {
        const oldFile = oldMap.get(relPath);
        const newFile = newMap.get(relPath);

        // Check if we already have a result for this file
        const existing = existingPairs.find(p => p.relativePath === relPath);
        const sizeChanged = existing && oldFile && newFile
          && (existing.oldSize !== oldFile.sizeBytes || existing.newSize !== newFile.sizeBytes);

        if (oldFile && newFile) {
          // If sizes unchanged and we already verified, keep existing result
          if (existing && !sizeChanged && existing.diffStatus !== "unknown") {
            return {
              ...existing,
              oldSize: oldFile.sizeBytes, newSize: newFile.sizeBytes,
              oldModifiedAt: oldFile.modifiedAt, newModifiedAt: newFile.modifiedAt,
            };
          }
          // Different size = definitely different
          const diffStatus = oldFile.sizeBytes !== newFile.sizeBytes
            ? "different" as const
            : "unknown" as const;
          return {
            filename: oldFile.name, relativePath: relPath,
            oldPath: oldFile.path, newPath: newFile.path,
            oldSize: oldFile.sizeBytes, newSize: newFile.sizeBytes,
            oldModifiedAt: oldFile.modifiedAt,
            newModifiedAt: newFile.modifiedAt,
            status: "matched" as const,
            diffStatus,
          };
        } else if (oldFile) {
          return {
            filename: oldFile.name, relativePath: relPath,
            oldPath: oldFile.path, newPath: null,
            oldSize: oldFile.sizeBytes, newSize: 0,
            oldModifiedAt: oldFile.modifiedAt,
            status: "old-only" as const, diffStatus: "unknown" as const,
          };
        } else {
          return {
            filename: newFile!.name, relativePath: relPath,
            oldPath: null, newPath: newFile!.path,
            oldSize: 0, newSize: newFile!.sizeBytes,
            newModifiedAt: newFile!.modifiedAt,
            status: "new-only" as const, diffStatus: "unknown" as const,
          };
        }
      });

    // Set pairs immediately — no Python reads needed!
    set({ filePairs: pairs });

    // Add to history if both directories are selected
    if (oldDir && newDir && pairs.length > 0) {
      const { useHistoryStore } = await import("./historyStore");
      useHistoryStore.getState().add(oldDir, newDir);
    }
  },

  // Manual verify all files — triggered by user clicking "对比" button
  verifyAllFiles: async () => {
    const { filePairs } = get();
    const { readExcel } = await import("../api/tauri");
    const verifiedPairs = [...filePairs];
    // Clear cache to force re-read
    const cache = new Map<string, { data: ParsedWorkbook; size: number; modified: number | null }>();
    set({ _workbookCache: cache });
    const CONCURRENCY = 4;

    const needVerify = verifiedPairs
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.status === "matched");

    for (let batch = 0; batch < needVerify.length; batch += CONCURRENCY) {
      const batchItems = needVerify.slice(batch, batch + CONCURRENCY);
      const results = await Promise.allSettled(
        batchItems.map(async ({ p, i }) => {
          // Check cache first
          const oldCache = cache.get(p.oldPath!);
          const newCache = cache.get(p.newPath!);
          if (oldCache && newCache
            && oldCache.size === p.oldSize && oldCache.modified === p.oldModifiedAt
            && newCache.size === p.newSize && newCache.modified === p.newModifiedAt) {
            let allSame = true;
            for (const sheetName of oldCache.data.sheetNames) {
              const oldSheet = oldCache.data.sheets.find((s) => s.name === sheetName);
              const newSheet = newCache.data.sheets.find((s) => s.name === sheetName);
              if (!newSheet) { allSame = false; break; }
              if (!rowsEqual(oldSheet!.rows, newSheet.rows)) {
                allSame = false; break;
              }
            }
            return {
              index: i,
              diffStatus: (allSame && oldCache.data.sheetNames.length === newCache.data.sheetNames.length)
                ? "identical" as const : "different" as const,
            };
          }

          const [oldWb, newWb] = await Promise.all([
            readExcel(p.oldPath!), readExcel(p.newPath!),
          ]);
          cache.set(p.oldPath!, { data: oldWb, size: p.oldSize, modified: p.oldModifiedAt! });
          cache.set(p.newPath!, { data: newWb, size: p.newSize, modified: p.newModifiedAt! });

          let allSame = true;
          for (const sheetName of oldWb.sheetNames) {
            const oldSheet = oldWb.sheets.find((s) => s.name === sheetName);
            const newSheet = newWb.sheets.find((s) => s.name === sheetName);
            if (!newSheet) { allSame = false; break; }
            if (!rowsEqual(oldSheet!.rows, newSheet.rows)) {
              allSame = false; break;
            }
          }
          return {
            index: i,
            diffStatus: (allSame && oldWb.sheetNames.length === newWb.sheetNames.length)
              ? "identical" as const : "different" as const,
          };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          verifiedPairs[r.value.index] = { ...verifiedPairs[r.value.index], diffStatus: r.value.diffStatus };
        }
      }
    }

    set({ filePairs: verifiedPairs });
  },

  selectFilePair: (pair) => set({ selectedFilePair: pair }),
  setOldWorkbook: (wb) => set({ oldWorkbook: wb }),
  setNewWorkbook: (wb) => set({ newWorkbook: wb }),
  setCurrentSheet: (sheet) => set({ currentSheet: sheet }),
  setDiffResult: (result) => set({ diffResult: result }),
  setKeyColumnIndices: (indices) => set({ keyColumnIndices: indices }),
  setHasUnsavedChanges: (has) => set({ hasUnsavedChanges: has }),
  setEffectiveNewRows: (rows) => set({ effectiveNewRows: rows }),

  updateNewCell: (rowIndex, colIndex, value) => {
    const { effectiveNewRows } = get();
    if (!effectiveNewRows) return;
    const newRows = effectiveNewRows.map((row, i) => {
      if (i !== rowIndex) return row;
      const newRow = row.map((c) => ({ ...c }));
      while (newRow.length <= colIndex) newRow.push({ value: null });
      newRow[colIndex] = { value };
      return newRow;
    });
    set({ effectiveNewRows: newRows, hasUnsavedChanges: true });
  },

  markFileAsIdentical: (relativePath) => {
    set((state) => ({
      filePairs: state.filePairs.map((p) =>
        p.relativePath === relativePath
          ? { ...p, diffStatus: "identical" as const }
          : p
      ),
    }));
  },
}));
