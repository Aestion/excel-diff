import { describe, it, expect } from 'vitest';
import { computeDiff, buildKey } from './diffEngine';
import type { SheetData } from '../types/excel';

function makeSheet(name: string, headers: string[], rows: (string | number | null)[][]): SheetData {
  return {
    name,
    columns: headers.map((h, i) => ({ index: i, name: h, dataType: 'mixed' })),
    rows: [
      headers.map((h) => ({ value: h })),
      ...rows.map((r) => r.map((v) => ({ value: v }))),
    ],
  };
}

describe('buildKey', () => {
  it('builds key from single column', () => {
    const row = [{ value: 'A001' }, { value: 'Alice' }];
    expect(JSON.parse(buildKey(row, [0]))).toEqual([[0, 'A001']]);
  });

  it('builds composite key from multiple columns', () => {
    const row = [{ value: 'A001' }, { value: 'Alice' }, { value: 25 }];
    expect(JSON.parse(buildKey(row, [0, 2]))).toEqual([[0, 'A001'], [2, '25']]);
  });

  it('handles null values', () => {
    const row = [{ value: null }, { value: 'Alice' }];
    expect(JSON.parse(buildKey(row, [0]))).toEqual([[0, '']]);
  });

  it('handles number values', () => {
    const row = [{ value: 42 }, { value: 'Alice' }];
    expect(JSON.parse(buildKey(row, [0]))).toEqual([[0, '42']]);
  });

  it('handles float values', () => {
    const row = [{ value: 3.14 }, { value: 'Alice' }];
    expect(JSON.parse(buildKey(row, [0]))).toEqual([[0, '3.14']]);
  });

  it('does not collide when key values contain old separators', () => {
    const rowA = [{ value: 'a|1:b' }, { value: 'c' }];
    const rowB = [{ value: 'a' }, { value: 'b|1:c' }];
    expect(buildKey(rowA, [0, 1])).not.toBe(buildKey(rowB, [0, 1]));
  });
});

describe('computeDiff', () => {
  it('detects unchanged rows', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(1);
    expect(result.stats.modified).toBe(0);
    expect(result.stats.added).toBe(0);
    expect(result.stats.deleted).toBe(0);
  });

  it('detects modified rows', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Bob'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(0);
    expect(result.stats.modified).toBe(1);
    expect(result.diffRows[0].cellDiffs).toHaveLength(1);
    expect(result.diffRows[0].cellDiffs[0].columnIndex).toBe(1);
    expect(result.diffRows[0].cellDiffs[0].oldValue).toBe('Alice');
    expect(result.diffRows[0].cellDiffs[0].newValue).toBe('Bob');
  });

  it('detects added rows', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(1);
    expect(result.stats.added).toBe(1);
    expect(result.diffRows[1].status).toBe('added');
  });

  it('detects deleted rows', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(1);
    expect(result.stats.deleted).toBe(1);
    expect(result.diffRows[1].status).toBe('deleted');
  });

  it('handles composite keys', () => {
    const oldSheet = makeSheet('Sheet1', ['First', 'Last', 'Age'], [
      ['John', 'Doe', 30],
      ['Jane', 'Doe', 28],
    ]);
    const newSheet = makeSheet('Sheet1', ['First', 'Last', 'Age'], [
      ['John', 'Doe', 31],
      ['Jane', 'Doe', 28],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0, 1]);
    expect(result.stats.unchanged).toBe(1);
    expect(result.stats.modified).toBe(1);
    expect(result.diffRows[0].status).toBe('modified');
  });

  it('handles empty sheets', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], []);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], []);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(0);
    expect(result.stats.added).toBe(0);
    expect(result.stats.deleted).toBe(0);
  });

  it('handles all added rows', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], []);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.added).toBe(2);
    expect(result.stats.unchanged).toBe(0);
  });

  it('handles all deleted rows', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], []);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.deleted).toBe(2);
    expect(result.stats.unchanged).toBe(0);
  });

  it('treats null and empty string as equal', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', null],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', ''],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(1);
  });

  it('treats close floats as equal', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Value'], [
      ['1', 1.00000000001],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Value'], [
      ['1', 1.0],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(1);
  });

  it('detects different floats', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Value'], [
      ['1', 1.5],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Value'], [
      ['1', 2.5],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.modified).toBe(1);
  });

  it('handles duplicate keys gracefully', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['1', 'Bob'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['1', 'Bob'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(2);
  });

  it('keeps original row numbers for duplicate keys', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['1', 'Bob'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['1', 'Bob'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.diffRows.map((r) => [r.oldRowNumber, r.newRowNumber])).toEqual([
      [2, 2],
      [3, 3],
    ]);
  });

  it('matches duplicate keys by the closest row content', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name', 'Dept'], [
      ['1', 'Alice', 'Sales'],
      ['1', 'Bob', 'HR'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name', 'Dept'], [
      ['1', 'Bob', 'HR'],
      ['1', 'Alice', 'Sales'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(2);
    expect(result.diffRows.map((r) => [r.oldRowNumber, r.newRowNumber])).toEqual([
      [2, 3],
      [3, 2],
    ]);
  });

  it('handles mismatched duplicate keys', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['1', 'Bob'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['1', 'Charlie'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    // One matches exactly, one may be modified or deleted/added depending on matching order
    expect(result.diffRows.length).toBe(2);
  });

  it('preserves viewIndex order', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'A'],
      ['2', 'B'],
      ['3', 'C'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'A'],
      ['3', 'C'],
      ['2', 'B'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.diffRows[0].viewIndex).toBe(0);
    expect(result.diffRows[1].viewIndex).toBe(1);
    expect(result.diffRows[2].viewIndex).toBe(2);
  });

  it('treats identical formulas as equal even if cached values differ', () => {
    // Old file has cached computed value, new file has formula string as value
    const oldSheet: SheetData = {
      name: 'Sheet1',
      columns: [{ index: 0, name: 'ID', dataType: 'mixed' }, { index: 1, name: 'Calc', dataType: 'mixed' }],
      rows: [
        [{ value: 'ID' }, { value: 'Calc' }],
        [{ value: '1' }, { value: 6, formula: '=1+2+3' }],
      ],
    };
    const newSheet: SheetData = {
      name: 'Sheet1',
      columns: [{ index: 0, name: 'ID', dataType: 'mixed' }, { index: 1, name: 'Calc', dataType: 'mixed' }],
      rows: [
        [{ value: 'ID' }, { value: 'Calc' }],
        [{ value: '1' }, { value: '=1+2+3', formula: '=1+2+3' }],
      ],
    };
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(1);
    expect(result.stats.modified).toBe(0);
  });

  it('detects different formulas as modified', () => {
    const oldSheet: SheetData = {
      name: 'Sheet1',
      columns: [{ index: 0, name: 'ID', dataType: 'mixed' }, { index: 1, name: 'Calc', dataType: 'mixed' }],
      rows: [
        [{ value: 'ID' }, { value: 'Calc' }],
        [{ value: '1' }, { value: 6, formula: '=1+2+3' }],
      ],
    };
    const newSheet: SheetData = {
      name: 'Sheet1',
      columns: [{ index: 0, name: 'ID', dataType: 'mixed' }, { index: 1, name: 'Calc', dataType: 'mixed' }],
      rows: [
        [{ value: 'ID' }, { value: 'Calc' }],
        [{ value: '1' }, { value: '=1+2+4', formula: '=1+2+4' }],
      ],
    };
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.modified).toBe(1);
  });

  it('detects formula vs non-formula as modified', () => {
    const oldSheet: SheetData = {
      name: 'Sheet1',
      columns: [{ index: 0, name: 'ID', dataType: 'mixed' }, { index: 1, name: 'Calc', dataType: 'mixed' }],
      rows: [
        [{ value: 'ID' }, { value: 'Calc' }],
        [{ value: '1' }, { value: 6, formula: '=1+2+3' }],
      ],
    };
    const newSheet: SheetData = {
      name: 'Sheet1',
      columns: [{ index: 0, name: 'ID', dataType: 'mixed' }, { index: 1, name: 'Calc', dataType: 'mixed' }],
      rows: [
        [{ value: 'ID' }, { value: 'Calc' }],
        [{ value: '1' }, { value: 6 }],
      ],
    };
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.modified).toBe(1);
  });
});
