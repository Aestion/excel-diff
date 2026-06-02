# Excel 合表对比工具 - 实现方案

## 项目概述

基于 Tauri 2.x + React + AG Grid 的桌面 Excel 对比/合并工具，参考 Beyond Compare 的交互设计。

**核心场景**：用户选择两个目录（旧版本 vs 新版本），按关键列匹配记录，可视化对比差异，手动选择性合并，保存覆盖新版本文件。

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | Tauri | 2.x |
| 前端 | React + TypeScript + Vite | latest |
| 表格 | AG Grid Community | 32+ |
| 状态 | Zustand | 5.x |
| 样式 | Tailwind CSS | latest |
| Excel读取 | calamine (Rust) | 0.25+ |
| Excel写入 | Python + openpyxl | 3.x |

## Beyond Compare 设计参考

### 颜色规范

| 场景 | 颜色 | 说明 |
|------|------|------|
| 相同 | 白色背景 | 两边数据一致 |
| 不同/修改 | 红色/粉色背景 | 两边都有但值不同 |
| 仅旧版/删除 | 灰色背景 | 只在左边存在 |
| 仅新版/新增 | 绿色背景 | 只在右边存在 |
| 当前选中 | 蓝色边框 ring | 键盘/鼠标选中行 |
| 修改单元格 | 红色高亮 | 具体哪个单元格变了 |

### 快捷键

| 快捷键 | 功能 | 位置 |
|--------|------|------|
| Ctrl+→ | 选中行从左复制到右 | 对比页 |
| Ctrl+← | 选中行从右复制到左 | 对比页 |
| Ctrl+G | 跳转下一个差异 | 对比页 |
| Ctrl+Shift+G | 跳转上一个差异 | 对比页 |
| Ctrl+B | 仅显示差异行 | 通用 |
| Ctrl+U | 仅显示相同行 | 目录页 |
| Ctrl+S | 保存 | 对比页 |
| Ctrl+Z | 撤销 | 对比页 |
| Ctrl+Y | 重做 | 对比页 |
| F5 | 刷新文件列表 | 目录页 |
| ↑↓ | 导航文件 | 目录页 |
| Enter | 打开选中文件 | 目录页 |
| Space | 选中/取消行 | 对比页 |

### UI 布局

#### 目录页
```
┌─────────────────────────────────────────────────┐
│ 工具栏: [全部][不同][相同][仅左][仅右] [刷新][全部左→右][全部右→左] │
├──────────────────────┬──────────────────────────┤
│ 旧目录路径           │ 新目录路径               │
├──────────────────────┼──────────────────────────┤
│ 文件列表 (左)        │ 文件列表 (右)            │
│ 白=相同 红=不同      │ 白=相同 红=不同          │
│ 灰=仅此侧           │ 灰=仅此侧               │
├──────────────────────┴──────────────────────────┤
│ 状态栏: 相同 5 | 不同 3 | 仅左 1 | 仅右 2 | 共11 │
└─────────────────────────────────────────────────┘
```

#### 对比页
```
┌─────────────────────────────────────────────────┐
│ [< 文件夹] 文件名  [Sheet▼] [仅差异] [撤销][重做][保存] │
├────────────────┬────────────────┬────────────────┤
│ ← 左: 旧版本   │ 操作           │ 右: 新版本 →   │
├────────────────┼────────────────┼────────────────┤
│ 表格 (只读)    │ [→复制] [←复制] │ 表格 (可编辑)  │
│                │   已选N行       │                │
├────────────────┴────────────────┴────────────────┤
│ 状态栏: 修改 3 | 新增 1 | 删除 2 | 未变 5        │
│ 快捷键提示: Ctrl+→ 左到右 | Ctrl+G 下一差异     │
└─────────────────────────────────────────────────┘
```

## 核心数据模型

```typescript
type CellValue = string | number | boolean | null;
type Row = CellValue[];
type RowKey = string;
type RowStatus = 'unchanged' | 'modified' | 'added' | 'deleted';

interface DiffRow {
  viewIndex: number;
  status: RowStatus;
  key: RowKey;
  oldRow: Row | null;
  newRow: Row | null;
  cellDiffs: CellDiff[];
  isOverridden: boolean;
}

interface DiffResult {
  keyColumnIndices: number[];
  diffRows: DiffRow[];
  stats: { unchanged: number; added: number; deleted: number; modified: number };
}
```

## Diff 算法

按关键列建立 Map（支持重复 key），O(n+m) 匹配。在前端 TypeScript 计算。
比较时以旧版列数为基准，忽略新版多余空列。

## 撤销/重做

Command Pattern，单元格级别粒度，栈深度 200 步。

## Excel 写入

通过 Python + openpyxl 修改原始文件，保留格式、颜色、字体。
Rust 后端序列化数据为 JSON → 调用 Python 脚本 → openpyxl 加载原文件 → 修改单元格 → 保存。

## Rust 后端命令

- `list_excel_files(dir)` - 递归列出目录下 Excel 文件
- `read_excel(path)` - 读取 Excel（自动截断空列）
- `write_excel(path, sheets)` - 通过 Python/openpyxl 写入
- `detect_key_columns(path, sheet)` - 自动检测唯一列

## 项目结构

```
excel-diff/
├── src/                          # React 前端
│   ├── App.tsx
│   ├── api/tauri.ts              # Tauri IPC 封装
│   ├── components/
│   │   ├── DirectoryPicker.tsx   # 双目录选择
│   │   ├── FileList.tsx          # 文件列表 + 筛选 + 批量合并
│   │   ├── DiffView.tsx          # 对比主界面 + 快捷键
│   │   └── DiffGrid.tsx          # AG Grid 封装
│   ├── stores/
│   │   ├── diffStore.ts          # 对比状态
│   │   └── editStore.ts          # 撤销/重做栈
│   ├── types/                    # TypeScript 类型
│   ├── utils/diffEngine.ts       # diff 算法
│   └── styles/index.css          # Tailwind + BC 风格颜色
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/mod.rs       # Tauri 命令
│   │   ├── excel/reader.rs       # calamine 读取（截断空列）
│   │   └── excel/writer.rs       # 调用 Python 脚本
│   └── write_excel.py            # openpyxl 写入脚本
└── docs/
```

## 实现状态

### Phase 1: 脚手架 + 只读对比 ✅
### Phase 2: 编辑 + 复制操作 ✅
### Phase 3: 保存 + 持久化 + 快捷键 ✅
### Phase 4: 打磨 + 边界情况 (进行中)

#### 已完成
- [x] Beyond Compare 风格颜色方案
- [x] 目录页筛选按钮（全部/不同/相同/仅左/仅右）
- [x] Ctrl+B / Ctrl+U 筛选快捷键
- [x] Ctrl+→ / Ctrl+← 双向合并
- [x] Ctrl+G / Ctrl+Shift+G 差异导航
- [x] F5 刷新、↑↓ 导航
- [x] 底部状态栏（目录页 + 对比页）
- [x] 数据内容比较（替代文件大小比较）
- [x] openpyxl 格式保留写入
- [x] 空列忽略 + 旧版列数基准
- [x] 重复 key 处理

#### 待实现
- [x] 左右同步滚动
- [x] 关键列选择 UI
- [x] 日期单元格正确处理
- [x] 加载指示器（大文件）
- [x] 错误提示对话框
- [x] 导出 diff 报告（CSV）
- [x] 应用图标 + 安装包配置
