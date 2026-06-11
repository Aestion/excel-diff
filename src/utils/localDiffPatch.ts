import type { CellData, Row } from "../types/excel";
import type { DiffResult, DiffRow } from "../types/diff";
import { cellDataEqual } from "./diffEngine";

export function getDiffRowRef(row: DiffRow): string {
  return `${row.oldRowNumber ?? ""}:${row.newRowNumber ?? ""}:${row.viewIndex}`;
}

function hasFormula(cell: CellData | undefined): boolean {
  return !!cell?.formula;
}

function compareRows(oldRow: Row, newRow: Row): DiffRow["cellDiffs"] {
  const diffs: DiffRow["cellDiffs"] = [];
  const maxCols = Math.max(oldRow.length, newRow.length);
  for (let col = 0; col < maxCols; col++) {
    const oldCell = col < oldRow.length ? oldRow[col] : { value: null };
    const newCell = col < newRow.length ? newRow[col] : { value: null };
    if (!cellDataEqual(oldCell, newCell)) {
      diffs.push({
        columnIndex: col,
        oldValue: oldCell.value,
        newValue: newCell.value,
        oldFormula: oldCell.formula,
        newFormula: newCell.formula,
        isDifferent: true,
      });
    }
  }
  return diffs;
}

export function patchDiffResultForCellEdit(
  diffResult: DiffResult,
  rowRef: string,
  nextNewRow: Row,
  editedColumnIndex: number,
  keyColumnIndices: number[]
): DiffResult | null {
  if (keyColumnIndices.includes(editedColumnIndex)) return null;

  const rowIndex = diffResult.diffRows.findIndex((row) => getDiffRowRef(row) === rowRef);
  if (rowIndex < 0) return null;

  const row = diffResult.diffRows[rowIndex];
  if (!row.oldRow || !row.newRow || !row.newRowNumber) return null;
  if (row.status !== "modified" && row.status !== "unchanged") return null;
  if (hasFormula(row.oldRow[editedColumnIndex]) || hasFormula(row.newRow[editedColumnIndex]) || hasFormula(nextNewRow[editedColumnIndex])) {
    return null;
  }

  const cellDiffs = compareRows(row.oldRow, nextNewRow);
  const status = cellDiffs.length > 0 ? "modified" : "unchanged";
  if (status === row.status && cellDiffs.length === row.cellDiffs.length) {
    let sameDiffs = true;
    for (let i = 0; i < cellDiffs.length; i++) {
      if (cellDiffs[i].columnIndex !== row.cellDiffs[i].columnIndex) {
        sameDiffs = false;
        break;
      }
    }
    if (sameDiffs && row.newRow === nextNewRow) return diffResult;
  }

  const nextRows = diffResult.diffRows.slice();
  nextRows[rowIndex] = {
    ...row,
    status,
    newRow: nextNewRow,
    cellDiffs,
  };

  const stats = { ...diffResult.stats };
  if (row.status !== status) {
    stats[row.status]--;
    stats[status]++;
  }

  return {
    ...diffResult,
    diffRows: nextRows,
    stats,
  };
}
