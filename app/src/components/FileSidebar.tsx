import { useMemo } from "react";
import type { FileDiff, RiskLevel } from "../types";

interface FileSidebarProps {
  files: FileDiff[];
  selectedFile: FileDiff | null;
  onSelectFile: (file: FileDiff) => void;
  viewedFiles: Set<string>;
  onToggleViewed: (filePath: string) => void;
}

function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

function getDiffTypeIcon(diffType: string): string {
  switch (diffType) {
    case "added":
      return "A";
    case "removed":
      return "D";
    case "modified":
      return "M";
    default:
      return "?";
  }
}

function getDiffTypeClass(diffType: string): string {
  switch (diffType) {
    case "added":
      return "diff-type-added";
    case "removed":
      return "diff-type-removed";
    case "modified":
      return "diff-type-modified";
    default:
      return "";
  }
}

function getRiskLabel(level: RiskLevel): string {
  switch (level) {
    case "critical":
      return "CRIT";
    case "high":
      return "HIGH";
    case "medium":
      return "MED";
    case "low":
      return "LOW";
  }
}

interface GroupedFiles {
  [category: string]: FileDiff[];
}

const riskOrder: Record<RiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function FileSidebar({
  files,
  selectedFile,
  onSelectFile,
  viewedFiles,
  onToggleViewed,
}: FileSidebarProps) {
  const grouped = useMemo(() => {
    const groups: GroupedFiles = {};
    for (const file of files) {
      const cat = file.category || "Other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(file);
    }
    // Sort files within each group by risk level
    for (const cat of Object.keys(groups)) {
      groups[cat].sort(
        (a, b) =>
          (riskOrder[a.risk_level] ?? 2) - (riskOrder[b.risk_level] ?? 2)
      );
    }
    return groups;
  }, [files]);

  const categoryOrder = [
    "Business Logic",
    "Infrastructure",
    "Domain Types",
    "Other",
  ];
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    const ai = categoryOrder.indexOf(a);
    const bi = categoryOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const viewedCount = viewedFiles.size;
  const totalCount = files.length;

  return (
    <aside className="file-sidebar">
      <div className="sidebar-header">
        <span>
          Files ({viewedCount}/{totalCount} viewed)
        </span>
      </div>
      <nav className="file-list">
        {sortedCategories.map((category) => (
          <div key={category} className="file-group">
            <div className="group-header">{category}</div>
            {grouped[category].map((file) => {
              const isViewed = viewedFiles.has(file.path);
              const isCritical =
                file.risk_level === "critical" || file.risk_level === "high";
              return (
                <div
                  key={file.path}
                  className={`file-item-wrapper ${isCritical ? "file-critical" : ""}`}
                >
                  <button
                    className={`file-item ${selectedFile?.path === file.path ? "selected" : ""} ${isViewed ? "viewed" : ""}`}
                    onClick={() => onSelectFile(file)}
                    title={file.path}
                  >
                    <span
                      className="viewed-checkbox"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isViewed}
                        onChange={() => onToggleViewed(file.path)}
                      />
                    </span>
                    <span
                      className={`diff-type-badge ${getDiffTypeClass(file.diff_type)}`}
                    >
                      {getDiffTypeIcon(file.diff_type)}
                    </span>
                    <span className="file-name">{getFileName(file.path)}</span>
                    <span
                      className={`risk-badge risk-${file.risk_level}`}
                    >
                      {getRiskLabel(file.risk_level)}
                    </span>
                    {file.highlights?.length > 0 && (
                      <span className="file-highlight-count" title={`${file.highlights.length} AI note${file.highlights.length === 1 ? "" : "s"}`}>
                        {file.highlights.length}
                      </span>
                    )}
                    <span className="file-path-hint">
                      {file.path.split("/").slice(-2, -1)[0] || ""}
                    </span>
                  </button>
                  <div className="file-summary">{file.reason}</div>
                </div>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
