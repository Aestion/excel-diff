import type { CellValue, Row } from "./excel";

export type RowStatus = "unchanged" | "modified" | "added" | "deleted";
export type RowKey = string;

export interface CellDiff {
  columnIndex: number;
  oldValue: CellValue;
  newValue: CellValue;
  oldFormula?: string;
  newFormula?: string;
  isDifferent: boolean;
}

export interface DiffRow {
  viewIndex: number;
  status: RowStatus;
  key: RowKey;
  oldRow: Row | null;
  newRow: Row | null;
  cellDiffs: CellDiff[];
  isOverridden: boolean;
}

export interface DiffResult {
  keyColumnIndices: number[];
  diffRows: DiffRow[];
  stats: {
    totalOld: number;
    totalNew: number;
    unchanged: number;
    added: number;
    deleted: number;
    modified: number;
  };
}
