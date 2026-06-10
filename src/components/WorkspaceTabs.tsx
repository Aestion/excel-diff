import { useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useDiffStore } from "../stores/diffStore";
import { captureDiffTabSnapshot, restoreDiffTabSnapshot } from "../utils/diffTabSnapshot";
import { requestDiffTabUiState, restoreDiffTabUiState } from "../utils/diffTabUiStateBridge";
import type { WorkspaceTab } from "../stores/workspaceStore";

function tabTypeLabel(type: "file-list" | "diff"): string {
  return type === "file-list" ? "DIR" : "DIFF";
}

export default function WorkspaceTabs() {
  const { tabs, activeTabId, activateTab, closeTab, closeTabs, getDiffSnapshot, updateDiffSnapshot } = useWorkspaceStore();
  const { setView, hasUnsavedChanges } = useDiffStore();
  const [menu, setMenu] = useState<{ x: number; y: number; tab: WorkspaceTab } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleActivate = (id: string, type: "file-list" | "diff") => {
    const currentTab = useWorkspaceStore.getState().tabs.find((tab) => tab.id === useWorkspaceStore.getState().activeTabId);
    if (currentTab?.type === "diff") {
      updateDiffSnapshot(currentTab.id, captureDiffTabSnapshot(requestDiffTabUiState()));
    }
    activateTab(id);
    if (type === "diff") {
      const snapshot = getDiffSnapshot(id);
      if (snapshot) {
        restoreDiffTabSnapshot(snapshot);
        restoreDiffTabUiState(snapshot.uiState);
      }
    }
    setView(type === "file-list" ? "directory" : "diff");
  };

  const handleClose = (event: React.MouseEvent, id: string, type: "file-list" | "diff") => {
    event.stopPropagation();
    if (type === "diff" && hasUnsavedChanges && !window.confirm("Current diff has unsaved changes. Close this tab?")) {
      return;
    }

    const stateBefore = useWorkspaceStore.getState();
    const beforeActive = stateBefore.activeTabId;
    const currentTab = stateBefore.tabs.find((tab) => tab.id === beforeActive);
    if (currentTab?.type === "diff" && currentTab.id !== id) {
      updateDiffSnapshot(currentTab.id, captureDiffTabSnapshot(requestDiffTabUiState()));
    }
    closeTab(id);
    const state = useWorkspaceStore.getState();
    if (beforeActive === id) {
      const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
      if (activeTab?.type === "diff") {
        const snapshot = state.getDiffSnapshot(activeTab.id);
        if (snapshot) {
          restoreDiffTabSnapshot(snapshot);
          restoreDiffTabUiState(snapshot.uiState);
        }
      }
      setView(activeTab?.type === "diff" ? "diff" : "directory");
    }
  };

  const closeMany = (ids: string[]) => {
    const currentTab = useWorkspaceStore.getState().tabs.find((tab) => tab.id === useWorkspaceStore.getState().activeTabId);
    if (currentTab?.type === "diff") {
      updateDiffSnapshot(currentTab.id, captureDiffTabSnapshot(requestDiffTabUiState()));
    }
    closeTabs(ids);
    const state = useWorkspaceStore.getState();
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (activeTab?.type === "diff") {
      const snapshot = state.getDiffSnapshot(activeTab.id);
      if (snapshot) {
        restoreDiffTabSnapshot(snapshot);
        restoreDiffTabUiState(snapshot.uiState);
      }
    }
    setView(activeTab?.type === "diff" ? "diff" : "directory");
  };

  const handleMenuAction = (action: "close" | "others" | "group") => {
    if (!menu) return;
    const target = menu.tab;
    setMenu(null);
    if (action === "close") {
      if (target.type !== "file-list") closeMany([target.id]);
      return;
    }
    if (action === "others") {
      closeMany(tabs.filter((tab) => tab.type === "diff" && tab.id !== target.id).map((tab) => tab.id));
      return;
    }
    closeMany(tabs.filter((tab) => tab.type === "diff").map((tab) => tab.id));
  };

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(event.target as Node)) return;
      setMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <div className="flex h-9 shrink-0 items-end gap-1 border-b bg-gray-100 px-2 pt-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const canClose = tab.type !== "file-list";
        return (
          <button
            type="button"
            key={tab.id}
            className={`group flex max-w-[260px] items-center gap-2 rounded-t border px-3 py-1.5 text-xs ${
              active
                ? "border-gray-300 border-b-white bg-white text-gray-900"
                : "border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            onClick={() => handleActivate(tab.id, tab.type)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ x: event.clientX, y: event.clientY, tab });
            }}
            title={tab.title}
          >
            <span className={`shrink-0 rounded px-1 text-[10px] font-semibold ${
              tab.type === "file-list" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"
            }`}>
              {tabTypeLabel(tab.type)}
            </span>
            <span className="min-w-0 truncate">{tab.title}</span>
            {canClose && (
              <span
                role="button"
                tabIndex={-1}
                className="ml-1 rounded px-1 text-gray-400 hover:bg-gray-300 hover:text-gray-700"
                onClick={(event) => handleClose(event, tab.id, tab.type)}
                title="Close tab"
              >
                x
              </span>
            )}
          </button>
        );
      })}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[150px] rounded border bg-white py-1 text-xs shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.tab.type !== "file-list" && (
            <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-50" onClick={() => handleMenuAction("close")}>
              Close
            </button>
          )}
          <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-50" onClick={() => handleMenuAction("others")}>
            Close others
          </button>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-50" onClick={() => handleMenuAction("group")}>
            Close all diffs
          </button>
        </div>
      )}
    </div>
  );
}
