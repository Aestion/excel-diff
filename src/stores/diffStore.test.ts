import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDiffStore } from './diffStore';
import type { FileEntry, FilePair, ParsedWorkbook } from '../types/excel';
import type { DiffResult } from '../types/diff';

vi.mock('../api/tauri', () => ({
  readExcel: vi.fn(),
  writeExcel: vi.fn(),
  writeExcelChanges: vi.fn(),
  listExcelFiles: vi.fn(),
  detectKeyColumns: vi.fn(),
  pickDirectory: vi.fn(),
  pickSavePath: vi.fn(),
  saveTextFile: vi.fn(),
}));

describe('diffStore', () => {
  beforeEach(() => {
    const s = useDiffStore.getState();
    s.setView('directory');
    s.setOldDir('');
    s.setNewDir('');
    s.setOldFiles([]);
    s.setNewFiles([]);
    s.setFilePairs([]);
    s.selectFilePair(null);
    s.setOldWorkbook(null);
    s.setNewWorkbook(null);
    s.setCurrentSheet('');
    s.setDiffResult(null);
    s.setKeyColumnIndices([]);
    s.setHasUnsavedChanges(false);
    s.setEffectiveNewRows(null);
  });

  it('sets view mode', () => {
    const store = useDiffStore.getState();
    store.setView('diff');
    expect(useDiffStore.getState().currentView).toBe('diff');
  });

  it('sets directories', () => {
    const store = useDiffStore.getState();
    store.setOldDir('/old');
    store.setNewDir('/new');
    expect(useDiffStore.getState().oldDir).toBe('/old');
    expect(useDiffStore.getState().newDir).toBe('/new');
  });

  it('sets file lists', () => {
    const store = useDiffStore.getState();
    const files: FileEntry[] = [
      { name: 'a.xlsx', path: '/old/a.xlsx', relativePath: 'a.xlsx', sizeBytes: 100 },
    ];
    store.setOldFiles(files);
    expect(useDiffStore.getState().oldFiles).toEqual(files);
  });

  it('selects file pair', () => {
    const store = useDiffStore.getState();
    const pair: FilePair = {
      filename: 'a.xlsx',
      relativePath: 'a.xlsx',
      oldPath: '/old/a.xlsx',
      newPath: '/new/a.xlsx',
      oldSize: 100,
      newSize: 120,
      status: 'matched',
      diffStatus: 'different',
    };
    store.selectFilePair(pair);
    expect(useDiffStore.getState().selectedFilePair).toEqual(pair);
  });

  it('sets workbooks', () => {
    const store = useDiffStore.getState();
    const wb: ParsedWorkbook = {
      filePath: '/test.xlsx',
      sheets: [],
      sheetNames: [],
    };
    store.setOldWorkbook(wb);
    expect(useDiffStore.getState().oldWorkbook).toEqual(wb);
  });

  it('sets key column indices', () => {
    const store = useDiffStore.getState();
    store.setKeyColumnIndices([0, 1]);
    expect(useDiffStore.getState().keyColumnIndices).toEqual([0, 1]);
  });

  it('sets diff result', () => {
    const store = useDiffStore.getState();
    const result: DiffResult = {
      keyColumnIndices: [0],
      diffRows: [],
      stats: { totalOld: 0, totalNew: 0, unchanged: 0, added: 0, deleted: 0, modified: 0 },
    };
    store.setDiffResult(result);
    expect(useDiffStore.getState().diffResult).toEqual(result);
  });

  it('marks file as identical', () => {
    const store = useDiffStore.getState();
    store.setFilePairs([
      { filename: 'a.xlsx', relativePath: 'a.xlsx', oldPath: '/old/a.xlsx', newPath: '/new/a.xlsx', oldSize: 100, newSize: 100, status: 'matched', diffStatus: 'different' },
    ]);
    store.markFileAsIdentical('a.xlsx');
    expect(useDiffStore.getState().filePairs[0].diffStatus).toBe('identical');
  });

  it('updates new cell value', () => {
    const store = useDiffStore.getState();
    store.setEffectiveNewRows([
      [{ value: 'ID' }, { value: 'Name' }],
      [{ value: '1' }, { value: 'Alice' }],
    ]);
    store.updateNewCell(1, 1, 'Bob');
    const rows = useDiffStore.getState().effectiveNewRows;
    expect(rows![1][1].value).toBe('Bob');
    expect(useDiffStore.getState().hasUnsavedChanges).toBe(true);
  });

  it('extends row when updating beyond current length', () => {
    const store = useDiffStore.getState();
    store.setEffectiveNewRows([
      [{ value: 'ID' }],
      [{ value: '1' }],
    ]);
    store.updateNewCell(1, 3, 'extra');
    const rows = useDiffStore.getState().effectiveNewRows;
    expect(rows![1]).toHaveLength(4);
    expect(rows![1][3].value).toBe('extra');
  });

  it('sets has unsaved changes', () => {
    const store = useDiffStore.getState();
    store.setHasUnsavedChanges(true);
    expect(useDiffStore.getState().hasUnsavedChanges).toBe(true);
    store.setHasUnsavedChanges(false);
    expect(useDiffStore.getState().hasUnsavedChanges).toBe(false);
  });
});
