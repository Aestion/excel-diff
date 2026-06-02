import { useDiffStore } from "./stores/diffStore";
import DirectoryPicker from "./components/DirectoryPicker";
import FileList from "./components/FileList";
import DiffView from "./components/DiffView";
import HistoryBar from "./components/HistoryBar";

function App() {
  const { currentView } = useDiffStore();

  return (
    <div className="h-screen flex flex-col bg-gray-50 text-gray-900 select-none">
      {currentView === "directory" && (
        <>
          <HistoryBar />
          <DirectoryPicker />
          <FileList />
        </>
      )}
      {currentView === "diff" && <DiffView />}
    </div>
  );
}

export default App;
