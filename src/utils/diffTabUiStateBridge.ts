import type { DiffTabUiState } from "../stores/workspaceStore";

const CAPTURE_EVENT = "excel-diff:capture-diff-ui-state";
const RESTORE_EVENT = "excel-diff:restore-diff-ui-state";

declare global {
  interface WindowEventMap {
    [CAPTURE_EVENT]: CustomEvent<{ callback: (state: DiffTabUiState) => void }>;
    [RESTORE_EVENT]: CustomEvent<DiffTabUiState>;
  }
}

export function requestDiffTabUiState(): DiffTabUiState | undefined {
  let captured: DiffTabUiState | undefined;
  window.dispatchEvent(new CustomEvent(CAPTURE_EVENT, {
    detail: {
      callback: (state: DiffTabUiState) => {
        captured = state;
      },
    },
  }));
  return captured;
}

export function onDiffTabUiStateCapture(handler: () => DiffTabUiState): () => void {
  const listener = (event: WindowEventMap[typeof CAPTURE_EVENT]) => {
    event.detail.callback(handler());
  };
  window.addEventListener(CAPTURE_EVENT, listener);
  return () => window.removeEventListener(CAPTURE_EVENT, listener);
}

export function restoreDiffTabUiState(state: DiffTabUiState | undefined): void {
  if (!state) return;
  window.dispatchEvent(new CustomEvent(RESTORE_EVENT, { detail: state }));
}

export function onDiffTabUiStateRestore(handler: (state: DiffTabUiState) => void): () => void {
  const listener = (event: WindowEventMap[typeof RESTORE_EVENT]) => {
    handler(event.detail);
  };
  window.addEventListener(RESTORE_EVENT, listener);
  return () => window.removeEventListener(RESTORE_EVENT, listener);
}
