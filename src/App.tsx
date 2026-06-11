import { useEffect, useRef } from "react";
import { useDiffStore } from "./stores/diffStore";
import DirectoryPicker from "./components/DirectoryPicker";
import FileList from "./components/FileList";
import DiffView from "./components/DiffView";
import HistoryBar from "./components/HistoryBar";
import WorkspaceTabs from "./components/WorkspaceTabs";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { getStartupExternalDiffRequest, listenExternalDiffOpen, type ExternalDiffRequest } from "./api/tauri";
import { openExternalDiff } from "./utils/externalDiffLauncher";

function App() {
  const { currentView, setView, oldDir, newDir } = useDiffStore();
  const { tabs, activeTabId, setFileListTitle } = useWorkspaceStore();
  const externalDiffQueueRef = useRef(Promise.resolve());
  const externalDiffSeenRef = useRef(new Set<string>());
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const effectiveView = activeTab?.type === "diff" ? "diff" : "directory";

  useEffect(() => {
    if (currentView !== effectiveView) {
      setView(effectiveView);
    }
  }, [currentView, effectiveView, setView]);

  useEffect(() => {
    const nameOf = (path: string) => path.split(/[\\/]+/).filter(Boolean).pop() ?? "";
    const left = nameOf(oldDir);
    const right = nameOf(newDir);
    setFileListTitle(left || right ? `${left || "Left"} vs ${right || "Right"}` : "Directory Compare");
  }, [newDir, oldDir, setFileListTitle]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const requestKey = (request: ExternalDiffRequest) => [
      request.sourcePath,
      request.destinationPath,
      request.title ?? "",
    ].join("\n");

    const handleRequest = (request: ExternalDiffRequest) => {
      const key = requestKey(request);
      if (externalDiffSeenRef.current.has(key)) return;
      externalDiffSeenRef.current.add(key);

      externalDiffQueueRef.current = externalDiffQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (disposed) return;
          try {
            await openExternalDiff(request);
          } catch (e: any) {
            alert(`Open external diff failed: ${e?.message || String(e)}`);
          }
        });
    };

    void getStartupExternalDiffRequest().then((request) => {
      if (!disposed && request) handleRequest(request);
    });

    void listenExternalDiffOpen((request) => {
      if (!disposed) handleRequest(request);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50 text-gray-900 select-none">
      <WorkspaceTabs />
      {effectiveView === "directory" && (
        <>
          <HistoryBar />
          <DirectoryPicker />
          <FileList />
        </>
      )}
      {effectiveView === "diff" && <DiffView />}
    </div>
  );
}

export default App;
