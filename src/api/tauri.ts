import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { copyFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { FileEntry, ParsedWorkbook, SheetData } from "../types/excel";
import type { VcsCommitSummary, VcsFileInfo } from "../types/vcs";
import * as mock from "./mockTauri";

async function tryReal<T>(realFn: () => Promise<T>, mockFn: () => Promise<T>): Promise<T> {
  try {
    return await realFn();
  } catch (e: any) {
    // If the error indicates we're not in Tauri (e.g. plugin not initialized), use mock
    if (e?.message?.includes("window.__TAURI__") ||
        e?.message?.includes("not allowed") ||
        e?.message?.includes("undefined") ||
        e?.message?.includes("plugin")) {
      return mockFn();
    }
    throw e;
  }
}

export async function pickDirectory(): Promise<string | null> {
  return tryReal(
    async () => {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择目录",
      });
      return selected as string | null;
    },
    () => mock.pickDirectory()
  );
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  return tryReal(
    async () => {
      const selected = await save({
        defaultPath: defaultName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (selected === null) return null;
      if (Array.isArray(selected)) return selected[0] || null;
      return selected;
    },
    () => mock.pickSavePath(defaultName)
  );
}

export async function saveTextFile(path: string, content: string): Promise<void> {
  return tryReal(
    () => writeTextFile(path, content),
    () => mock.saveTextFile(path, content)
  );
}

export async function listExcelFiles(dirPath: string): Promise<FileEntry[]> {
  return tryReal(
    () => invoke("list_excel_files", { dirPath }),
    () => mock.listExcelFiles(dirPath)
  );
}

export async function readExcel(filePath: string): Promise<ParsedWorkbook> {
  return tryReal(
    () => invoke("read_excel", { filePath }),
    () => mock.readExcel(filePath)
  );
}

export async function hashFiles(filePaths: string[]): Promise<Array<{ path: string; hash: string }>> {
  return tryReal(
    () => invoke("hash_files", { filePaths }),
    () => mock.hashFiles(filePaths)
  );
}

export async function copyExcelFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await copyFile(sourcePath, targetPath);
  } catch (e: any) {
    const message = String(e?.message ?? e ?? "");
    if (!message.includes("window.__TAURI__") && !message.includes("undefined") && !message.includes("plugin")) {
      try {
        await invoke("copy_excel_file", { sourcePath, targetPath });
        return;
      } catch (invokeError: any) {
        const invokeMessage = String(invokeError?.message ?? invokeError ?? "");
        if (!invokeMessage.includes("Command not found") && !invokeMessage.includes("copy_excel_file")) {
          throw invokeError;
        }
      }
    }
    if (message.includes("window.__TAURI__") || message.includes("undefined") || message.includes("plugin")) {
      await mock.copyExcelFile(sourcePath, targetPath);
      return;
    }
    const workbook = await readExcel(sourcePath);
    await writeExcel(targetPath, workbook.sheets);
  }
}

export async function writeExcel(
  filePath: string,
  sheets: SheetData[]
): Promise<void> {
  return tryReal(
    () => invoke("write_excel", { filePath, sheets }),
    () => mock.writeExcel(filePath, sheets)
  );
}

export async function writeExcelChanges(
  filePath: string,
  changesJson: string
): Promise<void> {
  return tryReal(
    () => invoke("write_excel_changes", { filePath, changesJson }),
    () => mock.writeExcelChanges(filePath, changesJson)
  );
}

export async function detectKeyColumns(
  filePath: string,
  sheetName: string
): Promise<number[]> {
  return tryReal(
    () => invoke("detect_key_columns", { filePath, sheetName }),
    () => mock.detectKeyColumns(filePath, sheetName)
  );
}

export async function getExcelEngineStatus(): Promise<string> {
  return tryReal(
    () => invoke("get_excel_engine_status"),
    () => Promise.resolve("openpyxl")
  );
}

export async function openVcsLog(path: string): Promise<void> {
  return tryReal(
    () => invoke("open_vcs_log", { path }),
    () => mock.openVcsLog(path)
  );
}

export async function openInFileExplorer(path: string): Promise<void> {
  return tryReal(
    () => invoke("open_in_file_explorer", { path }),
    () => mock.openInFileExplorer(path)
  );
}

export async function getVcsFileInfo(path: string): Promise<VcsFileInfo> {
  return tryReal(
    () => invoke("get_vcs_file_info", { path }),
    () => mock.getVcsFileInfo(path)
  );
}

export async function getVcsFileLog(path: string, limit = 20): Promise<VcsCommitSummary[]> {
  return tryReal(
    () => invoke("get_vcs_file_log", { path, limit }),
    () => mock.getVcsFileLog(path, limit)
  );
}

export async function exportVcsFileRevision(path: string, revision: string): Promise<string> {
  return tryReal(
    () => invoke("export_vcs_file_revision", { path, revision }),
    () => mock.exportVcsFileRevision(path, revision)
  );
}

export async function cleanupOldVcsTempExports(maxAgeHours = 24): Promise<void> {
  return tryReal(
    () => invoke("cleanup_old_vcs_temp_exports", { maxAgeHours }),
    () => mock.cleanupOldVcsTempExports(maxAgeHours)
  );
}
