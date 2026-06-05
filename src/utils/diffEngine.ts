import type { CellValue, Row, SheetData, CellData } from "../types/excel";
import type { CellDiff, DiffResult, DiffRow, RowKey } from "../types/diff";

function serializeCellValue(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    return String(v);
  }
  return normalizeTextValue(String(v));
}

export function normalizeTextValue(value: string): string {
  return value
    .replace(/_x005F_x000D__x000D_\r\n/gi, "_x000D_\n")
    .replace(/_x005F_x000D__x000D_\r/gi, "_x000D_\n")
    .replace(/_x005F_x000D__x000D_\n/gi, "_x000D_\n")
    .replace(/_x005F_x000A__x000A_\r\n/gi, "_x000A_\n")
    .replace(/_x005F_x000A__x000A_\r/gi, "_x000A_\n")
    .replace(/_x005F_x000A__x000A_\n/gi, "_x000A_\n")
    .replace(/_x005F_x000D__x000D_/gi, "_x000D_\n")
    .replace(/_x005F_x000A__x000A_/gi, "_x000A_\n")
    .replace(/_x005F_x000D_/gi, "_x000D_")
    .replace(/_x005F_x000A_/gi, "_x000A_")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/_x005F_/gi, "_");
}

export function buildKey(row: Row, keyColumns: number[]): RowKey {
  return JSON.stringify(
    keyColumns.map((col) => [col, serializeCellValue(row[col]?.value ?? null)])
  );
}

function cellSignature(cell: CellData | undefined): string {
  const rawValue = cell?.value ?? null;
  const value = typeof rawValue === "string" ? normalizeTextValue(rawValue) : rawValue;
  const formula = cell?.formula ?? null;
  return JSON.stringify([value, formula]);
}

function rowSignature(row: Row): string {
  let lastNonEmpty = row.length - 1;
  while (lastNonEmpty >= 0 && cellDataEqual(row[lastNonEmpty], undefined)) {
    lastNonEmpty--;
  }
  return JSON.stringify(row.slice(0, lastNonEmpty + 1).map(cellSignature));
}

function cellValuesEqual(a: CellValue, b: CellValue): boolean {
  if (a === b) return true;
  if (a === null && b === "") return true;
  if (a === "" && b === null) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-10;
  if (typeof a === "string" && typeof b === "string") {
    return normalizeTextValue(a) === normalizeTextValue(b);
  }
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
  const newSignatureByIndex = new Map<number, string>();
  for (let i = 1; i < newSheet.rows.length; i++) {
    const key = buildKey(newSheet.rows[i], keyColumnIndices);
    const list = newByKey.get(key) || [];
    list.push(i);
    newByKey.set(key, list);
    newSignatureByIndex.set(i, rowSignature(newSheet.rows[i]));
  }

  const consumedOld = new Set<number>();
  const consumedNew = new Set<number>();
  const duplicateKeySet = new Set<RowKey>();
  for (const key of new Set([...oldByKey.keys(), ...newByKey.keys()])) {
    const oldCount = oldByKey.get(key)?.length ?? 0;
    const newCount = newByKey.get(key)?.length ?? 0;
    if (oldCount > 1 || newCount > 1) duplicateKeySet.add(key);
  }

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
      const oldSignature = rowSignature(oldRow);
      let bestExactDistance = Number.POSITIVE_INFINITY;
      for (const ni of newList) {
        if (!consumedNew.has(ni) && newSignatureByIndex.get(ni) === oldSignature) {
          const distance = Math.abs(ni - i);
          if (distance < bestExactDistance) {
            matchedNewIdx = ni;
            bestExactDistance = distance;
          }
          matchedCellDiffs = [];
        }
      }

      let bestScore = Number.POSITIVE_INFINITY;
      let bestDistance = Number.POSITIVE_INFINITY;
      if (matchedNewIdx === null) {
        for (const ni of newList) {
          if (!consumedNew.has(ni)) {
            const candidateDiffs = compareRows(oldRow, newSheet.rows[ni]);
            const distance = Math.abs(ni - i);
            if (candidateDiffs.length < bestScore || (candidateDiffs.length === bestScore && distance < bestDistance)) {
              matchedNewIdx = ni;
              matchedCellDiffs = candidateDiffs;
              bestScore = candidateDiffs.length;
              bestDistance = distance;
            }
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
        hasDuplicateKey: duplicateKeySet.has(key),
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
        hasDuplicateKey: duplicateKeySet.has(key),
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
      hasDuplicateKey: duplicateKeySet.has(key),
    });
  }

  const duplicateKeys = Array.from(duplicateKeySet).map((key) => ({
    key,
    oldCount: oldByKey.get(key)?.length ?? 0,
    newCount: newByKey.get(key)?.length ?? 0,
  }));

  const stats = {
    totalOld: oldSheet.rows.length - 1,
    totalNew: newSheet.rows.length - 1,
    unchanged: diffRows.filter((r) => r.status === "unchanged").length,
    added: diffRows.filter((r) => r.status === "added").length,
    deleted: diffRows.filter((r) => r.status === "deleted").length,
    modified: diffRows.filter((r) => r.status === "modified").length,
  };

  return { keyColumnIndices, diffRows, duplicateKeys, stats };
}
