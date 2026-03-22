import { useState } from "react";
import { useSuppression, useAddSuppression, useDeleteSuppression } from "../../hooks/useSettings";

export default function SuppressionTab() {
  const { data, isLoading } = useSuppression();
  const addEntry = useAddSuppression();
  const deleteEntry = useDeleteSuppression();

  const [value, setValue] = useState("");
  const [sourceType, setSourceType] = useState("email");

  const entries = data?.entries ?? [];

  const handleAdd = (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    addEntry.mutate(
      { value: value.trim(), source_type: sourceType },
      { onSuccess: () => setValue("") }
    );
  };

  const handleDelete = (hash) => {
    if (window.confirm("Retirer cette entree de la liste de suppression ?")) {
      deleteEntry.mutate(hash);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">
        Liste de suppression RGPD ({entries.length} entrees)
      </h2>

      {/* Add form */}
      <form onSubmit={handleAdd} className="bg-white rounded-lg shadow p-4 mb-4 flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Email ou URL LinkedIn</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="exemple@email.com ou https://linkedin.com/in/..."
            className="w-full rounded border-gray-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            className="rounded border-gray-300 text-sm"
          >
            <option value="email">Email</option>
            <option value="linkedin">LinkedIn</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={addEntry.isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          Ajouter
        </button>
      </form>

      <p className="text-xs text-gray-400 mb-4">
        Les valeurs sont hashees SHA-256 pour la conformite RGPD
      </p>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Valeur hashee</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                  Aucune entree dans la liste de suppression
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.hashed_value || entry.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">
                    {(entry.hashed_value || "").slice(0, 12)}...
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {entry.source_type || "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(entry.hashed_value)}
                      className="text-sm text-red-600 hover:text-red-800"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
