import { useCallback, useEffect, useState } from "react";
import { useDiffStore } from "../stores/diffStore";
import { pickDirectory, listExcelFiles, getExcelEngineStatus } from "../api/tauri";
import { FolderOpenIcon, FileExcelIcon } from "./Icons";

export default function DirectoryPicker() {
  const {
    oldDir, newDir,
    setOldDir, setNewDir,
    setOldFiles, setNewFiles,
    buildFilePairs,
    oldFiles, newFiles, filePairs,
  } = useDiffStore();

  const [engineStatus, setEngineStatus] = useState<string>("");

  useEffect(() => {
    getExcelEngineStatus().then(setEngineStatus).catch(() => setEngineStatus(""));
  }, []);

  const handlePickOld = useCallback(async () => {
    const dir = await pickDirectory();
    if (dir) {
      setOldDir(dir);
      const files = await listExcelFiles(dir);
      setOldFiles(files);
      buildFilePairs();
    }
  }, [setOldDir, setOldFiles, buildFilePairs]);

  const handlePickNew = useCallback(async () => {
    const dir = await pickDirectory();
    if (dir) {
      setNewDir(dir);
      const files = await listExcelFiles(dir);
      setNewFiles(files);
      buildFilePairs();
    }
  }, [setNewDir, setNewFiles, buildFilePairs]);

  const matched = filePairs.filter((p) => p.status === "matched").length;
  const oldOnly = filePairs.filter((p) => p.status === "old-only").length;
  const newOnly = filePairs.filter((p) => p.status === "new-only").length;

  return (
    <div className="p-4 border-b border-gray-200 bg-white">
      <div className="flex items-center gap-2 mb-3">
        <FileExcelIcon size={20} className="text-green-600" />
        <h1 className="text-base font-bold text-gray-800">Excel Diff — 合表对比工具</h1>
        {engineStatus === "xlwings" && (
          <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded ml-2">
            Excel COM
          </span>
        )}
        {engineStatus === "openpyxl" && (
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded ml-2">
            openpyxl
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {/* Old directory */}
        <div className="border rounded-lg p-3 bg-gray-50">
          <div className="flex items-center gap-1.5 mb-2">
            <FolderOpenIcon size={14} className="text-amber-500" />
            <h3 className="text-xs font-semibold text-gray-500">左侧目录</h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={oldDir}
              readOnly
              placeholder="点击选择目录..."
              className="flex-1 px-2.5 py-1.5 border rounded bg-white text-xs truncate"
            />
            <button
              onClick={handlePickOld}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            >
              <FolderOpenIcon size={13} />
              选择
            </button>
          </div>
          {oldFiles.length > 0 && (
            <p className="text-[11px] text-gray-400 mt-1.5 flex items-center gap-1">
              <FileExcelIcon size={11} /> {oldFiles.length} 个 Excel 文件
            </p>
          )}
        </div>

        {/* New directory */}
        <div className="border rounded-lg p-3 bg-gray-50">
          <div className="flex items-center gap-1.5 mb-2">
            <FolderOpenIcon size={14} className="text-blue-500" />
            <h3 className="text-xs font-semibold text-gray-500">右侧目录</h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newDir}
              readOnly
              placeholder="点击选择目录..."
              className="flex-1 px-2.5 py-1.5 border rounded bg-white text-xs truncate"
            />
            <button
              onClick={handlePickNew}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            >
              <FolderOpenIcon size={13} />
              选择
            </button>
          </div>
          {newFiles.length > 0 && (
            <p className="text-[11px] text-gray-400 mt-1.5 flex items-center gap-1">
              <FileExcelIcon size={11} /> {newFiles.length} 个 Excel 文件
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
