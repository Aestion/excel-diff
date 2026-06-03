import { create } from "zustand";
import type { CellValue, FileEntry, FilePair, ParsedWorkbook, Row } from "../types/excel";
import type { DiffResult } from "../types/diff";
import { cellDataEqual } from "../utils/diffEngine";

type ViewMode = "directory" | "diff";

// Compare rows with the same semantics as the row-level diff engine.
function rowsEqual(a: Row[], b: Row[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) {
      if (!cellDataEqual(a[i][j], b[i][j])) return false;
    }
  }
  return true;
}

function workbooksEqual(a: ParsedWorkbook, b: ParsedWorkbook): boolean {
  if (a.sheetNames.length !== b.sheetNames.length) return false;
  for (const sheetName of a.sheetNames) {
    const oldSheet = a.sheets.find((s) => s.name === sheetName);
    const newSheet = b.sheets.find((s) => s.name === sheetName);
    if (!oldSheet || !newSheet || !rowsEqual(oldSheet.rows, newSheet.rows)) return false;
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
  fileListCollapsedFolders: Set<string>;
  fileListKnownFolders: Set<string>;
  fileListScrollTop: number;
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
  verifyFilePair: (relativePath: string, force?: boolean) => Promise<void>;
  selectFilePair: (pair: FilePair | null) => void;
  setOldWorkbook: (wb: ParsedWorkbook | null) => void;
  setNewWorkbook: (wb: ParsedWorkbook | null) => void;
  setCurrentSheet: (sheet: string) => void;
  setDiffResult: (result: DiffResult | null) => void;
  setKeyColumnIndices: (indices: number[]) => void;
  setHasUnsavedChanges: (has: boolean) => void;
  setFileListCollapsedFolders: (folders: Set<string>) => void;
  setFileListKnownFolders: (folders: Set<string>) => void;
  setFileListScrollTop: (scrollTop: number) => void;
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
  fileListCollapsedFolders: new Set(),
  fileListKnownFolders: new Set(),
  fileListScrollTop: 0,
  effectiveNewRows: null,
  _workbookCache: new Map(),

  setView: (view) => set({ currentView: view }),
  setOldDir: (dir) => set((state) => ({
    oldDir: dir,
    fileListCollapsedFolders: state.oldDir === dir ? state.fileListCollapsedFolders : new Set(),
    fileListKnownFolders: state.oldDir === dir ? state.fileListKnownFolders : new Set(),
    fileListScrollTop: state.oldDir === dir ? state.fileListScrollTop : 0,
  })),
  setNewDir: (dir) => set((state) => ({
    newDir: dir,
    fileListCollapsedFolders: state.newDir === dir ? state.fileListCollapsedFolders : new Set(),
    fileListKnownFolders: state.newDir === dir ? state.fileListKnownFolders : new Set(),
    fileListScrollTop: state.newDir === dir ? state.fileListScrollTop : 0,
  })),
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
        const metadataChanged = existing && oldFile && newFile
          && (existing.oldSize !== oldFile.sizeBytes
            || existing.newSize !== newFile.sizeBytes
            || existing.oldModifiedAt !== oldFile.modifiedAt
            || existing.newModifiedAt !== newFile.modifiedAt);

        if (oldFile && newFile) {
          // If metadata is unchanged and we already verified, keep existing result
          if (existing && !metadataChanged && existing.diffStatus !== "unknown") {
            return {
              ...existing,
              oldSize: oldFile.sizeBytes, newSize: newFile.sizeBytes,
              oldModifiedAt: oldFile.modifiedAt, newModifiedAt: newFile.modifiedAt,
            };
          }
          return {
            filename: oldFile.name, relativePath: relPath,
            oldPath: oldFile.path, newPath: newFile.path,
            oldSize: oldFile.sizeBytes, newSize: newFile.sizeBytes,
            oldModifiedAt: oldFile.modifiedAt,
            newModifiedAt: newFile.modifiedAt,
            status: "matched" as const,
            diffStatus: "unknown" as const,
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
    const { filePairs, _workbookCache } = get();
    const { hashFiles, readExcel } = await import("../api/tauri");
    const verifiedPairs = [...filePairs];
    const cache = new Map(_workbookCache);
    const CONCURRENCY = 4;

    const needVerify = verifiedPairs
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.status === "matched" && p.diffStatus === "unknown");

    for (let batch = 0; batch < needVerify.length; batch += CONCURRENCY) {
      const batchItems = needVerify.slice(batch, batch + CONCURRENCY);
      const hashMap = new Map<string, string>();
      const hashPaths = batchItems
        .filter(({ p }) => p.oldSize === p.newSize)
        .flatMap(({ p }) => [p.oldPath!, p.newPath!]);
      if (hashPaths.length > 0) {
        try {
          const hashes = await hashFiles(hashPaths);
          for (const item of hashes) {
            hashMap.set(item.path, item.hash);
          }
        } catch {
          // Fall through to semantic Excel comparison if hashing is unavailable.
        }
      }

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

          if (p.oldSize === p.newSize) {
            const oldHash = hashMap.get(p.oldPath!);
            const newHash = hashMap.get(p.newPath!);
            if (oldHash && newHash && oldHash === newHash) {
              return {
                index: i,
                diffStatus: "identical" as const,
              };
            }
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

    set({ filePairs: verifiedPairs, _workbookCache: cache });
  },

  verifyFilePair: async (relativePath, force = false) => {
    const { filePairs, _workbookCache } = get();
    const pairIndex = filePairs.findIndex((p) => p.relativePath === relativePath);
    const pair = pairIndex >= 0 ? filePairs[pairIndex] : null;
    if (!pair || pair.status !== "matched" || !pair.oldPath || !pair.newPath) return;

    const { hashFiles, readExcel } = await import("../api/tauri");
    const cache = new Map(_workbookCache);

    if (!force) {
      const oldCache = cache.get(pair.oldPath);
      const newCache = cache.get(pair.newPath);
      if (oldCache && newCache
        && oldCache.size === pair.oldSize && oldCache.modified === (pair.oldModifiedAt ?? null)
        && newCache.size === pair.newSize && newCache.modified === (pair.newModifiedAt ?? null)) {
        const diffStatus = workbooksEqual(oldCache.data, newCache.data) ? "identical" as const : "different" as const;
        set((state) => ({
          filePairs: state.filePairs.map((p) => p.relativePath === relativePath ? { ...p, diffStatus } : p),
          _workbookCache: cache,
        }));
        return;
      }
    }

    if (pair.oldSize === pair.newSize) {
      try {
        const hashes = await hashFiles([pair.oldPath, pair.newPath]);
        const hashMap = new Map(hashes.map((item) => [item.path, item.hash]));
        if (hashMap.get(pair.oldPath) && hashMap.get(pair.oldPath) === hashMap.get(pair.newPath)) {
          set((state) => ({
            filePairs: state.filePairs.map((p) =>
              p.relativePath === relativePath ? { ...p, diffStatus: "identical" as const } : p
            ),
            _workbookCache: cache,
          }));
          return;
        }
      } catch {
        // Fall through to semantic Excel comparison if hashing is unavailable.
      }
    }

    const [oldWb, newWb] = await Promise.all([
      readExcel(pair.oldPath), readExcel(pair.newPath),
    ]);
    cache.set(pair.oldPath, { data: oldWb, size: pair.oldSize, modified: pair.oldModifiedAt ?? null });
    cache.set(pair.newPath, { data: newWb, size: pair.newSize, modified: pair.newModifiedAt ?? null });

    const diffStatus = workbooksEqual(oldWb, newWb) ? "identical" as const : "different" as const;
    set((state) => ({
      filePairs: state.filePairs.map((p) => p.relativePath === relativePath ? { ...p, diffStatus } : p),
      _workbookCache: cache,
    }));
  },

  selectFilePair: (pair) => set({ selectedFilePair: pair }),
  setOldWorkbook: (wb) => set({ oldWorkbook: wb }),
  setNewWorkbook: (wb) => set({ newWorkbook: wb }),
  setCurrentSheet: (sheet) => set({ currentSheet: sheet }),
  setDiffResult: (result) => set({ diffResult: result }),
  setKeyColumnIndices: (indices) => set({ keyColumnIndices: indices }),
  setHasUnsavedChanges: (has) => set({ hasUnsavedChanges: has }),
  setFileListCollapsedFolders: (folders) => set({ fileListCollapsedFolders: folders }),
  setFileListKnownFolders: (folders) => set({ fileListKnownFolders: folders }),
  setFileListScrollTop: (scrollTop) => set({ fileListScrollTop: scrollTop }),
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
