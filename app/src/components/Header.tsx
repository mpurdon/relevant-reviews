import { open } from "@tauri-apps/plugin-shell";
import type { ReviewManifest, DiffViewMode } from "../types";

interface HeaderProps {
  manifest: ReviewManifest;
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
  viewedCount: number;
  onSettingsClick: () => void;
  onNewReview: () => void;
}

export function Header({
  manifest,
  viewMode,
  onViewModeChange,
  viewedCount,
  onSettingsClick,
  onNewReview,
}: HeaderProps) {
  const totalCount = manifest.files.length;
  const progress = totalCount > 0 ? (viewedCount / totalCount) * 100 : 0;

  return (
    <header className="header">
      <div className="header-left">
        <button className="new-review-button" onClick={onNewReview} title="Open a different PR">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L4.56 7.25h7.69a.75.75 0 0 1 0 1.5H4.56l3.22 3.22a.75.75 0 0 1 0 1.06z" />
          </svg>
        </button>
        <span className="header-separator" />
        <span className="pr-number">#{manifest.pr_number}</span>
        <h1 className="pr-title">{manifest.pr_title}</h1>
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
    </header>
  );
}
