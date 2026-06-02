# 公式支持设计方案

**日期**: 2026-05-31
**项目**: Excel 合表对比工具
**状态**: 已批准

---

## 概述

为 Excel 合表对比工具添加公式支持，使得在读取、对比、编辑、保存时能够正确处理 Excel 公式。

## 需求确认

| 问题 | 决策 | 说明 |
|------|------|------|
| UI 显示公式吗 | **A. 只显示计算值** | 公式隐藏，但复制/保存时保留 |
| 公式不同值同算差异吗 | **B. 算差异** | 公式和值任一不同即标记为差异 |
| 编辑行为 | **B. `=` 开头算公式** | 输入以 `=` 开头当公式，否则当值 |
| 读取方式 | **A. 总是用 Python** | 统一路径，calamine 不支持读公式 |

---

## 设计详情

### 1. 数据模型

#### TypeScript 类型变更 (`src/types/excel.ts`)

```typescript
// 旧
// export type CellValue = string | number | boolean | null;
// export type Row = CellValue[];

// 新
export interface CellData {
  value: string | number | boolean | null;
  formula?: string;
}
export type Row = CellData[];

// SheetData 也相应更新
export interface SheetData {
  name: string;
  columns: ColumnInfo[];
  rows: Row[];  // Row = CellData[]
}
```

#### Diff 类型变更 (`src/types/diff.ts`)

```typescript
export interface CellDiff {
  columnIndex: number;
  oldValue: CellValue;    // 其实是 CellData["value"]
  newValue: CellValue;
  oldFormula?: string;    // 新增
  newFormula?: string;    // 新增
  isDifferent: boolean;
}
```

#### EditStore 类型变更 (`src/stores/editStore.ts`)

```typescript
export interface CellChange {
  rowKey: RowKey;
  columnIndex: number;
  value: CellValue;
  formula?: string;  // 新增
}
```

### 2. Rust 后端变更

#### `src-tauri/src/excel/reader.rs`

**删除** calamine 读取逻辑，**替换为**调用 Python 脚本：

```rust
// 新逻辑
pub fn read_workbook(file_path: &str) -> Result<ParsedWorkbook, String> {
    // 1. 调用 python read_excel.py <file_path>
    // 2. 解析 stdout JSON
    // 3. 反序列化为 ParsedWorkbook
}
```

需要添加 `find_read_script()` 函数（类似 `writer.rs` 中的 `find_write_script()`）。

#### `src-tauri/src/models/types.rs`

已经有正确的 `CellData` 结构：
```rust
pub struct CellData {
    pub value: serde_json::Value,
    #[serde(default)]
    pub formula: Option<String>,
}
```

### 3. Python 脚本

#### `read_excel.py`

已经实现！它读取每个单元格的 `value` 和 `formula`（如果有）。

需要注意的边界：
- `data_only=False` 确保读取公式而非计算值
- 公式以 `=` 开头时才保存到 `formula` 字段

#### `write_excel.py`

已经支持公式写入！`set_cell()` 函数接受 `formula` 参数。

### 4. 对比引擎 (`src/utils/diffEngine.ts`)

#### 变更点

1. `buildKey()` - **不变**，只使用 value 构建 key
2. `cellValuesEqual()` - **不变**，只对比 value
3. **新增** `cellFormulasEqual()` - 对比公式
4. `compareRows()` - 更新为同时对比 value 和 formula

```typescript
function cellFormulasEqual(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (!a && !b) return true;
  // normalize: 忽略空格差异？暂不，精确对比
  return false;
}

function compareRows(oldRow: Row, newRow: Row): CellDiff[] {
  const diffs: CellDiff[] = [];
  const maxCols = Math.max(oldRow.length, newRow.length);
  for (let col = 0; col < maxCols; col++) {
    const oldCell = col < oldRow.length ? oldRow[col] : { value: null };
    const newCell = col < newRow.length ? newRow[col] : { value: null };

    const oldVal = oldCell.value;
    const newVal = newCell.value;
    const oldFormula = oldCell.formula;
    const newFormula = newCell.formula;

    // Skip if both are completely empty
    if (isEmptyValue(oldVal) && isEmptyValue(newVal) && !oldFormula && !newFormula) continue;

    const valueDiff = !cellValuesEqual(oldVal, newVal);
    const formulaDiff = !cellFormulasEqual(oldFormula, newFormula);

    if (valueDiff || formulaDiff) {
      diffs.push({
        columnIndex: col,
        oldValue: oldVal,
        newValue: newVal,
        oldFormula,
        newFormula,
        isDifferent: true,
      });
    }
  }
  return diffs;
}
```

### 5. UI 变更

#### `DiffGrid.tsx`

**显示**:
- 从 `CellData.value` 提取值显示（与之前相同）
- 公式不显示

**编辑**:
```typescript
const handleCellValueChanged = (event: CellValueChangedEvent) => {
  const rawValue = event.newValue;
  let value: CellValue = rawValue;
  let formula: string | undefined;

  if (typeof rawValue === "string" && rawValue.startsWith("=")) {
    formula = rawValue;
    // 保持旧 value？或者设为 null？
    // 方案：保存 formula，但 value 保留原值（因为 Python 会重新计算）
  }

  onCellEdit(event.data._key, parseInt(field.slice(4)), event.oldValue, value, formula);
};
```

需要更新 `onCellEdit` 签名接受 formula。

#### `DiffView.tsx`

需要更新：
- `handleCellEdit` 接受 formula
- diffStore 中的 `applyEdit` 处理 formula
- 保存时带上 formula

### 6. 保存逻辑

增量保存 (`writeExcelChanges`) 需要传递 formula。

当前 `writeExcelChanges` 接受 JSON，已支持 formula（因为 Python 脚本已支持）。

---

## 数据流向

```
读取:
  Excel 文件 → Python read_excel.py → JSON → Rust 反序列化 → TypeScript CellData[]

对比:
  CellData[] → compareRows (value + formula) → CellDiff[]

显示:
  CellData.value → AG Grid (formula 隐藏)

编辑:
  用户输入 → 是否 = 开头? → 是: formula, 否: value → 更新 CellData

保存:
  CellData[] → JSON → Python write_excel.py → Excel 文件
```

---

## 边界情况

| 情况 | 处理 |
|------|------|
| 旧文件有公式，新文件值相同 | 标记为差异 |
| 用户编辑公式单元格输入非 `=` | 覆盖为值，公式丢失 |
| 用户输入 `=` 但不是有效公式 | 原样保存，Excel 会显示错误 |
| Python 读取失败 | 回退到 calamine？不，按设计总是用 Python |
| 空值单元格有公式 | 保留公式 |

---

## 非目标

- 公式语法高亮
- 公式自动计算（依赖 Excel，Python/openpyxl 不计算公式值）
- 跨表格公式引用处理（原样保留）

---

## 批准

**设计已批准，开始实现。**
