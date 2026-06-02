import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FileList from './FileList';
import { useDiffStore } from '../stores/diffStore';
import type { FilePair } from '../types/excel';

vi.mock('../api/tauri', () => ({
  readExcel: vi.fn(),
  writeExcel: vi.fn(),
  listExcelFiles: vi.fn(),
  detectKeyColumns: vi.fn(),
}));

vi.mock('../utils/diffEngine', () => ({
  computeDiff: vi.fn(() => ({
    keyColumnIndices: [0],
    diffRows: [],
    stats: { totalOld: 0, totalNew: 0, unchanged: 0, added: 0, deleted: 0, modified: 0 },
  })),
}));

describe('FileList', () => {
  beforeEach(() => {
    useDiffStore.setState({
      filePairs: [],
      oldDir: '',
      newDir: '',
      setView: vi.fn(),
      selectFilePair: vi.fn(),
      setOldWorkbook: vi.fn(),
      setNewWorkbook: vi.fn(),
      setCurrentSheet: vi.fn(),
      setDiffResult: vi.fn(),
      setKeyColumnIndices: vi.fn(),
    } as any);
  });

  it('shows empty state when no file pairs', () => {
    render(<FileList />);
    expect(screen.getByText('请先选择两个目录')).toBeInTheDocument();
  });

  it('renders file pairs with correct counts', () => {
    const pairs: FilePair[] = [
      { filename: 'a.xlsx', relativePath: 'a.xlsx', oldPath: '/old/a.xlsx', newPath: '/new/a.xlsx', oldSize: 100, newSize: 120, status: 'matched', diffStatus: 'different' },
      { filename: 'b.xlsx', relativePath: 'b.xlsx', oldPath: '/old/b.xlsx', newPath: null, oldSize: 200, newSize: 0, status: 'old-only', diffStatus: 'unknown' },
      { filename: 'c.xlsx', relativePath: 'c.xlsx', oldPath: null, newPath: '/new/c.xlsx', oldSize: 0, newSize: 150, status: 'new-only', diffStatus: 'unknown' },
    ];
    useDiffStore.setState({ filePairs: pairs, oldDir: '/old', newDir: '/new' } as any);
    render(<FileList />);
    expect(screen.getAllByText('a.xlsx').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('b.xlsx').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('c.xlsx').length).toBeGreaterThanOrEqual(1);
  });

  it('shows filter buttons with counts', () => {
    const pairs: FilePair[] = [
      { filename: 'a.xlsx', relativePath: 'a.xlsx', oldPath: '/old/a.xlsx', newPath: '/new/a.xlsx', oldSize: 100, newSize: 100, status: 'matched', diffStatus: 'identical' },
      { filename: 'b.xlsx', relativePath: 'b.xlsx', oldPath: '/old/b.xlsx', newPath: '/new/b.xlsx', oldSize: 100, newSize: 120, status: 'matched', diffStatus: 'different' },
      { filename: 'c.xlsx', relativePath: 'c.xlsx', oldPath: '/old/c.xlsx', newPath: null, oldSize: 200, newSize: 0, status: 'old-only', diffStatus: 'unknown' },
    ];
    useDiffStore.setState({ filePairs: pairs, oldDir: '/old', newDir: '/new' } as any);
    render(<FileList />);
    expect(screen.getByText('全部(3)')).toBeInTheDocument();
    expect(screen.getByText('不同(1)')).toBeInTheDocument();
    expect(screen.getByText('相同(1)')).toBeInTheDocument();
    expect(screen.getByText('仅左(1)')).toBeInTheDocument();
  });

  it('filters by filename wildcard', () => {
    const pairs: FilePair[] = [
      { filename: 'report1.xlsx', relativePath: 'report1.xlsx', oldPath: '/old/report1.xlsx', newPath: '/new/report1.xlsx', oldSize: 100, newSize: 100, status: 'matched', diffStatus: 'identical' },
      { filename: 'data.xlsx', relativePath: 'data.xlsx', oldPath: '/old/data.xlsx', newPath: '/new/data.xlsx', oldSize: 100, newSize: 100, status: 'matched', diffStatus: 'identical' },
    ];
    useDiffStore.setState({ filePairs: pairs, oldDir: '/old', newDir: '/new' } as any);
    render(<FileList />);
    const input = screen.getByPlaceholderText('*.xlsx, report*, ...');
    fireEvent.change(input, { target: { value: 'report*' } });
    expect(screen.getAllByText('report1.xlsx').length).toBeGreaterThanOrEqual(1);
    // data.xlsx should not appear in either panel after filtering
    expect(screen.queryAllByText('data.xlsx').length).toBe(0);
  });
});
