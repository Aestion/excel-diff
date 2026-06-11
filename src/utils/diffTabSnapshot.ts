import { useDiffStore } from "../stores/diffStore";
import { useEditStore } from "../stores/editStore";
import type { DiffTabSnapshot, DiffTabUiState } from "../stores/workspaceStore";

export function createDefaultDiffTabUiState(): DiffTabUiState {
  return {
    showSearch: false,
    searchText: "",
    currentMatchIndex: 0,
    leftSelected: [],
    rightSelected: [],
    activeDiffRowRef: null,
    filter: "all",
    scrollMetrics: { scrollTop: 0, clientHeight: 1, scrollHeight: 2 },
    columnWidths: {},
  };
}

export function captureDiffTabSnapshot(uiState?: DiffTabUiState): DiffTabSnapshot {
  const state = useDiffStore.getState();
  const editState = useEditStore.getState();
  return {
    selectedFilePair: state.selectedFilePair,
    oldWorkbook: state.oldWorkbook,
    newWorkbook: state.newWorkbook,
    currentSheet: state.currentSheet,
    diffResult: state.diffResult,
    keyColumnIndices: state.keyColumnIndices,
    effectiveNewRows: state.effectiveNewRows,
    hasUnsavedChanges: state.hasUnsavedChanges,
    undoStack: [...editState.undoStack],
    redoStack: [...editState.redoStack],
    uiState: uiState ?? createDefaultDiffTabUiState(),
  };
}

export function restoreDiffTabSnapshot(snapshot: DiffTabSnapshot): void {
  const state = useDiffStore.getState();
  state.restoreSnapshot({
    selectedFilePair: snapshot.selectedFilePair,
    oldWorkbook: snapshot.oldWorkbook,
    newWorkbook: snapshot.newWorkbook,
    currentSheet: snapshot.currentSheet,
    diffResult: snapshot.diffResult,
    keyColumnIndices: snapshot.keyColumnIndices,
    effectiveNewRows: snapshot.effectiveNewRows,
    hasUnsavedChanges: snapshot.hasUnsavedChanges,
  });
  useEditStore.getState().setStacks([...(snapshot.undoStack ?? [])], [...(snapshot.redoStack ?? [])]);
}
