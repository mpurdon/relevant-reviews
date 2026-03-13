import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileSidebar } from "./components/FileSidebar";
import { DiffViewer } from "./components/DiffViewer";
import { Header } from "./components/Header";
import { PrOpener } from "./components/PrOpener";
import { SettingsModal } from "./components/SettingsModal";
import type { ReviewManifest, FileDiff, DiffViewMode } from "./types";

function App() {
  const [manifest, setManifest] = useState<ReviewManifest | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileDiff | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>("split");
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    setManifest(data);
    setViewedFiles(new Set());
    if (data.files.length > 0) {
      setSelectedFile(data.files[0]);
    }
    setError(null);
  }

  const toggleViewed = useCallback((filePath: string) => {
    setViewedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

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
        </div>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div
        className="app empty-state"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
      >
        <div className="empty-message">
          <h1>Relevant Reviews</h1>
          <p>
            Drop a manifest JSON file here, or enter a PR URL below to start
            a review.
          </p>
          <PrOpener onManifestLoaded={handleManifestLoaded} />
          <button
            className="settings-button"
            onClick={() => setSettingsOpen(true)}
            style={{ marginTop: 16 }}
          >
            Settings
          </button>
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        manifest={manifest}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        viewedCount={viewedFiles.size}
        onSettingsClick={() => setSettingsOpen(true)}
        onNewReview={() => {
          setManifest(null);
          setSelectedFile(null);
          setViewedFiles(new Set());
        }}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <div className="main-content">
        <FileSidebar
          files={manifest.files}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          viewedFiles={viewedFiles}
          onToggleViewed={toggleViewed}
        />
        <div className="diff-pane">
          {selectedFile ? (
            <DiffViewer file={selectedFile} viewMode={viewMode} />
          ) : (
            <div className="no-file-selected">Select a file to review</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
