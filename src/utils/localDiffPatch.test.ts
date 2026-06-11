import { describe, expect, it } from "vitest";
import type { DiffResult } from "../types/diff";
import type { Row } from "../types/excel";
import { patchDiffResultForCellEdit } from "./localDiffPatch";

function row(values: unknown[]): Row {
  return values.map((value) => ({ value: value as any }));
}

function baseDiffResult(oldRow: Row, newRow: Row): DiffResult {
  return {
    keyColumnIndices: [0],
    duplicateKeys: [],
    stats: {
      totalOld: 1,
      totalNew: 1,
      unchanged: 1,
      added: 0,
      deleted: 0,
      modified: 0,
    },
    diffRows: [{
      viewIndex: 0,
      status: "unchanged",
      key: JSON.stringify([[0, "id"]]),
      oldRowNumber: 2,
      newRowNumber: 2,
      oldRow,
      newRow,
      cellDiffs: [],
      isOverridden: false,
      hasDuplicateKey: false,
    }],
  };
}

describe("patchDiffResultForCellEdit", () => {
  it("patches an ordinary non-key cell edit without rebuilding the whole result", () => {
    const oldRow = row(["id", "old"]);
    const newRow = row(["id", "old"]);
    const result = baseDiffResult(oldRow, newRow);
    const nextNewRow = row(["id", "new"]);

    const patched = patchDiffResultForCellEdit(result, "2:2:0", nextNewRow, 1, [0]);

    expect(patched).not.toBeNull();
    expect(patched?.stats.unchanged).toBe(0);
    expect(patched?.stats.modified).toBe(1);
    expect(patched?.diffRows[0].status).toBe("modified");
    expect(patched?.diffRows[0].newRow).toBe(nextNewRow);
    expect(patched?.diffRows[0].cellDiffs).toMatchObject([{ columnIndex: 1, oldValue: "old", newValue: "new" }]);
  });

  it("returns null for key column edits", () => {
    const result = baseDiffResult(row(["id", "old"]), row(["id", "old"]));

    expect(patchDiffResultForCellEdit(result, "2:2:0", row(["new-id", "old"]), 0, [0])).toBeNull();
  });

  it("returns null for formula edits so the full diff can preserve formula semantics", () => {
    const oldRow = [{ value: "id" }, { value: 1, formula: "=A2" }];
    const newRow = [{ value: "id" }, { value: 1, formula: "=A2" }];
    const result = baseDiffResult(oldRow, newRow);

    expect(patchDiffResultForCellEdit(result, "2:2:0", [{ value: "id" }, { value: 2, formula: "=A2" }], 1, [0])).toBeNull();
  });

  it("returns null for structural rows", () => {
    const result = baseDiffResult(row(["id", "old"]), row(["id", "old"]));
    result.diffRows[0] = {
      ...result.diffRows[0],
      status: "added",
      oldRow: null,
      oldRowNumber: null,
    };

    expect(patchDiffResultForCellEdit(result, ":2:0", row(["id", "new"]), 1, [0])).toBeNull();
  });
});
