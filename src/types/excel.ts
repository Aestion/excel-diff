export type CellValue = string | number | boolean | null;

export interface CellData {
  value: CellValue;
  formula?: string;
}

export type Row = CellData[];

export interface ColumnInfo {
  index: number;
  name: string;
  dataType: string;
}

export interface SheetData {
  name: string;
  columns: ColumnInfo[];
  rows: Row[];
}

export interface ParsedWorkbook {
  filePath: string;
  sheets: SheetData[];
  sheetNames: string[];
}

export interface FileEntry {
  name: string;
  path: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt?: number;
}

export type FileMatchStatus = "matched" | "old-only" | "new-only";
export type DiffStatus = "identical" | "different" | "unknown";

export interface FilePair {
  filename: string;
  relativePath: string;
  oldPath: string | null;
  newPath: string | null;
  oldSize: number;
  newSize: number;
  oldModifiedAt?: number;
  newModifiedAt?: number;
  status: FileMatchStatus;
  diffStatus: DiffStatus;
  oldReadOnly?: boolean;
  newReadOnly?: boolean;
  compareNote?: string;
}
