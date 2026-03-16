import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileSidebar } from "./components/FileSidebar";
import { DiffViewer } from "./components/DiffViewer";
import { Header } from "./components/Header";
import { PrOpener } from "./components/PrOpener";
import { LoadingView } from "./components/LoadingView";
import { SettingsModal } from "./components/SettingsModal";
import { SummaryParagraphs } from "./components/SummaryParagraphs";
import type { ReviewManifest, FileDiff, DiffViewMode, Tab, FetchProgress } from "./types";

function App() {
  const nextTabId = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>("split");
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingPrRef, setLoadingPrRef] = useState("");
  const [loadingPrTitle, setLoadingPrTitle] = useState<string | null>(null);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [fileCounts, setFileCounts] = useState<Record<number, { done: number; total: number }>>({});

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  function createTab(manifest: ReviewManifest): Tab {
    return {
      id: String(nextTabId.current++),
      manifest,
      selectedFile: manifest.files.length > 0 ? manifest.files[0] : null,
      viewedFiles: new Set(),
    };
  }

  useEffect(() => {
    invoke<string | null>("get_initial_manifest_path").then((path) => {
      if (path) {
        loadManifest(path);
      }
    });
  }, []);

  async function loadManifest(path: string) {
    try {
      const data = await invoke<ReviewManifest>("load_manifest", { path });
      handleManifestLoaded(data);
    } catch (e) {
      setError(String(e));
    }
  }

  function handleManifestLoaded(data: ReviewManifest) {
    const tab = createTab(data);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setShowOpener(false);
    setError(null);
  }

  const unlistenRef = useRef<(() => void) | null>(null);

  async function handleFetchStart(prRef: string) {
    if (loading) return;
    setLoading(true);
    setLoadingPrRef(prRef);
    setLoadingPrTitle(null);
    setProgress(null);
    setFileCounts({});
    setError(null);

    const unlisten = await listen<FetchProgress>("fetch-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.pr_title) {
        setLoadingPrTitle(event.payload.pr_title);
      }
      if (event.payload.files_total != null) {
        setFileCounts((prev) => ({
          ...prev,
          [event.payload.step]: {
            done: event.payload.files_done ?? 0,
            total: event.payload.files_total!,
          },
        }));
      }
    });
    unlistenRef.current = unlisten;

    try {
      const manifest = await invoke<ReviewManifest>("fetch_pr", { prRef });
      handleManifestLoaded(manifest);
    } catch (err) {
      setError(String(err));
    } finally {
      unlisten();
      unlistenRef.current = null;
      setLoading(false);
      setProgress(null);
    }
  }

  function handleFetchCancel() {
    unlistenRef.current?.();
    unlistenRef.current = null;
    setLoading(false);
    setProgress(null);
  }

  function updateActiveTab(updater: (tab: Tab) => Tab) {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? updater(t) : t))
    );
  }

  function setSelectedFile(file: FileDiff) {
    updateActiveTab((t) => ({ ...t, selectedFile: file }));
  }

  function toggleViewed(filePath: string) {
    updateActiveTab((t) => {
      const next = new Set(t.viewedFiles);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return { ...t, viewedFiles: next };
    });
  }

  function closeTab(tabId: string) {
    const idx = tabs.findIndex((t) => t.id === tabId);
    const next = tabs.filter((t) => t.id !== tabId);
    setTabs(next);
    if (tabId === activeTabId) {
      if (next.length === 0) {
        setActiveTabId(null);
      } else {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveTabId(next[newIdx].id);
      }
    }
  }

  async function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const path = (file as File & { path?: string }).path;
      if (path) {
        loadManifest(path);
      }
    }
  }

  if (error) {
    return (
      <div className="app error-state">
        <div className="error-message">
          <h2>Error loading review</h2>
          <pre>{error}</pre>
          <button
            className="settings-button"
            onClick={() => {
              setError(null);
            }}
            style={{ marginTop: 16 }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (tabs.length === 0 || showOpener) {
    return (
      <div
        className="app empty-state"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
      >
        <div className="empty-message">
          {loading ? (
            <LoadingView
              prRef={loadingPrRef}
              prTitle={loadingPrTitle}
              progress={progress}
              fileCounts={fileCounts}
              onCancel={handleFetchCancel}
            />
          ) : (
            <>
              <h1>Relevant Reviews</h1>
              <p>
                Drop a manifest JSON file here, or enter a PR URL below to start
                a review.
              </p>
              <PrOpener onFetchStart={handleFetchStart} />
            </>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center" }}>
            {tabs.length > 0 && !loading && (
              <button
                className="settings-button"
                onClick={() => setShowOpener(false)}
              >
                Cancel
              </button>
            )}
            {!loading && (
              <button
                className="settings-button"
                onClick={() => setSettingsOpen(true)}
              >
                Settings
              </button>
            )}
          </div>
        </div>
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onNewReview={() => setShowOpener(true)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        viewedCount={activeTab?.viewedFiles.size ?? 0}
        onSettingsClick={() => setSettingsOpen(true)}
        manifest={activeTab?.manifest ?? null}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      {activeTab && (
        <div className="main-content">
          <FileSidebar
            files={activeTab.manifest.files}
            changeGroups={activeTab.manifest.change_groups ?? []}
            selectedFile={activeTab.selectedFile}
            onSelectFile={setSelectedFile}
            viewedFiles={activeTab.viewedFiles}
            onToggleViewed={toggleViewed}
          />
          <div className="diff-pane">
            {activeTab.selectedFile ? (
              <DiffViewer file={activeTab.selectedFile} viewMode={viewMode} />
            ) : activeTab.manifest.summary ? (
              <div className="pr-summary">
                <h3>PR Summary</h3>
                <SummaryParagraphs text={activeTab.manifest.summary} />
              </div>
            ) : (
              <div className="no-file-selected">Select a file to review</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
