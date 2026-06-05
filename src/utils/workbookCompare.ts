import type { ParsedWorkbook, Row, SheetData } from "../types/excel";
import { buildKey, cellDataEqual, computeDiff } from "./diffEngine";

function trimRow(row: Row): Row {
  let end = row.length;
  while (end > 0 && cellDataEqual(row[end - 1], undefined)) end--;
  return row.slice(0, end);
}

function trimRows(rows: Row[]): Row[] {
  const trimmed = rows.map(trimRow);
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1].length === 0) end--;
  return trimmed.slice(0, end);
}

export function rowsEqual(a: Row[], b: Row[]): boolean {
  const aa = trimRows(a);
  const bb = trimRows(b);
  if (aa.length !== bb.length) return false;
  for (let rowIndex = 0; rowIndex < aa.length; rowIndex++) {
    const maxCols = Math.max(aa[rowIndex].length, bb[rowIndex].length);
    for (let colIndex = 0; colIndex < maxCols; colIndex++) {
      if (!cellDataEqual(aa[rowIndex][colIndex], bb[rowIndex][colIndex])) return false;
    }
  }
  return true;
}

function serializeKeyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function detectSemanticKeyColumns(sheet: SheetData): number[] {
  if (sheet.rows.length < 2) return [];
  const colCount = sheet.columns.length;
  const scores: Array<{ index: number; score: number }> = [];

  for (let col = 0; col < colCount; col++) {
    const header = (sheet.columns[col]?.name ?? "").trim();
    if (!header || header === "None" || header.startsWith("Column ")) continue;

    const values: string[] = [];
    const total = sheet.rows.length - 1;
    for (let rowIndex = 1; rowIndex < sheet.rows.length; rowIndex++) {
      const value = sheet.rows[rowIndex]?.[col]?.value;
      const keyValue = serializeKeyValue(value);
      if (keyValue !== "") values.push(keyValue);
    }
    if (values.length === 0 || values.length * 5 < total * 4) continue;

    scores.push({ index: col, score: new Set(values).size / values.length });
  }

  scores.sort((a, b) => b.score - a.score);
  const unique = scores.filter(({ score }) => score > 0.95).map(({ index }) => index);
  return unique.length > 0 ? unique : scores.slice(0, 3).map(({ index }) => index);
}

export function sheetsEqualByKey(oldSheet: SheetData, newSheet: SheetData): boolean {
  const keyColumns = detectSemanticKeyColumns(newSheet);
  if (keyColumns.length === 0) return rowsEqual(oldSheet.rows, newSheet.rows);

  const diff = computeDiff(oldSheet, newSheet, keyColumns);
  return diff.stats.added === 0 && diff.stats.deleted === 0 && diff.stats.modified === 0;
}

export function workbooksEqual(a: ParsedWorkbook, b: ParsedWorkbook): boolean {
  if (a.sheetNames.length !== b.sheetNames.length) return false;
  for (const sheetName of a.sheetNames) {
    const oldSheet = a.sheets.find((s) => s.name === sheetName);
    const newSheet = b.sheets.find((s) => s.name === sheetName);
    if (!oldSheet || !newSheet || !sheetsEqualByKey(oldSheet, newSheet)) return false;
  }
  return true;
}
