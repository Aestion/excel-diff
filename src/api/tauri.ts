import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { FileEntry, ParsedWorkbook, SheetData } from "../types/excel";
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
