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
  oldRowNumber: number | null;
  newRowNumber: number | null;
  oldRow: Row | null;
  newRow: Row | null;
  cellDiffs: CellDiff[];
  isOverridden: boolean;
  hasDuplicateKey?: boolean;
}

export interface DuplicateKeyInfo {
  key: RowKey;
  oldCount: number;
  newCount: number;
}

export interface DiffResult {
  keyColumnIndices: number[];
  diffRows: DiffRow[];
  duplicateKeys?: DuplicateKeyInfo[];
  stats: {
    totalOld: number;
    totalNew: number;
    unchanged: number;
    added: number;
    deleted: number;
    modified: number;
  };
}
