# Excel Diff — 合表对比工具

一个基于 Tauri 的 Excel 文件对比工具，支持快速对比两个目录中的 Excel 文件，可视化差异并支持一键合并。

## 功能特性

- **快速文件对比** — 基于文件大小快速筛选，瞬间显示文件列表
- **手动对比** — 点击"对比"按钮触发详细数据对比
- **可视化差异** — 左右分栏显示，差异高亮标注
- **公式支持** — 识别并对比 Excel 公式
- **一键合并** — 支持左→右、右→左批量复制
- **单元格编辑** — 直接在对比界面修改数据
- **导出报告** — 导出差异报告为 CSV 文件
- **文件夹对齐** — 仅一侧存在的文件显示为灰色占位行

## 技术栈

- **前端**：React + TypeScript + Zustand + Tailwind CSS
- **后端**：Rust (Tauri 2)
- **Excel 读取**：calamine (纯 Rust，无需 Python)
- **Excel 写入**：Python openpyxl（保留格式和元数据）

## 安装

### 下载安装包

从 [Releases](https://github.com/Aestion/excel-diff/releases) 下载最新版本：

- `Excel Diff_1.0.0_x64-setup.exe` — NSIS 安装包
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

## 使用方法

1. **选择目录** — 分别选择左侧和右侧的 Excel 文件目录
2. **查看文件列表** — 文件按名称对齐显示，大小不同的自动标记为"不同"
3. **点击对比** — 点击蓝色"对比"按钮，详细对比所有文件内容
4. **查看差异** — 双击文件进入对比视图，查看具体差异
5. **合并文件** — 右键选择文件，批量复制到另一侧

## 快捷键

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
├── src/                    # 前端源码
│   ├── components/         # React 组件
│   ├── stores/             # Zustand 状态管理
│   ├── utils/              # 工具函数
│   └── types/              # TypeScript 类型定义
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── excel/          # Excel 读写模块
│   │   ├── commands/       # Tauri 命令
│   │   └── models/         # 数据模型
│   ├── read_excel.py       # Python Excel 读取（备用）
│   └── write_excel.py      # Python Excel 写入
└── package.json
```

## 性能优化

- **文件列表**：只比较文件大小，不读取文件内容，瞬间加载
- **手动对比**：用户点击"对比"按钮才触发详细对比
- **原生读取**：使用 Rust calamine 读取 Excel，比 Python 快 10-50 倍
- **并发处理**：支持 4 个文件并发对比
- **结果缓存**：已对比结果缓存在内存中，避免重复读取

## 许可证

MIT License
