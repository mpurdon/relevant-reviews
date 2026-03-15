import { useMemo, useState } from "react";
import type { FileDiff, RiskLevel } from "../types";

type SidebarView = "category" | "tree";

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

function sortByPathThenName(pathA: string, pathB: string): number {
  const dirA = pathA.substring(0, pathA.lastIndexOf("/"));
  const dirB = pathB.substring(0, pathB.lastIndexOf("/"));
  if (dirA !== dirB) return dirA.localeCompare(dirB);
  const nameA = pathA.substring(pathA.lastIndexOf("/") + 1);
  const nameB = pathB.substring(pathB.lastIndexOf("/") + 1);
  return nameA.localeCompare(nameB);
}

interface GroupedFiles {
  [category: string]: FileDiff[];
}

const NEEDS_ATTENTION = "Needs Attention";

const riskOrder: Record<RiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/* ─── File Tree types & helpers ─────────────────────────────────────────── */

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  file: FileDiff | null;
}

function buildFileTree(files: FileDiff[]): TreeNode {
  const root: TreeNode = { name: "", children: new Map(), file: null };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.children.has(parts[i])) {
        node.children.set(parts[i], {
          name: parts[i],
          children: new Map(),
          file: null,
        });
      }
      node = node.children.get(parts[i])!;
    }
    const fileName = parts[parts.length - 1];
    node.children.set(fileName, {
      name: fileName,
      children: new Map(),
      file,
    });
  }
  compressTree(root);
  return root;
}

function compressTree(node: TreeNode): void {
  const renames: [string, TreeNode][] = [];
  for (const [key, child] of node.children) {
    // Compress: if child is a dir with exactly one child that is also a dir, merge them
    while (
      child.file === null &&
      child.children.size === 1
    ) {
      const [, grandChild] = child.children.entries().next().value!;
      if (grandChild.file !== null) break; // don't merge into a file
      child.name = child.name + "/" + grandChild.name;
      child.children = grandChild.children;
    }
    if (child.name !== key) {
      renames.push([key, child]);
    }
    compressTree(child);
  }
  for (const [oldKey, child] of renames) {
    node.children.delete(oldKey);
    node.children.set(child.name, child);
  }
}

function sortedTreeEntries(node: TreeNode): TreeNode[] {
  const dirs: TreeNode[] = [];
  const fileNodes: TreeNode[] = [];
  for (const child of node.children.values()) {
    if (child.file) fileNodes.push(child);
    else dirs.push(child);
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  fileNodes.sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...fileNodes];
}

/* ─── Shared file item renderer ─────────────────────────────────────────── */

function FileItem({
  file,
  selectedFile,
  isViewed,
  onSelectFile,
  onToggleViewed,
  showPathHint,
}: {
  file: FileDiff;
  selectedFile: FileDiff | null;
  isViewed: boolean;
  onSelectFile: (f: FileDiff) => void;
  onToggleViewed: (path: string) => void;
  showPathHint?: boolean;
}) {
  const isCritical =
    file.risk_level === "critical" || file.risk_level === "high";
  return (
    <div className={`file-item-wrapper ${isCritical ? "file-critical" : ""}`}>
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
        <span className="line-stats">
          <span className="line-stat-add">+{file.additions}</span>
          <span className="line-stat-del">-{file.deletions}</span>
        </span>
        <span className={`risk-badge risk-${file.risk_level}`}>
          {getRiskLabel(file.risk_level)}
        </span>
        {file.highlights?.length > 0 && (
          <span
            className="file-highlight-count"
            title={`${file.highlights.length} AI note${file.highlights.length === 1 ? "" : "s"}`}
          >
            {file.highlights.length}
          </span>
        )}
        {showPathHint && (
          <span className="file-path-hint">
            {file.path.split("/").slice(-2, -1)[0] || ""}
          </span>
        )}
      </button>
      <div className="file-summary">{file.reason}</div>
    </div>
  );
}

/* ─── Tree node renderer ────────────────────────────────────────────────── */

function TreeFolder({
  node,
  depth,
  collapsed,
  toggleCollapsed,
  selectedFile,
  viewedFiles,
  onSelectFile,
  onToggleViewed,
}: {
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  toggleCollapsed: (key: string) => void;
  selectedFile: FileDiff | null;
  viewedFiles: Set<string>;
  onSelectFile: (f: FileDiff) => void;
  onToggleViewed: (path: string) => void;
}) {
  const children = sortedTreeEntries(node);
  return (
    <>
      {children.map((child) => {
        if (child.file) {
          return (
            <div key={child.file.path} style={{ paddingLeft: depth * 12 }}>
              <FileItem
                file={child.file}
                selectedFile={selectedFile}
                isViewed={viewedFiles.has(child.file.path)}
                onSelectFile={onSelectFile}
                onToggleViewed={onToggleViewed}
              />
            </div>
          );
        }
        const folderKey = `tree:${depth}:${child.name}`;
        const isCollapsed = collapsed.has(folderKey);
        return (
          <div key={folderKey} className="tree-folder">
            <button
              className="tree-folder-toggle"
              style={{ paddingLeft: 16 + depth * 12 }}
              onClick={() => toggleCollapsed(folderKey)}
            >
              <span
                className={`collapse-chevron ${isCollapsed ? "collapsed" : ""}`}
              >
                &#9662;
              </span>
              <span className="tree-folder-icon">&#128193;</span>
              <span className="tree-folder-name">{child.name}</span>
            </button>
            {!isCollapsed && (
              <TreeFolder
                node={child}
                depth={depth + 1}
                collapsed={collapsed}
                toggleCollapsed={toggleCollapsed}
                selectedFile={selectedFile}
                viewedFiles={viewedFiles}
                onSelectFile={onSelectFile}
                onToggleViewed={onToggleViewed}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/* ─── Main component ────────────────────────────────────────────────────── */

export function FileSidebar({
  files,
  selectedFile,
  onSelectFile,
  viewedFiles,
  onToggleViewed,
}: FileSidebarProps) {
  const [view, setView] = useState<SidebarView>("category");

  const criticalFiles = useMemo(() => {
    return files
      .filter((f) => f.risk_level === "critical" || f.risk_level === "high")
      .sort((a, b) => {
        const riskDiff =
          (riskOrder[a.risk_level] ?? 2) - (riskOrder[b.risk_level] ?? 2);
        if (riskDiff !== 0) return riskDiff;
        return sortByPathThenName(a.path, b.path);
      });
  }, [files]);

  const grouped = useMemo(() => {
    const groups: GroupedFiles = {};
    for (const file of files) {
      const cat = file.category || "Other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(file);
    }
    for (const cat of Object.keys(groups)) {
      groups[cat].sort(
        (a, b) =>
          (riskOrder[a.risk_level] ?? 2) - (riskOrder[b.risk_level] ?? 2)
      );
    }
    return groups;
  }, [files]);

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  const sortedCategories = useMemo(() => {
    const order = ["Business Logic", "Infrastructure", "Domain Types", "Other"];
    return Object.keys(grouped).sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [grouped]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set([NEEDS_ATTENTION]));
  const toggleCollapsed = (section: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const viewedCount = viewedFiles.size;
  const totalCount = files.length;

  return (
    <aside className="file-sidebar">
      <div className="sidebar-header">
        <span>
          Files ({viewedCount}/{totalCount} viewed)
        </span>
        <div className="sidebar-view-toggle">
          <button
            className={view === "category" ? "active" : ""}
            onClick={() => setView("category")}
            title="Group by category"
          >
            Category
          </button>
          <button
            className={view === "tree" ? "active" : ""}
            onClick={() => setView("tree")}
            title="File tree"
          >
            Tree
          </button>
        </div>
      </div>
      <nav className="file-list">
        {view === "category" ? (
          <>
            {criticalFiles.length > 0 && (
              <div className="file-group critical-group">
                <button
                  className="group-header group-toggle"
                  onClick={() => toggleCollapsed(NEEDS_ATTENTION)}
                >
                  <span className={`collapse-chevron ${collapsed.has(NEEDS_ATTENTION) ? "collapsed" : ""}`}>&#9662;</span>
                  {NEEDS_ATTENTION}
                  <span className="group-count">{criticalFiles.length}</span>
                </button>
                {!collapsed.has(NEEDS_ATTENTION) && criticalFiles.map((file) => (
                  <FileItem
                    key={file.path}
                    file={file}
                    selectedFile={selectedFile}
                    isViewed={viewedFiles.has(file.path)}
                    onSelectFile={onSelectFile}
                    onToggleViewed={onToggleViewed}
                    showPathHint
                  />
                ))}
              </div>
            )}
            {sortedCategories.map((category) => (
              <div key={category} className="file-group">
                <button
                  className="group-header group-toggle"
                  onClick={() => toggleCollapsed(category)}
                >
                  <span className={`collapse-chevron ${collapsed.has(category) ? "collapsed" : ""}`}>&#9662;</span>
                  {category}
                  <span className="group-count">{grouped[category].length}</span>
                </button>
                {!collapsed.has(category) && grouped[category].map((file) => (
                  <FileItem
                    key={file.path}
                    file={file}
                    selectedFile={selectedFile}
                    isViewed={viewedFiles.has(file.path)}
                    onSelectFile={onSelectFile}
                    onToggleViewed={onToggleViewed}
                    showPathHint
                  />
                ))}
              </div>
            ))}
          </>
        ) : (
          <div className="file-tree">
            <TreeFolder
              node={fileTree}
              depth={0}
              collapsed={collapsed}
              toggleCollapsed={toggleCollapsed}
              selectedFile={selectedFile}
              viewedFiles={viewedFiles}
              onSelectFile={onSelectFile}
              onToggleViewed={onToggleViewed}
            />
          </div>
        )}
      </nav>
    </aside>
  );
}
