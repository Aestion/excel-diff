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
  return JSON.stringify(value);
}

function rowSignature(row: Row): string {
  let lastNonEmpty = row.length - 1;
  while (lastNonEmpty >= 0 && cellDataEqual(row[lastNonEmpty], undefined)) {
    lastNonEmpty--;
  }
  return JSON.stringify(row.slice(0, lastNonEmpty + 1).map(cellSignature));
}

function rowIsEmpty(row: Row | undefined): boolean {
  return !row || row.every((cell) => cellDataEqual(cell, undefined));
}

function cellValuesEqual(a: CellValue, b: CellValue): boolean {
  if (a === b) return true;
  if (a === null && b === "") return true;
  if (a === "" && b === null) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-10;
  if (typeof a === "number" && typeof b === "string") {
    return String(a) === b.trim();
  }
  if (typeof a === "string" && typeof b === "number") {
    return a.trim() === String(b);
  }
  if (typeof a === "string" && typeof b === "string") {
    return normalizeTextValue(a) === normalizeTextValue(b);
  }
  return false;
}

function normalizeFormulaForRow(formula: string, excelRowNumber: number | null): string {
  if (excelRowNumber == null) return formula;

  return formula.replace(/(\$?[A-Za-z]{1,3})(\$?)(\d+)/g, (_match, column: string, rowAnchor: string, rowText: string) => {
    if (rowAnchor === "$") return `${column}${rowAnchor}${rowText}`;
    const rowNumber = Number(rowText);
    if (!Number.isFinite(rowNumber)) return `${column}${rowText}`;
    return `${column}[r${rowNumber - excelRowNumber}]`;
  });
}

function cellFormulasEqual(
  a: string | undefined,
  b: string | undefined,
  oldExcelRowNumber: number | null = null,
  newExcelRowNumber: number | null = null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return normalizeFormulaForRow(a, oldExcelRowNumber) === normalizeFormulaForRow(b, newExcelRowNumber);
}

function isEmptyValue(v: CellValue): boolean {
  return v === null || v === undefined || v === "";
}

export function cellDataEqual(oldCell: CellData | undefined, newCell: CellData | undefined): boolean {
  return cellDataEqualAt(oldCell, newCell);
}

function cellDataEqualAt(
  oldCell: CellData | undefined,
  newCell: CellData | undefined,
  oldExcelRowNumber: number | null = null,
  newExcelRowNumber: number | null = null
): boolean {
  const oldVal = oldCell?.value ?? null;
  const newVal = newCell?.value ?? null;
  const oldFormula = oldCell?.formula;
  const newFormula = newCell?.formula;

  // If both sides have the same formula, consider them equal regardless of
  // cached computed value availability. Relative row references may shift
  // when rows are inserted above, so compare formulas in row context.
  if (oldFormula && newFormula && cellFormulasEqual(oldFormula, newFormula, oldExcelRowNumber, newExcelRowNumber)) return true;

  if (isEmptyValue(oldVal) && isEmptyValue(newVal) && !oldFormula && !newFormula) return true;

  // This tool compares the effective table data. If the displayed/computed
  // values are equal, do not mark a difference just because one side stores a
  // formula and the other side stores the computed value.
  if (cellValuesEqual(oldVal, newVal)) return true;

  return !!oldFormula && !!newFormula && cellFormulasEqual(oldFormula, newFormula, oldExcelRowNumber, newExcelRowNumber);
}

function compareRows(oldRow: Row, newRow: Row, oldExcelRowNumber: number | null = null, newExcelRowNumber: number | null = null): CellDiff[] {
  const diffs: CellDiff[] = [];
  const maxCols = Math.max(oldRow.length, newRow.length);
  for (let col = 0; col < maxCols; col++) {
    const oldCell = col < oldRow.length ? oldRow[col] : { value: null };
    const newCell = col < newRow.length ? newRow[col] : { value: null };

    if (!cellDataEqualAt(oldCell, newCell, oldExcelRowNumber, newExcelRowNumber)) {
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

  const keyHasUnconsumedOldRow = (key: RowKey): boolean => {
    return oldByKey.get(key)?.some((idx) => !consumedOld.has(idx)) ?? false;
  };

  const pushAddedNewRow = (newIdx: number) => {
    const newRow = newSheet.rows[newIdx];
    const key = buildKey(newRow, keyColumnIndices);
    consumedNew.add(newIdx);
    diffRows.push({
      viewIndex: viewIndex++,
      status: "added",
      key,
      oldRowNumber: null,
      newRowNumber: newIdx + 1,
      oldRow: null,
      newRow,
      cellDiffs: [],
      isOverridden: false,
      hasDuplicateKey: duplicateKeySet.has(key),
    });
  };

  const pushInsertedNewRowsBefore = (limitNewIdx: number) => {
    for (let ni = 1; ni < limitNewIdx; ni++) {
      if (consumedNew.has(ni)) continue;
      const key = buildKey(newSheet.rows[ni], keyColumnIndices);
      if (keyHasUnconsumedOldRow(key)) continue;
      pushAddedNewRow(ni);
    }
  };

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
            const candidateDiffs = compareRows(oldRow, newSheet.rows[ni], i + 1, ni + 1);
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
      pushInsertedNewRowsBefore(matchedNewIdx);
      consumedOld.add(i);
      consumedNew.add(matchedNewIdx);
      const newRow = newSheet.rows[matchedNewIdx];
      const cellDiffs = matchedCellDiffs ?? compareRows(oldRow, newRow, i + 1, matchedNewIdx + 1);
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
      if (!rowIsEmpty(oldRow)) {
        const samePositionNewRow = newSheet.rows[i];
        if (!consumedNew.has(i) && rowIsEmpty(samePositionNewRow)) {
          consumedNew.add(i);
        }
      }
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
    pushAddedNewRow(i);
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
