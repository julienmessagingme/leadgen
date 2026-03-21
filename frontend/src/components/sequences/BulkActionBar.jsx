import { useState } from "react";
import ConfirmDialog from "../shared/ConfirmDialog";

export default function BulkActionBar({ count, onAction, onClear }) {
  const [showConfirm, setShowConfirm] = useState(false);

  if (count === 0) return null;

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            {count} lead(s) selectionne(s)
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onAction("pause")}
              className="px-3 py-1.5 text-sm font-medium text-yellow-700 bg-yellow-100 rounded-md hover:bg-yellow-200"
            >
              Mettre en pause
            </button>
            <button
              onClick={() => onAction("resume")}
              className="px-3 py-1.5 text-sm font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200"
            >
              Reprendre
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              className="px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200"
            >
              Exclure
            </button>

            <div className="w-px h-6 bg-gray-200 mx-1" />

            <button
              onClick={onClear}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Deselectionner
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showConfirm}
        title="Exclure les leads selectionnes ?"
        message={`Exclure ${count} lead(s) ? Cette action est irreversible.`}
        confirmLabel="Exclure"
        danger
        onConfirm={() => {
          onAction("exclude");
          setShowConfirm(false);
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
