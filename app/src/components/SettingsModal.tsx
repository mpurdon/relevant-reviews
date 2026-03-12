import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Settings {
  model: string;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      invoke<Settings>("get_settings").then((s) => {
        setModel(s.model);
      });
      setSaved(false);
    }
  }, [open]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await invoke("save_settings", { settings: { model: model.trim() } });
      setSaved(true);
      setTimeout(() => onClose(), 600);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <form onSubmit={handleSave}>
          <label className="settings-label" htmlFor="model-arn">
            Claude Model ARN
          </label>
          <p className="settings-hint">
            The Bedrock inference profile ARN used for AI classification.
          </p>
          <input
            id="model-arn"
            className="settings-input"
            type="text"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setSaved(false);
            }}
            placeholder="arn:aws:bedrock:us-east-2:123456:application-inference-profile/..."
            spellCheck={false}
          />
          <div className="settings-actions">
            <button
              type="button"
              className="settings-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="settings-save"
              disabled={saving || !model.trim()}
            >
              {saved ? "Saved" : saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
