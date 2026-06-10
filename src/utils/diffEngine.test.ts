import { describe, it, expect } from 'vitest';
import { computeDiff, buildKey, normalizeTextValue } from './diffEngine';
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

describe('normalizeTextValue', () => {
  it('normalizes Excel escaped newline text', () => {
    const escaped = 'FireStart=0,0;_x005F_x000D__x000D_LaserWarn=Role/Kk/kk_laser_04;';
    const plain = 'FireStart=0,0;_x000D_\nLaserWarn=Role/Kk/kk_laser_04;';
    expect(normalizeTextValue(escaped)).toBe(plain);
  });

  it('normalizes COM-saved escaped newline text without adding an extra blank line', () => {
    const escaped = 'FireStart=0,0;_x005F_x000D__x000D_\r\nLaserWarn=Role/Kk/kk_laser_04;';
    const plain = 'FireStart=0,0;_x000D_\nLaserWarn=Role/Kk/kk_laser_04;';
    expect(normalizeTextValue(escaped)).toBe(plain);
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

  it('keeps inserted new rows near their spreadsheet position', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
      [null, null],
      ['10', 'Later'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
      ['5', 'Inserted'],
      [null, null],
      ['10', 'Later'],
    ]);

    const result = computeDiff(oldSheet, newSheet, [0]);

    expect(result.stats.added).toBe(1);
    expect(result.diffRows.map((row) => ({
      status: row.status,
      oldRowNumber: row.oldRowNumber,
      newRowNumber: row.newRowNumber,
      newId: row.newRow?.[0]?.value ?? null,
    }))).toEqual([
      { status: 'unchanged', oldRowNumber: 2, newRowNumber: 2, newId: '1' },
      { status: 'unchanged', oldRowNumber: 3, newRowNumber: 3, newId: '2' },
      { status: 'added', oldRowNumber: null, newRowNumber: 4, newId: '5' },
      { status: 'unchanged', oldRowNumber: 4, newRowNumber: 5, newId: null },
      { status: 'unchanged', oldRowNumber: 5, newRowNumber: 6, newId: '10' },
    ]);
  });

  it('shows right-only rows at matching blank old positions', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Before'],
      [null, null],
      [null, null],
      [null, null],
      ['10', 'After'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Before'],
      [null, null],
      ['5', 'Inserted'],
      [null, null],
      ['10', 'After'],
    ]);

    const result = computeDiff(oldSheet, newSheet, [0]);

    expect(result.diffRows.map((row) => ({
      status: row.status,
      oldRowNumber: row.oldRowNumber,
      newRowNumber: row.newRowNumber,
      newId: row.newRow?.[0]?.value ?? null,
    }))).toEqual([
      { status: 'unchanged', oldRowNumber: 2, newRowNumber: 2, newId: '1' },
      { status: 'unchanged', oldRowNumber: 3, newRowNumber: 3, newId: null },
      { status: 'added', oldRowNumber: null, newRowNumber: 4, newId: '5' },
      { status: 'unchanged', oldRowNumber: 4, newRowNumber: 5, newId: null },
      { status: 'unchanged', oldRowNumber: 6, newRowNumber: 6, newId: '10' },
    ]);
  });

  it('does not render empty placeholders as extra added rows after a deletion', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
      ['5', 'Deleted'],
      [null, null],
      ['10', 'Later'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
      [null, null],
      [null, null],
      ['10', 'Later'],
    ]);

    const result = computeDiff(oldSheet, newSheet, [0]);

    expect(result.stats.deleted).toBe(1);
    expect(result.stats.added).toBe(0);
    expect(result.diffRows.map((row) => ({
      status: row.status,
      oldRowNumber: row.oldRowNumber,
      newRowNumber: row.newRowNumber,
      oldId: row.oldRow?.[0]?.value ?? null,
      newId: row.newRow?.[0]?.value ?? null,
    }))).toEqual([
      { status: 'unchanged', oldRowNumber: 2, newRowNumber: 2, oldId: '1', newId: '1' },
      { status: 'unchanged', oldRowNumber: 3, newRowNumber: 3, oldId: '2', newId: '2' },
      { status: 'deleted', oldRowNumber: 4, newRowNumber: null, oldId: '5', newId: null },
      { status: 'unchanged', oldRowNumber: 5, newRowNumber: 5, oldId: null, newId: null },
      { status: 'unchanged', oldRowNumber: 6, newRowNumber: 6, oldId: '10', newId: '10' },
    ]);
  });

  it('ignores unmatched empty rows instead of reporting them as differences', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      [null, null],
      [null, null],
      ['2', 'Bob'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      [null, null],
      ['2', 'Bob'],
      [null, null],
      [null, null],
    ]);

    const result = computeDiff(oldSheet, newSheet, [0]);

    expect(result.stats.added).toBe(0);
    expect(result.stats.deleted).toBe(0);
    expect(result.stats.modified).toBe(0);
    expect(result.duplicateKeys).toEqual([]);
    expect(result.diffRows.every((row) => row.status === 'unchanged')).toBe(true);
  });

  it('does not treat moved rows as inserted while interleaving additions', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
      ['3', 'Cara'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['2', 'Bob'],
      ['1', 'Alice'],
      ['3', 'Cara'],
    ]);

    const result = computeDiff(oldSheet, newSheet, [0]);

    expect(result.stats.added).toBe(0);
    expect(result.stats.deleted).toBe(0);
    expect(result.diffRows.map((row) => row.status)).toEqual(['unchanged', 'unchanged', 'unchanged']);
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

  it('treats Excel escaped newlines as equal to real newlines', () => {
    const escaped = 'FireStart=0,0;_x005F_x000D__x000D_LaserWarn=Role/Kk/kk_laser_04;';
    const plain = 'FireStart=0,0;_x000D_\rLaserWarn=Role/Kk/kk_laser_04;';
    const oldSheet = makeSheet('Sheet1', ['ID', 'Config'], [
      ['1', plain],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Config'], [
      ['1', escaped],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.unchanged).toBe(1);
    expect(result.stats.modified).toBe(0);
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

  it('treats numbers and matching numeric text as equal', () => {
    const oldSheet = makeSheet('Sheet1', ['Role ID', 'Skill Type'], [
      [1000, 5],
    ]);
    const newSheet = makeSheet('Sheet1', ['Role ID', 'Skill Type'], [
      ['1000', '5'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0, 1]);
    expect(result.stats.unchanged).toBe(1);
    expect(result.stats.modified).toBe(0);
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
    expect(result.duplicateKeys).toEqual([{ key: '[[0,"1"]]', oldCount: 2, newCount: 2 }]);
    expect(result.diffRows.every((row) => row.hasDuplicateKey)).toBe(true);
  });

  it('does not flag unique keys as duplicate', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name'], [
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.duplicateKeys).toEqual([]);
    expect(result.diffRows.some((row) => row.hasDuplicateKey)).toBe(false);
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

  it('uses row proximity as a tie breaker for duplicate exact matches', () => {
    const oldSheet = makeSheet('Sheet1', ['ID', 'Name', 'Value'], [
      ['1', 'A', 'same'],
      ['1', 'B', 'target'],
      ['1', 'A', 'same'],
    ]);
    const newSheet = makeSheet('Sheet1', ['ID', 'Name', 'Value'], [
      ['1', 'A', 'same'],
      ['1', 'B', 'target'],
      ['1', 'A', 'same'],
    ]);
    const result = computeDiff(oldSheet, newSheet, [0]);
    expect(result.stats.modified).toBe(0);
    expect(result.diffRows.map((r) => [r.oldRowNumber, r.newRowNumber])).toEqual([
      [2, 2],
      [3, 3],
      [4, 4],
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

  it('treats shifted relative row references as the same formula', () => {
    const oldSheet: SheetData = {
      name: 'Sheet1',
      columns: [
        { index: 0, name: 'TAG', dataType: 'mixed' },
        { index: 1, name: 'Value', dataType: 'mixed' },
        { index: 2, name: 'State', dataType: 'mixed' },
        { index: 3, name: 'Invert', dataType: 'mixed' },
        { index: 4, name: 'Quest', dataType: 'mixed' },
      ],
      rows: [
        [{ value: 'TAG' }, { value: 'Value' }, { value: 'State' }, { value: 'Invert' }, { value: 'Quest' }],
        [{ value: 'QUEST_91100_FINISH', formula: '"QUEST_"&E2&"_FINISH"' }, { value: null }, { value: 'QuestState' }, { value: null }, { value: 91100 }],
      ],
    };
    const newSheet: SheetData = {
      ...oldSheet,
      rows: [
        oldSheet.rows[0],
        [{ value: 'INSERTED_1' }, { value: null }, { value: null }, { value: null }, { value: null }],
        [{ value: 'INSERTED_2' }, { value: null }, { value: null }, { value: null }, { value: null }],
        [{ value: 'INSERTED_3' }, { value: null }, { value: null }, { value: null }, { value: null }],
        [{ value: 'INSERTED_4' }, { value: null }, { value: null }, { value: null }, { value: null }],
        [{ value: 'QUEST_91100_FINISH', formula: '"QUEST_"&E6&"_FINISH"' }, { value: null }, { value: 'QuestState' }, { value: null }, { value: 91100 }],
      ],
    };
    const result = computeDiff(oldSheet, newSheet, [0]);
    const matched = result.diffRows.find((row) => row.key === '[[0,"QUEST_91100_FINISH"]]');
    expect(matched?.status).toBe('unchanged');
    expect(matched?.cellDiffs).toEqual([]);
  });

  it('treats formula and matching computed value as equal', () => {
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
    expect(result.stats.unchanged).toBe(1);
    expect(result.stats.modified).toBe(0);
  });
});
