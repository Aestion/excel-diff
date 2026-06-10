import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { getVcsFileLog, openVcsLog } from "../api/tauri";
import type { VcsCommitSummary } from "../types/vcs";

interface VersionCompareDialogProps {
  leftPath: string | null;
  rightPath: string | null;
  onClose: () => void;
}

type MergeRelation = {
  leftId: string;
  rightId: string;
  key: string;
  label: string;
  direction: "right-merges-left" | "left-merges-right";
};

type Connector = MergeRelation & {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const LOG_LIMIT = 50;

function normalizeRevision(id: string): string | null {
  const match = id.match(/\d+/);
  return match ? match[0] : null;
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/, "");
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function expandRevisionToken(token: string): string[] {
  const trimmed = token.trim();
  if (!trimmed) return [];
  const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!range) return /^\d+$/.test(trimmed) ? [trimmed] : [];

  const start = Number(range[1]);
  const end = Number(range[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  if (max - min > 200) return [String(start), String(end)];
  return Array.from({ length: max - min + 1 }, (_, index) => String(min + index));
}

function parseMergedRevisions(message: string): string[] {
  const match = message.match(/Merged\s+revision\(s\)\s+([0-9,\-\s]+)/i);
  if (!match) return [];
  return match[1].split(",").flatMap(expandRevisionToken);
}

function buildRelations(leftLogs: VcsCommitSummary[], rightLogs: VcsCommitSummary[]): MergeRelation[] {
  const leftByRevision = new Map<string, VcsCommitSummary>();
  const rightByRevision = new Map<string, VcsCommitSummary>();
  for (const item of leftLogs) {
    const revision = normalizeRevision(item.id);
    if (revision) leftByRevision.set(revision, item);
  }
  for (const item of rightLogs) {
    const revision = normalizeRevision(item.id);
    if (revision) rightByRevision.set(revision, item);
  }

  const relations = new Map<string, MergeRelation>();
  for (const right of rightLogs) {
    const rightRevision = normalizeRevision(right.id);
    if (!rightRevision) continue;
    for (const mergedRevision of parseMergedRevisions(right.message)) {
      const left = leftByRevision.get(mergedRevision);
      if (!left) continue;
      const key = `${left.id}->${right.id}`;
      relations.set(key, {
        leftId: left.id,
        rightId: right.id,
        key,
        label: `右 ${right.id} merge 左 r${mergedRevision}`,
        direction: "right-merges-left",
      });
    }
  }

  for (const left of leftLogs) {
    const leftRevision = normalizeRevision(left.id);
    if (!leftRevision) continue;
    for (const mergedRevision of parseMergedRevisions(left.message)) {
      const right = rightByRevision.get(mergedRevision);
      if (!right) continue;
      const key = `${left.id}->${right.id}`;
      relations.set(key, {
        leftId: left.id,
        rightId: right.id,
        key,
        label: `左 ${left.id} merge 右 r${mergedRevision}`,
        direction: "left-merges-right",
      });
    }
  }

  return Array.from(relations.values());
}

function LogList({
  title,
  path,
  logs,
  loading,
  error,
  highlightedIds,
  activeIds,
  mergeIds,
  itemRefs,
  onLayoutChange,
}: {
  title: string;
  path: string | null;
  logs: VcsCommitSummary[];
  loading: boolean;
  error: string | null;
  highlightedIds: Set<string>;
  activeIds: Set<string>;
  mergeIds: Set<string>;
  itemRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  onLayoutChange: () => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    window.requestAnimationFrame(onLayoutChange);
  };

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <div className="font-semibold text-gray-800">{title}</div>
        {path && (
          <button
            type="button"
            className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700"
            onClick={() => { void openVcsLog(path); }}
          >
            Tortoise
          </button>
        )}
      </div>
      <div className="truncate text-[11px] text-gray-400" title={path ?? ""}>{path ?? "-"}</div>
      <div className="mt-2 space-y-1">
        {loading ? (
          <div className="rounded border border-dashed p-4 text-center text-xs text-gray-400">正在读取日志...</div>
        ) : error ? (
          <div className="rounded border border-red-100 bg-red-50 p-3 text-xs text-red-600">{error}</div>
        ) : logs.length === 0 ? (
          <div className="rounded border border-dashed p-4 text-center text-xs text-gray-400">暂无日志</div>
        ) : logs.map((item) => {
          const highlighted = highlightedIds.has(item.id);
          const active = activeIds.has(item.id);
          const isMerge = mergeIds.has(item.id);
          const message = item.message || "(无提交说明)";
          const expanded = expandedIds.has(item.id);
          const canToggle = message.length > 36;
          return (
            <div
              key={`${item.id}-${item.date ?? ""}`}
              ref={(node) => {
                if (node) itemRefs.current.set(item.id, node);
                else itemRefs.current.delete(item.id);
              }}
              className={`rounded border px-2 py-1.5 text-xs shadow-sm ${
                active
                  ? "border-blue-500 bg-blue-100 ring-1 ring-blue-300"
                  : highlighted
                    ? "border-sky-200 bg-sky-50/70"
                    : "border-gray-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-blue-700">{shortId(item.id)}</span>
                <span className="rounded bg-blue-50 px-1.5 font-semibold text-blue-700">{item.author ?? "-"}</span>
                <span className="rounded bg-emerald-50 px-1.5 font-semibold text-emerald-700">{formatDate(item.date)}</span>
                {isMerge && <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-700">merge</span>}
              </div>
              <div className="mt-1 flex items-start gap-2">
                <div
                  className={`min-w-0 flex-1 text-gray-700 ${expanded ? "whitespace-pre-wrap break-words leading-5" : "overflow-hidden text-ellipsis whitespace-nowrap"}`}
                  title={expanded ? undefined : message}
                >
                  {message}
                </div>
                {canToggle && (
                  <button
                    type="button"
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
                    onClick={() => toggleExpanded(item.id)}
                  >
                    {expanded ? "收起" : "展开"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function VersionCompareDialog({ leftPath, rightPath, onClose }: VersionCompareDialogProps) {
  const [leftLogs, setLeftLogs] = useState<VcsCommitSummary[]>([]);
  const [rightLogs, setRightLogs] = useState<VcsCommitSummary[]>([]);
  const [leftLoading, setLeftLoading] = useState(false);
  const [rightLoading, setRightLoading] = useState(false);
  const [leftError, setLeftError] = useState<string | null>(null);
  const [rightError, setRightError] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [activeRelationKey, setActiveRelationKey] = useState<string | null>(null);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });
  const [layoutVersion, setLayoutVersion] = useState(0);

  const diagramRef = useRef<HTMLDivElement>(null);
  const leftRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const rightRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const loadSide = async (
      path: string | null,
      setLogs: (logs: VcsCommitSummary[]) => void,
      setLoading: (loading: boolean) => void,
      setError: (error: string | null) => void
    ) => {
      setError(null);
      if (!path) {
        setLogs([]);
        return;
      }
      setLoading(true);
      try {
        const logs = await getVcsFileLog(path, LOG_LIMIT);
        if (!cancelled) setLogs(logs);
      } catch (error: any) {
        if (!cancelled) {
          setLogs([]);
          setError(error?.message || String(error));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSide(leftPath, setLeftLogs, setLeftLoading, setLeftError);
    void loadSide(rightPath, setRightLogs, setRightLoading, setRightError);

    return () => { cancelled = true; };
  }, [leftPath, rightPath]);

  const relations = useMemo(() => buildRelations(leftLogs, rightLogs), [leftLogs, rightLogs]);
  const highlightedLeftIds = useMemo(() => new Set(relations.map((relation) => relation.leftId)), [relations]);
  const highlightedRightIds = useMemo(() => new Set(relations.map((relation) => relation.rightId)), [relations]);
  const activeRelation = useMemo(() => (
    relations.find((relation) => relation.key === activeRelationKey) ?? relations[0] ?? null
  ), [activeRelationKey, relations]);
  const activeLeftIds = useMemo(() => new Set(activeRelation ? [activeRelation.leftId] : []), [activeRelation]);
  const activeRightIds = useMemo(() => new Set(activeRelation ? [activeRelation.rightId] : []), [activeRelation]);
  const rightMergeIds = useMemo(() => new Set(
    relations
      .filter((relation) => relation.direction === "right-merges-left")
      .map((relation) => relation.rightId)
  ), [relations]);
  const leftMergeIds = useMemo(() => new Set(
    relations
      .filter((relation) => relation.direction === "left-merges-right")
      .map((relation) => relation.leftId)
  ), [relations]);

  useEffect(() => {
    if (relations.length === 0) {
      setActiveRelationKey(null);
      return;
    }
    if (!activeRelationKey || !relations.some((relation) => relation.key === activeRelationKey)) {
      setActiveRelationKey(relations[0].key);
    }
  }, [activeRelationKey, relations]);

  useEffect(() => {
    const handleResize = () => setLayoutVersion((value) => value + 1);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useLayoutEffect(() => {
    const diagram = diagramRef.current;
    if (!diagram) return;
    const diagramRect = diagram.getBoundingClientRect();
    const scrollLeft = diagram.scrollLeft;
    const scrollTop = diagram.scrollTop;
    const next: Connector[] = [];
    for (const relation of relations) {
      const leftNode = leftRefs.current.get(relation.leftId);
      const rightNode = rightRefs.current.get(relation.rightId);
      if (!leftNode || !rightNode) continue;
      const leftRect = leftNode.getBoundingClientRect();
      const rightRect = rightNode.getBoundingClientRect();
      next.push({
        ...relation,
        x1: leftRect.right - diagramRect.left + scrollLeft,
        y1: leftRect.top + leftRect.height / 2 - diagramRect.top + scrollTop,
        x2: rightRect.left - diagramRect.left + scrollLeft,
        y2: rightRect.top + rightRect.height / 2 - diagramRect.top + scrollTop,
      });
    }
    setSvgSize({ width: diagram.scrollWidth, height: diagram.scrollHeight });
    setConnectors(next);
  }, [relations, leftLogs, rightLogs, leftLoading, rightLoading, layoutVersion]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="flex max-h-[86vh] w-[1180px] max-w-[calc(100vw-40px)] flex-col rounded border bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900">版本对比</div>
            <div className="text-xs text-gray-500">最近 {LOG_LIMIT} 条日志，虚线表示 SVN merge 关系</div>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs hover:bg-gray-100">
            关闭
          </button>
        </div>

        <div ref={diagramRef} className="relative grid flex-1 grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)] gap-4 overflow-auto p-4">
          <svg
            className="pointer-events-none absolute left-0 top-0 z-0"
            style={{ width: svgSize.width, height: svgSize.height }}
          >
            {connectors.map((line) => {
              const midX = (line.x1 + line.x2) / 2;
              const active = activeRelation?.key === line.key;
              return (
                <g key={`${line.leftId}-${line.rightId}`}>
                  <path
                    d={`M ${line.x1} ${line.y1} C ${midX} ${line.y1}, ${midX} ${line.y2}, ${line.x2} ${line.y2}`}
                    fill="none"
                    stroke="#2563eb"
                    strokeDasharray="6 5"
                    strokeOpacity={active ? 0.98 : 0.48}
                    strokeWidth={active ? "2.8" : "1.9"}
                  />
                </g>
              );
            })}
          </svg>

          <div className="relative z-10">
            <LogList
              title="左侧日志"
              path={leftPath}
              logs={leftLogs}
              loading={leftLoading}
              error={leftError}
              highlightedIds={highlightedLeftIds}
              activeIds={activeLeftIds}
              mergeIds={leftMergeIds}
              itemRefs={leftRefs}
              onLayoutChange={() => setLayoutVersion((value) => value + 1)}
            />
          </div>

          <div className="relative z-10 px-2 pt-12">
            <div className="sticky top-0 rounded border border-dashed border-blue-200 bg-blue-50/90 p-2 text-xs text-blue-800 shadow-sm">
              <div className="font-semibold">Merge 关系</div>
              <div className="mt-1 text-blue-700">{relations.length > 0 ? `${relations.length} 条命中，悬停可高亮` : "未发现 merge 关系"}</div>
            </div>
            <div className="mt-3 space-y-1">
              {relations.map((relation) => (
                <button
                  type="button"
                  key={relation.key}
                  onMouseEnter={() => setActiveRelationKey(relation.key)}
                  onFocus={() => setActiveRelationKey(relation.key)}
                  onClick={() => setActiveRelationKey(relation.key)}
                  className={`w-full rounded border px-2 py-1 text-left text-[11px] ${
                    activeRelation?.key === relation.key
                      ? "border-blue-400 bg-blue-100 text-blue-800"
                      : "border-blue-200 bg-blue-50/80 text-blue-800 hover:border-blue-300 hover:bg-blue-100"
                  }`}
                >
                  {relation.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative z-10">
            <LogList
              title="右侧日志"
              path={rightPath}
              logs={rightLogs}
              loading={rightLoading}
              error={rightError}
              highlightedIds={highlightedRightIds}
              activeIds={activeRightIds}
              mergeIds={rightMergeIds}
              itemRefs={rightRefs}
              onLayoutChange={() => setLayoutVersion((value) => value + 1)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
