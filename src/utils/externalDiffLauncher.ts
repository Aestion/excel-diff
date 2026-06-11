import { readExcel, type ExternalDiffRequest } from "../api/tauri";
import { useDiffStore } from "../stores/diffStore";
import { useEditStore } from "../stores/editStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { FilePair, ParsedWorkbook } from "../types/excel";
import { computeDiff } from "./diffEngine";
import { captureDiffTabSnapshot } from "./diffTabSnapshot";
import { detectSemanticKeyColumns } from "./workbookCompare";

const SUPPORTED_EXTENSIONS = new Set(["xlsx", "xlsm", "xlsb", "xls", "csv", "tsv"]);

function basename(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
}

function extension(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function commonTitle(request: ExternalDiffRequest): string {
  if (request.title?.trim()) return basename(request.title.trim());
  const left = basename(request.sourcePath);
  const right = basename(request.destinationPath);
  return left === right ? left : `${left} vs ${right}`;
}

function createExternalFilePair(request: ExternalDiffRequest, title: string): FilePair {
  return {
    filename: title,
    relativePath: `external/${title}`,
    oldPath: request.sourcePath,
    newPath: request.destinationPath,
    oldSize: 0,
    newSize: 0,
    status: "matched",
    diffStatus: "unknown",
    oldReadOnly: true,
    compareNote: "External diff",
  };
}

function computeFirstSheetDiff(oldWorkbook: ParsedWorkbook, newWorkbook: ParsedWorkbook) {
  const commonSheets = oldWorkbook.sheetNames.filter((name) => newWorkbook.sheetNames.includes(name));
  const sheetName = commonSheets[0] || oldWorkbook.sheetNames[0] || newWorkbook.sheetNames[0] || "";
  if (!sheetName) {
    return { sheetName, keyColumnIndices: [], diffResult: null };
  }

  const oldSheet = oldWorkbook.sheets.find((sheet) => sheet.name === sheetName);
  const newSheet = newWorkbook.sheets.find((sheet) => sheet.name === sheetName);
  if (!oldSheet || !newSheet) {
    return { sheetName, keyColumnIndices: [], diffResult: null };
  }

  const keyColumnIndices = detectSemanticKeyColumns(newSheet);
  return {
    sheetName,
    keyColumnIndices,
    diffResult: computeDiff(oldSheet, newSheet, keyColumnIndices),
  };
}

export async function openExternalDiff(request: ExternalDiffRequest): Promise<void> {
  const sourceExt = extension(request.sourcePath);
  const destinationExt = extension(request.destinationPath);
  if (!SUPPORTED_EXTENSIONS.has(sourceExt) || !SUPPORTED_EXTENSIONS.has(destinationExt)) {
    throw new Error(`Unsupported file type: ${basename(request.sourcePath)} / ${basename(request.destinationPath)}`);
  }

  const [oldWorkbook, newWorkbook] = await Promise.all([
    readExcel(request.sourcePath),
    readExcel(request.destinationPath),
  ]);

  const title = commonTitle(request);
  const pair = createExternalFilePair(request, title);
  const { sheetName, keyColumnIndices, diffResult } = computeFirstSheetDiff(oldWorkbook, newWorkbook);

  const diffStore = useDiffStore.getState();
  diffStore.setOldWorkbook(oldWorkbook);
  diffStore.setNewWorkbook(newWorkbook);
  diffStore.selectFilePair(pair);
  diffStore.setCurrentSheet(sheetName);
  diffStore.setKeyColumnIndices(keyColumnIndices);
  diffStore.setDiffResult(diffResult);
  diffStore.setEffectiveNewRows(null);
  diffStore.setHasUnsavedChanges(false);
  diffStore.setView("diff");
  useEditStore.getState().clear();

  useWorkspaceStore.getState().openDiffTab({
    title,
    fileKey: `external:${request.sourcePath}:${request.destinationPath}`,
    revision: "external",
    snapshot: captureDiffTabSnapshot(),
  });
}
