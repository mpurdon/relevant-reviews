import type { ReviewManifest, DiffViewMode } from "../types";

interface HeaderProps {
  manifest: ReviewManifest;
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
  viewedCount: number;
  onSettingsClick: () => void;
}

export function Header({
  manifest,
  viewMode,
  onViewModeChange,
  viewedCount,
  onSettingsClick,
}: HeaderProps) {
  const totalCount = manifest.files.length;
  const progress = totalCount > 0 ? (viewedCount / totalCount) * 100 : 0;

  return (
    <header className="header">
      <div className="header-left">
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
          target="_blank"
          rel="noreferrer"
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
