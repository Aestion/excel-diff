# Excel Diff 与 Git/SVN 集成计划

## 背景

当前工具已经能回答“两个目录里的 Excel 文件有什么差异”。下一步希望把差异和版本管理上下文连接起来，让用户在看到某个文件、某张表或某处差异时，可以继续追问：

- 这个文件最近是谁改的？
- 什么时候改的？
- 提交说明是什么？
- 左右两侧文件分别来自哪个 Git 分支、SVN URL 或 revision？
- 是否可以直接跳到 Git/SVN 日志继续追查？

这个方向的核心目标不是简单嵌入外部右键菜单，而是做“差异原因追踪”。

## 需求理解

用户提出的粗略例子是：在 FileList 页面右键点击左右任意 Excel 文件时，能够直接查看该文件在系统右键菜单里的 SVN/Git 入口，以便查询日志。

分析后，这个例子背后更真实的需求是：

1. 在对比文件时快速进入版本历史。
2. 不想从文件路径手动打开资源管理器，再找 SVN/Git 菜单。
3. 希望版本信息和当前左右目录、当前文件、当前差异建立上下文关联。
4. 初期可以依赖外部 Git/SVN/Tortoise 工具，但长期希望工具自身能展示关键信息。

## 设计原则

- 优先做可控命令入口，而不是直接模拟系统右键菜单。
- 优先支持当前文件路径，再逐步支持目录、sheet、差异行。
- Git/SVN 检测应自动完成，失败时给出明确提示。
- 外部工具入口作为补充，工具内版本摘要作为长期方向。
- 不强依赖 TortoiseSVN/TortoiseGit；有则增强，没有也能用命令行 Git/SVN。
- 所有版本控制能力都应同时支持左侧文件和右侧文件。

## 集成层次

### Level 1: 轻量入口

在 FileList 右键菜单中加入版本相关动作：

- 查看版本记录
- 在资源管理器中定位
- 复制文件路径
- 复制相对路径
- 用 TortoiseGit/TortoiseSVN 打开日志（可选，检测到后显示）

这一层解决“快速跳转”，实现成本低，风险小。

### Level 2: 工具内版本摘要

在工具内读取并展示每个文件的版本控制上下文：

- VCS 类型：Git / SVN / none
- Git 仓库根目录、当前分支、工作区状态
- SVN working copy root、URL、revision
- 文件最近一次提交：作者、时间、commit/revision、摘要
- 文件当前状态：modified、added、deleted、untracked、clean 等

这一层解决“无需离开工具即可知道大概是谁改了什么”。

### Level 3: 差异与版本联动

将版本信息和 Excel 差异进一步结合：

- 在 DiffView 顶部展示当前文件左右两侧的版本来源。
- 右键某个差异行时，可以查看当前文件最近提交。
- 支持从 Git/SVN 某个历史版本读取文件作为左侧或右侧进行比较。
- 支持比较两个 Git commit、两个 SVN revision 下的同一个 Excel 文件。
- 导出 diff 报告时附带版本来源信息。

这一层让工具从“目录对比器”升级为“版本变更分析器”。

## 推荐路线

### Phase 0: 探索与约束确认

目标：确认本机和目标用户环境里 TortoiseGit/TortoiseSVN 的可用性，并建立命令行 Git/SVN 作为兜底能力。

任务：

- 调研 Windows 下 Git、SVN、TortoiseGit、TortoiseSVN 常见安装路径和调用方式。
- 明确是否需要支持非 Windows 平台。
- 明确 TortoiseGit/TortoiseSVN 的检测路径和调用参数。
- 明确 SVN 场景是标准 working copy 还是存在多层 checkout。

输出：

- VCS 命令检测策略。
- 外部工具调用策略。
- 初版错误提示文案。

### Phase 1: FileList 右键菜单轻量集成

目标：让用户在文件列表里能快速打开 Tortoise 版本日志，支持文件和文件夹节点。

任务：

- 在 Rust 后端新增命令：
  - `detect_vcs_for_path(path)`：检测 Git/SVN/none。
  - `open_in_file_explorer(path)`：在资源管理器中定位文件。
  - `open_vcs_log(path)`：按检测结果打开合适的日志入口。
- 在前端 API 层封装这些命令。
- 在 `FileList` 右键菜单加入：
  - 查看版本记录
  - 在资源管理器中定位
  - 复制路径
- 支持左右侧路径分别调用。
- 支持文件夹节点右键查看目录级日志。
- 当检测不到 Git/SVN 时，降级到资源管理器定位或提示。

验收：

- Git working tree 中的文件可以通过 TortoiseGit 打开 Git 日志。
- SVN working copy 中的文件可以通过 TortoiseSVN 打开 SVN 日志。
- Git/SVN working copy 中的目录节点可以打开目录级日志。
- 普通目录文件不会报错崩溃，有清晰提示。

### Phase 2: 工具内版本摘要面板

目标：在不离开工具的情况下看到文件的版本摘要。

任务：

- 新增版本信息数据模型：
  - `VcsKind`
  - `VcsFileStatus`
  - `VcsFileInfo`
  - `VcsCommitSummary`
- Rust 后端新增命令：
  - `get_vcs_file_info(path)`
  - `get_vcs_file_log(path, limit)`
- Git 实现：
  - `git rev-parse --show-toplevel`
  - `git branch --show-current`
  - `git status --porcelain -- path`
  - `git log -n <limit> --date=iso -- path`
- SVN 实现：
  - `svn info path`
  - `svn status path`
  - `svn log -l <limit> path`
- FileList 中增加版本标记或详情入口。
- 右键“查看版本记录”优先打开工具内弹窗；弹窗里再提供“用外部工具打开”。

验收：

- Git 文件能看到最近提交摘要。
- SVN 文件能看到最近 revision 摘要。
- 左右两侧同名文件能分别显示版本来源。

### Phase 3: DiffView 版本上下文

目标：用户进入具体 Excel diff 后，也能看到左右文件来源。

任务：

- DiffView 顶部展示左右文件的版本摘要：
  - Git 分支 / SVN URL
  - 最近提交人和时间
  - 当前工作区状态
- 保存文件后刷新该文件版本状态。
- 导出 CSV 报告时可选附带版本摘要。

验收：

- 打开 diff 页面时能看到左右版本来源。
- 文件保存后，右侧状态能刷新为 modified 或对应 SVN 状态。

### Phase 4: 历史版本比较

目标：支持直接用版本库历史内容进行 Excel 对比。

任务：

- Git：
  - `git show <rev>:<repo-relative-path>` 导出临时文件。
  - 支持选择 commit 作为左侧或右侧。
- SVN：
  - `svn cat -r <rev> <path>` 导出临时文件。
  - 支持选择 revision 作为左侧或右侧。
- 新增临时文件管理策略。
- UI 中提供“与历史版本比较”入口。

验收：

- 可以选择一个 Git commit 中的 Excel 文件与当前工作区文件比较。
- 可以选择一个 SVN revision 中的 Excel 文件与当前文件比较。

## 初版技术方案

### Rust 后端模块建议

新增模块：

```text
src-tauri/src/vcs/
  mod.rs
  types.rs
  detect.rs
  git.rs
  svn.rs
  external.rs
```

命令入口放在：

```text
src-tauri/src/commands/mod.rs
```

前端封装放在：

```text
src/api/tauri.ts
```

前端 UI 首批修改：

```text
src/components/FileList.tsx
src/components/ErrorDialog.tsx
```

后续可新增：

```text
src/components/VcsLogDialog.tsx
src/components/VcsBadge.tsx
src/stores/vcsStore.ts
```

### 数据模型草案

```typescript
export type VcsKind = "git" | "svn" | "none";

export interface VcsFileInfo {
  kind: VcsKind;
  path: string;
  root?: string;
  branch?: string;
  url?: string;
  revision?: string;
  status?: string;
  lastCommit?: VcsCommitSummary;
}

export interface VcsCommitSummary {
  id: string;
  author?: string;
  date?: string;
  message: string;
}
```

### 外部工具调用优先级

Git：

1. 如果检测到 TortoiseGitProc.exe，调用 TortoiseGit 日志。
2. 否则尝试命令行 `git log -- <path>` 并提示用户未检测到 TortoiseGit。
3. 否则降级为资源管理器定位。

SVN：

1. 如果检测到 TortoiseProc.exe，调用 TortoiseSVN 日志。
2. 否则尝试命令行 `svn log <path>` 并提示用户未检测到 TortoiseSVN。
3. 否则降级为资源管理器定位。

## 风险与待确认

- TortoiseSVN 和 TortoiseGit 的安装路径可能不固定。
- Git/SVN 命令输出需要解析，中文环境、编码、换行格式都要处理。
- SVN working copy 可能较慢，日志查询应异步执行并可取消。
- 文件路径含中文、空格、特殊字符时必须严格使用参数传递，不能拼 shell 字符串。
- Git LFS 或 SVN 大文件历史版本导出可能耗时。
- 历史版本比较需要临时文件生命周期管理。

## 待用户确认的问题

1. TortoiseGitProc.exe 和 TortoiseProc.exe 是否存在统一安装路径，还是需要做全盘/注册表检测？
2. 打开日志时是否要默认带上 revision/commit 范围，还是仅打开当前文件/目录完整日志？
3. 文件夹级日志应在左侧/右侧树目录节点都显示，还是只对真实存在的一侧显示？
4. 后续历史版本比较更常用“当前文件 vs 历史版本”，还是“两边分别选择历史版本”？

## 决策记录

| 日期 | 决策 | 说明 |
|------|------|------|
| 2026-06-09 | 不优先模拟系统右键菜单 | 改为可控的 Git/SVN 命令入口，系统/Tortoise 入口作为增强 |
| 2026-06-09 | 将需求定义为“差异原因追踪” | 版本日志、作者、提交摘要、来源分支都属于核心上下文 |
| 2026-06-09 | 先从 FileList 右键菜单开始 | 成本低，和现有工作流贴合，适合作为第一阶段 |
| 2026-06-09 | 初版直接打开 Tortoise 外部工具 | 目标用户主要使用 TortoiseSVN/TortoiseGit，工具内日志弹窗后置 |
| 2026-06-09 | Git 与 SVN 同等优先级 | 两者都需要支持，不区分主次 |
| 2026-06-09 | 支持文件夹级日志 | FileList 树节点右键需要能查看目录历史 |
| 2026-06-09 | 历史版本比较作为后续重点 | 日志查询之后继续推进历史版本与当前文件比较 |

## 工作记录

### 2026-06-09

- 建立本长期计划文档。
- 将需求拆分为轻量入口、工具内版本摘要、差异联动、历史版本比较四个层次。
- 初步建议 Phase 1 从 FileList 右键菜单的“查看版本记录 / 资源管理器定位 / 复制路径”开始。
- 用户确认目标用户主要使用 TortoiseSVN/TortoiseGit。
- 用户确认 Git 与 SVN 都需要支持，初版直接打开外部工具。
- 用户确认需要文件夹级日志，历史版本比较是后续重点。
- Phase 1 初版开发完成：
  - 新增 Rust `vcs` 模块，按路径自动识别 Git/SVN working copy。
  - 新增 `open_vcs_log` 命令，优先调用 TortoiseGitProc.exe / TortoiseProc.exe 打开日志。
  - 新增 `open_in_file_explorer` 命令，用于在资源管理器中定位文件或打开目录。
  - FileList 右键菜单支持文件和文件夹两类目标。
  - 文件右键新增“查看版本记录 / 在资源管理器中定位 / 复制路径”。
  - 文件夹节点右键新增目录级“查看版本记录 / 在资源管理器中定位 / 复制路径”。
  - 当前版本未检测到 Tortoise 时给出提示，命令行日志展示仍留到后续阶段。
- Phase 2 初版开发完成：
  - 新增 `get_vcs_file_info` / `get_vcs_file_log` 命令。
  - Git 支持读取仓库根、分支、文件状态、最近提交、最近日志。
  - SVN 支持读取 URL、revision、文件状态、最近日志。
  - FileList 右键“查看版本记录”改为打开工具内日志弹窗。
  - 保留“用 Tortoise 打开日志”作为外部工具入口。
- Phase 3 初版开发完成：
  - DiffView 顶部展示左右文件的版本摘要。
  - 点击左右版本摘要可继续打开 Tortoise 日志。
  - 保存左侧/右侧后刷新对应版本摘要。
- Phase 4 初版开发完成：
  - 新增 `export_vcs_file_revision` 命令。
  - Git 使用 `git show <rev>:<path>` 导出历史文件到临时目录。
  - SVN 使用 `svn cat -r <rev> <path>` 导出历史文件到临时目录。
  - FileList 文件右键新增“与历史版本比较”，输入 commit/revision 后打开“历史版本 vs 当前文件”的 Excel diff。
- 技术补充：
  - 新增 `EXCEL_DIFF_ENGINE=openpyxl|xlwings` 环境变量，用于显式选择写入引擎。
  - 测试脚本固定 `EXCEL_DIFF_ENGINE=openpyxl`，避免本机 Excel/xlwings 状态影响测试稳定性。
- Review 后安全修复：
  - 非 Git/SVN 文件查看版本记录时不再因为日志读取失败而报错，改为显示 `none` 版本状态和空日志。
  - 历史版本比较导出的左侧临时文件标记为只读，DiffView 隐藏左侧保存按钮并禁用左侧编辑。
  - DiffView 版本摘要刷新增加取消保护，避免快速切换文件时旧请求覆盖新文件摘要。
  - `get_vcs_file_log` 限制日志条数范围为 1..100。
  - SVN 日志解析对 `line/lines` 行数提示做更精确过滤。
  - 历史版本导出前清理超过 24 小时的 `excel-diff-vcs` 临时文件。
