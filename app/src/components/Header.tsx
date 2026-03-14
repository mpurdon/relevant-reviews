import { open } from "@tauri-apps/plugin-shell";
import type { ReviewManifest, DiffViewMode, Tab } from "../types";

interface HeaderProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewReview: () => void;
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
  viewedCount: number;
  onSettingsClick: () => void;
  manifest: ReviewManifest | null;
}

export function Header({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewReview,
  viewMode,
  onViewModeChange,
  viewedCount,
  onSettingsClick,
  manifest,
}: HeaderProps) {
  const totalCount = manifest?.files.length ?? 0;
  const progress = totalCount > 0 ? (viewedCount / totalCount) * 100 : 0;

  return (
    <header className="header">
      <div className="tab-bar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? "tab-active" : ""}`}
            onClick={() => onSelectTab(tab.id)}
          >
            <span className="tab-label">
              <span className="tab-pr-number">#{tab.manifest.pr_number}</span>
              <span className="tab-title">{tab.manifest.pr_title}</span>
            </span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              title="Close tab"
            >
              &times;
            </button>
          </div>
        ))}
        <button className="tab-new" onClick={onNewReview} title="Open a new PR">
          +
        </button>
      </div>
      {manifest && (
        <div className="header-toolbar">
          <div className="header-left">
            <span className="file-count">
              {viewedCount}/{totalCount} reviewed
            </span>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="header-right">
            <div className="view-toggle">
              <button
                className={viewMode === "split" ? "active" : ""}
                onClick={() => onViewModeChange("split")}
              >
                Split
              </button>
              <button
                className={viewMode === "unified" ? "active" : ""}
                onClick={() => onViewModeChange("unified")}
              >
                Unified
              </button>
            </div>
            <a
              className="github-link"
              href={manifest.pr_url}
              onClick={(e) => {
                e.preventDefault();
                open(manifest.pr_url);
              }}
            >
              View on GitHub
            </a>
            <button className="settings-button" onClick={onSettingsClick}>
              Settings
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
