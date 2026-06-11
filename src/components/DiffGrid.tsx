import { forwardRef, memo, useMemo, useCallback, useRef, useEffect, useImperativeHandle } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, RowClassParams, CellValueChangedEvent, CellContextMenuEvent } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import type { CellValue, ColumnInfo } from "../types/excel";
import type { DiffResult, DiffRow } from "../types/diff";

const ROW_HEIGHT = 26;
const VIRTUAL_ROW_BUFFER = 20;
const SCROLL_SYNC_HOLD_MS = 80;
const ROW_NUMBER_COL_ID = "_rowNumber";

const DEFAULT_COL_DEF: ColDef = { sortable: false, resizable: true };
const ROW_SELECTION_CONFIG = {
  mode: "multiRow" as const,
  checkboxes: true,
  headerCheckbox: true,
  enableClickSelection: true,
};

function getDiffRowRef(row: DiffRow): string {
  return `${row.oldRowNumber ?? ""}:${row.newRowNumber ?? ""}:${row.viewIndex}`;
}

interface DiffGridProps {
  side: "old" | "new";
  diffResult: DiffResult;
  columns: ColumnInfo[];
  onCellEdit?: (rowRef: string, colIndex: number, oldValue: CellValue, newValue: CellValue, oldFormula?: string, newFormula?: string) => void;
  onSelectionChanged?: (selectedRowRefs: string[]) => void;
  filter?: "all" | "diff" | "same" | "duplicate";
  onScroll?: (scrollTop: number, scrollLeft: number, rowIndex: number, source: "old" | "new") => void;
  onScrollMetrics?: (metrics: { scrollTop: number; clientHeight: number; scrollHeight: number }) => void;
  columnWidths?: Record<string, number>;
  onColumnWidthsChange?: (widths: Record<string, number>) => void;
  searchText?: string;
  searchMatches?: { rowRef: string; side: "old" | "new"; colIndex: number; value: string }[];
  currentMatchIndex?: number;
  activeRowRef?: string | null;
  onRowContextMenu?: (side: "old" | "new", rowRef: string, x: number, y: number) => void;
}

export type DiffGridHandle = {
  syncScroll: (scrollTop: number, scrollLeft: number) => void;
  scrollToRowRef: (rowRef: string) => void;
  getScrollPosition: () => { top: number; left: number; rowIndex: number } | null;
};

const DiffGrid = forwardRef<DiffGridHandle, DiffGridProps>(function DiffGrid({ side, diffResult, columns, onCellEdit, onSelectionChanged, filter = "all", onScroll, onScrollMetrics, columnWidths, onColumnWidthsChange, searchText, searchMatches, currentMatchIndex, activeRowRef, onRowContextMenu }, ref) {
  const gridRef = useRef<AgGridReact>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const syncTargetRef = useRef<{ top: number; left: number } | null>(null);
  const syncReleaseTimerRef = useRef<number | null>(null);

  const getBodyViewport = useCallback(() => (
    containerRef.current?.querySelector(".ag-body-viewport") as HTMLElement | null
  ), []);

  const getHorizontalViewport = useCallback(() => (
    containerRef.current?.querySelector(".ag-body-horizontal-scroll-viewport") as HTMLElement | null
  ), []);

  const reportScrollMetrics = useCallback((viewport: HTMLElement) => {
    onScrollMetrics?.({
      scrollTop: viewport.scrollTop,
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
    });
  }, [onScrollMetrics]);

  const readFirstDisplayedRowIndex = useCallback(() => {
    const api = gridRef.current?.api as any;
    const apiIndex = api?.getFirstDisplayedRowIndex?.();
    if (typeof apiIndex === "number" && apiIndex >= 0) return apiIndex;
    const viewport = getBodyViewport();
    return viewport ? Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT)) : 0;
  }, [getBodyViewport]);

  const searchMatchSet = useMemo(() => {
    if (!searchText || !searchMatches) return null;
    return new Set(searchMatches.map((m) => `${m.rowRef}:${m.side}:${m.colIndex}`));
  }, [searchMatches, searchText]);

  const currentSearchKey = useMemo(() => {
    if (!searchText || !searchMatches || currentMatchIndex == null) return null;
    const current = searchMatches[currentMatchIndex];
    return current ? `${current.rowRef}:${current.side}:${current.colIndex}` : null;
  }, [currentMatchIndex, searchMatches, searchText]);

  const releaseScrollHold = useCallback(() => {
    syncingRef.current = false;
    syncTargetRef.current = null;
    if (syncReleaseTimerRef.current !== null) {
      window.clearTimeout(syncReleaseTimerRef.current);
      syncReleaseTimerRef.current = null;
    }
  }, []);

  const holdScrollEvents = useCallback((scrollTop: number, scrollLeft: number) => {
    syncingRef.current = true;
    syncTargetRef.current = { top: scrollTop, left: scrollLeft };
    if (syncReleaseTimerRef.current !== null) {
      window.clearTimeout(syncReleaseTimerRef.current);
    }
    syncReleaseTimerRef.current = window.setTimeout(() => {
      syncingRef.current = false;
      syncTargetRef.current = null;
      syncReleaseTimerRef.current = null;
    }, SCROLL_SYNC_HOLD_MS);
  }, []);

  useEffect(() => () => {
    if (syncReleaseTimerRef.current !== null) {
      window.clearTimeout(syncReleaseTimerRef.current);
    }
  }, []);

  const syncScroll = useCallback((scrollTop: number, scrollLeft: number) => {
    if (!containerRef.current) return;

    holdScrollEvents(scrollTop, scrollLeft);
    const viewport = getBodyViewport();
    const horizontalViewport = getHorizontalViewport();
    if (viewport && Math.abs(viewport.scrollTop - scrollTop) > 1) {
      viewport.scrollTop = scrollTop;
    }
    if (horizontalViewport && Math.abs(horizontalViewport.scrollLeft - scrollLeft) > 1) {
      horizontalViewport.scrollLeft = scrollLeft;
    } else if (viewport && Math.abs(viewport.scrollLeft - scrollLeft) > 1) {
      viewport.scrollLeft = scrollLeft;
    }
    if (viewport) reportScrollMetrics(viewport);
  }, [getBodyViewport, getHorizontalViewport, holdScrollEvents, reportScrollMetrics]);

  const getScrollPosition = useCallback(() => {
    const viewport = getBodyViewport();
    if (!viewport) return null;
    const horizontalViewport = getHorizontalViewport();
    return {
      top: viewport.scrollTop,
      left: horizontalViewport?.scrollLeft ?? viewport.scrollLeft,
      rowIndex: readFirstDisplayedRowIndex(),
    };
  }, [getBodyViewport, getHorizontalViewport, readFirstDisplayedRowIndex]);

  const columnDefs: ColDef[] = useMemo(() => {
    const maxRowNumber = diffResult.diffRows.reduce((max, row) => (
      Math.max(max, row.oldRowNumber ?? 0, row.newRowNumber ?? 0)
    ), 0);
    const rowNumberDigits = Math.max(String(maxRowNumber).length, 3);
    const defaultRowNumberWidth = Math.max(56, Math.min(110, 28 + rowNumberDigits * 8));
    const defs: ColDef[] = [
      {
        headerName: "#",
        colId: ROW_NUMBER_COL_ID,
        valueGetter: (p: any) => p.data?._rowNumber ?? "",
        width: columnWidths?.[ROW_NUMBER_COL_ID] ?? defaultRowNumberWidth,
        minWidth: 52,
        pinned: "left",
        suppressSizeToFit: true,
      },
    ];
    for (const col of columns) {
      const field = `col_${col.index}`;
      defs.push({
        headerName: col.name, field,
        editable: !!onCellEdit,
        width: columnWidths?.[field] ?? 120,
        minWidth: 70,
        cellClassRules: {
          "cell-modified": (p: any) => {
            if (p.data?._status !== "modified") return false;
            return (p.data?._cellDiffSet as Set<number> | undefined)?.has(col.index) ?? false;
          },
          "cell-search-match": (p: any) => {
            return searchMatchSet?.has(`${p.data?._rowRef}:${side}:${col.index}`) ?? false;
          },
          "cell-search-current": (p: any) => {
            return currentSearchKey === `${p.data?._rowRef}:${side}:${col.index}`;
          },
        },
      });
    }
    return defs;
  }, [columns, columnWidths, currentSearchKey, diffResult.diffRows, onCellEdit, searchMatchSet, side]);

  const rowData = useMemo(() => {
    let rows = diffResult.diffRows;
    if (filter === "diff") rows = rows.filter((r) => r.status !== "unchanged");
    if (filter === "duplicate") rows = rows.filter((r) => r.hasDuplicateKey);
    return rows.map((dr) => {
      const sourceRow = side === "old" ? dr.oldRow : dr.newRow;
      const row: Record<string, any> = {
        _key: dr.key, _rowRef: getDiffRowRef(dr), _status: dr.status, _diffRow: dr,
        _rowNumber: side === "old" ? dr.oldRowNumber : dr.newRowNumber,
        _hasDuplicateKey: dr.hasDuplicateKey,
        _cellDiffSet: new Set(dr.cellDiffs.map((d) => d.columnIndex)),
      };
      if (sourceRow) {
        for (let i = 0; i < sourceRow.length; i++) {
          row[`col_${i}`] = sourceRow[i].value;
        }
      }
      return row;
    });
  }, [diffResult, side, filter]);

  const getRowClass = useCallback((params: RowClassParams<any>) => {
    const duplicateClass = params.data?._hasDuplicateKey ? " row-duplicate-key" : "";
    const activeClass = params.data?._rowRef === activeRowRef ? " row-active-diff" : "";
    switch (params.data?._status) {
      case "added":    return `row-added${duplicateClass}${activeClass}`;
      case "deleted":  return `row-deleted${duplicateClass}${activeClass}`;
      case "modified": return `row-modified${duplicateClass}${activeClass}`;
      default:         return `${duplicateClass}${activeClass}`.trim();
    }
  }, [activeRowRef]);

  const scrollToRowRef = useCallback((rowRef: string) => {
    const api = gridRef.current?.api;
    if (!api) return;
    const rowIndex = rowData.findIndex((row) => row._rowRef === rowRef);
    if (rowIndex < 0) return;
    api.ensureIndexVisible(rowIndex, "middle");
    api.redrawRows();
  }, [rowData]);

  useImperativeHandle(ref, () => ({ syncScroll, scrollToRowRef, getScrollPosition }), [getScrollPosition, scrollToRowRef, syncScroll]);

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      if (!onCellEdit || !event.data) return;
      const field = event.colDef.field;
      if (!field?.startsWith("col_")) return;
      const colIndex = parseInt(field.slice(4));
      const rowRef = event.data._rowRef;

      const diffRow = event.data._diffRow;
      const sourceRow = side === "new" ? diffRow.newRow : diffRow.oldRow;
      const oldCell = sourceRow?.[colIndex];
      const oldValue = oldCell?.value ?? null;
      const oldFormula = oldCell?.formula;

      const rawValue = event.newValue;
      let newValue: CellValue = rawValue;
      let newFormula: string | undefined;

      if (typeof rawValue === "string" && rawValue.startsWith("=")) {
        newFormula = rawValue;
        newValue = oldValue;
      }

      onCellEdit(rowRef, colIndex, oldValue, newValue, oldFormula, newFormula);
    },
    [onCellEdit, side]
  );

  const handleSelectionChanged = useCallback(() => {
    if (!onSelectionChanged || !gridRef.current?.api) return;
    onSelectionChanged(gridRef.current.api.getSelectedNodes().map((n) => n.data?._rowRef).filter(Boolean));
  }, [onSelectionChanged]);

  const handleColumnResized = useCallback((event: any) => {
    if (!event.finished || !onColumnWidthsChange) return;
    const next: Record<string, number> = {};
    for (const column of event.api.getColumns() ?? []) {
      const colId = column.getColId();
      if (colId === ROW_NUMBER_COL_ID || colId.startsWith("col_")) {
        next[colId] = column.getActualWidth();
      }
    }
    onColumnWidthsChange(next);
  }, [onColumnWidthsChange]);

  const handleCellContextMenu = useCallback((event: CellContextMenuEvent) => {
    const nativeEvent = event.event as MouseEvent | undefined;
    nativeEvent?.preventDefault();
    nativeEvent?.stopPropagation();
    const rowRef = event.data?._rowRef;
    if (!rowRef || !nativeEvent) return;
    onRowContextMenu?.(side, rowRef, nativeEvent.clientX, nativeEvent.clientY);
  }, [onRowContextMenu, side]);

  // Listen to vertical and horizontal scroll events on the AG Grid viewports.
  useEffect(() => {
    if ((!onScroll && !onScrollMetrics) || !containerRef.current) return;
    const viewport = getBodyViewport();
    const horizontalViewport = getHorizontalViewport();
    if (!viewport) return;

    const handler = () => {
      const scrollTop = viewport.scrollTop;
      const scrollLeft = horizontalViewport?.scrollLeft ?? viewport.scrollLeft;
      if (syncingRef.current) {
        const target = syncTargetRef.current;
        const isProgrammaticSyncEvent = target
          && Math.abs(scrollTop - target.top) <= 1
          && Math.abs(scrollLeft - target.left) <= 1;
        if (isProgrammaticSyncEvent) {
          reportScrollMetrics(viewport);
          return;
        }
        releaseScrollHold();
      }
      onScroll?.(scrollTop, scrollLeft, readFirstDisplayedRowIndex(), side);
      reportScrollMetrics(viewport);
    };
    reportScrollMetrics(viewport);
    requestAnimationFrame(() => reportScrollMetrics(viewport));
    viewport.addEventListener('scroll', handler, { passive: true });
    horizontalViewport?.addEventListener('scroll', handler, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', handler);
      horizontalViewport?.removeEventListener('scroll', handler);
    };
  }, [getBodyViewport, getHorizontalViewport, onScroll, readFirstDisplayedRowIndex, releaseScrollHold, reportScrollMetrics, rowData, side]);

  return (
    <div
      ref={containerRef}
      className="ag-theme-alpine h-full w-full"
      onContextMenu={(event) => event.preventDefault()}
    >
      <AgGridReact
        ref={gridRef}
        columnDefs={columnDefs} rowData={rowData}
        getRowId={(params) => params.data._rowRef}
        getRowClass={getRowClass}
        onCellValueChanged={handleCellValueChanged}
        onCellContextMenu={handleCellContextMenu}
        onColumnResized={handleColumnResized}
        onSelectionChanged={handleSelectionChanged}
        rowSelection={ROW_SELECTION_CONFIG}
        rowHeight={ROW_HEIGHT} headerHeight={30}
        rowBuffer={VIRTUAL_ROW_BUFFER}
        animateRows={false}
        suppressScrollOnNewData={true}
        suppressRowHoverHighlight={true}
        suppressCellFocus={!onCellEdit}
        stopEditingWhenCellsLoseFocus={true}
        suppressContextMenu={true}
        defaultColDef={DEFAULT_COL_DEF}
      />
    </div>
  );
});

export default memo(DiffGrid);
