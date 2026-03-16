import type { FetchProgress } from "../types";

const STEP_LABELS = [
  "Fetching PR metadata",
  "Fetching files and diff",
  "Classifying files with AI",
  "Analyzing highlights, summary, and grouping",
  "Fetching file contents",
  "Building review manifest",
];

interface LoadingViewProps {
  prRef: string;
  prTitle: string | null;
  progress: FetchProgress | null;
  fileCounts: Record<number, { done: number; total: number }>;
  onCancel: () => void;
}

export function LoadingView({ prRef, prTitle, progress, fileCounts, onCancel }: LoadingViewProps) {
  const currentStep = progress?.step ?? 0;
  const currentStatus = progress?.status ?? "running";

  const completedSteps =
    currentStatus === "done" ? currentStep : currentStep - 1;
  const progressPercent = (completedSteps / 6) * 100;

  return (
    <div className="loading-view">
      {prTitle ? (
        <div className="loading-view-title">{prTitle}</div>
      ) : (
        <div className="loading-view-pr-ref">{prRef}</div>
      )}
      <div className="loading-view-body">
      <div className="loading-view-steps">
        {STEP_LABELS.map((label, i) => {
          const stepNum = i + 1;
          let status: "done" | "active" | "pending";
          if (stepNum < currentStep) {
            status = "done";
          } else if (stepNum === currentStep) {
            status = currentStatus === "done" ? "done" : "active";
          } else {
            status = "pending";
          }

          return (
            <div key={stepNum} className={`loading-view-step loading-view-step-${status}`}>
              <span className="loading-view-step-icon">
                {status === "done" && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M11.5 3.5L5.5 10L2.5 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                {status === "active" && <span className="loading-view-spinner" />}
                {status === "pending" && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                )}
              </span>
              <span className="loading-view-step-label">
                {label}
                {fileCounts[stepNum] && (
                  <span className="loading-view-file-count">
                    {" "}{fileCounts[stepNum].done}/{fileCounts[stepNum].total}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="loading-view-progress">
        <div
          className="loading-view-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <button className="settings-button" onClick={onCancel} style={{ marginTop: 16 }}>
        Cancel
      </button>
      </div>
    </div>
  );
}
