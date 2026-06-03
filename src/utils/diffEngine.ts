import type { CellValue, Row, SheetData, CellData } from "../types/excel";
import type { CellDiff, DiffResult, DiffRow, RowKey } from "../types/diff";

function serializeCellValue(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    return String(v);
  }
  return String(v);
}

export function buildKey(row: Row, keyColumns: number[]): RowKey {
  return JSON.stringify(
    keyColumns.map((col) => [col, serializeCellValue(row[col]?.value ?? null)])
  );
}

function cellValuesEqual(a: CellValue, b: CellValue): boolean {
  if (a === b) return true;
  if (a === null && b === "") return true;
  if (a === "" && b === null) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-10;
  return false;
}

function cellFormulasEqual(a: string | undefined, b: string | undefined): boolean {
  return a === b;
}

function isEmptyValue(v: CellValue): boolean {
  return v === null || v === undefined || v === "";
}

export function cellDataEqual(oldCell: CellData | undefined, newCell: CellData | undefined): boolean {
  const oldVal = oldCell?.value ?? null;
  const newVal = newCell?.value ?? null;
  const oldFormula = oldCell?.formula;
  const newFormula = newCell?.formula;

  // If both sides have the same formula, consider them equal
  // regardless of cached computed value availability
  if (oldFormula && newFormula && oldFormula === newFormula) return true;

  if (isEmptyValue(oldVal) && isEmptyValue(newVal) && !oldFormula && !newFormula) return true;

  return cellValuesEqual(oldVal, newVal) && cellFormulasEqual(oldFormula, newFormula);
}

function compareRows(oldRow: Row, newRow: Row): CellDiff[] {
  const diffs: CellDiff[] = [];
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

export function computeDiff(
  oldSheet: SheetData,
  newSheet: SheetData,
  keyColumnIndices: number[]
): DiffResult {
  const oldByKey = new Map<RowKey, number[]>();
  for (let i = 1; i < oldSheet.rows.length; i++) {
    const key = buildKey(oldSheet.rows[i], keyColumnIndices);
    const list = oldByKey.get(key) || [];
    list.push(i);
    oldByKey.set(key, list);
  }

  const newByKey = new Map<RowKey, number[]>();
  for (let i = 1; i < newSheet.rows.length; i++) {
    const key = buildKey(newSheet.rows[i], keyColumnIndices);
    const list = newByKey.get(key) || [];
    list.push(i);
    newByKey.set(key, list);
  }

  const consumedOld = new Set<number>();
  const consumedNew = new Set<number>();

  const diffRows: DiffRow[] = [];
  let viewIndex = 0;

  for (let i = 1; i < oldSheet.rows.length; i++) {
    if (consumedOld.has(i)) continue;
    const oldRow = oldSheet.rows[i];
    const key = buildKey(oldRow, keyColumnIndices);

    const newList = newByKey.get(key);
    let matchedNewIdx: number | null = null;
    let matchedCellDiffs: CellDiff[] | null = null;

    if (newList) {
      let bestScore = Number.POSITIVE_INFINITY;
      for (const ni of newList) {
        if (!consumedNew.has(ni)) {
          const candidateDiffs = compareRows(oldRow, newSheet.rows[ni]);
          if (candidateDiffs.length < bestScore) {
            matchedNewIdx = ni;
            matchedCellDiffs = candidateDiffs;
            bestScore = candidateDiffs.length;
            if (bestScore === 0) break;
          }
        }
      }
    }

    if (matchedNewIdx !== null) {
      consumedOld.add(i);
      consumedNew.add(matchedNewIdx);
      const newRow = newSheet.rows[matchedNewIdx];
      const cellDiffs = matchedCellDiffs ?? compareRows(oldRow, newRow);
      diffRows.push({
        viewIndex: viewIndex++,
        status: cellDiffs.length > 0 ? "modified" : "unchanged",
        key,
        oldRowNumber: i + 1,
        newRowNumber: matchedNewIdx + 1,
        oldRow,
        newRow,
        cellDiffs,
        isOverridden: false,
      });
    } else {
      consumedOld.add(i);
      diffRows.push({
        viewIndex: viewIndex++,
        status: "deleted",
        key,
        oldRowNumber: i + 1,
        newRowNumber: null,
        oldRow,
        newRow: null,
        cellDiffs: [],
        isOverridden: false,
      });
    }
  }

  for (let i = 1; i < newSheet.rows.length; i++) {
    if (consumedNew.has(i)) continue;
    const newRow = newSheet.rows[i];
    const key = buildKey(newRow, keyColumnIndices);
    consumedNew.add(i);
    diffRows.push({
      viewIndex: viewIndex++,
      status: "added",
      key,
      oldRowNumber: null,
      newRowNumber: i + 1,
      oldRow: null,
      newRow,
      cellDiffs: [],
      isOverridden: false,
    });
  }

  const stats = {
    totalOld: oldSheet.rows.length - 1,
    totalNew: newSheet.rows.length - 1,
    unchanged: diffRows.filter((r) => r.status === "unchanged").length,
    added: diffRows.filter((r) => r.status === "added").length,
    deleted: diffRows.filter((r) => r.status === "deleted").length,
    modified: diffRows.filter((r) => r.status === "modified").length,
  };

  return { keyColumnIndices, diffRows, stats };
}
