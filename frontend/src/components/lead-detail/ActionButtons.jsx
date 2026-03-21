import { useState } from "react";

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
    >
      {copied ? "Copie !" : label}
    </button>
  );
}

export default function ActionButtons({ lead, onAction, isLoading }) {
  const isPaused = lead.metadata?.is_paused;

  return (
    <div className="mt-6 pt-4 border-t border-gray-200">
      <div className="flex flex-wrap items-center gap-2">
        {/* Pause / Resume */}
        {isPaused ? (
          <button
            onClick={() => onAction("resume")}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200 disabled:opacity-50"
          >
            Reprendre
          </button>
        ) : (
          <button
            onClick={() => onAction("pause")}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm font-medium text-yellow-700 bg-yellow-100 rounded-md hover:bg-yellow-200 disabled:opacity-50"
          >
            Mettre en pause
          </button>
        )}

        {/* Exclude */}
        <button
          onClick={() => onAction("exclude")}
          disabled={isLoading}
          className="px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200 disabled:opacity-50"
        >
          Exclure (RGPD)
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-200 mx-1" />

        {/* Copy buttons */}
        {lead.email && <CopyButton value={lead.email} label="Copier email" />}
        {lead.linkedin_url && (
          <CopyButton value={lead.linkedin_url} label="Copier LinkedIn" />
        )}
      </div>
    </div>
  );
}
