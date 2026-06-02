# 历史对比记录功能 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DirectoryPicker 上方添加可折叠的历史记录栏，保存最近 5 次对比记录

**Architecture:** 新增 historyStore 管理历史状态和持久化，新增 HistoryBar 组件展示，修改 App.tsx 集成，修改 diffStore.ts 触发保存时机

**Tech Stack:** React, TypeScript, Zustand, Tauri (fs/path)

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/stores/historyStore.ts` | 新建 | 历史记录状态管理和持久化 |
| `src/components/HistoryBar.tsx` | 新建 | 历史记录UI组件 |
| `src/App.tsx` | 修改 | 集成 HistoryBar 到页面 |
| `src/stores/diffStore.ts` | 修改 | 在 buildFilePairs 后添加历史记录 |

---

### Task 1: 创建 historyStore.ts - 基础状态结构

**Files:**
- Create: `src/stores/historyStore.ts`

- [ ] **Step 1: 定义类型和初始状态**

```typescript
import { create } from "zustand";

export interface HistoryRecord {
  id: string;
  oldDir: string;
  newDir: string;
  timestamp: number;
}

interface HistoryState {
  records: HistoryRecord[];
  isCollapsed: boolean;

  setRecords: (records: HistoryRecord[]) => void;
  add: (oldDir: string, newDir: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  toggleCollapsed: () => void;
  load: () => Promise<void>;
  save: () => Promise<void>;
}

// Generate unique id
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Max records to keep
const MAX_RECORDS = 5;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  records: [],
  isCollapsed: false,

  setRecords: (records) => set({ records }),

  add: (oldDir, newDir) => {
    const { records } = get();
    const now = Date.now();

    // Check for duplicate (same oldDir and newDir)
    const existingIndex = records.findIndex(
      (r) => r.oldDir === oldDir && r.newDir === newDir
    );

    let newRecords: HistoryRecord[];
    if (existingIndex >= 0) {
      // Move existing to front with new timestamp
      const existing = records[existingIndex];
      newRecords = [
        { ...existing, timestamp: now },
        ...records.slice(0, existingIndex),
        ...records.slice(existingIndex + 1),
      ];
    } else {
      // Add new to front
      newRecords = [
        { id: generateId(), oldDir, newDir, timestamp: now },
        ...records,
      ];
    }

    // Trim to max records
    if (newRecords.length > MAX_RECORDS) {
      newRecords = newRecords.slice(0, MAX_RECORDS);
    }

    set({ records: newRecords });
    get().save();
  },

  remove: (id) => {
    set((state) => ({ records: state.records.filter((r) => r.id !== id) }));
    get().save();
  },

  clear: () => {
    set({ records: [] });
    get().save();
  },

  toggleCollapsed: () => set((state) => ({ isCollapsed: !state.isCollapsed })),

  load: async () => {
    try {
      const { join, appDataDir } = await import("@tauri-apps/api/path");
      const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
      const appDir = await appDataDir();
      const historyPath = await join(appDir, "history.json");

      if (await exists(historyPath)) {
        const content = await readTextFile(historyPath);
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          set({ records: data });
        }
      }
    } catch {
      // Ignore errors - start with empty
    }
  },

  save: async () => {
    try {
      const { join, appDataDir } = await import("@tauri-apps/api/path");
      const { writeTextFile, exists, mkdir } = await import("@tauri-apps/plugin-fs");
      const appDir = await appDataDir();

      // Ensure app data dir exists
      if (!(await exists(appDir))) {
        await mkdir(appDir, { recursive: true });
      }

      const historyPath = await join(appDir, "history.json");
      await writeTextFile(historyPath, JSON.stringify(get().records, null, 2));
    } catch {
      // Ignore errors
    }
  },
}));
```

---

### Task 2: 创建 HistoryBar.tsx 组件

**Files:**
- Create: `src/components/HistoryBar.tsx`
- Reference: `src/components/Icons.tsx` (for ChevronDown, etc.)

- [ ] **Step 1: 创建 HistoryBar 组件**

```typescript
import { useCallback } from "react";
import { useHistoryStore } from "../stores/historyStore";
import { useDiffStore } from "../stores/diffStore";
import { listExcelFiles } from "../api/tauri";
import { ChevronDown, XIcon, ClockIcon } from "./Icons";

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
  const { records, isCollapsed, toggleCollapsed, remove, clear, load } = useHistoryStore();
  const { setOldDir, setNewDir, setOldFiles, setNewFiles, buildFilePairs, oldDir, newDir } =
    useDiffStore();

  // Load on mount
  useCallback(() => {
    load();
  }, [load]);

  const handleSelect = useCallback(
    async (record: { oldDir: string; newDir: string }) => {
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
    [setOldDir, setNewDir, setOldFiles, setNewFiles, buildFilePairs]
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
                <span className="text-gray-700 truncate">
                  左: {truncatePath(record.oldDir || "-", 20)} → 右: {truncatePath(record.newDir || "-", 20)}
                </span>
                <button
                  onClick={(e) => handleRemove(e, record.id)}
                  className="ml-auto opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-500 transition-opacity"
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
```

---

### Task 3: 添加 Icons (如果需要)

**Files:**
- Check: `src/components/Icons.tsx`

- [ ] **Step 1: 检查并添加需要的图标**

首先读取现有 Icons.tsx，确认是否已有 ClockIcon，如果没有则添加：

```tsx
// 已有图标保持不变，新增：

export function ClockIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function XIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
```

---

### Task 4: 修改 App.tsx 集成 HistoryBar

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 修改 App.tsx**

```tsx
import { useDiffStore } from "./stores/diffStore";
import DirectoryPicker from "./components/DirectoryPicker";
import FileList from "./components/FileList";
import DiffView from "./components/DiffView";
import HistoryBar from "./components/HistoryBar";

function App() {
  const { currentView } = useDiffStore();

  return (
    <div className="h-screen flex flex-col bg-gray-50 text-gray-900 select-none">
      {currentView === "directory" && (
        <>
          <HistoryBar />
          <DirectoryPicker />
          <FileList />
        </>
      )}
      {currentView === "diff" && <DiffView />}
    </div>
  );
}

export default App;
```

---

### Task 5: 修改 diffStore.ts 添加历史记录触发

**Files:**
- Modify: `src/stores/diffStore.ts`

- [ ] **Step 1: 修改 buildFilePairs 函数**

在 `buildFilePairs` 函数的最后，成功构建 filePairs 后添加历史记录：

```typescript
  buildFilePairs: async () => {
    const { oldFiles, newFiles, oldDir, newDir } = get();
    const oldMap = new Map(oldFiles.map((f) => [f.relativePath, f]));
    const newMap = new Map(newFiles.map((f) => [f.relativePath, f]));
    const allPaths = new Set([...oldMap.keys(), ...newMap.keys()]);

    // Build initial pairs with size-based guess
    const pairs: FilePair[] = Array.from(allPaths)
      .sort()
      .map((relPath) => {
        const oldFile = oldMap.get(relPath);
        const newFile = newMap.get(relPath);
        if (oldFile && newFile) {
          return {
            filename: oldFile.name, relativePath: relPath,
            oldPath: oldFile.path, newPath: newFile.path,
            oldSize: oldFile.sizeBytes, newSize: newFile.sizeBytes,
            status: "matched" as const,
            diffStatus: oldFile.sizeBytes === newFile.sizeBytes ? "identical" as const : "different" as const,
          };
        } else if (oldFile) {
          return {
            filename: oldFile.name, relativePath: relPath,
            oldPath: oldFile.path, newPath: null,
            oldSize: oldFile.sizeBytes, newSize: 0,
            status: "old-only" as const, diffStatus: "unknown" as const,
          };
        } else {
          return {
            filename: newFile!.name, relativePath: relPath,
            oldPath: null, newPath: newFile!.path,
            oldSize: 0, newSize: newFile!.sizeBytes,
            status: "new-only" as const, diffStatus: "unknown" as const,
          };
        }
      });

    // Set pairs immediately (size-based)
    set({ filePairs: pairs });

    // Add to history if both directories are selected
    if (oldDir && newDir && pairs.length > 0) {
      const { useHistoryStore } = await import("./historyStore");
      useHistoryStore.getState().add(oldDir, newDir);
    }

    // Then verify "different" files by reading actual data (background)
    const { readExcel } = await import("../api/tauri");
    const verifiedPairs = [...pairs];

    for (let i = 0; i < verifiedPairs.length; i++) {
      const p = verifiedPairs[i];
      if (p.status !== "matched" || p.diffStatus !== "different") continue;

      try {
        const [oldWb, newWb] = await Promise.all([
          readExcel(p.oldPath!),
          readExcel(p.newPath!),
        ]);

        // Compare all common sheets
        let allSame = true;
        for (const sheetName of oldWb.sheetNames) {
          const oldSheet = oldWb.sheets.find((s) => s.name === sheetName);
          const newSheet = newWb.sheets.find((s) => s.name === sheetName);
          if (!newSheet) { allSame = false; break; }
          if (JSON.stringify(oldSheet!.rows) !== JSON.stringify(newSheet.rows)) {
            allSame = false; break;
          }
        }

        if (allSame && oldWb.sheetNames.length === newWb.sheetNames.length) {
          verifiedPairs[i] = { ...p, diffStatus: "identical" };
        }
      } catch {
        // Keep as "different" if we can't read
      }
    }

    set({ filePairs: verifiedPairs });
  },
```

---

### Task 6: 修复 HistoryBar 的 load 调用

**Files:**
- Modify: `src/components/HistoryBar.tsx`

- [ ] **Step 1: 用 useEffect 替代 useCallback 加载**

```typescript
import { useCallback, useEffect } from "react";
// ... 其他 import 保持不变

export default function HistoryBar() {
  const { records, isCollapsed, toggleCollapsed, remove, clear, load } = useHistoryStore();
  // ... 其他 state 保持不变

  // Load on mount
  useEffect(() => {
    load();
  }, [load]);

  // ... 其余代码保持不变
}
```

---

### Task 7: 手动测试功能

**Files:** 无需修改

- [ ] **Step 1: 启动开发服务器**

```bash
npm run tauri dev
```

- [ ] **Step 2: 测试流程**

1. 选择两个目录，确认历史记录栏出现该记录
2. 再次选择相同两个目录，确认记录被更新到最前面而不是新增
3. 选择不同目录，确认添加新记录
4. 选择第 6 个目录，确认最早的记录被移除
5. 点击历史记录，确认能正确加载
6. 点击 × 删除单条记录
7. 点击清空，确认全部删除
8. 收起/展开功能测试

---

## 计划完成检查

| Spec 要求 | 对应任务 |
|-----------|----------|
| 可折叠历史记录栏 | Task 2, Task 4 |
| 保存 5 条记录 | Task 1 |
| 时间戳显示 MM-DD HH:mm | Task 2 |
| 点击历史加载目录 | Task 2 |
| 删除单条/清空 | Task 2 |
| 重复记录更新时间戳 | Task 1 |
| 持久化到 appDataDir/history.json | Task 1 |
| 选择目录后自动保存历史 | Task 5 |
