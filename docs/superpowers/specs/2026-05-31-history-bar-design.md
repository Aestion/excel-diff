# 历史对比记录功能 - 设计文档

**日期**: 2026-05-31
**功能**: 在 FileList 页面添加历史对比记录栏

## 概述

在 DirectoryPicker 上方添加一个可折叠的历史记录栏，保存最近 5 次对比记录，点击可快速加载。

## 数据结构

```typescript
// 历史记录项
interface HistoryRecord {
  id: string;           // 唯一标识 (timestamp + random)
  oldDir: string;       // 左侧目录路径
  newDir: string;       // 右侧目录路径
  timestamp: number;    // Unix timestamp (ms)
}

// 历史记录管理
interface HistoryStore {
  records: HistoryRecord[];
  isCollapsed: boolean;

  load: () => Promise<void>;
  save: () => Promise<void>;
  add: (oldDir: string, newDir: string) => Promise<void>;
  remove: (id: string) => void;
  clear: () => void;
  toggleCollapsed: () => void;
}
```

## 组件结构

```
excel-diff/
├── src/
│   ├── components/
│   │   ├── HistoryBar.tsx       # 新增：历史记录栏组件
│   │   ├── DirectoryPicker.tsx  # 现有
│   │   └── FileList.tsx         # 现有
│   ├── stores/
│   │   ├── historyStore.ts      # 新增：历史记录状态管理
│   │   └── diffStore.ts         # 现有（修改：添加 addHistory 时机）
│   └── api/
│       └── tauri.ts             # 现有（添加：历史记录文件读写辅助函数）
```

## 新增组件：HistoryBar.tsx

UI 布局：
```
┌─────────────────────────────────────────────────────────┐
│ [▼] 历史对比记录                    [清空] │ ← 标题栏
├─────────────────────────────────────────────────────────┤
│ 05-31 14:30 左: C:\old\... → 右: C:\new\...  [×] │
│ 05-30 10:15 左: D:\data\... → 右: D:\backup\... [×] │
│ ... (最多5条)                                    │
│ (暂无历史记录)                                   │
└─────────────────────────────────────────────────────────┘
```

- 点击 [▼] 可收起/展开
- 点击历史记录行加载目录
- 点击 [×] 删除单条
- 点击 [清空] 清空全部

## 新增 Store：historyStore.ts

使用 Zustand，管理历史记录状态和持久化。

## 修改：diffStore.ts

在 `buildFilePairs` 成功后，自动调用 `historyStore.add(oldDir, newDir)` 添加历史记录。

## 修改：App.tsx

在 DirectoryPicker 上方渲染 HistoryBar。

## Tauri 命令扩展

无需新增 Rust 命令，使用现有的 `@tauri-apps/plugin-fs` 和 `@tauri-apps/api/path` 读写 JSON 文件到 `appDataDir/history.json`。

## 数据流

1. 应用启动 → `historyStore.load()` 从文件加载历史
2. 用户选择两个目录并成功加载 → `historyStore.add()` 新增/更新记录 → `historyStore.save()` 保存到文件
3. 用户点击历史记录 → 调用 `setOldDir/setNewDir` → `listExcelFiles` → `buildFilePairs`
4. 用户删除/清空 → 更新 store → 保存到文件

## 重复记录处理

添加新记录时，如果已存在完全相同的 `oldDir` 和 `newDir`，则更新那条记录的 `timestamp` 并移到最前面，而不是新增。

## 边界情况处理

| 情况 | 处理方式 |
|------|----------|
| 历史记录中的目录已不存在 | 点击时正常尝试加载，让 Tauri 的 `listExcelFiles` 报错处理 |
| 只有一个目录存在 | 仍然加载，另一边留空 |
| 重复的历史记录 | 更新已有记录的时间戳并移到最前面 |
| 应用首次启动 | 历史记录区域显示"暂无历史记录" |
| 超过 5 条记录 | 自动删除最早的记录 |

## 时间戳显示格式

`MM-DD HH:mm`（例如 `05-31 14:30`）
