import type { FileEntry, ParsedWorkbook, SheetData } from "../types/excel";
import { generateMockFiles, generateMockNewFiles, generateMockWorkbook } from "./mockData";

let _oldDir = "";
let _newDir = "";
let _oldFiles: FileEntry[] = [];
let _newFiles: FileEntry[] = [];
let _savedWorkbooks: Map<string, ParsedWorkbook> = new Map();

export async function pickDirectory(): Promise<string | null> {
  // Return a mock directory path
  return new Promise((resolve) => {
    setTimeout(() => resolve(`C:/Mock/Directory_${Date.now()}`), 100);
  });
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  return `C:/Mock/Exports/${defaultName}`;
}

export async function saveTextFile(path: string, content: string): Promise<void> {
  console.log("[MOCK] Saved text file:", path, "Content length:", content.length);
}

export async function listExcelFiles(dirPath: string): Promise<FileEntry[]> {
  await delay(200);
  if (!_oldDir || _oldDir === dirPath) {
    _oldDir = dirPath;
    _oldFiles = generateMockFiles(dirPath);
    return _oldFiles;
  }
  _newDir = dirPath;
  _newFiles = generateMockNewFiles(dirPath);
  return _newFiles;
}

export async function readExcel(filePath: string): Promise<ParsedWorkbook> {
  await delay(300);

  // Return saved workbook if available
  if (_savedWorkbooks.has(filePath)) {
    return _savedWorkbooks.get(filePath)!;
  }

  const isOld = filePath.includes(_oldDir) || !filePath.includes(_newDir);
  const name = filePath.split("/").pop() || "file";

  if (name === "employees.xlsx") {
    return generateMockWorkbook("employees", isOld ? "old" : "new");
  }

  // Generic workbook for other files
  const rows: SheetData["rows"] = [
    [{ value: "ID" }, { value: "Value" }],
    [{ value: "1" }, { value: "A" }],
    [{ value: "2" }, { value: "B" }],
  ];

  return {
    filePath,
    sheets: [{
      name: "Sheet1",
      columns: [
        { index: 0, name: "ID", dataType: "string" },
        { index: 1, name: "Value", dataType: "string" },
      ],
      rows,
    }],
    sheetNames: ["Sheet1"],
  };
}

export async function writeExcel(filePath: string, sheets: SheetData[]): Promise<void> {
  await delay(200);
  console.log("[MOCK] Wrote workbook:", filePath);

  // Store the written workbook so subsequent reads return updated data
  const existing = _savedWorkbooks.get(filePath);
  if (existing) {
    _savedWorkbooks.set(filePath, { ...existing, sheets });
  }
}

export async function writeExcelChanges(filePath: string, changesJson: string): Promise<void> {
  await delay(200);
  console.log("[MOCK] Wrote changes to:", filePath, changesJson.substring(0, 100));
}

export async function detectKeyColumns(filePath: string, sheetName: string): Promise<number[]> {
  await delay(150);
  // Auto-detect: first column (ID) is typically the key
  return [0];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
