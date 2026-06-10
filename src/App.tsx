import { useEffect } from "react";
import { useDiffStore } from "./stores/diffStore";
import DirectoryPicker from "./components/DirectoryPicker";
import FileList from "./components/FileList";
import DiffView from "./components/DiffView";
import HistoryBar from "./components/HistoryBar";
import WorkspaceTabs from "./components/WorkspaceTabs";
import { useWorkspaceStore } from "./stores/workspaceStore";

function App() {
  const { currentView, setView, oldDir, newDir } = useDiffStore();
  const { tabs, activeTabId, setFileListTitle } = useWorkspaceStore();
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
