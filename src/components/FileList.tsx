import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useDiffStore } from "../stores/diffStore";
import { readExcel, detectKeyColumns, copyExcelFile, listExcelFiles, openVcsLog, openInFileExplorer, getVcsFileInfo, getVcsFileLog, exportVcsFileRevision, cleanupOldVcsTempExports } from "../api/tauri";
import { computeDiff } from "../utils/diffEngine";
import type { FilePair } from "../types/excel";
import type { VcsCommitSummary, VcsFileInfo } from "../types/vcs";
import VcsLogDialog from "./VcsLogDialog";
import { RefreshIcon, ArrowRight, ArrowLeft, SpinnerIcon, FolderIcon, ChevronDown } from "./Icons";

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModifiedAt(timestamp?: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
}

function matchWildcard(text: string, pattern: string): boolean {
  if (!pattern) return true;
  const regexPattern = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, ".*")
    .replace(/\\\?/g, ".");
  const regex = new RegExp(`^${regexPattern}$`, "i");
  return regex.test(text);
}

type FilterMode = "all" | "different" | "same" | "left-only" | "right-only";

interface FileTreeNode {
  name: string;
  path: string;
  files: FilePair[];
  children: FileTreeNode[];
  totalFiles: number;
  differentFiles: number;
  onlySideFiles: number;
}

function splitRelativePath(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function getFolderPaths(relativePath: string): string[] {
  const parts = splitRelativePath(relativePath);
  const folders: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    folders.push(parts.slice(0, i).join("\\"));
  }
  return folders;
}

function buildFileTree(pairs: FilePair[]): FileTreeNode {
  const root: FileTreeNode = {
    name: "",
    path: "",
    files: [],
    children: [],
    totalFiles: 0,
    differentFiles: 0,
    onlySideFiles: 0,
  };
  const nodeMap = new Map<string, FileTreeNode>([["", root]]);

  const ensureNode = (path: string, name: string, parentPath: string) => {
    const existing = nodeMap.get(path);
    if (existing) return existing;
    const node: FileTreeNode = {
      name,
      path,
      files: [],
      children: [],
      totalFiles: 0,
      differentFiles: 0,
      onlySideFiles: 0,
    };
    nodeMap.set(path, node);
    nodeMap.get(parentPath)?.children.push(node);
    return node;
  };

  for (const pair of pairs) {
    const parts = splitRelativePath(pair.relativePath);
    let parentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("\\");
      ensureNode(path, parts[i], parentPath);
      parentPath = path;
    }
    (nodeMap.get(parentPath) || root).files.push(pair);
  }

  const finalize = (node: FileTreeNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.filename.localeCompare(b.filename));

    let totalFiles = node.files.length;
    let differentFiles = node.files.filter(f => f.diffStatus === "different").length;
    let onlySideFiles = node.files.filter(f => f.status === "old-only" || f.status === "new-only").length;

    for (const child of node.children) {
      finalize(child);
      totalFiles += child.totalFiles;
      differentFiles += child.differentFiles;
      onlySideFiles += child.onlySideFiles;
    }

    node.totalFiles = totalFiles;
    node.differentFiles = differentFiles;
    node.onlySideFiles = onlySideFiles;
  };

  finalize(root);
  return root;
}

function joinDirectoryPath(baseDir: string, relativePath: string): string {
  if (!relativePath) return baseDir;
  const separator = baseDir.includes("\\") ? "\\" : "/";
  const normalizedRelative = relativePath.replace(/[\\/]+/g, separator);
  return baseDir.endsWith("\\") || baseDir.endsWith("/")
    ? `${baseDir}${normalizedRelative}`
    : `${baseDir}${separator}${normalizedRelative}`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

// Context menu
interface ContextMenuState {
  x: number;
  y: number;
  side: "left" | "right";
  targetKind: "file" | "folder";
  targetPath: string;
  relativePath: string;
  paths: string[];
}

function ContextMenu({ state, onAction, onClose }: {
  state: ContextMenuState;
  onAction: (action: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const count = state.paths.length;
  const isLeft = state.side === "left";
  const isFile = state.targetKind === "file";

  return (
    <div ref={ref} className="fixed bg-white rounded-lg shadow-xl border py-1 z-50 min-w-[180px]"
      style={{ left: state.x, top: state.y }}>
      <div className="px-3 py-1.5 text-[11px] text-gray-400 border-b">
        {isFile ? `已选 ${count} 个文件` : "文件夹"} · {isLeft ? "左侧" : "右侧"}
      </div>
      <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
        onClick={() => onAction("show-vcs-log")}>
        查看版本记录
      </button>
      <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
        onClick={() => onAction("open-vcs-log")}>
        用 Tortoise 打开日志
      </button>
      <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
        onClick={() => onAction("open-explorer")}>
        在资源管理器中定位
      </button>
      <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
        onClick={() => onAction("copy-path")}>
        复制路径
      </button>
      {isFile && <div className="my-1 border-t" />}
      {isFile && isLeft ? (
        <>
          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
            onClick={() => onAction("compare-history")}>
            与历史版本比较
          </button>
          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
            onClick={() => onAction("copy-left-to-right")}>
            <ArrowRight size={14} className="text-blue-500" />
            复制到右侧 ({count} 个文件)
          </button>
          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
            onClick={() => onAction("open-diff")}>
            打开对比
          </button>
        </>
      ) : isFile ? (
        <>
          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
            onClick={() => onAction("compare-history")}>
            与历史版本比较
          </button>
          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-purple-50 flex items-center gap-2"
            onClick={() => onAction("copy-right-to-left")}>
            <ArrowLeft size={14} className="text-purple-500" />
            复制到左侧 ({count} 个文件)
          </button>
          <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
            onClick={() => onAction("open-diff")}>
            打开对比
          </button>
        </>
      ) : null}
    </div>
  );
}

function TreeFileRow({ pair, side, level, selected, onSelect, onDoubleClick, onContextMenu }: {
  pair: FilePair;
  side: "left" | "right";
  level: number;
  selected: Set<string>;
  onSelect: (path: string, e: React.MouseEvent) => void;
  onDoubleClick: (pair: FilePair) => void;
  onContextMenu: (e: React.MouseEvent, side: "left" | "right", path: string, kind: "file" | "folder") => void;
}) {
  const getSize = (p: FilePair) => side === "left" ? p.oldSize : p.newSize;
  const getModifiedAt = (p: FilePair) => side === "left" ? p.oldModifiedAt : p.newModifiedAt;
  const existsOnThisSide = side === "left"
    ? pair.status !== "new-only"
    : pair.status !== "old-only";
  const paddingLeft = 8 + level * 16;

  if (!existsOnThisSide) {
    return (
      <div key={`placeholder-${pair.relativePath}-${side}`}
        className="flex items-center pr-4 h-7 border-b bg-gray-100 text-xs"
        style={{ paddingLeft }}>
        <span className="w-3 mr-1"></span>
        <span className="flex-1 font-mono truncate text-gray-300">{pair.filename}</span>
        <span className="w-20 ml-2 shrink-0"></span>
        <span className="w-16 ml-2 shrink-0"></span>
      </div>
    );
  }

  const isOnly = pair.status === "old-only" || pair.status === "new-only";
  const isDiff = pair.diffStatus === "different";
  const isUnknown = pair.diffStatus === "unknown";
  const isSelected = selected.has(pair.relativePath);
  const bg = isSelected
    ? "bg-blue-100"
    : isOnly
      ? "bg-gray-200"
      : isDiff
        ? "bg-red-50"
        : isUnknown
          ? "bg-yellow-50"
          : "bg-white";
  const modifiedAt = getModifiedAt(pair);

  return (
    <div key={pair.relativePath}
      className={`flex items-center pr-4 h-7 border-b cursor-pointer text-xs ${bg} hover:brightness-95`}
      style={{ paddingLeft }}
      onClick={(e) => onSelect(pair.relativePath, e)}
      onDoubleClick={() => onDoubleClick(pair)}
      onContextMenu={(e) => onContextMenu(e, side, pair.relativePath, "file")}>
      <span className="w-3 mr-1">
        {isSelected && <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-600" />}
      </span>
      <span className="flex-1 font-mono truncate">{pair.filename}</span>
      <span className="text-gray-400 ml-2 w-20 text-right shrink-0 font-mono">{formatModifiedAt(modifiedAt)}</span>
      <span className="text-gray-400 ml-2 w-16 text-right shrink-0">{formatSize(getSize(pair))}</span>
    </div>
  );
}

function TreeFolderNode({ node, side, level, selected, onSelect, onDoubleClick, onContextMenu, collapsedFolders, onToggle }: {
  node: FileTreeNode;
  side: "left" | "right";
  level: number;
  selected: Set<string>;
  onSelect: (path: string, e: React.MouseEvent) => void;
  onDoubleClick: (pair: FilePair) => void;
  onContextMenu: (e: React.MouseEvent, side: "left" | "right", path: string, kind: "file" | "folder") => void;
  collapsedFolders: Set<string>;
  onToggle: (dir: string) => void;
}) {
  const isRoot = node.path === "";
  const collapsed = !isRoot && collapsedFolders.has(node.path);
  const paddingLeft = 8 + level * 16;

  return (
    <div>
      {!isRoot && (
        <div className="flex items-center pr-2 h-7 bg-gray-50 border-b cursor-pointer hover:bg-gray-100 select-none"
          style={{ paddingLeft }}
          onClick={() => onToggle(node.path)}
          onContextMenu={(e) => onContextMenu(e, side, node.path, "folder")}>
          <span className={`transform transition-transform ${collapsed ? "" : "rotate-90"}`}>
            <ChevronDown size={12} className="text-gray-400" />
          </span>
          <FolderIcon size={13} className="text-amber-500 mx-1" />
          <span className="text-xs font-medium text-gray-600 flex-1 truncate">{node.name}</span>
          <span className="text-[10px] text-gray-400 ml-2">
            {node.totalFiles}文件
            {node.differentFiles > 0 && <span className="text-red-500 ml-1">{node.differentFiles}不同</span>}
            {node.onlySideFiles > 0 && <span className="text-gray-500 ml-1">{node.onlySideFiles}仅一侧</span>}
          </span>
        </div>
      )}
      {(!collapsed || isRoot) && (
        <>
          {node.children.map(child => (
            <TreeFolderNode key={child.path} node={child} side={side} level={isRoot ? level : level + 1}
              selected={selected} onSelect={onSelect}
              onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
              collapsedFolders={collapsedFolders} onToggle={onToggle} />
          ))}
          {node.files.map(pair => (
            <TreeFileRow key={pair.relativePath} pair={pair} side={side} level={isRoot ? level : level + 1}
              selected={selected} onSelect={onSelect}
              onDoubleClick={onDoubleClick} onContextMenu={onContextMenu} />
          ))}
        </>
      )}
    </div>
  );
}

export default function FileList() {
  const {
    filePairs, oldDir, newDir,
    setView, selectFilePair,
    setOldWorkbook, setNewWorkbook, setCurrentSheet,
    setDiffResult, setKeyColumnIndices,
    fileListCollapsedFolders, fileListKnownFolders,
    setFileListCollapsedFolders, setFileListKnownFolders,
    fileListScrollTop, setFileListScrollTop,
    verifyAllFiles,
  } = useDiffStore();

  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [filenameFilter, setFilenameFilter] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [vcsDialog, setVcsDialog] = useState<{
    title: string;
    path: string;
    info: VcsFileInfo | null;
    logs: VcsCommitSummary[];
    loading: boolean;
    error?: string;
  } | null>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const restoredScrollRef = useRef(false);

  // Collect all unique folders (including nested parent folders)
  const allFolders = useMemo(() => {
    const folders = new Set<string>();
    for (const pair of filePairs) {
      getFolderPaths(pair.relativePath).forEach((folder) => folders.add(folder));
    }
    return folders;
  }, [filePairs]);

  // Initialize collapsed state when folders change - only add new folders as collapsed
  useEffect(() => {
    const nextCollapsed = new Set(useDiffStore.getState().fileListCollapsedFolders);
    const nextKnown = new Set(fileListKnownFolders);
    let changed = false;
    for (const folder of allFolders) {
      if (!nextKnown.has(folder)) {
        nextKnown.add(folder);
        nextCollapsed.add(folder);
        changed = true;
      }
    }
    if (changed) {
      setFileListKnownFolders(nextKnown);
      setFileListCollapsedFolders(nextCollapsed);
    }
  }, [allFolders, fileListKnownFolders, setFileListCollapsedFolders, setFileListKnownFolders]);

  // Stats
  const stats = useMemo(() => ({
    total: filePairs.length,
    identical: filePairs.filter(p => p.diffStatus === "identical").length,
    different: filePairs.filter(p => p.diffStatus === "different").length,
    unknown: filePairs.filter(p => p.diffStatus === "unknown").length,
    oldOnly: filePairs.filter(p => p.status === "old-only").length,
    newOnly: filePairs.filter(p => p.status === "new-only").length,
  }), [filePairs]);

  // Filtered
  const filteredPairs = useMemo(() => {
    let result = filePairs;

    // Status filter
    switch (filter) {
      case "different": result = result.filter(p => p.diffStatus === "different"); break;
      case "same": result = result.filter(p => p.diffStatus === "identical"); break;
      case "left-only": result = result.filter(p => p.status === "old-only"); break;
      case "right-only": result = result.filter(p => p.status === "new-only"); break;
    }

    // Filename filter (wildcard)
    if (filenameFilter) {
      result = result.filter(p => matchWildcard(p.filename, filenameFilter));
    }

    return result;
  }, [filePairs, filter, filenameFilter]);

  // Single unified tree includes old-only, new-only, and matched files.
  const fileTree = useMemo(() => buildFileTree(filteredPairs), [filteredPairs]);

  // Refresh
  const handleRefresh = useCallback(async () => {
    const s = useDiffStore.getState();
    if (oldDir) { try { s.setOldFiles(await listExcelFiles(oldDir)); } catch {} }
    if (newDir) { try { s.setNewFiles(await listExcelFiles(newDir)); } catch {} }
    s.buildFilePairs();
  }, [oldDir, newDir]);

  // Manual verify all files
  const handleVerifyAll = useCallback(async () => {
    setVerifying(true);
    try {
      await useDiffStore.getState().verifyAllFiles();
    } finally {
      setVerifying(false);
    }
  }, []);

  // Toggle folder collapse (sync both sides)
  const toggleFolder = useCallback((dir: string) => {
    const next = new Set(fileListCollapsedFolders);
    if (next.has(dir)) {
      next.delete(dir);
    } else {
      next.add(dir);
    }
    setFileListCollapsedFolders(next);
  }, [fileListCollapsedFolders, setFileListCollapsedFolders]);

  // Open file for diff
  const handleOpen = useCallback(async (pair: FilePair) => {
    try {
      if (pair.status === "old-only" || pair.status === "new-only") {
        if (pair.oldPath) setOldWorkbook(await readExcel(pair.oldPath));
        if (pair.newPath) setNewWorkbook(await readExcel(pair.newPath));
        selectFilePair(pair); setView("diff"); return;
      }
      const [oldWb, newWb] = await Promise.all([readExcel(pair.oldPath!), readExcel(pair.newPath!)]);
      setOldWorkbook(oldWb); setNewWorkbook(newWb); selectFilePair(pair);
      const commonSheets = oldWb.sheetNames.filter(s => newWb.sheetNames.includes(s));
      const sheetName = commonSheets[0] || oldWb.sheetNames[0] || "";
      setCurrentSheet(sheetName);
      if (sheetName) {
        const keyCols = await detectKeyColumns(pair.newPath!, sheetName);
        setKeyColumnIndices(keyCols);
        const os = oldWb.sheets.find(s => s.name === sheetName);
        const ns = newWb.sheets.find(s => s.name === sheetName);
        if (os && ns) setDiffResult(computeDiff(os, ns, keyCols));
      }
      setView("diff");
    } catch (e: any) {
      alert(`打开失败: ${e?.message || String(e)}`);
    }
  }, [setView, selectFilePair, setOldWorkbook, setNewWorkbook, setCurrentSheet, setDiffResult, setKeyColumnIndices]);

  // Selection
  const handleSelect = useCallback((path: string, e: React.MouseEvent) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (e.ctrlKey || e.metaKey) {
        if (next.has(path)) next.delete(path); else next.add(path);
      } else if (e.shiftKey && prev.size > 0) {
        // Range select: add all between last selected and this one
        const allPaths = filteredPairs.map(p => p.relativePath);
        const lastSelected = Array.from(prev).pop()!;
        const startIdx = allPaths.indexOf(lastSelected);
        const endIdx = allPaths.indexOf(path);
        if (startIdx >= 0 && endIdx >= 0) {
          const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          for (let i = from; i <= to; i++) next.add(allPaths[i]);
        }
      } else {
        next.clear();
        next.add(path);
      }
      return next;
    });
  }, [filteredPairs]);

  // Double click → open diff
  const handleDoubleClick = useCallback((pair: FilePair) => {
    handleOpen(pair);
  }, [handleOpen]);

  const handlePanelScroll = useCallback((source: "left" | "right") => {
    if (syncingScrollRef.current) return;
    const sourceEl = source === "left" ? leftPanelRef.current : rightPanelRef.current;
    const targetEl = source === "left" ? rightPanelRef.current : leftPanelRef.current;
    if (!sourceEl || !targetEl) return;

    setFileListScrollTop(sourceEl.scrollTop);
    syncingScrollRef.current = true;
    targetEl.scrollTop = sourceEl.scrollTop;
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }, [setFileListScrollTop]);

  useEffect(() => {
    if (restoredScrollRef.current || fileListScrollTop <= 0) return;
    const leftEl = leftPanelRef.current;
    const rightEl = rightPanelRef.current;
    if (!leftEl || !rightEl) return;

    restoredScrollRef.current = true;
    syncingScrollRef.current = true;
    leftEl.scrollTop = fileListScrollTop;
    rightEl.scrollTop = fileListScrollTop;
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }, [fileListScrollTop, fileTree]);

  // Refs for latest values (avoid stale closures in keyboard handler)
  const handleRefreshRef = useRef(handleRefresh);
  const handleOpenRef = useRef(handleOpen);
  const selectedPathsRef = useRef(selectedPaths);
  const filteredPairsRef = useRef(filteredPairs);
  const filePairsRef = useRef(filePairs);
  handleRefreshRef.current = handleRefresh;
  handleOpenRef.current = handleOpen;
  selectedPathsRef.current = selectedPaths;
  filteredPairsRef.current = filteredPairs;
  filePairsRef.current = filePairs;

  // Right click → context menu
  const resolveContextTarget = useCallback((side: "left" | "right", path: string, kind: "file" | "folder"): string | null => {
    if (kind === "folder") {
      const baseDir = side === "left" ? oldDir : newDir;
      return baseDir ? joinDirectoryPath(baseDir, path) : null;
    }

    const pair = filePairs.find((p) => p.relativePath === path);
    return side === "left" ? pair?.oldPath ?? null : pair?.newPath ?? null;
  }, [filePairs, newDir, oldDir]);

  const handleContextMenu = useCallback((e: React.MouseEvent, side: "left" | "right", path = "", kind: "file" | "folder" = "folder") => {
    e.preventDefault();
    e.stopPropagation();
    const targetPath = resolveContextTarget(side, path, kind);
    if (!targetPath) return;

    const paths = kind === "file" && path && !selectedPaths.has(path)
      ? [path]
      : kind === "file" && selectedPaths.size > 0
        ? Array.from(selectedPaths)
        : path
          ? [path]
          : [];
    if (kind === "file" && path && !selectedPaths.has(path)) {
      setSelectedPaths(new Set([path]));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, side, targetKind: kind, targetPath, relativePath: path, paths });
  }, [resolveContextTarget, selectedPaths]);

  // Context menu action
  const handleContextAction = useCallback(async (action: string) => {
    if (!contextMenu) return;
    const paths = contextMenu.paths;
    setContextMenu(null);

    if (action === "show-vcs-log") {
      const targetPath = contextMenu.targetPath;
      setVcsDialog({
        title: contextMenu.targetKind === "folder" ? "目录版本记录" : "文件版本记录",
        path: targetPath,
        info: null,
        logs: [],
        loading: true,
      });
      try {
        const info = await getVcsFileInfo(targetPath);
        const logs = info.kind === "none" ? [] : await getVcsFileLog(targetPath, 20);
        setVcsDialog({
          title: contextMenu.targetKind === "folder" ? "目录版本记录" : "文件版本记录",
          path: targetPath,
          info,
          logs,
          loading: false,
        });
      } catch (e: any) {
        setVcsDialog((state) => state ? {
          ...state,
          loading: false,
          error: e?.message || String(e),
        } : null);
      }
      return;
    }

    if (action === "open-vcs-log") {
      try {
        await openVcsLog(contextMenu.targetPath);
      } catch (e: any) {
        alert(`打开版本记录失败: ${e?.message || String(e)}`);
      }
      return;
    }

    if (action === "compare-history") {
      const pair = paths.length === 1 ? filePairs.find(p => p.relativePath === paths[0]) : null;
      if (!pair) return;
      const currentPath = contextMenu.targetPath;
      const revision = window.prompt("输入要比较的 commit/revision：");
      if (!revision) return;
      try {
        await cleanupOldVcsTempExports(24);
        const historyPath = await exportVcsFileRevision(currentPath, revision.trim());
        const [historyWb, currentWb] = await Promise.all([
          readExcel(historyPath),
          readExcel(currentPath),
        ]);
        const commonSheets = historyWb.sheetNames.filter(s => currentWb.sheetNames.includes(s));
        const sheetName = commonSheets[0] || historyWb.sheetNames[0] || currentWb.sheetNames[0] || "";
        setOldWorkbook(historyWb);
        setNewWorkbook(currentWb);
        setCurrentSheet(sheetName);
        selectFilePair({
          ...pair,
          oldPath: historyPath,
          newPath: currentPath,
          status: "matched",
          diffStatus: "unknown",
          filename: `${pair.filename} @ ${revision.trim()}`,
          oldReadOnly: true,
          compareNote: `左侧为历史版本 ${revision.trim()} 的临时只读文件`,
        });
        if (sheetName) {
          const keyCols = await detectKeyColumns(currentPath, sheetName);
          setKeyColumnIndices(keyCols);
          const os = historyWb.sheets.find(s => s.name === sheetName);
          const ns = currentWb.sheets.find(s => s.name === sheetName);
          if (os && ns) setDiffResult(computeDiff(os, ns, keyCols));
        }
        setView("diff");
      } catch (e: any) {
        alert(`历史版本比较失败: ${e?.message || String(e)}`);
      }
      return;
    }

    if (action === "open-explorer") {
      try {
        await openInFileExplorer(contextMenu.targetPath);
      } catch (e: any) {
        alert(`打开资源管理器失败: ${e?.message || String(e)}`);
      }
      return;
    }

    if (action === "copy-path") {
      try {
        await copyTextToClipboard(contextMenu.targetPath);
      } catch (e: any) {
        alert(`复制路径失败: ${e?.message || String(e)}`);
      }
      return;
    }

    if (action === "open-diff" && paths.length === 1) {
      const pair = filePairs.find(p => p.relativePath === paths[0]);
      if (pair) handleOpen(pair);
      return;
    }

    if (action === "copy-left-to-right" || action === "copy-right-to-left") {
      const matchedPairs = paths
        .map(p => filePairs.find(f => f.relativePath === p))
        .filter((p): p is FilePair => !!p && p.status === "matched");

      if (matchedPairs.length === 0) return;

      setMerging(true);
      const mergedPaths: string[] = [];
      let ok = 0, fail = 0;
      const MERGE_CONCURRENCY = 4;
      for (let start = 0; start < matchedPairs.length; start += MERGE_CONCURRENCY) {
        const batch = matchedPairs.slice(start, start + MERGE_CONCURRENCY);
        setMergeProgress(`${start + 1}-${Math.min(start + batch.length, matchedPairs.length)}/${matchedPairs.length}`);
        const results = await Promise.allSettled(batch.map(async (pair) => {
          const src = action === "copy-left-to-right" ? pair.oldPath : pair.newPath;
          const dst = action === "copy-left-to-right" ? pair.newPath : pair.oldPath;
          if (!src || !dst) throw new Error("missing source or destination");
          await copyExcelFile(src, dst);
          return pair.relativePath;
        }));
        for (const result of results) {
          if (result.status === "fulfilled") {
            mergedPaths.push(result.value);
            ok++;
          } else {
            fail++;
          }
        }
      }
      const store = useDiffStore.getState();
      for (const relativePath of mergedPaths) {
        store.markFileAsIdentical(relativePath);
      }
      setMerging(false); setMergeProgress("");
      setSelectedPaths(new Set());
      alert(`覆盖完成：成功 ${ok}，失败 ${fail}`);
      window.setTimeout(() => {
        void (async () => {
          const latestStore = useDiffStore.getState();
          if (latestStore.oldDir) {
            try { latestStore.setOldFiles(await listExcelFiles(latestStore.oldDir)); } catch {}
          }
          if (latestStore.newDir) {
            try { latestStore.setNewFiles(await listExcelFiles(latestStore.newDir)); } catch {}
          }
          await latestStore.buildFilePairs();
          for (const relativePath of mergedPaths) {
            await useDiffStore.getState().verifyFilePair(relativePath, true);
          }
        })();
      }, 0);
    }
  }, [contextMenu, detectKeyColumns, filePairs, handleOpen, selectFilePair, setCurrentSheet, setDiffResult, setKeyColumnIndices, setNewWorkbook, setOldWorkbook, setView]);

  // Keyboard — register once, read latest values via refs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const sp = selectedPathsRef.current;
      const fp = filePairsRef.current;
      const flp = filteredPairsRef.current;

      if (e.key === "F5") { e.preventDefault(); handleRefreshRef.current(); }
      if (e.ctrlKey && e.key === "b") { e.preventDefault(); setFilter(f => f === "different" ? "all" : "different"); }
      if (e.key === "Enter" && sp.size === 1) {
        const pair = fp.find(p => p.relativePath === Array.from(sp)[0]);
        if (pair) handleOpenRef.current(pair);
      }
      if (e.key === "Escape") { setSelectedPaths(new Set()); setContextMenu(null); }
      if (e.ctrlKey && e.key === "a") { e.preventDefault(); setSelectedPaths(new Set(flp.map(p => p.relativePath))); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (filePairs.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">请先选择两个目录</div>;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-gray-50 border-b text-xs">
        <div className="flex items-center gap-1">
          {(["all", "different", "same", "left-only", "right-only"] as FilterMode[]).map(f => {
            const labels: Record<FilterMode, string> = {
              all: `全部(${stats.total})`, different: `不同(${stats.different})`,
              same: `相同(${stats.identical})`, "left-only": `仅左(${stats.oldOnly})`,
              "right-only": `仅右(${stats.newOnly})`,
            };
            const colors: Record<FilterMode, string> = {
              all: "bg-blue-600 text-white", different: "bg-yellow-500 text-white",
              same: "bg-green-600 text-white", "left-only": "bg-gray-600 text-white",
              "right-only": "bg-gray-600 text-white",
            };
            if (f === "left-only" && stats.oldOnly === 0) return null;
            if (f === "right-only" && stats.newOnly === 0) return null;
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-2 py-0.5 rounded ${filter === f ? colors[f] : "hover:bg-gray-200"}`}>
                {labels[f]}
              </button>
            );
          })}
          <span className="border-l border-gray-300 h-4 mx-2" />
          <div className="flex items-center gap-1">
            <span className="text-gray-500">文件名:</span>
            <input
              type="text"
              placeholder="*.xlsx, report*, ..."
              value={filenameFilter}
              onChange={(e) => setFilenameFilter(e.target.value)}
              className="w-36 px-2 py-0.5 border rounded bg-white text-xs outline-none focus:border-blue-400"
            />
            {filenameFilter && (
              <button
                onClick={() => setFilenameFilter("")}
                className="text-gray-400 hover:text-gray-600 px-1"
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedPaths.size > 0 && <span className="text-blue-600">已选 {selectedPaths.size} 个</span>}
          <button onClick={handleVerifyAll} disabled={verifying}
            className="flex items-center gap-1 px-2 py-0.5 bg-blue-500 text-white hover:bg-blue-600 rounded disabled:opacity-50">
            {verifying ? <SpinnerIcon size={13} /> : null} 对比
          </button>
          <button onClick={handleRefresh} className="flex items-center gap-1 px-2 py-0.5 bg-gray-200 hover:bg-gray-300 rounded">
            <RefreshIcon size={13} /> 刷新
          </button>
          {merging && <span className="flex items-center gap-1 text-orange-500"><SpinnerIcon size={13} /> {mergeProgress}</span>}
        </div>
      </div>

      {/* Dual panel */}
      <div className="flex-1 flex overflow-hidden" onClick={() => setContextMenu(null)}>
        {/* Left */}
        <div ref={leftPanelRef} className="flex-1 border-r overflow-auto"
          onScroll={() => handlePanelScroll("left")}
          onContextMenu={(e) => handleContextMenu(e, "left", "", "folder")}>
          <div className="sticky top-0 bg-gray-100 px-4 py-1 text-xs font-mono border-b z-10 text-gray-600">
            {oldDir || "(未选择)"}
          </div>
          <div className="sticky top-6 bg-gray-50 px-4 py-0.5 text-xs text-gray-500 border-b z-10 flex items-center">
            <span className="w-3 mr-1"></span>
            <span className="flex-1">文件名</span>
            <span className="w-20 text-right">修改时间</span>
            <span className="w-16 text-right ml-2">大小</span>
          </div>
          <TreeFolderNode node={fileTree} side="left" level={0}
            selected={selectedPaths} onSelect={handleSelect}
            onDoubleClick={handleDoubleClick} onContextMenu={handleContextMenu}
            collapsedFolders={fileListCollapsedFolders} onToggle={toggleFolder} />
        </div>

        {/* Right */}
        <div ref={rightPanelRef} className="flex-1 overflow-auto"
          onScroll={() => handlePanelScroll("right")}
          onContextMenu={(e) => handleContextMenu(e, "right", "", "folder")}>
          <div className="sticky top-0 bg-gray-100 px-4 py-1 text-xs font-mono border-b z-10 text-gray-600">
            {newDir || "(未选择)"}
          </div>
          <div className="sticky top-6 bg-gray-50 px-4 py-0.5 text-xs text-gray-500 border-b z-10 flex items-center">
            <span className="w-3 mr-1"></span>
            <span className="flex-1">文件名</span>
            <span className="w-20 text-right">修改时间</span>
            <span className="w-16 text-right ml-2">大小</span>
          </div>
          <TreeFolderNode node={fileTree} side="right" level={0}
            selected={selectedPaths} onSelect={handleSelect}
            onDoubleClick={handleDoubleClick} onContextMenu={handleContextMenu}
            collapsedFolders={fileListCollapsedFolders} onToggle={toggleFolder} />
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center px-4 py-1 bg-gray-100 border-t text-xs text-gray-600">
        <span>相同 <b className="text-green-600">{stats.identical}</b></span>
        <span className="mx-2">|</span>
        <span>不同 <b className="text-red-600">{stats.different}</b></span>
        <span className="mx-2">|</span>
        <span>待确认 <b className="text-yellow-600">{stats.unknown}</b></span>
        <span className="mx-2">|</span>
        <span>仅左 <b className="text-gray-500">{stats.oldOnly}</b></span>
        <span className="mx-2">|</span>
        <span>仅右 <b className="text-gray-500">{stats.newOnly}</b></span>
        <span className="mx-2">|</span>
        <span>共 {stats.total} 个文件</span>
        {verifying && <span className="ml-3 flex items-center gap-1 text-blue-500"><SpinnerIcon size={12} /> 对比中...</span>}
        <span className="flex-1" />
        <span className="text-gray-400">单击选中 | 双击打开 | 右键合并 | Ctrl+A 全选 | Shift+点击 范围选</span>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu state={contextMenu} onAction={handleContextAction}
          onClose={() => setContextMenu(null)} />
      )}
      {vcsDialog && (
        <VcsLogDialog
          title={vcsDialog.title}
          info={vcsDialog.info}
          logs={vcsDialog.logs}
          loading={vcsDialog.loading}
          error={vcsDialog.error}
          onClose={() => setVcsDialog(null)}
          onOpenExternal={() => { void openVcsLog(vcsDialog.path); }}
        />
      )}
    </div>
  );
}
