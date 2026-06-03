import { useMemo, useCallback, useRef, useEffect } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, RowClassParams, CellValueChangedEvent } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import type { CellValue, ColumnInfo } from "../types/excel";
import type { DiffResult, DiffRow } from "../types/diff";

function getDiffRowRef(row: DiffRow): string {
  return `${row.oldRowNumber ?? ""}:${row.newRowNumber ?? ""}:${row.viewIndex}`;
}

interface DiffGridProps {
  side: "old" | "new";
  diffResult: DiffResult;
  columns: ColumnInfo[];
  onCellEdit?: (rowRef: string, colIndex: number, oldValue: CellValue, newValue: CellValue, oldFormula?: string, newFormula?: string) => void;
  onSelectionChanged?: (selectedRowRefs: string[]) => void;
  filter?: "all" | "diff" | "same";
  scrollTop?: number;
  onScroll?: (scrollTop: number) => void;
  searchText?: string;
  searchMatches?: { rowRef: string; side: "old" | "new"; colIndex: number; value: string }[];
  currentMatchIndex?: number;
  scrollToRowRef?: string | null;
}

export default function DiffGrid({ side, diffResult, columns, onCellEdit, onSelectionChanged, filter = "all", scrollTop, onScroll, searchText, searchMatches, currentMatchIndex, scrollToRowRef }: DiffGridProps) {
  const gridRef = useRef<AgGridReact>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const columnDefs: ColDef[] = useMemo(() => {
    const defs: ColDef[] = [
      {
        headerName: "#",
        valueGetter: (p: any) => p.node?.rowIndex != null ? p.node.rowIndex + 1 : "",
        width: 40, pinned: "left", suppressSizeToFit: true,
      },
    ];
    for (const col of columns) {
      defs.push({
        headerName: col.name, field: `col_${col.index}`,
        editable: side === "new", flex: 1, minWidth: 70,
        cellClassRules: {
          "cell-modified": (p: any) => {
            if (p.data?._status !== "modified") return false;
            return (p.data?._cellDiffs as number[] | undefined)?.includes(col.index) ?? false;
          },
          "cell-search-match": (p: any) => {
            if (!searchText || !searchMatches) return false;
            return searchMatches.some(m => m.rowRef === p.data?._rowRef && m.side === side && m.colIndex === col.index);
          },
          "cell-search-current": (p: any) => {
            if (!searchText || !searchMatches || currentMatchIndex == null) return false;
            const current = searchMatches[currentMatchIndex];
            return current && current.rowRef === p.data?._rowRef && current.side === side && current.colIndex === col.index;
          },
        },
      });
    }
    return defs;
  }, [columns, side, searchText, searchMatches, currentMatchIndex]);

  const rowData = useMemo(() => {
    let rows = diffResult.diffRows;
    if (filter === "diff") rows = rows.filter((r) => r.status !== "unchanged");
    return rows.map((dr) => {
      const sourceRow = side === "old" ? dr.oldRow : dr.newRow;
      const row: Record<string, any> = {
        _key: dr.key, _rowRef: getDiffRowRef(dr), _status: dr.status, _diffRow: dr,
        _cellDiffs: dr.cellDiffs.map((d) => d.columnIndex),
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
    switch (params.data?._status) {
      case "added":    return "row-added";
      case "deleted":  return "row-deleted";
      case "modified": return "row-modified";
      default:         return "";
    }
  }, []);

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

  useEffect(() => {
    if (!scrollToRowRef || !gridRef.current?.api) return;
    const rowIndex = rowData.findIndex((row) => row._rowRef === scrollToRowRef);
    if (rowIndex < 0) return;

    gridRef.current.api.ensureIndexVisible(rowIndex, "middle");
  }, [scrollToRowRef, rowData]);

  // Sync scroll via DOM
  useEffect(() => {
    if (scrollTop === undefined || !containerRef.current) return;
    syncingRef.current = true;
    const viewport = containerRef.current.querySelector('.ag-body-viewport') as HTMLElement;
    if (viewport) viewport.scrollTop = scrollTop;
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, [scrollTop]);

  // Listen to scroll events on the viewport
  useEffect(() => {
    if (!onScroll || !containerRef.current) return;
    const viewport = containerRef.current.querySelector('.ag-body-viewport') as HTMLElement;
    if (!viewport) return;

    const handler = () => {
      if (syncingRef.current) return;
      onScroll(viewport.scrollTop);
    };
    viewport.addEventListener('scroll', handler, { passive: true });
    return () => viewport.removeEventListener('scroll', handler);
  }, [onScroll, rowData]); // re-attach when data changes

  return (
    <div ref={containerRef} className="ag-theme-alpine h-full w-full">
      <AgGridReact
        ref={gridRef}
        columnDefs={columnDefs} rowData={rowData}
        getRowClass={getRowClass}
        onCellValueChanged={handleCellValueChanged}
        onSelectionChanged={handleSelectionChanged}
        rowSelection={{
          mode: "multiRow",
          checkboxes: true,
          headerCheckbox: true,
          enableClickSelection: true,
        }}
        rowHeight={26} headerHeight={30}
        animateRows={false}
        suppressCellFocus={side === "old"}
        stopEditingWhenCellsLoseFocus={true}
        defaultColDef={{ sortable: true, resizable: true }}
      />
    </div>
  );
}
