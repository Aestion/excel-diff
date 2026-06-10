import { create } from "zustand";
import type { CellValue } from "../types/excel";
import type { RowKey } from "../types/diff";

export interface CellChange {
  rowKey: RowKey;
  rowRef?: string;
  columnIndex: number;
  value: CellValue;
  formula?: string;
}

export interface EditOperation {
  type: "cell-edit" | "row-copy" | "batch-copy" | "row-insert" | "row-delete";
  undoPayload: CellChange[];
  redoPayload: CellChange[];
  description: string;
}

interface EditState {
  undoStack: EditOperation[];
  redoStack: EditOperation[];

  pushEdit: (op: EditOperation) => void;
  undo: () => EditOperation | null;
  redo: () => EditOperation | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  setStacks: (undoStack: EditOperation[], redoStack: EditOperation[]) => void;
  clear: () => void;
}

export const useEditStore = create<EditState>((set, get) => ({
  undoStack: [],
  redoStack: [],

  pushEdit: (op) =>
    set((state) => ({
      undoStack: [...state.undoStack, op],
      redoStack: [],
    })),

  undo: () => {
    const { undoStack, redoStack } = get();
    if (undoStack.length === 0) return null;
    const op = undoStack[undoStack.length - 1];
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, op],
    });
    return op;
  },

  redo: () => {
    const { undoStack, redoStack } = get();
    if (redoStack.length === 0) return null;
    const op = redoStack[redoStack.length - 1];
    set({
      undoStack: [...undoStack, op],
      redoStack: redoStack.slice(0, -1),
    });
    return op;
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  setStacks: (undoStack, redoStack) => set({ undoStack, redoStack }),
  clear: () => set({ undoStack: [], redoStack: [] }),
}));
