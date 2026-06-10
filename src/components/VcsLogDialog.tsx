import { useState } from "react";
import type { VcsCommitSummary, VcsFileInfo } from "../types/vcs";

interface VcsLogDialogProps {
  title: string;
  info: VcsFileInfo | null;
  logs: VcsCommitSummary[];
  loading: boolean;
  error?: string;
  onClose: () => void;
  onOpenExternal: () => void;
}

function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

function isLongMessage(message: string): boolean {
  return message.length > 120 || message.includes("\n");
}

export default function VcsLogDialog({
  title,
  info,
  logs,
  loading,
  error,
  onClose,
  onOpenExternal,
}: VcsLogDialogProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());

  const toggleExpanded = (key: string) => {
    setExpandedItems((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="flex max-h-[78vh] w-[720px] max-w-[calc(100vw-32px)] flex-col rounded border bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-gray-800">{title}</div>
            <div className="truncate text-xs text-gray-500">{info?.path ?? ""}</div>
          </div>
          <button onClick={onOpenExternal} className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700">
            外部日志
          </button>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs hover:bg-gray-100">
            关闭
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-gray-500">正在读取版本信息...</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600">{error}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-b bg-gray-50 px-4 py-2 text-xs text-gray-600">
              <div>类型: <span className="font-mono">{info?.kind ?? "-"}</span></div>
              <div>状态: <span className="font-mono">{info?.status ?? "-"}</span></div>
              <div className="truncate">分支: <span className="font-mono">{info?.branch ?? "-"}</span></div>
              <div className="truncate">Revision: <span className="font-mono">{info?.revision ?? "-"}</span></div>
              <div className="col-span-2 truncate">Root/URL: <span className="font-mono">{info?.root ?? info?.url ?? "-"}</span></div>
            </div>

            <div className="overflow-auto">
              {logs.length === 0 ? (
                <div className="p-6 text-sm text-gray-400">暂无日志</div>
              ) : (
                <div className="divide-y">
                  {logs.map((item) => {
                    const key = `${item.id}-${item.date ?? ""}`;
                    const message = item.message || "(无提交说明)";
                    const canExpand = isLongMessage(message);
                    const expanded = expandedItems.has(key);

                    return (
                      <div key={key} className="px-4 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-blue-700">{shortId(item.id)}</span>
                          <span className="text-xs text-gray-500">{item.author ?? "-"}</span>
                          <span className="text-xs text-gray-400">{formatDate(item.date)}</span>
                        </div>
                        <div
                          className="mt-1 whitespace-pre-wrap break-words text-gray-800"
                          style={expanded ? undefined : {
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {message}
                        </div>
                        {canExpand && (
                          <button
                            type="button"
                            className="mt-1 text-xs text-blue-600 hover:text-blue-800"
                            onClick={() => toggleExpanded(key)}
                          >
                            {expanded ? "收起" : "展开"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
