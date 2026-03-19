import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileSidebar } from "./components/FileSidebar";
import { DiffViewer, detectLanguage } from "./components/DiffViewer";
import { CommentsViewer } from "./components/CommentsViewer";
import { Header } from "./components/Header";
import { PrOpener } from "./components/PrOpener";
import { ReviewRequestList } from "./components/ReviewRequestList";
import { LoadingView } from "./components/LoadingView";
import { SettingsModal } from "./components/SettingsModal";
import { SummaryParagraphs } from "./components/SummaryParagraphs";
import { SearchBar } from "./components/SearchBar";
import type { ReviewManifest, FileDiff, DiffViewMode, Tab, FetchProgress, HunkSignificanceFilter, SidebarView, ReviewThread, ReviewComment, SearchMatch } from "./types";

function App() {
  const nextTabId = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>("split");
  const [showHunkSignificance, setShowHunkSignificance] = useState(true);
  const [showAiNotes, setShowAiNotes] = useState(true);
  const [hunkFilter, setHunkFilter] = useState<HunkSignificanceFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingPrRef, setLoadingPrRef] = useState("");
  const [loadingPrTitle, setLoadingPrTitle] = useState<string | null>(null);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [fileCounts, setFileCounts] = useState<Record<number, { done: number; total: number }>>({});
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const selectedFilePath = activeTab?.selectedFile?.path ?? null;
  const fileSearchMatches = useMemo(
    () => searchMatches.filter((m) => m.filePath === selectedFilePath),
    [searchMatches, selectedFilePath]
  );
  const currentSearchMatch = useMemo(
    () => {
      const m = searchMatches[searchCurrentIndex];
      return m?.filePath === selectedFilePath ? m : null;
    },
    [searchMatches, searchCurrentIndex, selectedFilePath]
  );

  function createTab(manifest: ReviewManifest): Tab {
    const hasGroups = (manifest.change_groups ?? []).length > 0;
    return {
      id: String(nextTabId.current++),
      manifest,
      selectedFile: manifest.files.length > 0 ? manifest.files[0] : null,
      viewedFiles: new Set(),
      commentThreads: { status: "idle" },
      selectedCommentFile: null,
      sidebarView: hasGroups ? "groups" : "category",
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

  function handleViewChange(view: SidebarView) {
    updateActiveTab((t) => ({ ...t, sidebarView: view }));
    if (view === "comments") {
      handleRequestComments();
    }
  }

  async function handleRequestComments() {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.commentThreads.status === "loading" || tab.commentThreads.status === "loaded") return;

    updateActiveTab((t) => ({ ...t, commentThreads: { status: "loading" } }));
    try {
      const threads = await invoke<ReviewThread[]>("fetch_review_comments", {
        prUrl: tab.manifest.pr_url,
      });
      // Set first file with comments as selected if none selected
      const firstFile = threads.length > 0 ? threads[0].path : null;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                commentThreads: { status: "loaded", threads },
                selectedCommentFile: t.selectedCommentFile ?? firstFile,
              }
            : t
        )
      );
    } catch (err) {
      updateActiveTab((t) => ({
        ...t,
        commentThreads: { status: "error", message: String(err) },
      }));
    }
  }

  function handleSelectCommentFile(path: string) {
    updateActiveTab((t) => ({ ...t, selectedCommentFile: path }));
  }

  async function handleReply(threadId: string, commentId: string, body: string) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.commentThreads.status !== "loaded") return;

    // Optimistic update: add a placeholder comment
    const optimisticComment = {
      id: `optimistic-${Date.now()}`,
      body,
      author: { login: "you", avatar_url: "" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      url: "",
    };

    const prevThreads = tab.commentThreads.threads;
    const optimisticThreads = prevThreads.map((t) =>
      t.id === threadId
        ? { ...t, comments: [...t.comments, optimisticComment] }
        : t
    );
    updateActiveTab((t) => ({
      ...t,
      commentThreads: { status: "loaded", threads: optimisticThreads },
    }));

    try {
      const newComment = await invoke<ReviewComment>("reply_to_thread", {
        prUrl: tab.manifest.pr_url,
        commentId,
        body,
      });

      // Replace optimistic comment with real one
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId || t.commentThreads.status !== "loaded") return t;
          return {
            ...t,
            commentThreads: {
              status: "loaded",
              threads: t.commentThreads.threads.map((th) =>
                th.id === threadId
                  ? {
                      ...th,
                      comments: th.comments.map((c) =>
                        c.id === optimisticComment.id ? newComment : c
                      ),
                    }
                  : th
              ),
            },
          };
        })
      );
    } catch {
      // Revert on error
      updateActiveTab((t) => ({
        ...t,
        commentThreads: { status: "loaded", threads: prevThreads },
      }));
    }
  }

  async function handleToggleResolved(threadId: string, resolve: boolean) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.commentThreads.status !== "loaded") return;

    const prevThreads = tab.commentThreads.threads;

    // Optimistic update
    const optimisticThreads = prevThreads.map((t) =>
      t.id === threadId ? { ...t, is_resolved: resolve } : t
    );
    updateActiveTab((t) => ({
      ...t,
      commentThreads: { status: "loaded", threads: optimisticThreads },
    }));

    try {
      await invoke<boolean>("toggle_thread_resolved", { threadId, resolve });
    } catch {
      // Revert on error
      updateActiveTab((t) => ({
        ...t,
        commentThreads: { status: "loaded", threads: prevThreads },
      }));
    }
  }

  async function handleEditComment(commentId: string, body: string) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.commentThreads.status !== "loaded") return;

    const prevThreads = tab.commentThreads.threads;

    // Optimistic update
    const optimisticThreads = prevThreads.map((t) => ({
      ...t,
      comments: t.comments.map((c) =>
        c.id === commentId ? { ...c, body } : c
      ),
    }));
    updateActiveTab((t) => ({
      ...t,
      commentThreads: { status: "loaded" as const, threads: optimisticThreads },
    }));

    try {
      const updated = await invoke<ReviewComment>("update_review_comment", {
        commentId,
        body,
      });

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId || t.commentThreads.status !== "loaded") return t;
          return {
            ...t,
            commentThreads: {
              status: "loaded" as const,
              threads: t.commentThreads.threads.map((th) => ({
                ...th,
                comments: th.comments.map((c) =>
                  c.id === commentId ? updated : c
                ),
              })),
            },
          };
        })
      );
    } catch {
      updateActiveTab((t) => ({
        ...t,
        commentThreads: { status: "loaded" as const, threads: prevThreads },
      }));
    }
  }

  async function handleSubmitReview(event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body: string) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    try {
      await invoke<string>("submit_review", {
        prUrl: tab.manifest.pr_url,
        event,
        body,
      });
      // Re-fetch threads to update resolved states
      if (tab.commentThreads.status === "loaded") {
        const threads = await invoke<ReviewThread[]>("fetch_review_comments", {
          prUrl: tab.manifest.pr_url,
        });
        updateActiveTab((t) => ({
          ...t,
          commentThreads: { status: "loaded" as const, threads },
        }));
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCreateComment(path: string, endLine: number, side: "LEFT" | "RIGHT", body: string, startLine?: number, startSide?: "LEFT" | "RIGHT") {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    try {
      const newThread = await invoke<ReviewThread>("create_review_comment", {
        prUrl: tab.manifest.pr_url,
        body,
        path,
        line: endLine,
        side,
        startLine: startLine ?? null,
        startSide: startSide ?? null,
      });

      // Add the new thread to the comment threads state
      updateActiveTab((t) => {
        if (t.commentThreads.status === "loaded") {
          return {
            ...t,
            commentThreads: {
              status: "loaded",
              threads: [...t.commentThreads.threads, newThread],
            },
          };
        }
        return {
          ...t,
          commentThreads: { status: "loaded", threads: [newThread] },
        };
      });
    } catch (err) {
      setError(String(err));
    }
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
              <PrOpener onFetchStart={handleFetchStart} onSettingsClick={() => setSettingsOpen(true)} />
              <ReviewRequestList onSelectPr={handleFetchStart} />
            </>
          )}
          {tabs.length > 0 && !loading && (
            <button
              className="settings-button"
              onClick={() => setShowOpener(false)}
              style={{ marginTop: 16 }}
            >
              Cancel
            </button>
          )}
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
        showHunkSignificance={showHunkSignificance}
        onToggleHunkSignificance={() => setShowHunkSignificance((v) => !v)}
        showAiNotes={showAiNotes}
        onToggleAiNotes={() => setShowAiNotes((v) => !v)}
        commentThreads={activeTab?.commentThreads}
        onSubmitReview={activeTab ? handleSubmitReview : undefined}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      {activeTab && (
        <>
        <SearchBar
          files={activeTab.manifest.files}
          selectedFile={activeTab.selectedFile}
          onSelectFile={setSelectedFile}
          onHighlightMatches={(matches, idx, q) => { setSearchMatches(matches); setSearchCurrentIndex(idx); setSearchQuery(q); }}
          onClearHighlights={() => { setSearchMatches([]); setSearchCurrentIndex(0); setSearchQuery(""); }}
        />
        <div className="main-content">
          <FileSidebar
            files={activeTab.manifest.files}
            changeGroups={activeTab.manifest.change_groups ?? []}
            selectedFile={activeTab.selectedFile}
            onSelectFile={setSelectedFile}
            viewedFiles={activeTab.viewedFiles}
            onToggleViewed={toggleViewed}
            showHunkSignificance={showHunkSignificance}
            hunkFilter={hunkFilter}
            onHunkFilterChange={setHunkFilter}
            sidebarView={activeTab.sidebarView}
            onViewChange={handleViewChange}
            commentThreads={activeTab.commentThreads.status === "loaded" ? activeTab.commentThreads.threads : []}
            selectedCommentFile={activeTab.selectedCommentFile}
            onSelectCommentFile={handleSelectCommentFile}
          />
          <div className="diff-pane">
            {activeTab.sidebarView === "comments" ? (
              activeTab.commentThreads.status === "loading" ? (
                <div className="no-file-selected">Loading review threads...</div>
              ) : activeTab.commentThreads.status === "error" ? (
                <div className="no-file-selected" style={{ color: "var(--diff-remove-text)" }}>
                  {activeTab.commentThreads.message}
                </div>
              ) : activeTab.commentThreads.status === "loaded" ? (
                <CommentsViewer
                  threads={activeTab.commentThreads.threads}
                  selectedFile={activeTab.selectedCommentFile}
                  onReply={handleReply}
                  onToggleResolved={handleToggleResolved}
                  onEditComment={handleEditComment}
                  lang={activeTab.selectedCommentFile ? detectLanguage(activeTab.selectedCommentFile) : undefined}
                />
              ) : (
                <div className="no-file-selected">Switch to Comments tab to load threads</div>
              )
            ) : activeTab.selectedFile ? (
              <DiffViewer key={activeTab.selectedFile.path} file={activeTab.selectedFile} viewMode={viewMode} showHunkSignificance={showHunkSignificance} showAiNotes={showAiNotes} onCreateComment={handleCreateComment} onEditComment={handleEditComment} reviewThreads={activeTab.commentThreads.status === "loaded" ? activeTab.commentThreads.threads : undefined} searchMatches={fileSearchMatches} currentSearchMatch={currentSearchMatch} searchQuery={searchQuery} />
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
        </>
      )}
    </div>
  );
}

export default App;
