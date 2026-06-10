# 多页式工作区实施计划

## 背景

当前应用是单视图切换模型：`FileList` 和 `DiffView` 共用一份全局状态，通过 `view` 在目录列表和文件对比之间切换。这个模型有两个明显问题：

- `DiffView` 的关闭/返回行为容易让用户误以为只是关闭当前对比，实际可能影响整个软件使用流程。
- 一个目录对比下无法同时保留多个文件对比结果，用户需要频繁返回、重新打开。

目标是改成多页/标签页式工作区：目录对比页和文件对比页都作为独立页面存在，文件对比页附着在来源目录对比页后面打开，并且可以单独关闭。

## 目标体验

1. `FileList` 是目录对比页，可以存在多个。
2. `DiffView` 是文件对比页，从某个 `FileList` 打开后，自动插入到对应 `FileList` 页签后面。
3. 每个页签都可以单独关闭。
4. 关闭 `DiffView` 只关闭当前文件对比页，不退出软件。
5. 软件窗口右上角关闭按钮才表示退出整个应用。
6. 后续可支持多个目录对比页、恢复工作区、关闭一组相关页等增强功能。

## 第一阶段：最小可用多页

### 范围

- 新增顶部 `TabBar`。
- 新增工作区页签状态：
  - `file-list` 页签
  - `diff` 页签
- 初始打开一个 `file-list` 页签。
- 从 `FileList` 打开文件对比时创建/切换到 `diff` 页签。
- `DiffView` 顶部的返回/关闭行为改为切回来源 `FileList` 或关闭当前 `diff` 页签。
- 保持现有对比、保存、历史版本比较逻辑尽量不动。

### 非目标

- 暂不实现多个目录对比页的完整目录状态隔离。
- 暂不实现工作区持久化恢复。
- 暂不实现复杂的关闭右侧页、关闭其他页、拖拽排序。
- 暂不大规模重构现有 `diffStore`。

## 建议数据结构

```ts
type WorkspaceTab =
  | {
      id: string;
      type: "file-list";
      title: string;
    }
  | {
      id: string;
      type: "diff";
      title: string;
      parentTabId: string;
      fileKey: string;
      revision?: string;
    };
```

第一阶段为了降低改动风险，`diff` 页签先只保存页签元信息；实际 workbook、sheet、diffResult 仍复用现有 `diffStore`。后续若需要同时保留多个 DiffView 的完整状态，再把 workbook/diffResult 下沉到 tab state。

## 打开策略

- 普通文件对比页 key：`diff:${parentTabId}:${relativePath}`
- 历史版本对比页 key：`history:${parentTabId}:${relativePath}:${revision}`
- 如果已存在相同 key 的页签，则直接激活。
- 如果不存在，则插入到来源 `file-list` 页签后面，或插入到该来源已有 diff 页签组的末尾。

## 关闭策略

- 关闭 `diff` 页签：
  - 如果有未保存修改，先提示保存/不保存/取消。
  - 否则直接关闭，激活相邻页签，优先回到来源 `file-list`。
- 关闭 `file-list` 页签：
  - 第一阶段至少保留一个 `file-list` 页签。
  - 后续增强：关闭时提示是否连带关闭其附着的 diff 页签。

## 风险点

- 当前 `diffStore` 是全局单实例，第一阶段多个 `diff` 页签不能真正同时保留不同 workbook 状态。
- 若用户打开 A 文件 diff，再打开 B 文件 diff，切回 A 页签时第一阶段可能需要重新加载 A，或者暂时只保证“页签导航 + 当前活动 diff”。
- `DiffView` 内部已有大量状态，完整多实例化需要第二阶段拆分 store。

## 推荐实施顺序

1. 新增 `workspaceStore` 管理 tabs 和 activeTabId。
2. 新增 `WorkspaceTabs` 组件显示页签。
3. 修改 `App`，根据 active tab 渲染 `FileList` 或 `DiffView`。
4. 修改 `FileList` 打开文件对比和历史版本对比完成后的行为，创建/激活 diff 页签。
5. 修改 `DiffView` 返回按钮逻辑，优先激活 parent file-list 页签。
6. 增加关闭当前页签逻辑。
7. 跑 `npm test` 和 `npm run build`。

## 后续增强

- 每个 `diff` 页签保存自己的 workbook、diffResult、currentSheet、selection、filter。
- 多个 `file-list` 页签独立保存目录、滚动、选中、过滤条件。
- 工作区持久化，重启后恢复上次页签。
- 页签右键菜单：关闭、关闭其他、关闭右侧、关闭同组。
- FileList 页签关闭时批量处理附着 diff 页签和未保存修改。
