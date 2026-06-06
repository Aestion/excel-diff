# Excel Diff — 合表对比工具

一个基于 Tauri 的 Excel 文件对比工具，支持快速对比两个目录中的 Excel 文件，可视化差异并支持一键合并。

![Excel Diff](https://img.shields.io/badge/Tauri-2.0-blue) ![React](https://img.shields.io/badge/React-18-61dafb) ![Rust](https://img.shields.io/badge/Rust-1.70+-orange)

## 功能特性

### 核心功能
- **快速文件对比** — 基于文件大小快速筛选，瞬间显示文件列表
- **手动对比** — 点击"对比"按钮触发详细数据对比，支持多次重新对比
- **可视化差异** — 左右分栏显示，差异高亮标注，支持差异导航
- **公式支持** — 识别并对比 Excel 公式（读取公式字符串和缓存值）
- **一键合并** — 支持左→右、右→左批量复制文件（直接文件复制，保留所有格式）
- **单元格编辑** — 直接在对比界面修改数据，支持撤销/重做
- **导出报告** — 导出差异报告为 CSV 文件

### 文件列表
- **文件夹对齐** — 仅一侧存在的文件显示为灰色占位行，保持行对齐
- **同步滚动** — 左右面板滚动位置自动同步
- **状态持久化** — 文件夹折叠状态、滚动位置在返回时保留
- **对比结果保留** — 从对比视图返回后，已对比的结果不会丢失

### 对比视图
- **差异块导航** — 连续差异行自动分组，支持 Ctrl+G 快速跳转
- **单元格级高亮** — 精确标注修改的单元格
- **行级操作** — 支持选中行、复制行到另一侧
- **智能查找** — Ctrl+F 搜索内容，支持 Enter/Shift+Enter 导航

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    前端 (React + TypeScript)              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ FileList │  │ DiffView │  │ DiffGrid │  │  Store  │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────┘
                           │
                    Tauri IPC 调用
                           │
┌─────────────────────────────────────────────────────────┐
│                    后端 (Rust)                           │
│  ┌──────────────────┐  ┌──────────────────┐             │
│  │  calamine 读取   │  │  Python 写入     │             │
│  │  (纯 Rust, 快速) │  │  (openpyxl)      │             │
│  └──────────────────┘  └──────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

### 技术栈
- **前端**：React 18 + TypeScript + Zustand + Tailwind CSS
- **后端**：Rust (Tauri 2)
- **Excel 读取**：calamine (纯 Rust，无需 Python，比 Python 快 10-50 倍)
- **Excel 写入**：Python openpyxl（保留格式、样式、元数据）

## 安装

### 下载安装包

从 [Releases](https://github.com/Aestion/excel-diff/releases) 下载最新版本：

- `Excel Diff_1.0.0_x64-setup.exe` — NSIS 安装包（推荐）
- `Excel Diff_1.0.0_x64_en-US.msi` — MSI 安装包

### 从源码构建

**前置要求：**
- Node.js 18+
- Rust 1.70+
- Python 3.8+（用于 Excel 写入）
- Tauri CLI

```bash
# 克隆仓库
git clone https://github.com/Aestion/excel-diff.git
cd excel-diff

# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建发布版本
npm run tauri build
```

构建完成后，可执行文件位于：
- `src-tauri/target/release/excel-diff.exe`
- 安装包位于 `src-tauri/target/release/bundle/`

## 使用方法

### 基本流程

1. **选择目录** — 分别选择左侧和右侧的 Excel 文件目录
2. **查看文件列表** — 文件按名称对齐显示
   - 🔴 红色背景：文件大小不同（一定有差异）
   - 🟡 黄色背景：文件大小相同（待确认）
   - ⚪ 灰色背景：仅一侧存在的文件
3. **点击对比** — 点击蓝色"对比"按钮，详细对比所有文件内容
4. **查看差异** — 双击文件进入对比视图，查看具体差异
5. **合并文件** — 右键选择文件，批量复制到另一侧

### 对比视图操作

- **查看差异** — 差异行高亮显示，支持差异块导航
- **复制行** — 选中行后，点击中间的"复制"按钮或使用 Ctrl+→/Ctrl+←
- **编辑单元格** — 双击右侧单元格可直接编辑
- **保存** — 修改后点击"保存左侧"或"保存右侧"

## 快捷键

### 文件列表
| 快捷键 | 功能 |
|--------|------|
| `F5` | 刷新文件列表 |
| `Ctrl+B` | 切换显示仅不同的文件 |
| `Ctrl+A` | 全选文件 |
| `Enter` | 打开选中的文件 |
| `Esc` | 取消选择 |

### 对比视图
| 快捷键 | 功能 |
|--------|------|
| `Ctrl+F` | 查找 |
| `Ctrl+→` | 复制选中行到右侧 |
| `Ctrl+←` | 复制选中行到左侧 |
| `Ctrl+G` | 下一个差异 |
| `Ctrl+Shift+G` | 上一个差异 |
| `Ctrl+B` | 仅显示差异 |
| `Ctrl+S` | 保存 |
| `Ctrl+Z` | 撤销 |
| `Ctrl+Y` | 重做 |

## 项目结构

```
excel-diff/
├── src/                          # 前端源码
│   ├── components/               # React 组件
│   │   ├── FileList.tsx          # 文件列表（双栏对比）
│   │   ├── DiffView.tsx          # 差异对比视图
│   │   ├── DiffGrid.tsx          # 差异网格组件
│   │   ├── KeyColumnSelector.tsx # 关键列选择器
│   │   ├── DirectoryPicker.tsx   # 目录选择器
│   │   ├── HistoryBar.tsx        # 历史记录栏
│   │   └── Icons.tsx             # 图标组件
│   ├── stores/                   # Zustand 状态管理
│   │   ├── diffStore.ts          # 核心状态（文件、对比、缓存）
│   │   ├── editStore.ts          # 编辑状态（撤销/重做）
│   │   └── historyStore.ts       # 历史记录
│   ├── utils/
│   │   └── diffEngine.ts         # 差异对比算法
│   ├── types/                    # TypeScript 类型定义
│   └── api/
│       └── tauri.ts              # Tauri IPC 接口
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── excel/
│   │   │   ├── reader.rs         # Excel 读取（calamine）
│   │   │   └── writer.rs         # Excel 写入（Python）
│   │   ├── commands/mod.rs       # Tauri 命令
│   │   └── models/types.rs       # 数据模型
│   ├── read_excel.py             # Python Excel 读取（备用）
│   ├── write_excel.py            # Python Excel 写入
│   └── Cargo.toml                # Rust 依赖
└── package.json
```

## 性能优化

### 读取优化
- **纯 Rust 读取**：使用 calamine 直接读取 Excel，无需 Python 进程
- **直接文件复制**：合并操作使用文件复制，不经过读写，保留所有格式和元数据
- **并发处理**：支持 4 个文件并发对比
- **结果缓存**：已对比结果缓存在内存中，避免重复读取

### UI 优化
- **延迟加载**：文件列表只比较大小，不读取内容
- **手动触发**：点击"对比"按钮才执行详细对比
- **状态保留**：返回文件列表时保留对比结果和 UI 状态
- **同步滚动**：左右面板滚动位置自动同步

### 对比算法
- **智能匹配**：基于关键列匹配行，支持多关键列
- **单元格级对比**：精确到单元格的差异检测
- **公式感知**：对比公式字符串，而非仅对比缓存值
- **文本规范化**：自动处理换行符差异（`\r\n` vs `\n`）
- **重复键检测**：自动识别关键列重复的行，避免误匹配

## 已知限制

- Excel 写入依赖 Python，需要安装 Python 3.8+
- 不支持 .xls 格式（仅支持 .xlsx, .xlsm, .xlsb）
- 大型文件（>10MB）对比可能较慢
- 合并操作会覆盖目标文件，建议先备份

## 许可证

MIT License
