import { useState } from "react";

interface PrOpenerProps {
  onFetchStart: (prRef: string) => void;
}

export function PrOpener({ onFetchStart }: PrOpenerProps) {
  const [prRef, setPrRef] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prRef.trim()) return;
    onFetchStart(prRef.trim());
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
        />
        <button
          type="submit"
          className="pr-opener-button"
          disabled={!prRef.trim()}
        >
          Open PR
        </button>
      </form>
    </div>
  );
}
