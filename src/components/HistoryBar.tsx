import { useCallback, useEffect, useRef, useState } from "react";
import { useHistoryStore, type HistoryRecord } from "../stores/historyStore";
import { useDiffStore } from "../stores/diffStore";
import { listExcelFiles } from "../api/tauri";
import { ChevronDown, XIcon, ClockIcon, EditIcon } from "./Icons";

// Format timestamp to MM-DD HH:mm
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
}

// Truncate long path
function truncatePath(path: string, maxLen: number = 30): string {
  if (path.length <= maxLen) return path;
  const half = Math.floor((maxLen - 3) / 2);
  return path.substring(0, half) + "..." + path.substring(path.length - half);
}

export default function HistoryBar() {
  const { records, isCollapsed, toggleCollapsed, remove, clear, rename, load } = useHistoryStore();
  const { setOldDir, setNewDir, setOldFiles, setNewFiles, buildFilePairs } =
    useDiffStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Load on mount
  useEffect(() => {
    load();
  }, [load]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId) {
      setTimeout(() => editInputRef.current?.focus(), 0);
    }
  }, [editingId]);

  const handleSelect = useCallback(
    async (record: { oldDir: string; newDir: string }) => {
      if (editingId) return;
      setOldDir(record.oldDir);
      setNewDir(record.newDir);

      // Load files
      if (record.oldDir) {
        try {
          const files = await listExcelFiles(record.oldDir);
          setOldFiles(files);
        } catch {
          setOldFiles([]);
        }
      }
      if (record.newDir) {
        try {
          const files = await listExcelFiles(record.newDir);
          setNewFiles(files);
        } catch {
          setNewFiles([]);
        }
      }

      buildFilePairs();
    },
    [editingId, setOldDir, setNewDir, setOldFiles, setNewFiles, buildFilePairs]
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      remove(id);
    },
    [remove]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (records.length === 0 || window.confirm("确定清空所有历史记录？")) {
        clear();
      }
    },
    [records.length, clear]
  );

  const startRename = useCallback((e: React.MouseEvent, record: HistoryRecord) => {
    e.stopPropagation();
    setEditingId(record.id);
    setEditValue(record.name || "");
  }, []);

  const commitRename = useCallback((id: string) => {
    if (editValue.trim()) {
      rename(id, editValue.trim());
    }
    setEditingId(null);
    setEditValue("");
  }, [editValue, rename]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditValue("");
  }, []);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter") {
      commitRename(id);
    } else if (e.key === "Escape") {
      cancelRename();
    }
  }, [commitRename, cancelRename]);

  return (
    <div className="border-b border-gray-200 bg-white">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-gray-50"
        onClick={toggleCollapsed}
      >
        <div className="flex items-center gap-2">
          <span className={`transform transition-transform ${isCollapsed ? "" : "rotate-90"}`}>
            <ChevronDown size={14} className="text-gray-500" />
          </span>
          <ClockIcon size={14} className="text-gray-500" />
          <span className="text-xs font-semibold text-gray-700">历史对比记录</span>
        </div>
        <button
          onClick={handleClear}
          className="text-[11px] text-gray-400 hover:text-red-500 px-2 py-0.5 rounded hover:bg-red-50"
        >
          清空
        </button>
      </div>

      {/* Records */}
      {!isCollapsed && (
        <div className="px-4 pb-2 space-y-1">
          {records.length === 0 ? (
            <div className="text-[11px] text-gray-400 py-2 text-center">暂无历史记录</div>
          ) : (
            records.map((record) => (
              <div
                key={record.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-gray-100 cursor-pointer group"
                onClick={() => handleSelect(record)}
                title={`左: ${record.oldDir}\n右: ${record.newDir}`}
              >
                <span className="text-gray-500 font-mono shrink-0">{formatTime(record.timestamp)}</span>
                {editingId === record.id ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => handleRenameKeyDown(e, record.id)}
                    onBlur={() => commitRename(record.id)}
                    className="flex-1 px-1 py-0.5 border rounded bg-white text-xs outline-none focus:border-blue-400"
                    placeholder="输入名称..."
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="text-gray-700 truncate">
                    {record.name ? (
                      <span className="font-medium">{record.name}</span>
                    ) : (
                      <>左: {truncatePath(record.oldDir || "-", 20)} → 右: {truncatePath(record.newDir || "-", 20)}</>
                    )}
                  </span>
                )}
                {editingId !== record.id && (
                  <button
                    onClick={(e) => startRename(e, record)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-blue-100 rounded text-gray-400 hover:text-blue-500 transition-opacity"
                    title="重命名"
                  >
                    <EditIcon size={12} />
                  </button>
                )}
                <button
                  onClick={(e) => handleRemove(e, record.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-500 transition-opacity"
                  title="删除"
                >
                  <XIcon size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
