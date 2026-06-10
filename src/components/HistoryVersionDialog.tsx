import { useEffect, useState } from "react";
import { getVcsFileInfo, getVcsFileLog, openVcsLog } from "../api/tauri";
import type { VcsCommitSummary, VcsFileInfo } from "../types/vcs";

const LOG_LIMIT = 50;

function shortRevision(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function sameRevision(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

interface HistoryVersionDialogProps {
  path: string;
  onClose: () => void;
  onSelect: (revision: string, commit?: VcsCommitSummary, currentInfo?: VcsFileInfo | null) => void;
}

export default function HistoryVersionDialog({ path, onClose, onSelect }: HistoryVersionDialogProps) {
  const [logs, setLogs] = useState<VcsCommitSummary[]>([]);
  const [currentInfo, setCurrentInfo] = useState<VcsFileInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLogs([]);
    setCurrentInfo(null);
    setSelectedRevision(null);

    Promise.all([
      getVcsFileLog(path, LOG_LIMIT),
      getVcsFileInfo(path).catch(() => null),
    ])
      .then(([items, info]) => {
        if (cancelled) return;
        setLogs(items);
        setCurrentInfo(info);
        setSelectedRevision(items[0]?.id ?? null);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  const selectedLog = logs.find((item) => item.id === selectedRevision) ?? null;
  const currentRevision = currentInfo?.lastCommit?.id ?? currentInfo?.revision ?? null;
  const currentLog = logs.find((item) => sameRevision(item.id, currentRevision)) ?? null;
  const currentLabel = currentLog
    ? `${shortRevision(currentLog.id)} ${formatDate(currentLog.date)}`
    : currentRevision
      ? shortRevision(currentRevision)
      : "未识别";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="flex max-h-[82vh] w-[760px] max-w-[calc(100vw-36px)] flex-col rounded border bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900">选择历史版本</div>
            <div className="mt-1 truncate text-xs text-gray-500" title={path}>{path}</div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-gray-600">
              <span>当前版本</span>
              <span className="font-mono font-semibold text-blue-700">{currentLabel}</span>
              {currentInfo?.status && <span className="rounded bg-gray-100 px-1 font-mono text-gray-600">{currentInfo.status}</span>}
            </div>
          </div>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
            onClick={() => { void openVcsLog(path); }}
          >
            Tortoise 日志
          </button>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs hover:bg-gray-100">
            关闭
          </button>
        </div>

        <div className="min-h-[260px] flex-1 overflow-auto p-4">
          {loading ? (
            <div className="rounded border border-dashed p-6 text-center text-sm text-gray-400">正在读取历史版本...</div>
          ) : error ? (
            <div className="rounded border border-red-100 bg-red-50 p-4 text-sm text-red-600">{error}</div>
          ) : logs.length === 0 ? (
            <div className="rounded border border-dashed p-6 text-center text-sm text-gray-400">没有读取到历史版本</div>
          ) : (
            <div className="space-y-2">
              {logs.map((item) => {
                const active = item.id === selectedRevision;
                const isCurrent = sameRevision(item.id, currentRevision);
                return (
                  <button
                    type="button"
                    key={`${item.id}-${item.date ?? ""}`}
                    className={`w-full rounded border px-3 py-2 text-left text-xs shadow-sm ${
                      active
                        ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200"
                        : "border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/50"
                    }`}
                    onClick={() => setSelectedRevision(item.id)}
                    onDoubleClick={() => onSelect(item.id, item, currentInfo)}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono font-semibold text-blue-700">{shortRevision(item.id)}</span>
                      {isCurrent && <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-700">当前版本</span>}
                      <span className="rounded bg-gray-100 px-1.5 font-semibold text-gray-700">{item.author ?? "-"}</span>
                      <span className="rounded bg-emerald-50 px-1.5 font-semibold text-emerald-700">{formatDate(item.date)}</span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words text-gray-700">
                      {item.message || "(无提交说明)"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t px-4 py-3">
          <div className="min-w-0 flex-1 truncate text-xs text-gray-500">
            {selectedLog ? `将与 ${shortRevision(selectedLog.id)} 比较` : "请选择一个历史版本"}
          </div>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!selectedRevision}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            onClick={() => {
              if (selectedRevision) onSelect(selectedRevision, selectedLog ?? undefined, currentInfo);
            }}
          >
            开始比较
          </button>
        </div>
      </div>
    </div>
  );
}
