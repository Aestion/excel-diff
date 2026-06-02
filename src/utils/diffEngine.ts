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
  return keyColumns
    .map((col) => `${col}:${serializeCellValue(row[col]?.value ?? null)}`)
    .join("|");
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

function compareRows(oldRow: Row, newRow: Row): CellDiff[] {
  const diffs: CellDiff[] = [];
  const maxCols = Math.max(oldRow.length, newRow.length);
  for (let col = 0; col < maxCols; col++) {
    const oldCell = col < oldRow.length ? oldRow[col] : { value: null };
    const newCell = col < newRow.length ? newRow[col] : { value: null };

    const oldVal = oldCell.value;
    const newVal = newCell.value;
    const oldFormula = oldCell.formula;
    const newFormula = newCell.formula;

    // If both sides have the same formula, consider them equal
    // regardless of cached computed value availability
    if (oldFormula && newFormula && oldFormula === newFormula) continue;

    if (isEmptyValue(oldVal) && isEmptyValue(newVal) && !oldFormula && !newFormula) continue;

    const valueDiff = !cellValuesEqual(oldVal, newVal);
    const formulaDiff = !cellFormulasEqual(oldFormula, newFormula);

    if (valueDiff || formulaDiff) {
      diffs.push({
        columnIndex: col,
        oldValue: oldVal,
        newValue: newVal,
        oldFormula,
        newFormula,
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

    if (newList) {
      for (const ni of newList) {
        if (!consumedNew.has(ni)) {
          matchedNewIdx = ni;
          break;
        }
      }
    }

    if (matchedNewIdx !== null) {
      consumedOld.add(i);
      consumedNew.add(matchedNewIdx);
      const newRow = newSheet.rows[matchedNewIdx];
      const cellDiffs = compareRows(oldRow, newRow);
      diffRows.push({
        viewIndex: viewIndex++,
        status: cellDiffs.length > 0 ? "modified" : "unchanged",
        key,
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
