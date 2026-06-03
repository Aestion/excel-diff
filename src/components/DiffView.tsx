import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDiffStore } from "../stores/diffStore";
import { useEditStore, type CellChange } from "../stores/editStore";
import { cellDataEqual, computeDiff } from "../utils/diffEngine";
import DiffGrid from "./DiffGrid";
import KeyColumnSelector from "./KeyColumnSelector";
import ErrorDialog from "./ErrorDialog";
import { writeExcel, writeExcelChanges, listExcelFiles, readExcel, pickSavePath, saveTextFile } from "../api/tauri";
import type { CellValue, Row, SheetData, CellData } from "../types/excel";
import type { DiffResult, DiffRow } from "../types/diff";
import { BackIcon, UndoIcon, RedoIcon, SaveIcon, ArrowRight, ArrowLeft, FilterIcon, KeyIcon, ChevronDown, FileIcon, ChevronDown as ChevronDownIcon, SearchIcon } from "./Icons";

function getDiffRowRef(row: DiffRow): string {
  return `${row.oldRowNumber ?? ""}:${row.newRowNumber ?? ""}:${row.viewIndex}`;
}

function findDiffRowByRef(diffResult: DiffResult | null, rowRef: string): DiffRow | undefined {
  return diffResult?.diffRows.find((row) => getDiffRowRef(row) === rowRef);
}

function sheetRowsEqual(a: Row[], b: Row[]): boolean {
  if (a.length !== b.length) return false;
  for (let rowIndex = 0; rowIndex < a.length; rowIndex++) {
    if (a[rowIndex].length !== b[rowIndex].length) return false;
    for (let colIndex = 0; colIndex < a[rowIndex].length; colIndex++) {
      if (!cellDataEqual(a[rowIndex][colIndex], b[rowIndex][colIndex])) return false;
    }
  }
  return true;
}

type DiffBlock = {
  id: string;
  startIndex: number;
  endIndex: number;
  startRef: string;
};

export default function DiffView() {
  const {
    selectedFilePair, oldWorkbook, newWorkbook, currentSheet,
    diffResult, keyColumnIndices, effectiveNewRows, hasUnsavedChanges,
    setView, setCurrentSheet, setDiffResult, setHasUnsavedChanges, setEffectiveNewRows,
  } = useDiffStore();

  const { pushEdit, undo, redo } = useEditStore();
  const canUndo = useEditStore((s) => s.undoStack.length > 0);
  const canRedo = useEditStore((s) => s.redoStack.length > 0);

  const [showLegend, setShowLegend] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const oldSheet = oldWorkbook?.sheets.find((s) => s.name === currentSheet);
  const newSheet = newWorkbook?.sheets.find((s) => s.name === currentSheet);

  const [leftSelected, setLeftSelected] = useState<string[]>([]);
  const [rightSelected, setRightSelected] = useState<string[]>([]);
  const [activeDiffRowRef, setActiveDiffRowRef] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "diff" | "same">("all");
  const [scrollPos, setScrollPos] = useState(0);
  const [showKeySelector, setShowKeySelector] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

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
  const navigateDiffRef = useRef<(dir: "next" | "prev") => void>(() => {});
  showSearchRef.current = showSearch;
  searchTextRef.current = searchText;
  leftSelectedRef.current = leftSelected;
  rightSelectedRef.current = rightSelected;
  filterRef.current = filter;

  // Initialize effective rows
  const prevSheetRef = useRef<string>("");
  useEffect(() => {
    if (newSheet && currentSheet !== prevSheetRef.current) {
      prevSheetRef.current = currentSheet;
      setEffectiveNewRows(newSheet.rows.map((r) => r.map((c) => ({ ...c }))));
      useEditStore.getState().clear();
      setLeftSelected([]); setRightSelected([]);
    }
  }, [newSheet, currentSheet, setEffectiveNewRows]);

  // Recompute diff
  useEffect(() => {
    if (!oldSheet || !effectiveNewRows || !keyColumnIndices.length) return;
    setDiffResult(computeDiff(oldSheet, { ...newSheet!, rows: effectiveNewRows }, keyColumnIndices));
  }, [oldSheet, effectiveNewRows, keyColumnIndices, newSheet, setDiffResult]);

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
      const ss = showSearchRef.current;
      const st = searchTextRef.current;
      const ls = leftSelectedRef.current;
      const rs = rightSelectedRef.current;

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
      if (e.ctrlKey && e.key === "ArrowRight") { e.preventDefault(); handleCopyLeftToRight(ls); }
      // Ctrl+← : copy selected right → left (swap + copy)
      if (e.ctrlKey && e.key === "ArrowLeft") { e.preventDefault(); handleCopyRightToLeft(rs); }
      // Ctrl+G : next diff
      if (e.ctrlKey && !e.shiftKey && e.key === "g") { e.preventDefault(); navigateDiffRef.current("next"); }
      // Ctrl+Shift+G : prev diff
      if (e.ctrlKey && e.shiftKey && e.key === "G") { e.preventDefault(); navigateDiffRef.current("prev"); }
      // Ctrl+B : filter diffs
      if (e.ctrlKey && e.key === "b") { e.preventDefault(); setFilter((f) => f === "diff" ? "all" : "diff"); }
      // Ctrl+S : save
      if (e.ctrlKey && e.key === "s") { e.preventDefault(); handleSaveRight(); }
      // Ctrl+Z : undo
      if (e.ctrlKey && !e.shiftKey && e.key === "z") { e.preventDefault(); handleUndo(); }
      // Ctrl+Y or Ctrl+Shift+Z : redo
      if ((e.ctrlKey && e.key === "y") || (e.ctrlKey && e.shiftKey && e.key === "Z")) { e.preventDefault(); handleRedo(); }
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

  const jumpToDiffBlock = useCallback((block: DiffBlock) => {
    setActiveDiffRowRef(block.startRef);
  }, []);

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
    },
    [activeDiffRowRef, diffBlocks, findDiffBlockIndexByRef, leftSelected, rightSelected]
  );
  navigateDiffRef.current = navigateDiff;

  const handleBack = useCallback(async () => {
    if (hasUnsavedChanges && !window.confirm("有未保存的更改，确定要返回吗？")) return;
    const { oldDir, newDir, setOldFiles, setNewFiles, buildFilePairs } = useDiffStore.getState();
    if (oldDir) { try { setOldFiles(await listExcelFiles(oldDir)); } catch {} }
    if (newDir) { try { setNewFiles(await listExcelFiles(newDir)); } catch {} }
    await buildFilePairs();
    setView("directory");
  }, [setView, hasUnsavedChanges]);

  const refreshAndVerifyFilePair = useCallback(async (relativePath: string) => {
    const { oldDir, newDir, setOldFiles, setNewFiles, buildFilePairs, verifyFilePair } = useDiffStore.getState();
    if (oldDir) { try { setOldFiles(await listExcelFiles(oldDir)); } catch {} }
    if (newDir) { try { setNewFiles(await listExcelFiles(newDir)); } catch {} }
    await buildFilePairs();
    await verifyFilePair(relativePath, true);
  }, []);

  const isRightDirty = useCallback(
    (rows: Row[] | null): boolean => {
      if (!rows || !newWorkbook) return false;
      const baseline = newWorkbook.sheets.find((s) => s.name === currentSheet)?.rows;
      if (!baseline) return false;
      return !sheetRowsEqual(rows, baseline);
    },
    [currentSheet, newWorkbook]
  );

  const handleSheetChange = useCallback(
    (sheetName: string) => { setCurrentSheet(sheetName); useEditStore.getState().clear(); },
    [setCurrentSheet]
  );

  // Copy left → right (old values overwrite new)
  const handleCopyLeftToRight = useCallback(
    (rowRefs: string[]) => {
      const keys = rowRefs;
      const dr = diffResultRef.current;
      const rows = effectiveNewRowsRef.current;
      if (!dr || !rows || rowRefs.length === 0) return;

      const localRows = rows.map((r) => r.map((c) => ({ ...c })));
      const undoChanges: CellChange[] = [];
      const redoChanges: CellChange[] = [];

      for (const rowRef of rowRefs) {
        const diffRow = findDiffRowByRef(dr, rowRef);
        if (!diffRow || !diffRow.oldRow) continue;
        const key = diffRow.key;

        if (diffRow.newRow) {
          // Row exists on right → overwrite cells
          const idx = diffRow.newRowNumber ? diffRow.newRowNumber - 1 : -1;
          if (idx < 0) continue;
          // Copy all old values to new row
          for (let col = 0; col < diffRow.oldRow.length; col++) {
            const targetCell = diffRow.oldRow[col];
            const currentCell = localRows[idx]?.[col];
            const currentValue = currentCell?.value ?? null;
            const currentFormula = currentCell?.formula;
            const targetValue = targetCell?.value ?? null;
            const targetFormula = targetCell?.formula;

            if (JSON.stringify({ value: currentValue, formula: currentFormula }) !== JSON.stringify({ value: targetValue, formula: targetFormula })) {
              undoChanges.push({ rowKey: key, rowRef, columnIndex: col, value: currentValue, formula: currentFormula });
              redoChanges.push({ rowKey: key, rowRef, columnIndex: col, value: targetValue, formula: targetFormula });
              while (localRows[idx].length <= col) localRows[idx].push({ value: null });
              localRows[idx][col] = { ...targetCell };
            }
          }
          // Clear extra columns on right that don't exist on left
          for (let col = diffRow.oldRow.length; col < localRows[idx].length; col++) {
            const currentCell = localRows[idx][col];
            if (currentCell?.value !== null || currentCell?.formula !== undefined) {
              undoChanges.push({ rowKey: key, rowRef, columnIndex: col, value: currentCell?.value ?? null, formula: currentCell?.formula });
              redoChanges.push({ rowKey: key, rowRef, columnIndex: col, value: null });
              localRows[idx][col] = { value: null };
            }
          }
        } else {
          // Row only on left → insert
          undoChanges.push({ rowKey: key, rowRef, columnIndex: -1, value: null });
          redoChanges.push({ rowKey: key, rowRef, columnIndex: -2, value: JSON.stringify(diffRow.oldRow) });
          localRows.push(diffRow.oldRow.map((c) => ({ ...c })));
        }
      }

      if (undoChanges.length > 0) {
        pushEdit({ type: "batch-copy", undoPayload: undoChanges, redoPayload: redoChanges, description: `左→右 ${keys.length}行` });
        setEffectiveNewRows(localRows);
        setHasUnsavedChanges(isRightDirty(localRows));
      }
    },
    [pushEdit, setEffectiveNewRows, setHasUnsavedChanges, isRightDirty]
  );

  // Copy right → left (new values overwrite old file)
  const handleCopyRightToLeft = useCallback(
    async (rowRefs: string[]) => {
      const keys = rowRefs;
      if (!diffResult || !effectiveNewRows || !oldWorkbook || !selectedFilePair?.oldPath || rowRefs.length === 0) return;

      const oldSheetData = oldWorkbook.sheets.find((s) => s.name === currentSheet);
      if (!oldSheetData) return;

      // Build modified old rows
      const modifiedOldRows = oldSheetData.rows.map((r) => r.map((c) => ({ ...c })));

      for (const rowRef of rowRefs) {
        const dr = findDiffRowByRef(diffResult, rowRef);
        if (!dr) continue;

        const idx = dr.oldRowNumber ? dr.oldRowNumber - 1 : -1;
        if (idx < 0) continue;

        if (dr.newRow) {
          // Row exists on right → overwrite with new values
          for (let col = 0; col < dr.newRow.length; col++) {
            while (modifiedOldRows[idx].length <= col) modifiedOldRows[idx].push({ value: null });
            modifiedOldRows[idx][col] = { ...dr.newRow[col] };
          }
        } else {
          // Row only on left (deleted) → clear all cells
          for (let col = 0; col < modifiedOldRows[idx].length; col++) {
            modifiedOldRows[idx][col] = { value: null };
          }
        }
      }

      try {
        // Write to old file
        const sheets = oldWorkbook.sheets.map((s) => {
          if (s.name === currentSheet) return { ...s, rows: modifiedOldRows };
          return s;
        });
        await writeExcel(selectedFilePair.oldPath, sheets);

        // Reload old workbook
        const freshOld = await readExcel(selectedFilePair.oldPath);
        useDiffStore.getState().setOldWorkbook(freshOld);
        useEditStore.getState().clear();
        setHasUnsavedChanges(isRightDirty(effectiveNewRows));
        await refreshAndVerifyFilePair(selectedFilePair.relativePath);

        alert(`已复制 ${keys.length} 行到左侧`);
      } catch (e: any) {
        setError({ title: "右→左复制失败", message: e?.message || String(e) });
      }
    },
    [diffResult, effectiveNewRows, oldWorkbook, selectedFilePair, currentSheet, setHasUnsavedChanges, refreshAndVerifyFilePair, isRightDirty]
  );

  // Cell edit
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
      setHasUnsavedChanges(true);
    },
    [diffResult, effectiveNewRows, findNewRowIndex, pushEdit, setEffectiveNewRows, setHasUnsavedChanges]
  );

  // Undo
  const handleUndo = useCallback(() => {
    const op = undo(); if (!op || !effectiveNewRows) return;
    const localRows = effectiveNewRows.map((r) => r.map((c) => ({ ...c })));
    for (const c of op.undoPayload) {
      if (c.columnIndex === -1) { localRows.pop(); }
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
    setHasUnsavedChanges(isRightDirty(localRows));
  }, [undo, effectiveNewRows, diffResult, setEffectiveNewRows, setHasUnsavedChanges, isRightDirty]);

  // Redo
  const handleRedo = useCallback(() => {
    const op = redo(); if (!op || !effectiveNewRows) return;
    const localRows = effectiveNewRows.map((r) => r.map((c) => ({ ...c })));
    for (const c of op.redoPayload) {
      if (c.columnIndex === -2) {
        const rowData = JSON.parse(c.value as string);
        localRows.push(rowData.map((cell: CellData) => ({ ...cell })));
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
    setHasUnsavedChanges(isRightDirty(localRows));
  }, [redo, effectiveNewRows, diffResult, setEffectiveNewRows, setHasUnsavedChanges, isRightDirty]);

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

      for (let ri = 1; ri < effectiveNewRows.length; ri++) {
        const newRow = effectiveNewRows[ri];
        const origRow = ri < origSheet.rows.length ? origSheet.rows[ri] : null;

        if (!origRow) {
          // New row — append
          insertRows.push(newRow);
          continue;
        }

        for (let ci = 0; ci < newRow.length; ci++) {
          const newCell = newRow[ci] ?? { value: null };
          const origCell = ci < origRow.length ? (origRow[ci] ?? { value: null }) : { value: null };
          const nv = newCell.value ?? null;
          const nf = newCell.formula;
          const ov = origCell.value ?? null;
          const of = origCell.formula;
          if (JSON.stringify({ value: nv, formula: nf }) !== JSON.stringify({ value: ov, formula: of })) {
            changes.push({ row: ri + 1, col: ci + 1, value: nv, formula: nf }); // 1-based
          }
        }
      }

      // If no changes and no inserts, skip write
      if (changes.length === 0 && insertRows.length === 0) {
        setHasUnsavedChanges(false);
        useEditStore.getState().clear();
        return;
      }

      const changesData = {
        sheets: [{
          name: currentSheet,
          changes,
          insert_rows: insertRows,
          delete_rows: [] as number[],
        }]
      };

      await writeExcelChanges(selectedFilePair.newPath, JSON.stringify(changesData));
      setHasUnsavedChanges(false);

      // Update newWorkbook with our effective values (we already have correct values, no need to re-read)
      const { newWorkbook: currentWb, setNewWorkbook } = useDiffStore.getState();
      if (currentWb) {
        const updatedSheets = currentWb.sheets.map((s) => {
          if (s.name === currentSheet) {
            return { ...s, rows: effectiveNewRows };
          }
          return s;
        });
        setNewWorkbook({ ...currentWb, sheets: updatedSheets });
      }
      // effectiveNewRows is already correct
      useEditStore.getState().clear();

      await refreshAndVerifyFilePair(selectedFilePair.relativePath);
      alert("右侧保存成功！");
    } catch (e: any) { setError({ title: "保存失败", message: e?.message || String(e) }); }
  }, [newWorkbook, effectiveNewRows, selectedFilePair, currentSheet, setHasUnsavedChanges, setEffectiveNewRows, refreshAndVerifyFilePair]);

  // Save left side (old data)
  const handleSaveLeft = useCallback(async () => {
    if (!oldWorkbook || !selectedFilePair?.oldPath) return;
    try {
      await writeExcel(selectedFilePair.oldPath, oldWorkbook.sheets);
      setHasUnsavedChanges(false);

      const freshWb = await readExcel(selectedFilePair.oldPath);
      useDiffStore.getState().setOldWorkbook(freshWb);
      useEditStore.getState().clear();
      await refreshAndVerifyFilePair(selectedFilePair.relativePath);
      alert("左侧保存成功！");
    } catch (e: any) { setError({ title: "保存失败", message: e?.message || String(e) }); }
  }, [oldWorkbook, selectedFilePair, setHasUnsavedChanges, refreshAndVerifyFilePair]);

  // Export diff report as CSV
  const handleExport = useCallback(async () => {
    if (!diffResult || !oldSheet) return;
    const colNames = oldSheet.columns.map((c) => c.name);

    const rows: string[] = [];
    // Header
    rows.push(["行号", "状态", "关键值", ...colNames.map((n) => `左_${n}`), ...colNames.map((n) => `右_${n}`), "差异列"].join(","));

    for (const dr of diffResult.diffRows) {
      const statusMap: Record<string, string> = {
        unchanged: "未变", modified: "修改", added: "新增", deleted: "删除"
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

  // Filtered diff rows for display
  const displayRows = filter === "diff"
    ? diffResult.diffRows.filter((r) => r.status !== "unchanged")
    : diffResult.diffRows;

  const diffCount = diffResult.stats.modified + diffResult.stats.added + diffResult.stats.deleted;
  const diffBlockCount = diffBlocks.length;
  const activeDiffBlockIndex = findDiffBlockIndexByRef(activeDiffRowRef);
  const overviewRowCount = Math.max(diffResult.diffRows.length, 1);
  const overviewHeightPx = Math.max(96, overviewRowCount * 26 + 34);

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Top toolbar — BC style */}
      <div className="flex items-center px-4 py-1.5 bg-white border-b text-sm">
        <button onClick={handleBack} className="flex items-center gap-1 text-blue-600 hover:text-blue-800 mr-3">
          <BackIcon size={14} /> 文件夹
        </button>
        <span className="font-mono font-semibold mr-4">{selectedFilePair.filename}</span>
        {newWorkbook && newWorkbook.sheetNames.length > 1 && (
          <div className="flex items-center border rounded px-2 py-0.5 text-xs mr-3 hover:bg-gray-50">
            <select value={currentSheet} onChange={(e) => handleSheetChange(e.target.value)}
              className="bg-transparent outline-none pr-1">
              {newWorkbook.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
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
          <span className="text-gray-300 mx-1">|</span>
          <button onClick={() => setShowLegend(!showLegend)}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-100">
            <span className={`transform transition-transform ${showLegend ? "rotate-90" : ""}`}>
              <ChevronDownIcon size={12} />
            </span>
            图例
          </button>
          <span className="text-gray-300 mx-1">|</span>
          <button onClick={() => setFilter((f) => f === "diff" ? "all" : "diff")}
            className={`flex items-center gap-1 px-2 py-0.5 rounded ${filter === "diff" ? "bg-yellow-100 text-yellow-800" : "hover:bg-gray-100"}`}>
            <FilterIcon size={13} /> 仅差异 ({diffCount})
          </button>
          <span className="text-gray-300 mx-1">|</span>
          <button onClick={handleUndo} disabled={!canUndo}
            className="flex items-center gap-1 px-2 py-0.5 rounded disabled:opacity-30 hover:bg-gray-100">
            <UndoIcon size={13} /> 撤销
          </button>
          <button onClick={handleRedo} disabled={!canRedo}
            className="flex items-center gap-1 px-2 py-0.5 rounded disabled:opacity-30 hover:bg-gray-100">
            <RedoIcon size={13} /> 重做
          </button>
          {selectedFilePair.oldPath && (
            <button onClick={handleSaveLeft}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600">
              <SaveIcon size={13} /> 保存左侧
            </button>
          )}
          <button onClick={handleSaveRight}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700">
            <SaveIcon size={13} /> 保存右侧
          </button>
          {hasUnsavedChanges && <span className="text-orange-500 ml-1" title="有未保存修改" aria-label="有未保存修改">●</span>}
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

      {/* Legend panel */}
      {showLegend && (
        <div className="flex items-center gap-4 px-4 py-1 bg-gray-50 border-b text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-green-100" />
            <span className="text-gray-600">新增行</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-gray-200" />
            <span className="text-gray-600">删除行</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-red-50" />
            <span className="text-gray-600">修改行</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-red-200" />
            <span className="text-gray-600">修改单元格</span>
          </div>
        </div>
      )}

      {/* Header labels */}
      <div className="flex border-b text-xs">
        <div className="flex-1 bg-gray-50 px-3 py-1 border-r font-semibold text-gray-600">
          ← 左侧 {leftSelected.length > 0 && <span className="text-blue-600 ml-2">已选 {leftSelected.length} 行</span>}
        </div>
        <div className="w-20 bg-gray-100 px-1 py-1 text-center font-semibold text-gray-500 border-r">
          操作
        </div>
        <div className="flex-1 bg-gray-50 px-3 py-1 font-semibold text-gray-600">
          右侧 {rightSelected.length > 0 && <span className="text-blue-600 ml-2">已选 {rightSelected.length} 行</span>}
        </div>
      </div>

      {/* Grids */}
      <div className="flex-1 flex overflow-hidden relative pr-3">
        <div className="flex-1 border-r">
          <DiffGrid side="old" diffResult={diffResult} columns={oldSheet?.columns ?? []}
            onSelectionChanged={setLeftSelected} filter={filter}
            scrollTop={scrollPos} onScroll={setScrollPos}
            searchText={searchText} searchMatches={searchMatches} currentMatchIndex={currentMatchIndex}
            scrollToRowRef={activeDiffRowRef} />
        </div>

        {/* Center action bar — BC style */}
        <div className="w-16 flex flex-col items-center justify-center bg-gray-50 border-r gap-1.5 py-2">
          <button onClick={() => handleCopyLeftToRight(leftSelected)} disabled={leftSelected.length === 0}
            className="flex items-center gap-0.5 text-[10px] px-1.5 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-30"
            title="Ctrl+→">
            <ArrowRight size={11} /> 复制
          </button>
          <span className="text-[10px] text-gray-400">{leftSelected.length || 0} 行</span>
          <div className="w-10 border-t" />
          <button onClick={() => handleCopyRightToLeft(rightSelected)} disabled={rightSelected.length === 0}
            className="flex items-center gap-0.5 text-[10px] px-1.5 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-30"
            title="Ctrl+←">
            <ArrowLeft size={11} /> 复制
          </button>
          <span className="text-[10px] text-gray-400">{rightSelected.length || 0} 行</span>
        </div>

        <div className="flex-1">
          <DiffGrid side="new" diffResult={diffResult} columns={newSheet?.columns ?? []}
            onCellEdit={handleCellEdit} onSelectionChanged={setRightSelected} filter={filter}
            scrollTop={scrollPos} onScroll={setScrollPos}
            searchText={searchText} searchMatches={searchMatches} currentMatchIndex={currentMatchIndex}
            scrollToRowRef={activeDiffRowRef} />
        </div>

        {diffBlockCount > 0 && (
          <div
            className="absolute right-1 top-2 w-2 overflow-hidden rounded-sm border border-gray-300 bg-gray-100/90 shadow-sm z-20"
            style={{ height: overviewHeightPx, maxHeight: "calc(100% - 16px)" }}
            title={`${diffBlockCount} 个差异块`}
          >
            {diffBlocks.map((block, index) => {
              const top = `${(block.startIndex / overviewRowCount) * 100}%`;
              const height = `${Math.max(((block.endIndex - block.startIndex + 1) / overviewRowCount) * 100, 0.8)}%`;
              const isActive = index === activeDiffBlockIndex;
              return (
                <button
                  key={block.id}
                  type="button"
                  aria-label={`跳转到差异块 ${index + 1}`}
                  title={`差异块 ${index + 1}: 行 ${block.startIndex + 1}-${block.endIndex + 1}`}
                  onClick={() => jumpToDiffBlock(block)}
                  className={`absolute left-0 right-0 rounded-sm ${isActive ? "bg-red-700 ring-1 ring-red-900" : "bg-red-500 hover:bg-red-600"}`}
                  style={{ top, height }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom status bar — BC style */}
      <div className="flex items-center px-4 py-1 bg-gray-100 border-t text-xs text-gray-600">
        <span>修改 <b className="text-red-600">{diffResult.stats.modified}</b></span>
        <span className="mx-2">|</span>
        <span>新增 <b className="text-green-600">{diffResult.stats.added}</b></span>
        <span className="mx-2">|</span>
        <span>删除 <b className="text-gray-500">{diffResult.stats.deleted}</b></span>
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
    </div>
  );
}
