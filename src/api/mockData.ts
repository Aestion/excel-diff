import type { FileEntry, ParsedWorkbook, SheetData } from "../types/excel";

// Generate deterministic mock data
export function generateMockWorkbook(name: string, variant: "old" | "new"): ParsedWorkbook {
  const baseRows: SheetData["rows"] = [
    [{ value: "ID" }, { value: "Name" }, { value: "Department" }, { value: "Salary" }, { value: "Status" }],
    [{ value: "E001" }, { value: "Alice Wang" }, { value: "Engineering" }, { value: 85000 }, { value: "Active" }],
    [{ value: "E002" }, { value: "Bob Chen" }, { value: "Marketing" }, { value: 62000 }, { value: "Active" }],
    [{ value: "E003" }, { value: "Carol Li" }, { value: "Engineering" }, { value: 92000 }, { value: "Active" }],
    [{ value: "E004" }, { value: "David Zhang" }, { value: "Sales" }, { value: 58000 }, { value: "Active" }],
    [{ value: "E005" }, { value: "Eva Liu" }, { value: "HR" }, { value: 55000 }, { value: "Active" }],
  ];

  const newRows: SheetData["rows"] = [
    [{ value: "ID" }, { value: "Name" }, { value: "Department" }, { value: "Salary" }, { value: "Status" }],
    [{ value: "E001" }, { value: "Alice Wang" }, { value: "Engineering" }, { value: 90000 }, { value: "Active" }],
    [{ value: "E002" }, { value: "Bob Chen" }, { value: "Marketing" }, { value: 65000 }, { value: "Active" }],
    [{ value: "E003" }, { value: "Carol Li" }, { value: "Engineering" }, { value: 92000 }, { value: "On Leave" }],
    [{ value: "E006" }, { value: "Frank Zhao" }, { value: "Engineering" }, { value: 78000 }, { value: "Active" }],
    [{ value: "E007" }, { value: "Grace Wu" }, { value: "Sales" }, { value: 60000 }, { value: "Active" }],
  ];

  const sheet: SheetData = {
    name: "Employees",
    columns: [
      { index: 0, name: "ID", dataType: "string" },
      { index: 1, name: "Name", dataType: "string" },
      { index: 2, name: "Department", dataType: "string" },
      { index: 3, name: "Salary", dataType: "number" },
      { index: 4, name: "Status", dataType: "string" },
    ],
    rows: variant === "old" ? baseRows : newRows,
  };

  return {
    filePath: `/mock/${name}.xlsx`,
    sheets: [sheet],
    sheetNames: ["Employees"],
  };
}

export function generateMockFiles(dir: string): FileEntry[] {
  const files = [
    { name: "employees.xlsx", rel: "employees.xlsx", size: 15234 },
    { name: "sales_Q1.xlsx", rel: "sales_Q1.xlsx", size: 8932 },
    { name: "sales_Q2.xlsx", rel: "sales_Q2.xlsx", size: 9210 },
    { name: "budget.xlsx", rel: "budget.xlsx", size: 4560 },
    { name: "report.xlsx", rel: "reports/annual/report.xlsx", size: 28456 },
    { name: "summary.xlsx", rel: "reports/annual/summary.xlsx", size: 12340 },
    { name: "only_old.xlsx", rel: "only_old.xlsx", size: 3400 },
  ];

  return files.map((f) => ({
    name: f.name,
    path: `${dir}/${f.rel}`,
    relativePath: f.rel,
    sizeBytes: f.size,
    modifiedAt: Date.now() - Math.floor(Math.random() * 86400000),
  }));
}

export function generateMockNewFiles(dir: string): FileEntry[] {
  const files = [
    { name: "employees.xlsx", rel: "employees.xlsx", size: 16100 },
    { name: "sales_Q1.xlsx", rel: "sales_Q1.xlsx", size: 8932 },
    { name: "sales_Q2.xlsx", rel: "sales_Q2.xlsx", size: 9500 },
    { name: "budget.xlsx", rel: "budget.xlsx", size: 4560 },
    { name: "report.xlsx", rel: "reports/annual/report.xlsx", size: 29100 },
    { name: "summary.xlsx", rel: "reports/annual/summary.xlsx", size: 12340 },
    { name: "only_new.xlsx", rel: "only_new.xlsx", size: 2100 },
  ];

  return files.map((f) => ({
    name: f.name,
    path: `${dir}/${f.rel}`,
    relativePath: f.rel,
    sizeBytes: f.size,
    modifiedAt: Date.now() - Math.floor(Math.random() * 3600000),
  }));
}
