import { Fragment, useMemo, useState } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import type { FileDiff, DiffViewMode, Highlight } from "../types";

const extToLang: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp",
  css: "css", scss: "scss", less: "less", html: "xml", htm: "xml",
  xml: "xml", svg: "xml", vue: "xml", json: "json", yaml: "yaml",
  yml: "yaml", toml: "ini", md: "markdown", sql: "sql", sh: "bash",
  bash: "bash", zsh: "bash", dockerfile: "dockerfile",
  tf: "hcl", hcl: "hcl", graphql: "graphql", gql: "graphql",
};

function detectLanguage(filePath: string): string | undefined {
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  const ext = name.split(".").pop() ?? "";
  return extToLang[ext];
}

function highlightLines(content: string, lang: string | undefined): string[] {
  if (!content) return [];
  let html: string;
  if (lang) {
    try {
      html = hljs.highlight(content, { language: lang }).value;
    } catch {
      html = escapeHtml(content);
    }
  } else {
    html = escapeHtml(content);
  }
  return splitHtmlByLines(html);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitHtmlByLines(html: string): string[] {
  // highlight.js uses \n for line breaks inside its HTML output.
  // We need to split while keeping open <span> tags balanced across lines.
  const lines: string[] = [];
  let current = "";
  const openSpans: string[] = []; // stack of full <span ...> tags

  let i = 0;
  while (i < html.length) {
    if (html[i] === "\n") {
      lines.push(current + openSpans.map(() => "</span>").join(""));
      current = openSpans.join("");
      i++;
    } else if (html[i] === "<") {
      const closeEnd = html.indexOf(">", i);
      if (closeEnd === -1) {
        current += html[i];
        i++;
        continue;
      }
      const tag = html.slice(i, closeEnd + 1);
      if (tag.startsWith("</span>")) {
        openSpans.pop();
        current += tag;
        i = closeEnd + 1;
      } else if (tag.startsWith("<span")) {
        openSpans.push(tag);
        current += tag;
        i = closeEnd + 1;
      } else {
        current += tag;
        i = closeEnd + 1;
      }
    } else {
      current += html[i];
      i++;
    }
  }
  lines.push(current + openSpans.map(() => "</span>").join(""));
  return lines;
}

interface DiffViewerProps {
  file: FileDiff;
  viewMode: DiffViewMode;
  showHunkSignificance: boolean;
  showAiNotes: boolean;
}

interface DiffLine {
  type: "context" | "add" | "remove" | "header";
  content: string;
  html: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

function parseDiffLines(unifiedDiff: string, lang: string | undefined): DiffLine[] {
  const rawLines = unifiedDiff.split("\n");

  // First pass: extract old-side and new-side source lines for highlighting
  const oldSrc: string[] = [];
  const newSrc: string[] = [];
  const entries: { type: DiffLine["type"]; content: string; oldIdx: number | null; newIdx: number | null; oldLineNum: number | null; newLineNum: number | null }[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of rawLines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      entries.push({ type: "header", content: line, oldIdx: null, newIdx: null, oldLineNum: null, newLineNum: null });
    } else if (line.startsWith("+")) {
      const content = line.slice(1);
      entries.push({ type: "add", content, oldIdx: null, newIdx: newSrc.length, oldLineNum: null, newLineNum: newLine });
      newSrc.push(content);
      newLine++;
    } else if (line.startsWith("-")) {
      const content = line.slice(1);
      entries.push({ type: "remove", content, oldIdx: oldSrc.length, newIdx: null, oldLineNum: oldLine, newLineNum: null });
      oldSrc.push(content);
      oldLine++;
    } else if (line.startsWith("\\")) {
      // skip
    } else {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      entries.push({ type: "context", content, oldIdx: oldSrc.length, newIdx: newSrc.length, oldLineNum: oldLine, newLineNum: newLine });
      oldSrc.push(content);
      newSrc.push(content);
      oldLine++;
      newLine++;
    }
  }

  // Highlight both sides
  const oldHtml = highlightLines(oldSrc.join("\n"), lang);
  const newHtml = highlightLines(newSrc.join("\n"), lang);

  // Map highlighted HTML back to diff lines
  return entries.map((e) => {
    let html: string;
    if (e.type === "header") {
      html = escapeHtml(e.content);
    } else if (e.type === "add") {
      html = e.newIdx !== null ? (newHtml[e.newIdx] ?? escapeHtml(e.content)) : escapeHtml(e.content);
    } else if (e.type === "remove") {
      html = e.oldIdx !== null ? (oldHtml[e.oldIdx] ?? escapeHtml(e.content)) : escapeHtml(e.content);
    } else {
      // context — use new side
      html = e.newIdx !== null ? (newHtml[e.newIdx] ?? escapeHtml(e.content)) : escapeHtml(e.content);
    }
    return { type: e.type, content: e.content, html, oldLineNum: e.oldLineNum, newLineNum: e.newLineNum };
  });
}

interface SplitLine {
  left: DiffLine | null;
  right: DiffLine | null;
}

function buildSplitLines(diffLines: DiffLine[]): SplitLine[] {
  const result: SplitLine[] = [];
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];

    if (line.type === "header") {
      result.push({ left: line, right: line });
      i++;
      continue;
    }

    if (line.type === "context") {
      result.push({ left: line, right: line });
      i++;
      continue;
    }

    // Collect consecutive removes and adds for pairing
    if (line.type === "remove") {
      const removes: DiffLine[] = [];
      while (i < diffLines.length && diffLines[i].type === "remove") {
        removes.push(diffLines[i]);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i < diffLines.length && diffLines[i].type === "add") {
        adds.push(diffLines[i]);
        i++;
      }

      const maxLen = Math.max(removes.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        result.push({
          left: j < removes.length ? removes[j] : null,
          right: j < adds.length ? adds[j] : null,
        });
      }
      continue;
    }

    if (line.type === "add") {
      result.push({ left: null, right: line });
      i++;
      continue;
    }

    i++;
  }

  return result;
}

function buildFullFileLines(content: string, type: "add" | "remove", lang: string | undefined): DiffLine[] {
  if (!content) return [];
  const lines = content.split("\n");
  const htmlLines = highlightLines(content, lang);
  return lines.map((line, idx) => ({
    type,
    content: line,
    html: htmlLines[idx] ?? escapeHtml(line),
    oldLineNum: type === "remove" ? idx + 1 : null,
    newLineNum: type === "add" ? idx + 1 : null,
  }));
}

const LINE_TINT_THRESHOLD = 50;

function getHighlightForLine(
  lineNum: number | null,
  highlights: Highlight[]
): Highlight | undefined {
  if (lineNum === null || highlights.length === 0) return undefined;
  return highlights.find(
    (h) =>
      lineNum >= h.start_line &&
      lineNum <= h.end_line &&
      h.end_line - h.start_line + 1 <= LINE_TINT_THRESHOLD
  );
}

function isHighlightStart(
  lineNum: number | null,
  highlights: Highlight[]
): Highlight | undefined {
  if (lineNum === null || highlights.length === 0) return undefined;
  return highlights.find((h) => lineNum === h.start_line);
}

function formatLineRange(start: number, end: number): string {
  return `L${start}${end !== start ? `\u2013${end}` : ""}`;
}

const severityIcon: Record<string, string> = {
  critical: "!!",
  warning: "!",
  info: "i",
};

function HighlightMarker({ highlight }: { highlight: Highlight }) {
  return (
    <div className={`highlight-marker highlight-${highlight.severity}`}>
      <span className="highlight-icon">
        {severityIcon[highlight.severity] || "i"}
      </span>
      <span className="highlight-lines">{formatLineRange(highlight.start_line, highlight.end_line)}</span>
      <span className="highlight-comment">{highlight.comment}</span>
    </div>
  );
}

// ── Hunk grouping ────────────────────────────────────────────────────────

interface Hunk {
  index: number;
  headerLine: DiffLine | null;
  lines: DiffLine[];
  significance: string;
  lineCount: number;
}

function groupIntoHunks(
  diffLines: DiffLine[],
  hunkScores: string[]
): Hunk[] {
  const hunks: Hunk[] = [];
  let currentLines: DiffLine[] = [];
  let currentHeader: DiffLine | null = null;
  let hunkIdx = -1;

  for (const line of diffLines) {
    if (line.type === "header") {
      // Save previous hunk
      if (hunkIdx >= 0 || currentLines.length > 0) {
        hunks.push({
          index: Math.max(hunkIdx, 0),
          headerLine: currentHeader,
          lines: currentLines,
          significance: hunkScores[Math.max(hunkIdx, 0)] ?? "medium",
          lineCount: currentLines.length,
        });
      }
      hunkIdx++;
      currentHeader = line;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Save last hunk
  if (currentLines.length > 0 || currentHeader) {
    hunks.push({
      index: Math.max(hunkIdx, 0),
      headerLine: currentHeader,
      lines: currentLines,
      significance: hunkScores[Math.max(hunkIdx, 0)] ?? "medium",
      lineCount: currentLines.length,
    });
  }

  return hunks;
}

// ── Unified hunk rendering ───────────────────────────────────────────────

function UnifiedHunkLines({ lines, highlights }: { lines: DiffLine[]; highlights: Highlight[] }) {
  return (
    <>
      {lines.map((line, idx) => {
        const lineNum = line.newLineNum ?? line.oldLineNum;
        const hl = getHighlightForLine(lineNum, highlights);
        const hlStart = isHighlightStart(lineNum, highlights);
        return (
          <Fragment key={idx}>
            {hlStart && (
              <tr className="highlight-row">
                <td colSpan={4}>
                  <HighlightMarker highlight={hlStart} />
                </td>
              </tr>
            )}
            <tr
              className={`diff-line diff-line-${line.type}${hl ? ` highlighted highlighted-${hl.severity}` : ""}`}
            >
              <td className="line-num">{line.oldLineNum ?? ""}</td>
              <td className="line-num">{line.newLineNum ?? ""}</td>
              <td className="line-prefix">
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : line.type === "header" ? "@@" : " "}
              </td>
              <td className="line-content">
                <pre dangerouslySetInnerHTML={{ __html: line.html }} />
              </td>
            </tr>
          </Fragment>
        );
      })}
    </>
  );
}

function UnifiedView({
  hunks,
  highlights,
  collapsedHunks,
  onToggleHunk,
  showSignificance,
}: {
  hunks: Hunk[];
  highlights: Highlight[];
  collapsedHunks: Set<number>;
  onToggleHunk: (index: number) => void;
  showSignificance: boolean;
}) {
  return (
    <table className="diff-table unified">
      <colgroup>
        <col style={{ width: 50 }} />
        <col style={{ width: 50 }} />
        <col style={{ width: 20 }} />
        <col />
      </colgroup>
      <tbody>
        {hunks.map((hunk) => {
          const isLow = showSignificance && hunk.significance === "low";
          const isHigh = showSignificance && hunk.significance === "high";
          const isCollapsed = collapsedHunks.has(hunk.index);
          const isDimmed = isLow && !isCollapsed;

          return (
            <Fragment key={hunk.index}>
              {showSignificance && hunk.headerLine && (
                <tr
                  className={`diff-line diff-line-header${isHigh ? " hunk-header-high" : ""} hunk-header-clickable`}
                  onClick={() => onToggleHunk(hunk.index)}
                >
                  <td className="line-num"></td>
                  <td className="line-num"></td>
                  <td className="line-prefix">@@</td>
                  <td className="line-content">
                    <pre dangerouslySetInnerHTML={{ __html: escapeHtml(hunk.headerLine.content) }} />
                    {isHigh && <span className="hunk-significance-badge hunk-badge-high">HIGH</span>}
                    {isCollapsed && <span className="hunk-collapsed-indicator">{hunk.lineCount} lines</span>}
                  </td>
                </tr>
              )}
              {isCollapsed ? (
                !hunk.headerLine && (
                  <tr
                    className="hunk-collapsed"
                    onClick={() => onToggleHunk(hunk.index)}
                  >
                    <td colSpan={4}>
                      <span className="hunk-collapsed-chevron">&#9654;</span>
                      {hunk.lineCount} lines collapsed (click to expand)
                    </td>
                  </tr>
                )
              ) : isDimmed ? (
                <tr className="hunk-low-significance">
                  <td colSpan={4} style={{ padding: 0 }}>
                    <table className="diff-table unified hunk-low-significance-inner">
                      <colgroup>
                        <col style={{ width: 50 }} />
                        <col style={{ width: 50 }} />
                        <col style={{ width: 20 }} />
                        <col />
                      </colgroup>
                      <tbody>
                        <UnifiedHunkLines lines={hunk.lines} highlights={highlights} />
                      </tbody>
                    </table>
                  </td>
                </tr>
              ) : (
                <UnifiedHunkLines lines={hunk.lines} highlights={highlights} />
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Split hunk rendering ─────────────────────────────────────────────────

function SplitHunkLines({ splitLines, highlights }: { splitLines: SplitLine[]; highlights: Highlight[] }) {
  return (
    <>
      {splitLines.map((pair, idx) => {
        const rightLineNum = pair.right?.newLineNum ?? pair.right?.oldLineNum;
        const hl = getHighlightForLine(rightLineNum ?? null, highlights);
        const hlStart = isHighlightStart(rightLineNum ?? null, highlights);
        return (
          <Fragment key={idx}>
            {hlStart && (
              <tr className="highlight-row">
                <td colSpan={4}>
                  <HighlightMarker highlight={hlStart} />
                </td>
              </tr>
            )}
            <tr
              className={`diff-split-row${hl ? ` highlighted highlighted-${hl.severity}` : ""}`}
            >
              {/* Left side (base/old) */}
              <td className="line-num left-num">
                {pair.left?.oldLineNum ?? pair.left?.newLineNum ?? ""}
              </td>
              <td
                className={`line-content left-content ${pair.left ? `diff-line-${pair.left.type}` : "empty-line"}`}
              >
                <pre
                  dangerouslySetInnerHTML={{
                    __html: pair.left?.html ?? "",
                  }}
                />
              </td>
              {/* Right side (head/new) */}
              <td className="line-num right-num">
                {pair.right?.newLineNum ?? pair.right?.oldLineNum ?? ""}
              </td>
              <td
                className={`line-content right-content ${pair.right ? `diff-line-${pair.right.type}` : "empty-line"}`}
              >
                <pre
                  dangerouslySetInnerHTML={{
                    __html: pair.right?.html ?? "",
                  }}
                />
              </td>
            </tr>
          </Fragment>
        );
      })}
    </>
  );
}

function SplitView({
  hunks,
  highlights,
  collapsedHunks,
  onToggleHunk,
  showSignificance,
}: {
  hunks: Hunk[];
  highlights: Highlight[];
  collapsedHunks: Set<number>;
  onToggleHunk: (index: number) => void;
  showSignificance: boolean;
}) {
  return (
    <table className="diff-table split">
      <colgroup>
        <col style={{ width: 50 }} />
        <col />
        <col style={{ width: 50 }} />
        <col />
      </colgroup>
      <tbody>
        {hunks.map((hunk) => {
          const isLow = showSignificance && hunk.significance === "low";
          const isHigh = showSignificance && hunk.significance === "high";
          const isCollapsed = collapsedHunks.has(hunk.index);
          const isDimmed = isLow && !isCollapsed;
          const splitLines = isCollapsed ? [] : buildSplitLines(hunk.lines);

          return (
            <Fragment key={hunk.index}>
              {showSignificance && hunk.headerLine && (
                <tr
                  className={`diff-split-row diff-line-header${isHigh ? " hunk-header-high" : ""} hunk-header-clickable`}
                  onClick={() => onToggleHunk(hunk.index)}
                >
                  <td className="line-num left-num"></td>
                  <td className="line-content left-content diff-line-header">
                    <pre dangerouslySetInnerHTML={{ __html: escapeHtml(hunk.headerLine.content) }} />
                  </td>
                  <td className="line-num right-num"></td>
                  <td className="line-content right-content diff-line-header">
                    <pre dangerouslySetInnerHTML={{ __html: escapeHtml(hunk.headerLine.content) }} />
                    {isHigh && <span className="hunk-significance-badge hunk-badge-high">HIGH</span>}
                    {isCollapsed && <span className="hunk-collapsed-indicator">{hunk.lineCount} lines</span>}
                  </td>
                </tr>
              )}
              {isCollapsed ? (
                !hunk.headerLine && (
                  <tr
                    className="hunk-collapsed"
                    onClick={() => onToggleHunk(hunk.index)}
                  >
                    <td colSpan={4}>
                      <span className="hunk-collapsed-chevron">&#9654;</span>
                      {hunk.lineCount} lines collapsed (click to expand)
                    </td>
                  </tr>
                )
              ) : isDimmed ? (
                <tr className="hunk-low-significance">
                  <td colSpan={4} style={{ padding: 0 }}>
                    <table className="diff-table split hunk-low-significance-inner">
                      <colgroup>
                        <col style={{ width: 50 }} />
                        <col />
                        <col style={{ width: 50 }} />
                        <col />
                      </colgroup>
                      <tbody>
                        <SplitHunkLines splitLines={splitLines} highlights={highlights} />
                      </tbody>
                    </table>
                  </td>
                </tr>
              ) : (
                <SplitHunkLines splitLines={splitLines} highlights={highlights} />
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Main DiffViewer ──────────────────────────────────────────────────────

export function DiffViewer({ file, viewMode, showHunkSignificance, showAiNotes }: DiffViewerProps) {
  const { hunks, diffLines, useHunkView } = useMemo(() => {
    const lang = detectLanguage(file.path);
    const hunkScores = file.hunk_scores ?? [];
    const hasUnifiedDiff = file.unified_diff && file.unified_diff.length > 0;

    // Use hunk-based view when we have scores and a parseable unified diff
    if (hasUnifiedDiff && hunkScores.length > 0) {
      const lines = parseDiffLines(file.unified_diff, lang);
      return {
        hunks: groupIntoHunks(lines, hunkScores),
        diffLines: lines,
        useHunkView: true,
      };
    }

    // Fallback: flat rendering (no hunk scores available)
    let lines: DiffLine[];
    if (file.diff_type === "added") {
      lines = buildFullFileLines(file.head_content, "add", lang);
    } else if (file.diff_type === "removed") {
      lines = buildFullFileLines(file.base_content, "remove", lang);
    } else {
      lines = parseDiffLines(file.unified_diff, lang);
      // Even without scores from AI, group into hunks for consistent rendering
      return {
        hunks: groupIntoHunks(lines, []),
        diffLines: lines,
        useHunkView: true,
      };
    }

    return {
      hunks: [],
      diffLines: lines,
      useHunkView: false,
    };
  }, [file]);

  // Low hunks start collapsed when significance is shown; state resets on file change
  // via the key prop on DiffViewer (see App.tsx)
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(() => {
    if (!showHunkSignificance || hunks.length <= 1) return new Set<number>();
    return new Set(
      hunks.filter((h) => h.significance === "low").map((h) => h.index)
    );
  });

  const toggleHunk = (index: number) => {
    setCollapsedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const highlights = showAiNotes ? (file.highlights ?? []) : [];
  const isCritical =
    file.risk_level === "critical" || file.risk_level === "high";

  const highHunkCount = hunks.filter((h) => h.significance === "high").length;
  const collapsedCount = collapsedHunks.size;

  const collapseAllLow = () => {
    setCollapsedHunks(new Set(
      hunks.filter((h) => h.significance === "low").map((h) => h.index)
    ));
  };

  const expandAll = () => {
    setCollapsedHunks(new Set());
  };

  return (
    <div className={`diff-viewer ${isCritical ? "diff-viewer-critical" : ""}`}>
      <div className="diff-header">
        <span className={`diff-badge diff-badge-${file.diff_type}`}>
          {file.diff_type.toUpperCase()}
        </span>
        <span className={`risk-badge risk-${file.risk_level}`}>
          {file.risk_level.toUpperCase()}
        </span>
        <span className="diff-file-path">{file.path}</span>
        <span className="diff-reason">{file.reason}</span>
        {highlights.length > 0 && (
          <span className="highlight-count">
            {highlights.length} AI {highlights.length === 1 ? "note" : "notes"}
          </span>
        )}
        {showHunkSignificance && highHunkCount > 0 && (
          <span className="hunk-high-summary">
            {highHunkCount} high-significance {highHunkCount === 1 ? "hunk" : "hunks"}
          </span>
        )}
        {collapsedCount > 0 && (
          <>
            <span className="hunk-collapse-summary">
              {collapsedCount} {collapsedCount === 1 ? "hunk" : "hunks"} collapsed
            </span>
            <button className="hunk-toggle-all" onClick={expandAll}>
              Expand all
            </button>
          </>
        )}
        {showHunkSignificance && collapsedCount === 0 && hunks.length > 1 && hunks.some((h) => h.significance === "low") && (
          <button className="hunk-toggle-all" onClick={collapseAllLow}>
            Collapse low
          </button>
        )}
      </div>
      {highlights.length > 0 && (
        <div className="highlights-summary">
          {highlights.map((h, i) => (
            <div key={i} className={`highlights-summary-item highlight-${h.severity}`}>
              <span className="highlight-severity-badge">{h.severity.toUpperCase()}</span>
              <span className="highlight-lines">{formatLineRange(h.start_line, h.end_line)}</span>
              <span className="highlight-summary-text">{h.comment}</span>
            </div>
          ))}
        </div>
      )}
      <div className="diff-content">
        {useHunkView ? (
          viewMode === "unified" || file.diff_type !== "modified" ? (
            <UnifiedView
              hunks={hunks}
              highlights={highlights}
              collapsedHunks={collapsedHunks}
              onToggleHunk={toggleHunk}
              showSignificance={showHunkSignificance}
            />
          ) : (
            <SplitView
              hunks={hunks}
              highlights={highlights}
              collapsedHunks={collapsedHunks}
              onToggleHunk={toggleHunk}
              showSignificance={showHunkSignificance}
            />
          )
        ) : (
          <table className="diff-table unified">
            <colgroup>
              <col style={{ width: 50 }} />
              <col style={{ width: 50 }} />
              <col style={{ width: 20 }} />
              <col />
            </colgroup>
            <tbody>
              <UnifiedHunkLines lines={diffLines} highlights={highlights} />
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
