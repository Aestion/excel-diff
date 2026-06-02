import { describe, it, expect, beforeEach } from 'vitest';
import { useEditStore } from './editStore';

describe('editStore', () => {
  beforeEach(() => {
    useEditStore.getState().clear();
  });

  it('pushes edit and clears redo stack', () => {
    useEditStore.getState().pushEdit({
      type: 'cell-edit',
      undoPayload: [],
      redoPayload: [],
      description: 'test',
    });
    const state = useEditStore.getState();
    expect(state.undoStack).toHaveLength(1);
    expect(state.redoStack).toHaveLength(0);
    expect(state.canUndo()).toBe(true);
    expect(state.canRedo()).toBe(false);
  });

  it('undoes an edit', () => {
    const op = {
      type: 'cell-edit' as const,
      undoPayload: [{ rowKey: 'k1', columnIndex: 0, value: 'old' }],
      redoPayload: [{ rowKey: 'k1', columnIndex: 0, value: 'new' }],
      description: 'test',
    };
    useEditStore.getState().pushEdit(op);
    const undone = useEditStore.getState().undo();
    const state = useEditStore.getState();
    expect(undone).toEqual(op);
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(1);
    expect(state.canUndo()).toBe(false);
    expect(state.canRedo()).toBe(true);
  });

  it('redoes an edit', () => {
    const op = {
      type: 'cell-edit' as const,
      undoPayload: [],
      redoPayload: [],
      description: 'test',
    };
    useEditStore.getState().pushEdit(op);
    useEditStore.getState().undo();
    const redone = useEditStore.getState().redo();
    const state = useEditStore.getState();
    expect(redone).toEqual(op);
    expect(state.undoStack).toHaveLength(1);
    expect(state.redoStack).toHaveLength(0);
  });

  it('pushes new edit after undo clears redo stack', () => {
    useEditStore.getState().pushEdit({ type: 'cell-edit', undoPayload: [], redoPayload: [], description: 'first' });
    useEditStore.getState().pushEdit({ type: 'cell-edit', undoPayload: [], redoPayload: [], description: 'second' });
    useEditStore.getState().undo();
    expect(useEditStore.getState().redoStack).toHaveLength(1);
    useEditStore.getState().pushEdit({ type: 'cell-edit', undoPayload: [], redoPayload: [], description: 'third' });
    expect(useEditStore.getState().redoStack).toHaveLength(0);
    expect(useEditStore.getState().undoStack).toHaveLength(2);
  });

  it('returns null when undoing empty stack', () => {
    expect(useEditStore.getState().undo()).toBeNull();
  });

  it('returns null when redoing empty stack', () => {
    expect(useEditStore.getState().redo()).toBeNull();
  });

  it('clears stacks', () => {
    useEditStore.getState().pushEdit({ type: 'cell-edit', undoPayload: [], redoPayload: [], description: 'test' });
    useEditStore.getState().clear();
    const state = useEditStore.getState();
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
    expect(state.canUndo()).toBe(false);
    expect(state.canRedo()).toBe(false);
  });
});
