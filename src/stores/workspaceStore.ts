import { create } from "zustand";
import type { DiffResult } from "../types/diff";
import type { FilePair, ParsedWorkbook, Row } from "../types/excel";
import type { EditOperation } from "./editStore";

export interface DiffTabUiState {
  showSearch: boolean;
  searchText: string;
  currentMatchIndex: number;
  leftSelected: string[];
  rightSelected: string[];
  activeDiffRowRef: string | null;
  filter: "all" | "diff" | "same" | "duplicate";
  scrollMetrics: { scrollTop: number; clientHeight: number; scrollHeight: number };
  columnWidths: Record<string, number>;
}

export interface DiffTabSnapshot {
  selectedFilePair: FilePair | null;
  oldWorkbook: ParsedWorkbook | null;
  newWorkbook: ParsedWorkbook | null;
  currentSheet: string;
  diffResult: DiffResult | null;
  keyColumnIndices: number[];
  effectiveNewRows: Row[] | null;
  hasUnsavedChanges: boolean;
  undoStack: EditOperation[];
  redoStack: EditOperation[];
  uiState?: DiffTabUiState;
}

export type WorkspaceTab =
  | {
      id: string;
      type: "file-list";
      title: string;
    }
  | {
      id: string;
      type: "diff";
      title: string;
      parentTabId: string;
      fileKey: string;
      revision?: string;
      snapshot?: DiffTabSnapshot;
    };

type DiffTabInput = Omit<Extract<WorkspaceTab, { type: "diff" }>, "id" | "type" | "parentTabId"> & {
  parentTabId?: string;
};

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  activeFileListTabId: string;
  setFileListTitle: (title: string) => void;
  activateTab: (id: string) => void;
  activateFileListTab: (id?: string) => void;
  openDiffTab: (tab: DiffTabInput) => string;
  updateDiffSnapshot: (id: string, snapshot: DiffTabSnapshot) => void;
  getDiffSnapshot: (id: string) => DiffTabSnapshot | null;
  closeTab: (id: string) => void;
  closeTabs: (ids: string[]) => void;
}

const INITIAL_FILE_LIST_TAB_ID = "file-list:main";

function createDiffTabId(parentTabId: string, fileKey: string, revision?: string): string {
  return `diff:${parentTabId}:${fileKey}:${revision ?? "current"}`;
}

function findNextActiveTab(tabs: WorkspaceTab[], closedIndex: number, fallbackId: string): string {
  return tabs[Math.max(0, Math.min(closedIndex, tabs.length - 1))]?.id ?? fallbackId;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: [{ id: INITIAL_FILE_LIST_TAB_ID, type: "file-list", title: "Directory Compare" }],
  activeTabId: INITIAL_FILE_LIST_TAB_ID,
  activeFileListTabId: INITIAL_FILE_LIST_TAB_ID,

  setFileListTitle: (title) => set((state) => ({
    tabs: state.tabs.map((tab) => (
      tab.type === "file-list" ? { ...tab, title } : tab
    )),
  })),

  activateTab: (id) => set((state) => {
    const tab = state.tabs.find((item) => item.id === id);
    if (!tab) return state;
    return {
      activeTabId: id,
      activeFileListTabId: tab.type === "file-list" ? tab.id : state.activeFileListTabId,
    };
  }),

  activateFileListTab: (id) => set((state) => {
    const targetId = id ?? state.activeFileListTabId;
    const tab = state.tabs.find((item) => item.id === targetId && item.type === "file-list");
    if (!tab) return state;
    return {
      activeTabId: tab.id,
      activeFileListTabId: tab.id,
    };
  }),

  openDiffTab: ({ parentTabId, title, fileKey, revision, snapshot }) => {
    const state = get();
    const resolvedParentId = parentTabId ?? state.activeFileListTabId;
    const id = createDiffTabId(resolvedParentId, fileKey, revision);
    const existing = state.tabs.find((tab) => tab.id === id);
    if (existing) {
      set((current) => ({
        activeTabId: id,
        tabs: current.tabs.map((tab) => (
          tab.id === id && tab.type === "diff" && snapshot ? { ...tab, title, snapshot } : tab
        )),
      }));
      return id;
    }

    const tab: WorkspaceTab = {
      id,
      type: "diff",
      title,
      parentTabId: resolvedParentId,
      fileKey,
      revision,
      snapshot,
    };

    const parentIndex = state.tabs.findIndex((item) => item.id === resolvedParentId);
    const insertAfterIndex = parentIndex < 0
      ? state.tabs.length - 1
      : state.tabs.reduce((lastIndex, item, index) => (
          item.type === "diff" && item.parentTabId === resolvedParentId ? index : lastIndex
        ), parentIndex);
    const nextTabs = [...state.tabs];
    nextTabs.splice(insertAfterIndex + 1, 0, tab);
    set({ tabs: nextTabs, activeTabId: id });
    return id;
  },

  updateDiffSnapshot: (id, snapshot) => set((state) => ({
    tabs: state.tabs.map((tab) => (
      tab.id === id && tab.type === "diff" ? { ...tab, snapshot } : tab
    )),
  })),

  getDiffSnapshot: (id) => {
    const tab = get().tabs.find((item) => item.id === id);
    return tab?.type === "diff" ? tab.snapshot ?? null : null;
  },

  closeTab: (id) => set((state) => {
    const closedIndex = state.tabs.findIndex((tab) => tab.id === id);
    if (closedIndex < 0) return state;
    const target = state.tabs[closedIndex];
    if (target.type === "file-list") {
      const fileListCount = state.tabs.filter((tab) => tab.type === "file-list").length;
      if (fileListCount <= 1) return state;
    }

    const nextTabs = state.tabs.filter((tab) => tab.id !== id);
    const nextActiveTabId = state.activeTabId === id
      ? findNextActiveTab(nextTabs, closedIndex, state.activeFileListTabId)
      : state.activeTabId;
    const activeTab = nextTabs.find((tab) => tab.id === nextActiveTabId);
    const nextFileListTabId = activeTab?.type === "file-list"
      ? activeTab.id
      : nextTabs.find((tab) => tab.id === state.activeFileListTabId && tab.type === "file-list")?.id
        ?? nextTabs.find((tab) => tab.type === "file-list")?.id
        ?? INITIAL_FILE_LIST_TAB_ID;

    return {
      tabs: nextTabs,
      activeTabId: nextActiveTabId,
      activeFileListTabId: nextFileListTabId,
    };
  }),

  closeTabs: (ids) => set((state) => {
    const closeIds = new Set(ids);
    const nextTabs = state.tabs.filter((tab) => tab.type === "file-list" || !closeIds.has(tab.id));
    const activeStillExists = nextTabs.some((tab) => tab.id === state.activeTabId);
    const nextActiveTabId = activeStillExists
      ? state.activeTabId
      : nextTabs.find((tab) => tab.id === state.activeFileListTabId)?.id
        ?? nextTabs[0]?.id
        ?? INITIAL_FILE_LIST_TAB_ID;
    const activeTab = nextTabs.find((tab) => tab.id === nextActiveTabId);
    return {
      tabs: nextTabs,
      activeTabId: nextActiveTabId,
      activeFileListTabId: activeTab?.type === "file-list" ? activeTab.id : state.activeFileListTabId,
    };
  }),
}));
