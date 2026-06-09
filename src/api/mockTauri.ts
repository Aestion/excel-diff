import type { FileEntry, ParsedWorkbook, SheetData } from "../types/excel";
import type { VcsCommitSummary, VcsFileInfo } from "../types/vcs";
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

export async function hashFiles(filePaths: string): Promise<Array<{ path: string; hash: string }>>;
export async function hashFiles(filePaths: string[]): Promise<Array<{ path: string; hash: string }>>;
export async function hashFiles(filePaths: string | string[]): Promise<Array<{ path: string; hash: string }>> {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  return paths.map((path) => ({ path, hash: `mock-${path}` }));
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

export async function copyExcelFile(sourcePath: string, targetPath: string): Promise<void> {
  await delay(50);
  console.log("[MOCK] Copied workbook:", sourcePath, "->", targetPath);
  const sourceWorkbook = _savedWorkbooks.get(sourcePath);
  if (sourceWorkbook) {
    _savedWorkbooks.set(targetPath, { ...sourceWorkbook, filePath: targetPath });
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

export async function openVcsLog(path: string): Promise<void> {
  console.log("[MOCK] Open VCS log:", path);
  window.alert(`浏览器测试模式无法打开 Tortoise 日志。\n\n真实 Tauri 应用中会打开：\n${path}`);
}

export async function openInFileExplorer(path: string): Promise<void> {
  console.log("[MOCK] Open in file explorer:", path);
  window.alert(`浏览器测试模式无法打开资源管理器。\n\n真实 Tauri 应用中会定位：\n${path}`);
}

export async function getVcsFileInfo(path: string): Promise<VcsFileInfo> {
  return {
    kind: "git",
    path,
    root: "C:/Mock",
    branch: "main",
    status: "clean",
    lastCommit: {
      id: "mock1234",
      author: "Mock User",
      date: new Date().toISOString(),
      message: "Mock version context",
    },
  };
}

export async function getVcsFileLog(path: string, limit = 20): Promise<VcsCommitSummary[]> {
  return Array.from({ length: Math.min(limit, 3) }, (_, index) => ({
    id: `mock${index + 1}`,
    author: "Mock User",
    date: new Date(Date.now() - index * 86400000).toISOString(),
    message: `Mock commit for ${path.split(/[\\/]/).pop()}`,
  }));
}

export async function exportVcsFileRevision(path: string, revision: string): Promise<string> {
  console.log("[MOCK] Export VCS revision:", revision, path);
  return `${path}.mock-${revision}`;
}

export async function cleanupOldVcsTempExports(maxAgeHours = 24): Promise<void> {
  console.log("[MOCK] Cleanup VCS temp exports older than hours:", maxAgeHours);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
