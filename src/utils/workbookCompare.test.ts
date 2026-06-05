import { describe, expect, it } from "vitest";
import { rowsEqual, workbooksEqual } from "./workbookCompare";
import type { ParsedWorkbook, SheetData } from "../types/excel";

function sheet(rows: Array<Array<string | number | null>>): SheetData {
  return {
    name: "Sheet1",
    columns: [
      { index: 0, name: "ID", dataType: "mixed" },
      { index: 1, name: "Name", dataType: "mixed" },
      { index: 2, name: "Code", dataType: "mixed" },
    ],
    rows: rows.map((row) => row.map((value) => ({ value }))),
  };
}

function workbook(sheetData: SheetData): ParsedWorkbook {
  return {
    filePath: "",
    sheetNames: [sheetData.name],
    sheets: [sheetData],
  };
}

describe("workbookCompare", () => {
  it("ignores trailing empty cells and rows for physical row comparison", () => {
    expect(rowsEqual(
      [[{ value: "ID" }], [{ value: "1" }, { value: "" }], []],
      [[{ value: "ID" }], [{ value: "1" }]],
    )).toBe(true);
  });

  it("compares workbooks by key semantics instead of physical row order", () => {
    const oldSheet = sheet([
      ["ID", "Name", "Code"],
      [100, "A", "a"],
      [200, "B", "b"],
      [300, "C", "c"],
    ]);
    const newSheet = sheet([
      ["ID", "Name", "Code"],
      [300, "C", "c"],
      [100, "A", "a"],
      [200, "B", "b"],
    ]);

    expect(workbooksEqual(workbook(oldSheet), workbook(newSheet))).toBe(true);
  });
});
