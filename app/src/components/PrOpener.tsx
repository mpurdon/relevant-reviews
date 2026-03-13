import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ReviewManifest } from "../types";

interface PrOpenerProps {
  onManifestLoaded: (manifest: ReviewManifest) => void;
}

export function PrOpener({ onManifestLoaded }: PrOpenerProps) {
  const [prRef, setPrRef] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prRef.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const manifest = await invoke<ReviewManifest>("fetch_pr", {
        prRef: prRef.trim(),
      });
      onManifestLoaded(manifest);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pr-opener">
      <div className="pr-opener-divider">
        <span>or open a PR directly</span>
      </div>
      <form className="pr-opener-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="pr-opener-input"
          value={prRef}
          onChange={(e) => setPrRef(e.target.value)}
          placeholder="PR URL or owner/repo#123 or just #123"
          disabled={loading}
        />
        <button
          type="submit"
          className="pr-opener-button"
          disabled={loading || !prRef.trim()}
        >
          {loading ? "Fetching..." : "Open PR"}
        </button>
      </form>
      {error && <div className="pr-opener-error">{error}</div>}
    </div>
  );
}
