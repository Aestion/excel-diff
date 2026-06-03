import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDiffStore } from './diffStore';
import { hashFiles, readExcel } from '../api/tauri';
import type { FileEntry, FilePair, ParsedWorkbook } from '../types/excel';
import type { DiffResult } from '../types/diff';

vi.mock('../api/tauri', () => ({
  readExcel: vi.fn(),
  hashFiles: vi.fn(),
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
    vi.clearAllMocks();
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
    useDiffStore.setState({ _workbookCache: new Map(), fileListCollapsedFolders: new Set(), fileListKnownFolders: new Set(), fileListScrollTop: 0 });
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

  it('preserves file list folder state when setting the same directories', () => {
    const store = useDiffStore.getState();
    store.setOldDir('/old');
    store.setNewDir('/new');
    store.setFileListCollapsedFolders(new Set(['folder-a']));
    store.setFileListKnownFolders(new Set(['folder-a']));
    store.setFileListScrollTop(240);

    store.setOldDir('/old');
    store.setNewDir('/new');

    expect(useDiffStore.getState().fileListCollapsedFolders).toEqual(new Set(['folder-a']));
    expect(useDiffStore.getState().fileListKnownFolders).toEqual(new Set(['folder-a']));
    expect(useDiffStore.getState().fileListScrollTop).toBe(240);
  });

  it('clears file list folder state when directories change', () => {
    const store = useDiffStore.getState();
    store.setOldDir('/old');
    store.setNewDir('/new');
    store.setFileListCollapsedFolders(new Set(['folder-a']));
    store.setFileListKnownFolders(new Set(['folder-a']));
    store.setFileListScrollTop(240);

    store.setNewDir('/newer');

    expect(useDiffStore.getState().fileListCollapsedFolders.size).toBe(0);
    expect(useDiffStore.getState().fileListKnownFolders.size).toBe(0);
    expect(useDiffStore.getState().fileListScrollTop).toBe(0);
  });

  it('resets verified file status when matched file metadata changes', async () => {
    const store = useDiffStore.getState();
    store.setOldDir('/old');
    store.setNewDir('/new');
    store.setOldFiles([
      { name: 'a.xlsx', path: '/old/a.xlsx', relativePath: 'a.xlsx', sizeBytes: 100, modifiedAt: 1 },
    ]);
    store.setNewFiles([
      { name: 'a.xlsx', path: '/new/a.xlsx', relativePath: 'a.xlsx', sizeBytes: 100, modifiedAt: 1 },
    ]);
    store.setFilePairs([
      {
        filename: 'a.xlsx',
        relativePath: 'a.xlsx',
        oldPath: '/old/a.xlsx',
        newPath: '/new/a.xlsx',
        oldSize: 100,
        newSize: 100,
        oldModifiedAt: 1,
        newModifiedAt: 1,
        status: 'matched',
        diffStatus: 'identical',
      },
    ]);

    store.setNewFiles([
      { name: 'a.xlsx', path: '/new/a.xlsx', relativePath: 'a.xlsx', sizeBytes: 100, modifiedAt: 2 },
    ]);
    await store.buildFilePairs();

    expect(useDiffStore.getState().filePairs[0].diffStatus).toBe('unknown');
  });

  it('does not mark same-path matched files as different based on size alone', async () => {
    const store = useDiffStore.getState();
    store.setOldFiles([
      { name: 'same-content.xlsx', path: '/old/same-content.xlsx', relativePath: 'same-content.xlsx', sizeBytes: 120, modifiedAt: 1 },
    ]);
    store.setNewFiles([
      { name: 'same-content.xlsx', path: '/new/same-content.xlsx', relativePath: 'same-content.xlsx', sizeBytes: 100, modifiedAt: 1 },
    ]);

    await store.buildFilePairs();

    expect(useDiffStore.getState().filePairs[0].diffStatus).toBe('unknown');
  });

  it('skips already verified files when metadata is unchanged', async () => {
    const store = useDiffStore.getState();
    store.setFilePairs([
      {
        filename: 'cached.xlsx',
        relativePath: 'cached.xlsx',
        oldPath: '/old/cached.xlsx',
        newPath: '/new/cached.xlsx',
        oldSize: 100,
        newSize: 100,
        oldModifiedAt: 1,
        newModifiedAt: 1,
        status: 'matched',
        diffStatus: 'identical',
      },
    ]);

    await store.verifyAllFiles();

    expect(readExcel).not.toHaveBeenCalled();
    expect(useDiffStore.getState().filePairs[0].diffStatus).toBe('identical');
  });

  it('marks unknown same-size files as identical when binary hashes match', async () => {
    const store = useDiffStore.getState();
    store.setFilePairs([
      {
        filename: 'same.xlsx',
        relativePath: 'same.xlsx',
        oldPath: '/old/same.xlsx',
        newPath: '/new/same.xlsx',
        oldSize: 100,
        newSize: 100,
        oldModifiedAt: 1,
        newModifiedAt: 1,
        status: 'matched',
        diffStatus: 'unknown',
      },
    ]);
    vi.mocked(hashFiles).mockResolvedValueOnce([
      { path: '/old/same.xlsx', hash: 'abc' },
      { path: '/new/same.xlsx', hash: 'abc' },
    ]);

    await store.verifyAllFiles();

    expect(readExcel).not.toHaveBeenCalled();
    expect(useDiffStore.getState().filePairs[0].diffStatus).toBe('identical');
  });

  it('verifies a single file pair without touching other unknown files', async () => {
    const store = useDiffStore.getState();
    store.setFilePairs([
      {
        filename: 'edited.xlsx',
        relativePath: 'edited.xlsx',
        oldPath: '/old/edited.xlsx',
        newPath: '/new/edited.xlsx',
        oldSize: 100,
        newSize: 100,
        oldModifiedAt: 1,
        newModifiedAt: 2,
        status: 'matched',
        diffStatus: 'unknown',
      },
      {
        filename: 'other.xlsx',
        relativePath: 'other.xlsx',
        oldPath: '/old/other.xlsx',
        newPath: '/new/other.xlsx',
        oldSize: 100,
        newSize: 100,
        oldModifiedAt: 1,
        newModifiedAt: 1,
        status: 'matched',
        diffStatus: 'unknown',
      },
    ]);
    vi.mocked(hashFiles).mockResolvedValueOnce([
      { path: '/old/edited.xlsx', hash: 'same' },
      { path: '/new/edited.xlsx', hash: 'same' },
    ]);

    await store.verifyFilePair('edited.xlsx', true);

    expect(hashFiles).toHaveBeenCalledWith(['/old/edited.xlsx', '/new/edited.xlsx']);
    expect(readExcel).not.toHaveBeenCalled();
    expect(useDiffStore.getState().filePairs.map((p) => p.diffStatus)).toEqual(['identical', 'unknown']);
  });

  it('marks matched files as different when formulas differ but values match', async () => {
    const store = useDiffStore.getState();
    store.setFilePairs([
      {
        filename: 'formula.xlsx',
        relativePath: 'formula.xlsx',
        oldPath: '/old/formula.xlsx',
        newPath: '/new/formula.xlsx',
        oldSize: 100,
        newSize: 100,
        oldModifiedAt: 1,
        newModifiedAt: 1,
        status: 'matched',
        diffStatus: 'unknown',
      },
    ]);

    vi.mocked(hashFiles).mockResolvedValueOnce([
      { path: '/old/formula.xlsx', hash: 'old-hash' },
      { path: '/new/formula.xlsx', hash: 'new-hash' },
    ]);
    vi.mocked(readExcel)
      .mockResolvedValueOnce({
        filePath: '/old/formula.xlsx',
        sheetNames: ['Sheet1'],
        sheets: [{
          name: 'Sheet1',
          columns: [{ index: 0, name: 'ID', dataType: 'mixed' }, { index: 1, name: 'Calc', dataType: 'mixed' }],
          rows: [
            [{ value: 'ID' }, { value: 'Calc' }],
            [{ value: '1' }, { value: 2, formula: '=1+1' }],
          ],
        }],
      })
      .mockResolvedValueOnce({
        filePath: '/new/formula.xlsx',
        sheetNames: ['Sheet1'],
        sheets: [{
          name: 'Sheet1',
          columns: [{ index: 0, name: 'ID', dataType: 'mixed' }, { index: 1, name: 'Calc', dataType: 'mixed' }],
          rows: [
            [{ value: 'ID' }, { value: 'Calc' }],
            [{ value: '1' }, { value: 2, formula: '=2*1' }],
          ],
        }],
      });

    await store.verifyAllFiles();

    expect(useDiffStore.getState().filePairs[0].diffStatus).toBe('different');
  });
});
