import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDiffStore } from "../stores/diffStore";
import { useEditStore, type CellChange } from "../stores/editStore";
import { cellDataEqual, computeDiff } from "../utils/diffEngine";
import { rowsEqual } from "../utils/workbookCompare";
import DiffGrid, { type DiffGridHandle } from "./DiffGrid";
import KeyColumnSelector from "./KeyColumnSelector";
import ErrorDialog from "./ErrorDialog";
import VersionCompareDialog from "./VersionCompareDialog";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { onDiffTabUiStateCapture, onDiffTabUiStateRestore } from "../utils/diffTabUiStateBridge";
import { captureDiffTabSnapshot } from "../utils/diffTabSnapshot";
import { writeExcel, writeExcelChanges, listExcelFiles, readExcel, pickSavePath, saveTextFile, detectKeyColumns, getVcsFileInfo, openVcsLog } from "../api/tauri";
import type { CellValue, Row, SheetData, CellData } from "../types/excel";
import type { DiffResult, DiffRow } from "../types/diff";
import type { VcsFileInfo } from "../types/vcs";
import { BackIcon, UndoIcon, RedoIcon, SaveIcon, ArrowRight, ArrowLeft, FilterIcon, KeyIcon, ChevronDown, FileIcon, ChevronDown as ChevronDownIcon, SearchIcon } from "./Icons";

function getDiffRowRef(row: DiffRow): string {
  return `${row.oldRowNumber ?? ""}:${row.newRowNumber ?? ""}:${row.viewIndex}`;
}

function findDiffRowByRef(diffResult: DiffResult | null, rowRef: string): DiffRow | undefined {
  return diffResult?.diffRows.find((row) => getDiffRowRef(row) === rowRef);
}

function clampInsertIndex(index: number, rowCount: number): number {
  return Math.max(0, Math.min(rowCount, index));
}

function findVisualInsertIndex(
  diffRows: DiffRow[],
  rowRef: string,
  targetSide: "old" | "new",
  fallbackRowNumber: number | null | undefined,
  rowCount: number
): number {
  const index = diffRows.findIndex((row) => getDiffRowRef(row) === rowRef);
  const getRowNumber = (row: DiffRow) => targetSide === "old" ? row.oldRowNumber : row.newRowNumber;

  if (index >= 0) {
    for (let i = index - 1; i >= 0; i--) {
      const rowNumber = getRowNumber(diffRows[i]);
      if (rowNumber != null) return clampInsertIndex(rowNumber, rowCount);
    }
    for (let i = index + 1; i < diffRows.length; i++) {
      const rowNumber = getRowNumber(diffRows[i]);
      if (rowNumber != null) return clampInsertIndex(rowNumber - 1, rowCount);
    }
  }

  return clampInsertIndex((fallbackRowNumber ?? rowCount + 1) - 1, rowCount);
}

function rowIsEmpty(row: Row | undefined): boolean {
  return !row || row.every((cell) => cellDataEqual(cell, undefined));
}

type DiffBlock = {
  id: string;
  startIndex: number;
  endIndex: number;
  startRef: string;
};

type SheetSummary = {
  name: string;
  keyColumns: number[];
  diffCount: number;
  totalRows: number;
};

type CopyMode = "all" | "added" | "modified";
type RowContextMenuState = {
  side: "old" | "new";
  rowRef: string;
  x: number;
  y: number;
};

type DetailField = {
  index: number;
  name: string;
  oldText: string;
  newText: string;
  isDifferent: boolean;
};

type DetailEditState = {
  side: "old" | "new";
  rowRef: string;
  columnIndex: number;
  value: string;
};

const RIGHT_ROWS_SNAPSHOT = -10;
const LEFT_ROWS_SNAPSHOT = -11;
const ACTION_COLUMN_CLASS = "w-20";

function shouldCopyLeftToRight(row: DiffRow, mode: CopyMode): boolean {
  if (mode === "added") return row.status === "deleted";
  if (mode === "modified") return row.status === "modified";
  return row.status === "deleted" || row.status === "modified" || row.status === "added";
}

function shouldCopyRightToLeft(row: DiffRow, mode: CopyMode): boolean {
  if (mode === "added") return row.status === "added" && !!row.newRow;
  if (mode === "modified") return row.status === "modified" && !!row.newRow;
  return row.status === "added" || row.status === "modified" || row.status === "deleted";
}

function uniqueRowRefs(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat()));
}

function formatDetailCell(cell: CellData | undefined): string {
  if (!cell || cell.value === null || cell.value === undefined || cell.value === "") {
    return cell?.formula ? `公式: ${cell.formula}` : "";
  }
  const valueText = String(cell.value);
  return cell.formula ? `${valueText}\n公式: ${cell.formula}` : valueText;
}

function cellValueToEditText(cell: CellData | undefined): string {
  if (cell?.formula) return cell.formula;
  if (cell?.value === null || cell?.value === undefined) return "";
  return String(cell.value);
}

function parseEditedCellValue(value: string): { value: CellValue; formula?: string } {
  if (value.startsWith("=")) return { value, formula: value };
  if (value.trim() === "") return { value: null };
  const numericValue = Number(value);
  if (value.trim() !== "" && Number.isFinite(numericValue) && String(numericValue) === value.trim()) {
    return { value: numericValue };
  }
  return { value };
}

const METRICS_UPDATE_INTERVAL_MS = 80;

function formatVcsSummary(info: VcsFileInfo | null): string {
  if (!info) return "版本信息读取中";
  if (info.kind === "none") return "未检测到版本库";
  const source = info.branch || info.revision || info.url || info.root || info.kind;
  const status = info.status ? ` · ${info.status}` : "";
  const last = info.lastCommit ? ` · ${info.lastCommit.author ?? "-"} · ${formatVcsDate(info.lastCommit.date)} · ${info.lastCommit.message}` : "";
  return `${info.kind.toUpperCase()} · ${source}${status}${last}`;
}

function formatVcsDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/, "");
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function VcsSummaryBadge({ label, path, info, readOnly }: { label: string; path: string | null; info: VcsFileInfo | null; readOnly?: boolean }) {
  if (!path) return null;
  const source = info && info.kind !== "none" ? (info.revision || info.branch || info.url || info.root || info.kind) : "";
  const author = info?.lastCommit?.author ?? "-";
  const date = formatVcsDate(info?.lastCommit?.date);
  const message = info?.lastCommit?.message ?? "";
  const status = info?.status;

  return (
    <button
      type="button"
      onClick={() => { void openVcsLog(path); }}
      className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-0.5 text-left text-[11px] font-normal text-gray-600 hover:bg-blue-50"
      title={`${path}\n${formatVcsSummary(info)}`}
    >
      <span className="shrink-0 font-semibold">{label}</span>
      {!info ? (
        <span className="truncate text-gray-500">版本信息读取中</span>
      ) : info.kind === "none" ? (
        <span className="truncate text-gray-500">未检测到版本库</span>
      ) : (
        <>
          <span className="shrink-0 font-mono text-gray-500">{info.kind.toUpperCase()}{source ? ` ${source}` : ""}</span>
          {status && <span className="shrink-0 rounded bg-gray-100 px-1 font-mono text-gray-600">{status}</span>}
          {readOnly && <span className="shrink-0 rounded bg-amber-50 px-1 text-amber-700">只读</span>}
          <span className="shrink-0 rounded bg-blue-50 px-1.5 font-semibold text-blue-700">{author}</span>
          <span className="shrink-0 rounded bg-emerald-50 px-1.5 font-semibold text-emerald-700">{date}</span>
          {message && <span className="min-w-0 truncate text-gray-600">{message}</span>}
        </>
      )}
    </button>
  );
}

export default function DiffView() {
  const {
    selectedFilePair, oldWorkbook, newWorkbook, currentSheet,
    diffResult, keyColumnIndices, effectiveNewRows,
    setView, setCurrentSheet, setDiffResult, setKeyColumnIndices, setHasUnsavedChanges, setEffectiveNewRows, setOldWorkbook,
  } = useDiffStore();
  const { tabs, activeTabId, activateFileListTab, updateDiffSnapshot } = useWorkspaceStore();

  const { pushEdit, undo, redo } = useEditStore();
  const canUndo = useEditStore((s) => s.undoStack.length > 0);
  const canRedo = useEditStore((s) => s.redoStack.length > 0);

  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const oldSheet = oldWorkbook?.sheets.find((s) => s.name === currentSheet);
  const newSheet = newWorkbook?.sheets.find((s) => s.name === currentSheet);

  const [leftSelected, setLeftSelected] = useState<string[]>([]);
  const [rightSelected, setRightSelected] = useState<string[]>([]);
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenuState | null>(null);
  const [detailEdit, setDetailEdit] = useState<DetailEditState | null>(null);
  const [activeDiffRowRef, setActiveDiffRowRef] = useState<string | null>(null);
  const [diffJumpSignal, setDiffJumpSignal] = useState(0);
  const [filter, setFilter] = useState<"all" | "diff" | "same" | "duplicate">("all");
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, clientHeight: 1, scrollHeight: 2 });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [showKeySelector, setShowKeySelector] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [sheetSummaries, setSheetSummaries] = useState<SheetSummary[]>([]);
  const [leftDirty, setLeftDirty] = useState(false);
  const [rightDirty, setRightDirty] = useState(false);
  const [leftVcsInfo, setLeftVcsInfo] = useState<VcsFileInfo | null>(null);
  const [rightVcsInfo, setRightVcsInfo] = useState<VcsFileInfo | null>(null);
  const [showVersionCompare, setShowVersionCompare] = useState(false);
  const hasLocalUnsavedChanges = leftDirty || rightDirty;

  const saveActiveTabSnapshot = useCallback(() => {
    const activeTab = useWorkspaceStore.getState().tabs.find((tab) => tab.id === useWorkspaceStore.getState().activeTabId);
    if (activeTab?.type !== "diff") return;
    window.setTimeout(() => {
      updateDiffSnapshot(activeTab.id, captureDiffTabSnapshot());
    }, 0);
  }, [updateDiffSnapshot]);

  // Calculate search matches
  const searchMatches = useMemo(() => {
    if (!searchText || !diffResult) return [];
    const matches: { rowRef: string; side: "old" | "new"; colIndex: number; value: string }[] = [];
    const searchLower = searchText.toLowerCase();

    for (const dr of diffResult.diffRows) {
      const rowRef = getDiffRowRef(dr);
      if (dr.oldRow) {
        for (let i = 0; i < dr.oldRow.length; i++) {
          const val = dr.oldRow[i]?.value;
          if (val != null && String(val).toLowerCase().includes(searchLower)) {
            matches.push({ rowRef, side: "old", colIndex: i, value: String(val) });
          }
        }
      }
      if (dr.newRow) {
        for (let i = 0; i < dr.newRow.length; i++) {
          const val = dr.newRow[i]?.value;
          if (val != null && String(val).toLowerCase().includes(searchLower)) {
            matches.push({ rowRef, side: "new", colIndex: i, value: String(val) });
          }
        }
      }
    }
    return matches;
  }, [searchText, diffResult]);

  // Navigate to next/prev match
  const navigateMatch = useCallback((direction: "next" | "prev") => {
    if (searchMatches.length === 0) return;
    if (direction === "next") {
      setCurrentMatchIndex((prev) => (prev + 1) % searchMatches.length);
    } else {
      setCurrentMatchIndex((prev) => (prev - 1 + searchMatches.length) % searchMatches.length);
    }
  }, [searchMatches]);

  // Refs for latest values (avoid stale closures in callbacks)
  const diffResultRef = useRef(diffResult);
  const effectiveNewRowsRef = useRef(effectiveNewRows);
  diffResultRef.current = diffResult;
  effectiveNewRowsRef.current = effectiveNewRows;

  const showSearchRef = useRef(showSearch);
  const searchTextRef = useRef(searchText);
  const leftSelectedRef = useRef(leftSelected);
  const rightSelectedRef = useRef(rightSelected);
  const filterRef = useRef(filter);
  const scrollMetricsRef = useRef(scrollMetrics);
  const columnWidthsRef = useRef(columnWidths);
  const isActiveDiffViewRef = useRef(true);
  const navigateDiffRef = useRef<(dir: "next" | "prev") => void>(() => {});
  const copyLeftToRightRef = useRef<(rowRefs: string[], mode?: CopyMode) => void>(() => {});
  const copyRightToLeftRef = useRef<(rowRefs: string[], mode?: CopyMode) => void>(() => {});
  const saveRightRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const skipDetailCommitRef = useRef(false);
  const oldGridRef = useRef<DiffGridHandle>(null);
  const newGridRef = useRef<DiffGridHandle>(null);
  const metricsTimerRef = useRef<number | null>(null);
  const pendingScrollMetricRef = useRef(0);
  const pendingScrollMetricsRef = useRef<{ scrollTop: number; clientHeight: number; scrollHeight: number } | null>(null);
  const restoredSnapshotRef = useRef(false);
  showSearchRef.current = showSearch;
  searchTextRef.current = searchText;
  leftSelectedRef.current = leftSelected;
  rightSelectedRef.current = rightSelected;
  filterRef.current = filter;
  scrollMetricsRef.current = scrollMetrics;
  columnWidthsRef.current = columnWidths;
  isActiveDiffViewRef.current = tabs.find((tab) => tab.id === activeTabId)?.type === "diff";

  useEffect(() => {
    const offCapture = onDiffTabUiStateCapture(() => ({
      showSearch: showSearchRef.current,
      searchText: searchTextRef.current,
      currentMatchIndex,
      leftSelected: leftSelectedRef.current,
      rightSelected: rightSelectedRef.current,
      activeDiffRowRef,
      filter: filterRef.current,
      scrollMetrics: scrollMetricsRef.current,
      columnWidths: columnWidthsRef.current,
    }));
    const offRestore = onDiffTabUiStateRestore((state) => {
      restoredSnapshotRef.current = true;
      if (metricsTimerRef.current !== null) {
        window.clearTimeout(metricsTimerRef.current);
        metricsTimerRef.current = null;
      }
      pendingScrollMetricsRef.current = null;
      setShowSearch(state.showSearch);
      setSearchText(state.searchText);
      setCurrentMatchIndex(state.currentMatchIndex);
      setLeftSelected(state.leftSelected);
      setRightSelected(state.rightSelected);
      setActiveDiffRowRef(null);
      setFilter(state.filter);
      setScrollMetrics(state.scrollMetrics);
      setColumnWidths(state.columnWidths);
      // Ensure the restoring flag is cleared after UI state is restored
      useDiffStore.setState({ _restoringSnapshot: false });
    });
    return () => {
      offCapture();
      offRestore();
    };
  }, [activeDiffRowRef, currentMatchIndex]);

  useEffect(() => {
    if (!rowContextMenu) return;

    const closeMenu = () => setRowContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [rowContextMenu]);

  // Initialize effective rows
  const prevSheetRef = useRef<string>("");
  useEffect(() => {
    const sheetSessionKey = `${selectedFilePair?.oldPath ?? ""}:${selectedFilePair?.newPath ?? ""}:${currentSheet}`;
    if (newSheet && sheetSessionKey !== prevSheetRef.current) {
      prevSheetRef.current = sheetSessionKey;
      if (restoredSnapshotRef.current) {
        restoredSnapshotRef.current = false;
        return;
      }
      setEffectiveNewRows(newSheet.rows.map((r) => r.map((c) => ({ ...c }))));
      useEditStore.getState().clear();
      setLeftSelected([]); setRightSelected([]);
      setActiveDiffRowRef(null);
      setScrollMetrics({ scrollTop: 0, clientHeight: 1, scrollHeight: 2 });
      setColumnWidths({});
      setLeftDirty(false);
      setRightDirty(false);
    }
  }, [newSheet, currentSheet, selectedFilePair?.oldPath, selectedFilePair?.newPath, setEffectiveNewRows]);

  useEffect(() => {
    setHasUnsavedChanges(hasLocalUnsavedChanges);
  }, [hasLocalUnsavedChanges, setHasUnsavedChanges]);

  // Recompute diff
  useEffect(() => {
    if (!oldSheet || !effectiveNewRows || !keyColumnIndices.length) return;
    const state = useDiffStore.getState();
    if (state._restoringSnapshot) {
      useDiffStore.setState({ _restoringSnapshot: false });
      return;
    }
    setDiffResult(computeDiff(oldSheet, { ...newSheet!, rows: effectiveNewRows }, keyColumnIndices));
  }, [oldSheet, effectiveNewRows, keyColumnIndices, newSheet, setDiffResult]);

  useEffect(() => {
    let cancelled = false;
    const buildSummaries = async () => {
      if (!oldWorkbook || !newWorkbook || !selectedFilePair?.newPath) {
        setSheetSummaries([]);
        return;
      }

      const commonSheets = oldWorkbook.sheetNames.filter((name) => newWorkbook.sheetNames.includes(name));
      const summaries: SheetSummary[] = [];
      for (const name of commonSheets) {
        const os = oldWorkbook.sheets.find((s) => s.name === name);
        const ns = newWorkbook.sheets.find((s) => s.name === name);
        if (!os || !ns) continue;
        let keyColumns: number[] = [];
        try {
          keyColumns = await detectKeyColumns(selectedFilePair.newPath, name);
        } catch {
          keyColumns = ns.columns.length > 0 ? [0] : [];
        }
        if (cancelled) return;
        const summaryDiff = keyColumns.length > 0 ? computeDiff(os, ns, keyColumns) : null;
        summaries.push({
          name,
          keyColumns,
          diffCount: summaryDiff
            ? summaryDiff.stats.added + summaryDiff.stats.deleted + summaryDiff.stats.modified
            : 0,
          totalRows: Math.max(os.rows.length, ns.rows.length) - 1,
        });
      }
      if (!cancelled) setSheetSummaries(summaries);
    };

    buildSummaries();
    return () => { cancelled = true; };
  }, [oldWorkbook, newWorkbook, selectedFilePair]);

  const loadVcsInfo = useCallback(async (cancelled: () => boolean) => {
    const pair = useDiffStore.getState().selectedFilePair;
    const oldPath = pair?.oldPath ?? null;
    const newPath = pair?.newPath ?? null;
    const presetOldInfo = pair?.oldVcsInfo;
    const presetNewInfo = pair?.newVcsInfo;
    setLeftVcsInfo(presetOldInfo ?? (oldPath ? null : { kind: "none", path: "" }));
    setRightVcsInfo(presetNewInfo ?? (newPath ? null : { kind: "none", path: "" }));

    const [leftResult, rightResult] = await Promise.allSettled([
      presetOldInfo ? Promise.resolve(presetOldInfo) : oldPath ? getVcsFileInfo(oldPath) : Promise.resolve(null),
      presetNewInfo ? Promise.resolve(presetNewInfo) : newPath ? getVcsFileInfo(newPath) : Promise.resolve(null),
    ]);
    if (cancelled()) return;
    if (leftResult.status === "fulfilled") {
      setLeftVcsInfo(leftResult.value);
      const currentPair = useDiffStore.getState().selectedFilePair;
      if (currentPair && currentPair.oldPath === oldPath) {
        useDiffStore.getState().selectFilePair({
          ...currentPair,
          oldVcsInfo: leftResult.value ?? undefined,
        });
      }
    }
    if (rightResult.status === "fulfilled") {
      setRightVcsInfo(rightResult.value);
      const currentPair = useDiffStore.getState().selectedFilePair;
      if (currentPair && currentPair.newPath === newPath) {
        useDiffStore.getState().selectFilePair({
          ...currentPair,
          newVcsInfo: rightResult.value ?? undefined,
        });
      }
    }
  }, [selectedFilePair?.oldPath, selectedFilePair?.newPath]);

  useEffect(() => {
    let cancelled = false;
    void loadVcsInfo(() => cancelled);
    return () => { cancelled = true; };
  }, [loadVcsInfo]);

  const refreshVcsInfo = useCallback(async () => {
    const pair = useDiffStore.getState().selectedFilePair;
    if (pair) {
      useDiffStore.getState().selectFilePair({
        ...pair,
        oldVcsInfo: undefined,
        newVcsInfo: undefined,
      });
    }
    await loadVcsInfo(() => false);
  }, [loadVcsInfo]);

  // Find row index
  const findNewRowIndex = useCallback(
    (rowRef: string): number => {
      if (!diffResult || !effectiveNewRows) return -1;
      const dr = findDiffRowByRef(diffResult, rowRef);
      if (!dr?.newRowNumber) return -1;
      const idx = dr.newRowNumber - 1;
      return idx < effectiveNewRows.length ? idx : -1;
    },
    [diffResult, effectiveNewRows]
  );

  // Keyboard shortcuts — register once, read latest values via refs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveDiffViewRef.current) return;
      const ss = showSearchRef.current;
      const st = searchTextRef.current;
      const ls = leftSelectedRef.current;
      const rs = rightSelectedRef.current;
      const selected = uniqueRowRefs(ls, rs);

      // Ctrl+F : toggle search
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        const next = !ss;
        setShowSearch(next);
        if (next) setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      // Escape : close search
      if (e.key === "Escape" && ss) { e.preventDefault(); setShowSearch(false); setSearchText(""); }
      // Enter in search : next match
      if (e.key === "Enter" && ss && st) { e.preventDefault(); navigateMatch("next"); }
      // Shift+Enter in search : prev match
      if (e.key === "Enter" && e.shiftKey && ss && st) { e.preventDefault(); navigateMatch("prev"); }
      // Ctrl+→ : copy selected left → right
      if (e.ctrlKey && e.key === "ArrowRight") { e.preventDefault(); copyLeftToRightRef.current(selected); }
      // Ctrl+← : copy selected right → left (swap + copy)
      if (e.ctrlKey && e.key === "ArrowLeft") { e.preventDefault(); copyRightToLeftRef.current(selected); }
      // Ctrl+G : next diff
      if (e.ctrlKey && !e.shiftKey && e.key === "g") { e.preventDefault(); navigateDiffRef.current("next"); }
      // Ctrl+Shift+G : prev diff
      if (e.ctrlKey && e.shiftKey && e.key === "G") { e.preventDefault(); navigateDiffRef.current("prev"); }
      // Ctrl+B : filter diffs
      if (e.ctrlKey && e.key === "b") { e.preventDefault(); setFilter((f) => f === "diff" ? "all" : "diff"); }
      // Ctrl+S : save
      if (e.ctrlKey && e.key === "s") { e.preventDefault(); saveRightRef.current(); }
      // Ctrl+Z : undo
      if (e.ctrlKey && !e.shiftKey && e.key === "z") { e.preventDefault(); undoRef.current(); }
      // Ctrl+Y or Ctrl+Shift+Z : redo
      if ((e.ctrlKey && e.key === "y") || (e.ctrlKey && e.shiftKey && e.key === "Z")) { e.preventDefault(); redoRef.current(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Key column change handler
  const handleKeyColumnApply = useCallback(
    (indices: number[]) => {
      useDiffStore.getState().setKeyColumnIndices(indices);
      useEditStore.getState().clear();
      // Trigger re-diff by updating effectiveNewRows (force recompute)
      if (effectiveNewRows) {
        setEffectiveNewRows(effectiveNewRows.map((r) => r.map((c) => ({ ...c }))));
      }
    },
    [effectiveNewRows, setEffectiveNewRows]
  );

  const diffBlocks = useMemo<DiffBlock[]>(() => {
    if (!diffResult) return [];

    const blocks: DiffBlock[] = [];
    let current: DiffBlock | null = null;

    for (const row of diffResult.diffRows) {
      if (row.status === "unchanged") {
        current = null;
        continue;
      }

      const rowRef = getDiffRowRef(row);
      const rowIndex = row.viewIndex;
      if (current && rowIndex === current.endIndex + 1) {
        current.endIndex = rowIndex;
        continue;
      }

      current = {
        id: `${rowRef}:${blocks.length}`,
        startIndex: rowIndex,
        endIndex: rowIndex,
        startRef: rowRef,
      };
      blocks.push(current);
    }

    return blocks;
  }, [diffResult]);

  const findDiffBlockIndexByRef = useCallback(
    (rowRef: string | null | undefined): number => {
      if (!rowRef || !diffResult) return -1;
      const row = findDiffRowByRef(diffResult, rowRef);
      if (!row || row.status === "unchanged") return -1;
      return diffBlocks.findIndex((block) => row.viewIndex >= block.startIndex && row.viewIndex <= block.endIndex);
    },
    [diffBlocks, diffResult]
  );

  const scrollBothGridsToRowRef = useCallback((rowRef: string) => {
    window.requestAnimationFrame(() => {
      oldGridRef.current?.scrollToRowRef(rowRef);
      newGridRef.current?.scrollToRowRef(rowRef);
    });
  }, []);

  const jumpToDiffBlock = useCallback((block: DiffBlock) => {
    setActiveDiffRowRef(block.startRef);
    setDiffJumpSignal((value) => value + 1);
    scrollBothGridsToRowRef(block.startRef);
  }, [scrollBothGridsToRowRef]);

  // Navigate to next/prev diff
  const navigateDiff = useCallback(
    (dir: "next" | "prev") => {
      if (diffBlocks.length === 0) return;

      // Find current selection
      const currentRef = activeDiffRowRef || leftSelected[0] || rightSelected[0];
      const idx = findDiffBlockIndexByRef(currentRef);
      const nextIdx = dir === "next"
        ? (idx + 1) % diffBlocks.length
        : (idx - 1 + diffBlocks.length) % diffBlocks.length;
      setActiveDiffRowRef(diffBlocks[nextIdx].startRef);
      setDiffJumpSignal((value) => value + 1);
      scrollBothGridsToRowRef(diffBlocks[nextIdx].startRef);
    },
    [activeDiffRowRef, diffBlocks, findDiffBlockIndexByRef, leftSelected, rightSelected, scrollBothGridsToRowRef]
  );
  navigateDiffRef.current = navigateDiff;

  const handleBack = useCallback(async () => {
    if (hasLocalUnsavedChanges && !window.confirm("有未保存的更改，确定要返回吗？")) return;
    const relativePath = selectedFilePair?.relativePath;
    const { oldDir, newDir, setOldFiles, setNewFiles, buildFilePairs } = useDiffStore.getState();
    if (oldDir) { try { setOldFiles(await listExcelFiles(oldDir)); } catch {} }
    if (newDir) { try { setNewFiles(await listExcelFiles(newDir)); } catch {} }
    await buildFilePairs();
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    activateFileListTab(activeTab?.type === "diff" ? activeTab.parentTabId : undefined);
    setView("directory");
    if (relativePath) {
      window.setTimeout(() => {
        void refreshAndVerifyFilePair(relativePath);
      }, 0);
    }
  }, [activateFileListTab, activeTabId, setView, hasLocalUnsavedChanges, selectedFilePair, refreshAndVerifyFilePair, tabs]);

  async function refreshAndVerifyFilePair(relativePath: string) {
    const { oldDir, newDir, setOldFiles, setNewFiles, buildFilePairs, verifyFilePair } = useDiffStore.getState();
    if (oldDir) { try { setOldFiles(await listExcelFiles(oldDir)); } catch {} }
    if (newDir) { try { setNewFiles(await listExcelFiles(newDir)); } catch {} }
    await buildFilePairs();
    await verifyFilePair(relativePath, true);
  }

  const markCurrentFileStatus = useCallback((diffStatus: "identical" | "different" | "unknown") => {
    if (!selectedFilePair) return;
    useDiffStore.getState().markFileStatus(selectedFilePair.relativePath, diffStatus);
  }, [selectedFilePair]);

  const isRightDirty = useCallback(
    (rows: Row[] | null): boolean => {
      if (!rows || !newWorkbook) return false;
      const baseline = newWorkbook.sheets.find((s) => s.name === currentSheet)?.rows;
      if (!baseline) return false;
      return !rowsEqual(rows, baseline);
    },
    [currentSheet, newWorkbook]
  );

  const handleSheetChange = useCallback(
    async (sheetName: string) => {
      if (sheetName === currentSheet) return;
      if (hasLocalUnsavedChanges && !window.confirm("当前表有未保存的更改，确定要切换吗？")) return;
      setCurrentSheet(sheetName);
      useEditStore.getState().clear();
      setLeftSelected([]);
        setRightSelected([]);
        setActiveDiffRowRef(null);
        setScrollMetrics({ scrollTop: 0, clientHeight: 1, scrollHeight: 2 });
        setColumnWidths({});
        setLeftDirty(false);
        setRightDirty(false);

      const cached = sheetSummaries.find((summary) => summary.name === sheetName);
      if (cached) {
        setKeyColumnIndices(cached.keyColumns);
        return;
      }

      if (selectedFilePair?.newPath) {
        try {
          setKeyColumnIndices(await detectKeyColumns(selectedFilePair.newPath, sheetName));
        } catch {
          setKeyColumnIndices([]);
        }
      }
    },
    [currentSheet, hasLocalUnsavedChanges, selectedFilePair, setCurrentSheet, setKeyColumnIndices, sheetSummaries]
  );

  const handleScrollMetrics = useCallback((metrics: { scrollTop: number; clientHeight: number; scrollHeight: number }) => {
    pendingScrollMetricRef.current = metrics.scrollTop;
    pendingScrollMetricsRef.current = metrics;
    if (metricsTimerRef.current !== null) return;
    metricsTimerRef.current = window.setTimeout(() => {
      metricsTimerRef.current = null;
      const pending = pendingScrollMetricsRef.current;
      if (!pending) return;
      setScrollMetrics((prev) => {
        if (Math.abs(prev.scrollTop - pendingScrollMetricRef.current) <= 1 && prev.clientHeight === pending.clientHeight && prev.scrollHeight === pending.scrollHeight) return prev;
        return { ...pending, scrollTop: pendingScrollMetricRef.current };
      });
    }, METRICS_UPDATE_INTERVAL_MS);
  }, []);

  useEffect(() => () => {
    if (metricsTimerRef.current !== null) {
      window.clearTimeout(metricsTimerRef.current);
    }
  }, []);

  const handleGridScroll = useCallback((scrollTop: number, scrollLeft: number, _rowIndex: number, source: "old" | "new") => {
    const targetGrid = source === "old" ? newGridRef.current : oldGridRef.current;
    targetGrid?.syncScroll(scrollTop, scrollLeft);
  }, []);

  // Copy left → right (old values overwrite new)
  const restoreGridScrollAfterDataUpdate = useCallback(() => {
    const position = newGridRef.current?.getScrollPosition() ?? oldGridRef.current?.getScrollPosition();
    if (!position) return;
    const restore = () => {
      oldGridRef.current?.syncScroll(position.top, position.left);
      newGridRef.current?.syncScroll(position.top, position.left);
    };
    let frame = 0;
    const restoreNextFrame = () => {
      restore();
      frame += 1;
      if (frame < 6) window.requestAnimationFrame(restoreNextFrame);
    };
    window.requestAnimationFrame(restoreNextFrame);
    window.setTimeout(restore, 120);
  }, []);

  const handleCopyLeftToRight = useCallback(
    (rowRefs: string[], mode: CopyMode = "all") => {
      const dr = diffResultRef.current;
      const rows = effectiveNewRowsRef.current;
      if (!dr || !rows || rowRefs.length === 0) return;

      const originalRows = rows.map((r) => r.map((c) => ({ ...c })));
      const localRows = rows.map((r) => r.map((c) => ({ ...c })));
      const undoChanges: CellChange[] = [];
      const redoChanges: CellChange[] = [];
      let copiedRows = 0;
      const orderedRowRefs = [...rowRefs].sort((a, b) => {
        const rowA = findDiffRowByRef(dr, a);
        const rowB = findDiffRowByRef(dr, b);
        const isRightOnlyA = rowA?.status === "added" && !rowA.oldRow;
        const isRightOnlyB = rowB?.status === "added" && !rowB.oldRow;
        const isLeftOnlyA = rowA?.status === "deleted" && !rowA.newRow;
        const isLeftOnlyB = rowB?.status === "deleted" && !rowB.newRow;
        const structuralA = isRightOnlyA || isLeftOnlyA;
        const structuralB = isRightOnlyB || isLeftOnlyB;
        if (!structuralA && structuralB) return -1;
        if (structuralA && !structuralB) return 1;
        if (structuralA && structuralB) {
          const targetA = isRightOnlyA
            ? (rowA?.newRowNumber ?? localRows.length + 1) - 1
            : findVisualInsertIndex(dr.diffRows, a, "new", rowA?.oldRowNumber, localRows.length);
          const targetB = isRightOnlyB
            ? (rowB?.newRowNumber ?? localRows.length + 1) - 1
            : findVisualInsertIndex(dr.diffRows, b, "new", rowB?.oldRowNumber, localRows.length);
          if (targetA !== targetB) return targetB - targetA;
          if (isRightOnlyA && isLeftOnlyB) return -1;
          if (isLeftOnlyA && isRightOnlyB) return 1;
        }
        if (isLeftOnlyA) return -1;
        if (isLeftOnlyB) return 1;
        if (isRightOnlyA) return -1;
        if (isRightOnlyB) return 1;
        return 0;
      });

      for (const rowRef of orderedRowRefs) {
        const beforeChangeCount = undoChanges.length;
        const diffRow = findDiffRowByRef(dr, rowRef);
        if (!diffRow || !shouldCopyLeftToRight(diffRow, mode)) continue;
        const key = diffRow.key;

        if (!diffRow.oldRow && diffRow.newRow && mode === "all") {
          const idx = diffRow.newRowNumber ? diffRow.newRowNumber - 1 : -1;
          if (idx < 0 || idx >= localRows.length) continue;
          const removedRow = localRows.splice(idx, 1)[0];
          undoChanges.push({ rowKey: key, rowRef, columnIndex: -3, value: JSON.stringify(removedRow), formula: String(idx) });
          redoChanges.push({ rowKey: key, rowRef, columnIndex: -4, value: null, formula: String(idx) });
          copiedRows++;
          continue;
        }

        const oldRow = diffRow.oldRow;
        if (!oldRow) continue;

        if (diffRow.newRow) {
          // Row exists on right → overwrite cells
          const idx = diffRow.newRowNumber ? diffRow.newRowNumber - 1 : -1;
          if (idx < 0) continue;
          // Copy all old values to new row
          const colsToCopy = mode === "modified"
            ? diffRow.cellDiffs.map((d) => d.columnIndex)
            : Array.from({ length: oldRow.length }, (_, col) => col);
          for (const col of colsToCopy) {
            const targetCell = oldRow[col];
            const currentCell = localRows[idx]?.[col];
            const currentValue = currentCell?.value ?? null;
            const currentFormula = currentCell?.formula;
            const targetValue = targetCell?.value ?? null;
            const targetFormula = targetCell?.formula;

            if (!cellDataEqual(currentCell, targetCell)) {
              undoChanges.push({ rowKey: key, rowRef, columnIndex: col, value: currentValue, formula: currentFormula });
              redoChanges.push({ rowKey: key, rowRef, columnIndex: col, value: targetValue, formula: targetFormula });
              while (localRows[idx].length <= col) localRows[idx].push({ value: null });
              localRows[idx][col] = { ...targetCell };
            }
          }
          // Clear extra columns on right that don't exist on left
          if (mode === "all") {
            for (let col = oldRow.length; col < localRows[idx].length; col++) {
              const currentCell = localRows[idx][col];
              if (currentCell?.value !== null || currentCell?.formula !== undefined) {
                undoChanges.push({ rowKey: key, rowRef, columnIndex: col, value: currentCell?.value ?? null, formula: currentCell?.formula });
                redoChanges.push({ rowKey: key, rowRef, columnIndex: col, value: null });
                localRows[idx][col] = { value: null };
              }
            }
          }
        } else {
          // Row only on left → insert
          const insertIdx = findVisualInsertIndex(dr.diffRows, rowRef, "new", diffRow.oldRowNumber, localRows.length);
          undoChanges.push({ rowKey: key, rowRef, columnIndex: -1, value: null, formula: String(insertIdx) });
          redoChanges.push({ rowKey: key, rowRef, columnIndex: -2, value: JSON.stringify(oldRow), formula: String(insertIdx) });
          if (rowIsEmpty(localRows[insertIdx])) {
            localRows[insertIdx] = oldRow.map((c) => ({ ...c }));
          } else {
            localRows.splice(insertIdx, 0, oldRow.map((c) => ({ ...c })));
          }
        }
        if (undoChanges.length > beforeChangeCount) copiedRows++;
      }

      if (undoChanges.length > 0) {
        pushEdit({ type: "batch-copy", undoPayload: [{ rowKey: "__right_rows__", columnIndex: RIGHT_ROWS_SNAPSHOT, value: JSON.stringify(originalRows) }], redoPayload: [{ rowKey: "__right_rows__", columnIndex: RIGHT_ROWS_SNAPSHOT, value: JSON.stringify(localRows) }], description: `左→右 ${copiedRows}行` });
        restoreGridScrollAfterDataUpdate();
        setEffectiveNewRows(localRows);
        setRightDirty(isRightDirty(localRows));
      }
    },
    [pushEdit, restoreGridScrollAfterDataUpdate, setEffectiveNewRows, isRightDirty]
  );
  copyLeftToRightRef.current = handleCopyLeftToRight;

  // Copy right → left (stage new values into the left workbook)
  const handleCopyRightToLeft = useCallback(
    (rowRefs: string[], mode: CopyMode = "all") => {
      if (!diffResult || !effectiveNewRows || !oldWorkbook || rowRefs.length === 0) return;

      const oldSheetData = oldWorkbook.sheets.find((s) => s.name === currentSheet);
      if (!oldSheetData) return;

      // Build modified old rows
      const originalOldRows = oldSheetData.rows.map((r) => r.map((c) => ({ ...c })));
      const modifiedOldRows = oldSheetData.rows.map((r) => r.map((c) => ({ ...c })));
      let copiedRows = 0;
      const orderedRowRefs = [...rowRefs].sort((a, b) => {
        const rowA = findDiffRowByRef(diffResult, a);
        const rowB = findDiffRowByRef(diffResult, b);
        const isAddedA = !!rowA?.newRow && !rowA.oldRow;
        const isAddedB = !!rowB?.newRow && !rowB.oldRow;
        if (isAddedA && isAddedB) return (rowB?.newRowNumber ?? 0) - (rowA?.newRowNumber ?? 0);
        if (isAddedA) return 1;
        if (isAddedB) return -1;
        return 0;
      });

      for (const rowRef of orderedRowRefs) {
        const dr = findDiffRowByRef(diffResult, rowRef);
        if (!dr || !shouldCopyRightToLeft(dr, mode)) continue;

        const idx = dr.oldRowNumber ? dr.oldRowNumber - 1 : -1;
        if (idx < 0) {
          if (dr.newRow && (mode === "all" || mode === "added")) {
            const insertIdx = findVisualInsertIndex(diffResult.diffRows, rowRef, "old", dr.newRowNumber, modifiedOldRows.length);
            if (rowIsEmpty(modifiedOldRows[insertIdx])) {
              modifiedOldRows[insertIdx] = dr.newRow.map((c) => ({ ...c }));
            } else {
              modifiedOldRows.splice(insertIdx, 0, dr.newRow.map((c) => ({ ...c })));
            }
            copiedRows++;
          }
          continue;
        }

        if (dr.newRow) {
          // Row exists on right → overwrite with new values
          const colsToCopy = mode === "modified"
            ? dr.cellDiffs.map((d) => d.columnIndex)
            : Array.from({ length: dr.newRow.length }, (_, col) => col);
          for (const col of colsToCopy) {
            while (modifiedOldRows[idx].length <= col) modifiedOldRows[idx].push({ value: null });
            modifiedOldRows[idx][col] = { ...dr.newRow[col] };
          }
          copiedRows++;
        } else {
          // Row only on left (deleted) → clear all cells
          if (mode === "all") {
            for (let col = 0; col < modifiedOldRows[idx].length; col++) {
              modifiedOldRows[idx][col] = { value: null };
            }
            copiedRows++;
          }
        }
      }

      if (copiedRows === 0) return;

      const sheets = oldWorkbook.sheets.map((s) => {
        if (s.name === currentSheet) return { ...s, rows: modifiedOldRows };
        return s;
      });
      pushEdit({
        type: "batch-copy",
        undoPayload: [{ rowKey: "__left_rows__", columnIndex: LEFT_ROWS_SNAPSHOT, value: JSON.stringify(originalOldRows) }],
        redoPayload: [{ rowKey: "__left_rows__", columnIndex: LEFT_ROWS_SNAPSHOT, value: JSON.stringify(modifiedOldRows) }],
        description: `右→左 ${copiedRows}行`,
      });
      restoreGridScrollAfterDataUpdate();
      setOldWorkbook({ ...oldWorkbook, sheets });
      setLeftSelected([]);
      setRightSelected([]);
      setLeftDirty(true);
    },
    [diffResult, effectiveNewRows, oldWorkbook, currentSheet, pushEdit, restoreGridScrollAfterDataUpdate, setOldWorkbook]
  );
  copyRightToLeftRef.current = handleCopyRightToLeft;

  const handleRowContextMenu = useCallback((side: "old" | "new", rowRef: string, x: number, y: number) => {
    const menuWidth = 150;
    const menuHeight = 42;
    setRowContextMenu({
      side,
      rowRef,
      x: Math.min(x, window.innerWidth - menuWidth - 8),
      y: Math.min(y, window.innerHeight - menuHeight - 8),
    });
  }, []);

  const handleCopyContextRow = useCallback(() => {
    if (!rowContextMenu) return;

    const sideSelection = rowContextMenu.side === "old" ? leftSelected : rightSelected;
    const rowRefs = sideSelection.includes(rowContextMenu.rowRef) && sideSelection.length > 0
      ? sideSelection
      : [rowContextMenu.rowRef];

    if (rowContextMenu.side === "old") {
      handleCopyLeftToRight(rowRefs);
    } else {
      handleCopyRightToLeft(rowRefs);
    }
    setRowContextMenu(null);
  }, [handleCopyLeftToRight, handleCopyRightToLeft, leftSelected, rightSelected, rowContextMenu]);

  // Cell edit
  const handleLeftCellEdit = useCallback(
    (rowRef: string, colIndex: number, oldValue: CellValue, newValue: CellValue, oldFormula?: string, newFormula?: string) => {
      if ((oldValue === newValue && oldFormula === newFormula) || !oldWorkbook) return;
      const diffRow = findDiffRowByRef(diffResult, rowRef);
      if (!diffRow?.oldRowNumber) return;
      const rowIndex = diffRow.oldRowNumber - 1;

      const sheets = oldWorkbook.sheets.map((sheet) => {
        if (sheet.name !== currentSheet) return sheet;
        const rows = sheet.rows.map((row, index) => {
          if (index !== rowIndex) return row;
          const updated = row.map((cell) => ({ ...cell }));
          while (updated.length <= colIndex) updated.push({ value: null });
          updated[colIndex] = { value: newValue, formula: newFormula };
          return updated;
        });
        return { ...sheet, rows };
      });

      setOldWorkbook({ ...oldWorkbook, sheets });
      setLeftDirty(true);
    },
    [currentSheet, diffResult, oldWorkbook, setOldWorkbook]
  );

  const handleCellEdit = useCallback(
    (rowRef: string, colIndex: number, oldValue: CellValue, newValue: CellValue, oldFormula?: string, newFormula?: string) => {
      if ((oldValue === newValue && oldFormula === newFormula) || !effectiveNewRows) return;
      const diffRow = findDiffRowByRef(diffResult, rowRef);
      if (!diffRow) return;
      const idx = findNewRowIndex(rowRef);
      if (idx < 0) return;
      pushEdit({
        type: "cell-edit",
        undoPayload: [{ rowKey: diffRow.key, rowRef, columnIndex: colIndex, value: oldValue, formula: oldFormula }],
        redoPayload: [{ rowKey: diffRow.key, rowRef, columnIndex: colIndex, value: newValue, formula: newFormula }],
        description: "编辑"
      });
      const newRows = effectiveNewRows.map((row, i) => {
        if (i !== idx) return row;
        const updated = row.map((c) => ({ ...c }));
        while (updated.length <= colIndex) updated.push({ value: null });
        updated[colIndex] = { value: newValue, formula: newFormula };
        return updated;
      });
      setEffectiveNewRows(newRows);
      setRightDirty(true);
    },
    [diffResult, effectiveNewRows, findNewRowIndex, pushEdit, setEffectiveNewRows]
  );

  const startDetailEdit = useCallback((side: "old" | "new", rowRef: string, columnIndex: number, cell: CellData | undefined) => {
    skipDetailCommitRef.current = false;
    setDetailEdit({
      side,
      rowRef,
      columnIndex,
      value: cellValueToEditText(cell),
    });
  }, []);

  const cancelDetailEdit = useCallback(() => {
    skipDetailCommitRef.current = true;
    setDetailEdit(null);
  }, []);

  const commitDetailEdit = useCallback(() => {
    if (skipDetailCommitRef.current) {
      skipDetailCommitRef.current = false;
      return;
    }
    if (!detailEdit) return;
    const row = findDiffRowByRef(diffResult, detailEdit.rowRef);
    if (!row) {
      setDetailEdit(null);
      return;
    }

    const sourceRow = detailEdit.side === "old" ? row.oldRow : row.newRow;
    const oldCell = sourceRow?.[detailEdit.columnIndex];
    const parsed = parseEditedCellValue(detailEdit.value);
    if ((oldCell?.value ?? null) === parsed.value && oldCell?.formula === parsed.formula) {
      skipDetailCommitRef.current = true;
      setDetailEdit(null);
      return;
    }

    if (detailEdit.side === "old") {
      if (!oldWorkbook || !row.oldRowNumber) {
        skipDetailCommitRef.current = true;
        setDetailEdit(null);
        return;
      }
      const oldSheetData = oldWorkbook.sheets.find((s) => s.name === currentSheet);
      if (!oldSheetData) {
        skipDetailCommitRef.current = true;
        setDetailEdit(null);
        return;
      }
      const originalRows = oldSheetData.rows.map((r) => r.map((c) => ({ ...c })));
      const nextRows = oldSheetData.rows.map((r) => r.map((c) => ({ ...c })));
      const rowIndex = row.oldRowNumber - 1;
      while (nextRows[rowIndex].length <= detailEdit.columnIndex) nextRows[rowIndex].push({ value: null });
      nextRows[rowIndex][detailEdit.columnIndex] = { value: parsed.value, formula: parsed.formula };
      pushEdit({
        type: "cell-edit",
        undoPayload: [{ rowKey: "__left_rows__", columnIndex: LEFT_ROWS_SNAPSHOT, value: JSON.stringify(originalRows) }],
        redoPayload: [{ rowKey: "__left_rows__", columnIndex: LEFT_ROWS_SNAPSHOT, value: JSON.stringify(nextRows) }],
        description: "编辑左侧详情",
      });
      const sheets = oldWorkbook.sheets.map((s) => s.name === currentSheet ? { ...s, rows: nextRows } : s);
      setOldWorkbook({ ...oldWorkbook, sheets });
      setLeftDirty(true);
    } else {
      if (!effectiveNewRows || !row.newRowNumber) {
        skipDetailCommitRef.current = true;
        setDetailEdit(null);
        return;
      }
      const originalRows = effectiveNewRows.map((r) => r.map((c) => ({ ...c })));
      const nextRows = effectiveNewRows.map((r) => r.map((c) => ({ ...c })));
      const rowIndex = row.newRowNumber - 1;
      while (nextRows[rowIndex].length <= detailEdit.columnIndex) nextRows[rowIndex].push({ value: null });
      nextRows[rowIndex][detailEdit.columnIndex] = { value: parsed.value, formula: parsed.formula };
      pushEdit({
        type: "cell-edit",
        undoPayload: [{ rowKey: "__right_rows__", columnIndex: RIGHT_ROWS_SNAPSHOT, value: JSON.stringify(originalRows) }],
        redoPayload: [{ rowKey: "__right_rows__", columnIndex: RIGHT_ROWS_SNAPSHOT, value: JSON.stringify(nextRows) }],
        description: "编辑右侧详情",
      });
      setEffectiveNewRows(nextRows);
      setRightDirty(isRightDirty(nextRows));
    }
    skipDetailCommitRef.current = true;
    setDetailEdit(null);
  }, [currentSheet, detailEdit, diffResult, effectiveNewRows, isRightDirty, oldWorkbook, pushEdit, setEffectiveNewRows, setOldWorkbook]);

  // Undo
  const handleUndo = useCallback(() => {
    if (!isActiveDiffViewRef.current) return;
    const op = undo(); if (!op || !effectiveNewRows) return;
    const rightSnapshot = op.undoPayload.find((c) => c.columnIndex === RIGHT_ROWS_SNAPSHOT);
    if (rightSnapshot) {
      const restoredRows = (JSON.parse(rightSnapshot.value as string) as Row[]).map((r) => r.map((c) => ({ ...c })));
      setEffectiveNewRows(restoredRows);
      setRightDirty(isRightDirty(restoredRows));
      saveActiveTabSnapshot();
      return;
    }

    const leftSnapshot = op.undoPayload.find((c) => c.columnIndex === LEFT_ROWS_SNAPSHOT);
    if (leftSnapshot && oldWorkbook) {
      const restoredRows = (JSON.parse(leftSnapshot.value as string) as Row[]).map((r) => r.map((c) => ({ ...c })));
      const sheets = oldWorkbook.sheets.map((s) => s.name === currentSheet ? { ...s, rows: restoredRows } : s);
      setOldWorkbook({ ...oldWorkbook, sheets });
      setLeftDirty(true);
      saveActiveTabSnapshot();
      return;
    }

    const localRows = effectiveNewRows.map((r) => r.map((c) => ({ ...c })));
    for (const c of op.undoPayload) {
      if (c.columnIndex === -1) {
        const idx = Number(c.formula ?? localRows.length - 1);
        if (idx >= 0 && idx < localRows.length) localRows.splice(idx, 1);
        else localRows.pop();
      }
      else if (c.columnIndex === -3) {
        const rowData = JSON.parse(c.value as string);
        const idx = Math.max(0, Math.min(localRows.length, Number(c.formula ?? localRows.length)));
        localRows.splice(idx, 0, rowData.map((cell: CellData) => ({ ...cell })));
      }
      else if (c.columnIndex >= 0) {
        const dr = c.rowRef
          ? findDiffRowByRef(diffResult ?? null, c.rowRef)
          : diffResult?.diffRows.find((r) => r.key === c.rowKey);
        if (!dr) continue;
        const idx = dr.newRowNumber ? dr.newRowNumber - 1 : -1;
        if (idx >= 0 && idx < localRows.length) {
          while (localRows[idx].length <= c.columnIndex) localRows[idx].push({ value: null });
          localRows[idx][c.columnIndex] = { value: c.value, formula: c.formula };
        }
      }
    }
    setEffectiveNewRows(localRows);
    setRightDirty(isRightDirty(localRows));
    saveActiveTabSnapshot();
  }, [undo, effectiveNewRows, diffResult, oldWorkbook, currentSheet, setEffectiveNewRows, setOldWorkbook, isRightDirty, saveActiveTabSnapshot]);
  undoRef.current = handleUndo;

  // Redo
  const handleRedo = useCallback(() => {
    if (!isActiveDiffViewRef.current) return;
    const op = redo(); if (!op || !effectiveNewRows) return;
    const rightSnapshot = op.redoPayload.find((c) => c.columnIndex === RIGHT_ROWS_SNAPSHOT);
    if (rightSnapshot) {
      const restoredRows = (JSON.parse(rightSnapshot.value as string) as Row[]).map((r) => r.map((c) => ({ ...c })));
      setEffectiveNewRows(restoredRows);
      setRightDirty(isRightDirty(restoredRows));
      saveActiveTabSnapshot();
      return;
    }

    const leftSnapshot = op.redoPayload.find((c) => c.columnIndex === LEFT_ROWS_SNAPSHOT);
    if (leftSnapshot && oldWorkbook) {
      const restoredRows = (JSON.parse(leftSnapshot.value as string) as Row[]).map((r) => r.map((c) => ({ ...c })));
      const sheets = oldWorkbook.sheets.map((s) => s.name === currentSheet ? { ...s, rows: restoredRows } : s);
      setOldWorkbook({ ...oldWorkbook, sheets });
      setLeftDirty(true);
      saveActiveTabSnapshot();
      return;
    }

    const localRows = effectiveNewRows.map((r) => r.map((c) => ({ ...c })));
    for (const c of op.redoPayload) {
      if (c.columnIndex === -2) {
        const rowData = JSON.parse(c.value as string);
        const idx = Math.max(0, Math.min(localRows.length, Number(c.formula ?? localRows.length)));
        localRows.splice(idx, 0, rowData.map((cell: CellData) => ({ ...cell })));
      }
      else if (c.columnIndex === -4) {
        const idx = Number(c.formula ?? -1);
        if (idx >= 0 && idx < localRows.length) localRows.splice(idx, 1);
      }
      else if (c.columnIndex >= 0) {
        const dr = c.rowRef
          ? findDiffRowByRef(diffResult ?? null, c.rowRef)
          : diffResult?.diffRows.find((r) => r.key === c.rowKey);
        if (!dr) continue;
        const idx = dr.newRowNumber ? dr.newRowNumber - 1 : -1;
        if (idx >= 0 && idx < localRows.length) {
          while (localRows[idx].length <= c.columnIndex) localRows[idx].push({ value: null });
          localRows[idx][c.columnIndex] = { value: c.value, formula: c.formula };
        }
      }
    }
    setEffectiveNewRows(localRows);
    setRightDirty(isRightDirty(localRows));
    saveActiveTabSnapshot();
  }, [redo, effectiveNewRows, diffResult, oldWorkbook, currentSheet, setEffectiveNewRows, setOldWorkbook, isRightDirty, saveActiveTabSnapshot]);
  redoRef.current = handleRedo;

  // Save
  // Save right side — incremental (only changed cells)
  const handleSaveRight = useCallback(async () => {
    if (!newWorkbook || !effectiveNewRows || !selectedFilePair?.newPath) return;
    try {
      const origSheet = newWorkbook.sheets.find((s) => s.name === currentSheet);
      if (!origSheet) return;

      // Compute cell-level changes
      const changes: Array<{ row: number; col: number; value: any; formula?: string }> = [];
      const insertRows: Row[] = [];
      const deleteRows: number[] = [];

      for (let ri = 1; ri < effectiveNewRows.length; ri++) {
        const newRow = effectiveNewRows[ri];
        const origRow = ri < origSheet.rows.length ? origSheet.rows[ri] : null;

        if (!origRow) {
          // New row — append
          insertRows.push(newRow);
          continue;
        }

        const maxCols = Math.max(newRow.length, origRow.length);
        for (let ci = 0; ci < maxCols; ci++) {
          const newCell = ci < newRow.length ? (newRow[ci] ?? { value: null }) : { value: null };
          const origCell = ci < origRow.length ? (origRow[ci] ?? { value: null }) : { value: null };
          const nv = newCell.value ?? null;
          const nf = newCell.formula;
          if (!cellDataEqual(origCell, newCell)) {
            changes.push({ row: ri + 1, col: ci + 1, value: nv, formula: nf }); // 1-based
          }
        }
      }
      for (let ri = effectiveNewRows.length; ri < origSheet.rows.length; ri++) {
        deleteRows.push(ri + 1);
      }

      // If no changes and no inserts, skip write
      if (changes.length === 0 && insertRows.length === 0 && deleteRows.length === 0) {
        setRightDirty(false);
        useEditStore.getState().clear();
        return;
      }

      const changesData = {
        sheets: [{
          name: currentSheet,
          changes,
          insert_rows: insertRows,
          delete_rows: deleteRows,
        }]
      };

      await writeExcelChanges(selectedFilePair.newPath, JSON.stringify(changesData));

      const { newWorkbook: currentWb, setNewWorkbook } = useDiffStore.getState();
      if (currentWb) {
        setNewWorkbook({
          ...currentWb,
          sheets: currentWb.sheets.map((sheet) =>
            sheet.name === currentSheet ? { ...sheet, rows: effectiveNewRows } : sheet
          ),
        });
      }
      setEffectiveNewRows(effectiveNewRows.map((r) => r.map((c) => ({ ...c }))));
      const postSaveDiff = oldSheet && newSheet && keyColumnIndices.length > 0
        ? computeDiff(oldSheet, { ...newSheet, rows: effectiveNewRows }, keyColumnIndices)
        : diffResult;
      setRightDirty(false);
      useEditStore.getState().clear();
      markCurrentFileStatus(postSaveDiff?.stats.added === 0 && postSaveDiff.stats.deleted === 0 && postSaveDiff.stats.modified === 0 ? "identical" : "different");
      await refreshVcsInfo();
      alert("右侧保存成功！");
    } catch (e: any) { setError({ title: "保存失败", message: e?.message || String(e) }); }
  }, [newWorkbook, effectiveNewRows, selectedFilePair, currentSheet, setEffectiveNewRows, markCurrentFileStatus, diffResult, oldSheet, newSheet, keyColumnIndices, refreshVcsInfo]);
  saveRightRef.current = handleSaveRight;

  // Save left side (old data)
  const handleSaveLeft = useCallback(async () => {
    if (!oldWorkbook || !selectedFilePair?.oldPath) return;
    try {
      await writeExcel(selectedFilePair.oldPath, oldWorkbook.sheets);

      const freshWb = await readExcel(selectedFilePair.oldPath);
      useDiffStore.getState().setOldWorkbook(freshWb);
      setLeftDirty(false);
      useEditStore.getState().clear();
      await refreshAndVerifyFilePair(selectedFilePair.relativePath);
      await refreshVcsInfo();
      alert("左侧保存成功！");
    } catch (e: any) { setError({ title: "保存失败", message: e?.message || String(e) }); }
  }, [oldWorkbook, selectedFilePair, refreshAndVerifyFilePair, refreshVcsInfo]);

  // Export diff report as CSV
  const handleExport = useCallback(async () => {
    if (!diffResult || !oldSheet) return;
    const colNames = oldSheet.columns.map((c) => c.name);

    const rows: string[] = [];
    // Header
    rows.push(["行号", "状态", "关键值", ...colNames.map((n) => `左_${n}`), ...colNames.map((n) => `右_${n}`), "差异列"].join(","));

    for (const dr of diffResult.diffRows) {
      const statusMap: Record<string, string> = {
        unchanged: "未变", modified: "差异", added: "差异", deleted: "差异"
      };
      const status = statusMap[dr.status] || dr.status;
      const oldVals = colNames.map((_, i) => {
        const v = dr.oldRow?.[i]?.value;
        if (v === null || v === undefined) return "";
        const s = String(v);
        return s.includes(",") ? `"${s}"` : s;
      });
      const newVals = colNames.map((_, i) => {
        const v = dr.newRow?.[i]?.value;
        if (v === null || v === undefined) return "";
        const s = String(v);
        return s.includes(",") ? `"${s}"` : s;
      });
      const diffCols = dr.cellDiffs.map((d) => colNames[d.columnIndex] || `列${d.columnIndex + 1}`).join(";");

      rows.push([dr.viewIndex + 1, status, dr.key, ...oldVals, ...newVals, diffCols].join(","));
    }

    const csv = "﻿" + rows.join("\n"); // BOM for Excel Chinese support
    const defaultName = `diff_report_${selectedFilePair?.filename || "report"}.csv`;
    const savePath = await pickSavePath(defaultName);
    if (savePath) {
      await saveTextFile(savePath, csv);
      alert(`报告已导出到:\n${savePath}`);
    }
  }, [diffResult, oldSheet, selectedFilePair]);

  if (!selectedFilePair) return <div className="p-8 text-gray-500">未选择文件</div>;

  // Single-side file (old-only or new-only) — show informative message
  if (selectedFilePair.status === "old-only" || selectedFilePair.status === "new-only") {
    const sideLabel = selectedFilePair.status === "old-only" ? "左侧" : "右侧";
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="flex items-center px-4 py-1.5 bg-white border-b text-sm">
          <button onClick={handleBack} className="flex items-center gap-1 text-blue-600 hover:text-blue-800 mr-3">
            <BackIcon size={14} /> 文件夹
          </button>
          <span className="font-mono font-semibold mr-4">{selectedFilePair.filename}</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <p className="mb-2">此文件仅在{sideLabel}存在，无法进行对比</p>
            <p className="text-xs text-gray-400">路径: {selectedFilePair.status === "old-only" ? selectedFilePair.oldPath : selectedFilePair.newPath}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!diffResult) {
    if (!keyColumnIndices.length) {
      return (
        <div className="flex-1 flex flex-col h-full">
          <div className="flex items-center px-4 py-1.5 bg-white border-b text-sm">
            <button onClick={handleBack} className="flex items-center gap-1 text-blue-600 hover:text-blue-800 mr-3">
              <BackIcon size={14} /> 文件夹
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center text-gray-500">
            请先选择关键列以生成差异对比
          </div>
        </div>
      );
    }
    return <div className="p-8 text-gray-500">加载中...</div>;
  }

  const diffCount = diffResult.stats.modified + diffResult.stats.added + diffResult.stats.deleted;
  const duplicateKeyCount = diffResult.duplicateKeys?.length ?? 0;
  const diffBlockCount = diffBlocks.length;
  const activeDiffBlockIndex = findDiffBlockIndexByRef(activeDiffRowRef);
  const overviewRowCount = Math.max(diffResult.diffRows.length, 1);
  const estimatedScrollHeight = Math.max(scrollMetrics.scrollHeight, overviewRowCount * 26 + 30);
  const visibleHeight = Math.max(scrollMetrics.clientHeight, 1);
  const hasVerticalOverflow = estimatedScrollHeight > visibleHeight + 2;
  const overviewHeightPx = Math.max(96, Math.min(visibleHeight || 360, overviewRowCount * 8 + 34));
  const overviewStyle = hasVerticalOverflow
    ? { bottom: 8 }
    : { height: overviewHeightPx };
  const viewportRatio = estimatedScrollHeight > 0
    ? Math.min(1, visibleHeight / estimatedScrollHeight)
    : 1;
  const viewportTopRatio = estimatedScrollHeight > visibleHeight
    ? scrollMetrics.scrollTop / (estimatedScrollHeight - visibleHeight)
    : 0;
  const overviewViewportTop = `${Math.max(0, Math.min(1 - viewportRatio, viewportTopRatio * (1 - viewportRatio))) * 100}%`;
  const overviewViewportHeight = `${Math.max(viewportRatio * 100, 5)}%`;
  const selectedRowRefs = uniqueRowRefs(leftSelected, rightSelected);
  const selectedDetailRef = selectedRowRefs[0] ?? activeDiffRowRef ?? null;
  const selectedDetailRow = selectedDetailRef ? findDiffRowByRef(diffResult, selectedDetailRef) : undefined;
  const selectedDetailFields: DetailField[] = selectedDetailRow ? (() => {
    const maxCols = Math.max(
      oldSheet?.columns.length ?? 0,
      newSheet?.columns.length ?? 0,
      selectedDetailRow.oldRow?.length ?? 0,
      selectedDetailRow.newRow?.length ?? 0
    );
    const diffSet = new Set(selectedDetailRow.cellDiffs.map((d) => d.columnIndex));
    return Array.from({ length: maxCols }, (_, index) => {
      const name = oldSheet?.columns[index]?.name ?? newSheet?.columns[index]?.name ?? `Column ${index + 1}`;
      return {
        index,
        name,
        oldText: formatDetailCell(selectedDetailRow.oldRow?.[index]),
        newText: formatDetailCell(selectedDetailRow.newRow?.[index]),
        isDifferent: diffSet.has(index),
      };
    });
  })() : [];
  const leftToRightRefs = selectedRowRefs.filter((rowRef) => {
    const row = findDiffRowByRef(diffResult, rowRef);
    return !!row && row.status !== "unchanged";
  });
  const rightToLeftRefs = selectedRowRefs.filter((rowRef) => {
    const row = findDiffRowByRef(diffResult, rowRef);
    return !!row && row.status !== "unchanged";
  });

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Top toolbar — BC style */}
      <div className="flex items-center px-4 py-1.5 bg-white border-b text-sm">
        <button onClick={handleBack} className="flex items-center gap-1 text-blue-600 hover:text-blue-800 mr-3">
          <BackIcon size={14} /> 文件夹
        </button>
        <span className="font-mono font-semibold mr-4">{selectedFilePair.filename}</span>
        {selectedFilePair.compareNote && (
          <span className="max-w-[22vw] truncate text-[11px] text-amber-700" title={selectedFilePair.compareNote}>
            {selectedFilePair.compareNote}
          </span>
        )}
        {sheetSummaries.length > 1 && (
          <div className="flex items-center border rounded px-2 py-0.5 text-xs mr-3 hover:bg-gray-50">
            <select value={currentSheet} onChange={(e) => { void handleSheetChange(e.target.value); }}
              className="bg-transparent outline-none pr-1">
              {sheetSummaries.map((summary) => (
                <option key={summary.name} value={summary.name}>
                  {summary.name} · {summary.diffCount}差异
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="text-gray-400" />
          </div>
        )}
        <button onClick={() => setShowKeySelector(true)}
          className="flex items-center gap-1 border rounded px-2 py-0.5 text-xs hover:bg-gray-100"
          title="选择关键列">
          <KeyIcon size={13} /> 关键列
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-xs">
          <button onClick={() => setShowSearch(!showSearch)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded ${showSearch ? "bg-blue-100 text-blue-800" : "hover:bg-gray-100"}`}
            title="Ctrl+F">
            <SearchIcon size={13} />
            查找
          </button>
          <span className="text-gray-300 mx-1">|</span>
          <button onClick={() => navigateDiff("prev")} disabled={diffBlockCount === 0}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-100 disabled:opacity-30"
            title={`Ctrl+Shift+G · ${diffBlockCount} 个差异块`}>
            <span className="rotate-180"><ChevronDownIcon size={12} /></span>
            上一个
          </button>
          <button onClick={() => navigateDiff("next")} disabled={diffBlockCount === 0}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-100 disabled:opacity-30"
            title={`Ctrl+G · ${diffBlockCount} 个差异块`}>
            <ChevronDownIcon size={12} />
            下一个
          </button>
          <button onClick={() => setFilter((f) => f === "diff" ? "all" : "diff")}
            className={`flex items-center gap-1 px-2 py-0.5 rounded ${filter === "diff" ? "bg-yellow-100 text-yellow-800" : "hover:bg-gray-100"}`}>
            <FilterIcon size={13} /> 仅差异 ({diffCount})
          </button>
          {duplicateKeyCount > 0 && (
            <button onClick={() => setFilter((f) => f === "duplicate" ? "all" : "duplicate")}
              className={`flex items-center gap-1 px-2 py-0.5 rounded ${filter === "duplicate" ? "bg-red-100 text-red-800" : "hover:bg-gray-100"}`}
              title="查看重复主键相关行">
              <KeyIcon size={13} /> 重复键({duplicateKeyCount})
            </button>
          )}
          <span className="text-gray-300 mx-1">|</span>
          <button onClick={handleUndo} disabled={!canUndo}
            className="flex items-center gap-1 px-2 py-0.5 rounded disabled:opacity-30 hover:bg-gray-100">
            <UndoIcon size={13} /> 撤销
          </button>
          <button onClick={handleRedo} disabled={!canRedo}
            className="flex items-center gap-1 px-2 py-0.5 rounded disabled:opacity-30 hover:bg-gray-100">
            <RedoIcon size={13} /> 重做
          </button>
          {selectedFilePair.oldPath && !selectedFilePair.oldReadOnly && (
            <button onClick={handleSaveLeft}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600"
              title={leftDirty ? "左侧有未保存修改" : "保存左侧"}>
              <SaveIcon size={13} /> 保存左侧
              {leftDirty && <span className="h-1.5 w-1.5 rounded-full bg-white" aria-label="左侧有未保存修改" />}
            </button>
          )}
          <button onClick={handleSaveRight}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700"
            title={rightDirty ? "右侧有未保存修改" : "保存右侧"}>
            <SaveIcon size={13} /> 保存右侧
            {rightDirty && <span className="h-1.5 w-1.5 rounded-full bg-white" aria-label="右侧有未保存修改" />}
          </button>
          <span className="text-gray-300 mx-1">|</span>
          <button onClick={handleExport}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-100">
            <FileIcon size={13} /> 导出报告
          </button>
        </div>
      </div>

      {/* Search panel */}
      {showSearch && (
        <div className="flex items-center gap-2 px-4 py-1 bg-gray-50 border-b text-xs">
          <SearchIcon size={13} className="text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="查找内容..."
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setCurrentMatchIndex(0); }}
            className="flex-1 px-2 py-0.5 border rounded bg-white text-xs outline-none focus:border-blue-400"
          />
          {searchText && (
            <>
              <span className="text-gray-500">
                {searchMatches.length > 0 ? `${currentMatchIndex + 1}/${searchMatches.length}` : "0/0"}
              </span>
              <button
                onClick={() => navigateMatch("prev")}
                disabled={searchMatches.length === 0}
                className="px-2 py-0.5 rounded hover:bg-gray-200 disabled:opacity-30"
                title="Shift+Enter"
              >
                ↑
              </button>
              <button
                onClick={() => navigateMatch("next")}
                disabled={searchMatches.length === 0}
                className="px-2 py-0.5 rounded hover:bg-gray-200 disabled:opacity-30"
                title="Enter"
              >
                ↓
              </button>
            </>
          )}
          <button
            onClick={() => { setShowSearch(false); setSearchText(""); }}
            className="px-2 py-0.5 rounded hover:bg-gray-200"
            title="Esc"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header labels */}
      <div className="flex border-b text-xs">
        <div className="flex min-w-0 flex-1 items-center gap-2 bg-gray-50 px-3 py-1 border-r font-semibold text-gray-600">
          <span className="shrink-0">左侧</span>
          {leftSelected.length > 0 && <span className="shrink-0 text-blue-600">已选 {leftSelected.length} 行</span>}
          <VcsSummaryBadge label="左" path={selectedFilePair.oldPath} info={leftVcsInfo} readOnly={selectedFilePair.oldReadOnly} />
        </div>
        <div className={`${ACTION_COLUMN_CLASS} flex items-center justify-center bg-gray-100 px-1 py-1 text-center font-semibold text-gray-500 border-r`}>
          操作
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 bg-gray-50 px-3 py-1 font-semibold text-gray-600">
          <span className="shrink-0">右侧</span>
          {rightSelected.length > 0 && <span className="shrink-0 text-blue-600">已选 {rightSelected.length} 行</span>}
          <VcsSummaryBadge label="右" path={selectedFilePair.newPath} info={rightVcsInfo} readOnly={selectedFilePair.newReadOnly} />
        </div>
      </div>

      {/* Grids */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 border-r">
          <DiffGrid ref={oldGridRef} side="old" diffResult={diffResult} columns={oldSheet?.columns ?? []}
            onCellEdit={selectedFilePair.oldReadOnly ? undefined : handleLeftCellEdit} onSelectionChanged={setLeftSelected} filter={filter}
            onScroll={handleGridScroll}
            columnWidths={columnWidths} onColumnWidthsChange={setColumnWidths}
            searchText={searchText} searchMatches={searchMatches} currentMatchIndex={currentMatchIndex}
            activeRowRef={activeDiffRowRef}
            onRowContextMenu={handleRowContextMenu} />
        </div>

        {/* Center action bar */}
        <div className={`${ACTION_COLUMN_CLASS} flex flex-col items-center bg-gray-50 border-r gap-1.5 py-2`}>
          <button
            type="button"
            onClick={() => setShowVersionCompare(true)}
            className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
          >
            版本对比
          </button>
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5">
            <button onClick={() => handleCopyLeftToRight(leftToRightRefs)} disabled={leftToRightRefs.length === 0}
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-30"
              title="复制到右侧">
              <ArrowRight size={11} /> 复制
            </button>
            <span className="text-[10px] text-gray-400">{leftToRightRefs.length || 0} 行</span>
            <div className="w-10 border-t" />
            <button onClick={() => handleCopyRightToLeft(rightToLeftRefs)} disabled={rightToLeftRefs.length === 0}
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-30"
              title="复制到左侧">
              <ArrowLeft size={11} /> 复制
            </button>
            <span className="text-[10px] text-gray-400">{rightToLeftRefs.length || 0} 行</span>
          </div>
        </div>

        <div className="flex-1">
          <DiffGrid ref={newGridRef} side="new" diffResult={diffResult} columns={newSheet?.columns ?? []}
            onCellEdit={handleCellEdit} onSelectionChanged={setRightSelected} filter={filter}
            onScroll={handleGridScroll} onScrollMetrics={handleScrollMetrics}
            columnWidths={columnWidths} onColumnWidthsChange={setColumnWidths}
            searchText={searchText} searchMatches={searchMatches} currentMatchIndex={currentMatchIndex}
            activeRowRef={activeDiffRowRef}
            onRowContextMenu={handleRowContextMenu} />
        </div>

        {rowContextMenu && (
          <div
            className="fixed z-50 min-w-[150px] rounded border border-gray-200 bg-white py-1 shadow-lg"
            style={{ left: rowContextMenu.x, top: rowContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={handleCopyContextRow}
              className="w-full px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-blue-50 hover:text-blue-700"
            >
              复制到对侧
            </button>
          </div>
        )}


        {diffBlockCount > 0 && (
          <div
            className="absolute right-2 top-2 w-4 overflow-hidden rounded border border-gray-300 bg-gray-100/90 shadow-sm z-20"
            style={overviewStyle}
            title={`${diffBlockCount} 个差异块`}
          >
            <div
              className="pointer-events-none absolute left-0.5 right-0.5 rounded-sm bg-slate-500/30 z-30"
              style={{ top: overviewViewportTop, height: overviewViewportHeight }}
            />
            {diffBlocks.map((block, index) => {
              const top = `${(block.startIndex / overviewRowCount) * 100}%`;
              const height = `${Math.max(((block.endIndex - block.startIndex + 1) / overviewRowCount) * 100, 1.4)}%`;
              const isActive = index === activeDiffBlockIndex;
              return (
                <button
                  key={block.id}
                  type="button"
                  aria-label={`跳转到差异块 ${index + 1}`}
                  title={`差异块 ${index + 1}: 行 ${block.startIndex + 1}-${block.endIndex + 1}`}
                  onClick={() => jumpToDiffBlock(block)}
                  className={`absolute left-0 right-0 rounded-sm z-20 ${isActive ? "bg-red-700 ring-1 ring-red-900" : "bg-red-500 hover:bg-red-600"}`}
                  style={{ top, height }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom status bar — BC style */}
      <div className="h-44 shrink-0 border-t bg-white text-xs">
        <div className="flex items-center gap-3 border-b bg-gray-50 px-3 py-1 text-gray-600">
          <span className="font-semibold text-gray-700">选中数据详情</span>
          {selectedDetailRow ? (
            <>
              <span>左侧行 {selectedDetailRow.oldRowNumber ?? "-"}</span>
              <span>右侧行 {selectedDetailRow.newRowNumber ?? "-"}</span>
              <span className="text-red-600">{selectedDetailRow.cellDiffs.length} 个差异单元格</span>
              {selectedRowRefs.length > 1 && <span className="text-gray-400">已选 {selectedRowRefs.length} 行，显示第 1 行</span>}
            </>
          ) : (
            <span className="text-gray-400">选择一行后在这里查看完整内容</span>
          )}
        </div>
        <div className="h-[calc(100%-29px)] overflow-auto">
          {selectedDetailRow ? (
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[41%]" />
                <col className="w-[41%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b text-left text-gray-500">
                  <th className="px-3 py-1 font-semibold">字段</th>
                  <th className="px-3 py-1 font-semibold">左侧完整内容</th>
                  <th className="px-3 py-1 font-semibold">右侧完整内容</th>
                </tr>
              </thead>
              <tbody>
                {selectedDetailFields.map((field) => (
                  <tr key={field.index} className={`border-b align-top ${field.isDifferent ? "bg-red-50" : ""}`}>
                    <td className="px-3 py-1.5 font-medium text-gray-700">
                      <div className="truncate" title={field.name}>{field.name}</div>
                    </td>
                    <td
                      className={`px-3 py-1.5 whitespace-pre-wrap break-words font-mono ${field.isDifferent ? "bg-red-100/70" : ""}`}
                      onDoubleClick={() => selectedDetailRef && startDetailEdit("old", selectedDetailRef, field.index, selectedDetailRow.oldRow?.[field.index])}
                      title="双击编辑左侧内容"
                    >
                      {detailEdit?.side === "old" && detailEdit.rowRef === selectedDetailRef && detailEdit.columnIndex === field.index ? (
                        <textarea
                          autoFocus
                          value={detailEdit.value}
                          onChange={(event) => setDetailEdit({ ...detailEdit, value: event.target.value })}
                          onBlur={commitDetailEdit}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelDetailEdit();
                            }
                            if (event.key === "Enter" && (event.ctrlKey || !event.shiftKey)) {
                              event.preventDefault();
                              commitDetailEdit();
                            }
                          }}
                          className="min-h-[72px] w-full resize-y rounded border border-blue-400 bg-white p-1 font-mono text-xs outline-none"
                        />
                      ) : (
                        field.oldText
                      )}
                    </td>
                    <td
                      className={`px-3 py-1.5 whitespace-pre-wrap break-words font-mono ${field.isDifferent ? "bg-red-100/70" : ""}`}
                      onDoubleClick={() => selectedDetailRef && startDetailEdit("new", selectedDetailRef, field.index, selectedDetailRow.newRow?.[field.index])}
                      title="双击编辑右侧内容"
                    >
                      {detailEdit?.side === "new" && detailEdit.rowRef === selectedDetailRef && detailEdit.columnIndex === field.index ? (
                        <textarea
                          autoFocus
                          value={detailEdit.value}
                          onChange={(event) => setDetailEdit({ ...detailEdit, value: event.target.value })}
                          onBlur={commitDetailEdit}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelDetailEdit();
                            }
                            if (event.key === "Enter" && (event.ctrlKey || !event.shiftKey)) {
                              event.preventDefault();
                              commitDetailEdit();
                            }
                          }}
                          className="min-h-[72px] w-full resize-y rounded border border-blue-400 bg-white p-1 font-mono text-xs outline-none"
                        />
                      ) : (
                        field.newText
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">暂无选中数据</div>
          )}
        </div>
      </div>

      <div className="flex items-center px-4 py-1 bg-gray-100 border-t text-xs text-gray-600">
        <span>差异 <b className="text-red-600">{diffCount}</b></span>
        <span className="mx-2">|</span>
        <span>未变 {diffResult.stats.unchanged}</span>
        <span className="mx-2">|</span>
        <span className="text-blue-600">💡 保存时公式和格式会自动保留</span>
        <div className="flex-1" />
        <span className="text-gray-400">Ctrl+→ 左到右 | Ctrl+← 右到左 | Ctrl+G 下一个差异 | Ctrl+B 仅差异</span>
      </div>

      {/* Key column selector modal */}
      {showKeySelector && (
        <KeyColumnSelector
          columns={oldSheet?.columns ?? []}
          currentKeyIndices={keyColumnIndices}
          onApply={handleKeyColumnApply}
          onClose={() => setShowKeySelector(false)}
        />
      )}

      {/* Error dialog */}
      {error && (
        <ErrorDialog
          title={error.title}
          message={error.message}
          onClose={() => setError(null)}
        />
      )}
      {showVersionCompare && (
        <VersionCompareDialog
          leftPath={selectedFilePair.oldPath}
          rightPath={selectedFilePair.newPath}
          onClose={() => setShowVersionCompare(false)}
        />
      )}
    </div>
  );
}
