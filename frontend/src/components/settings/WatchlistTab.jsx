import { useState } from "react";
import { useWatchlist, useCreateWatchlistEntry, useUpdateWatchlistEntry, useDeleteWatchlistEntry } from "../../hooks/useSettings";

const SOURCE_TYPES = [
  { value: "competitor_page", label: "Page concurrent" },
  { value: "influencer", label: "Influenceur" },
  { value: "keyword", label: "Mot-cle" },
  { value: "job_keyword", label: "Offre emploi" },
];

const typeLabel = (type) => SOURCE_TYPES.find((t) => t.value === type)?.label || type;

const emptyEntry = {
  source_type: "competitor_page",
  source_label: "",
  source_url: "",
  keywords: "",
  is_active: true,
  sequence_id: "",
};

export default function WatchlistTab() {
  const { data, isLoading } = useWatchlist();
  const createEntry = useCreateWatchlistEntry();
  const updateEntry = useUpdateWatchlistEntry();
  const deleteEntry = useDeleteWatchlistEntry();

  const [adding, setAdding] = useState(false);
  const [newEntry, setNewEntry] = useState({ ...emptyEntry });
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [filterType, setFilterType] = useState("all");
  const [search, setSearch] = useState("");

  const allEntries = data?.sources ?? [];
  const entries = allEntries.filter((e) => {
    if (filterType !== "all" && e.source_type !== filterType) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = [e.source_label, e.source_url, ...(Array.isArray(e.keywords) ? e.keywords : [e.keywords])].map((s) => (s || "").toLowerCase()).join(" ");
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const handleCreate = () => {
    const payload = {
      ...newEntry,
      keywords: newEntry.keywords
        ? [newEntry.keywords.trim()]
        : [],
      sequence_id: newEntry.sequence_id || null,
    };
    createEntry.mutate(payload, {
      onSuccess: () => {
        setAdding(false);
        setNewEntry({ ...emptyEntry });
      },
    });
  };

  const handleUpdate = () => {
    const payload = {
      id: editId,
      ...editData,
      keywords: typeof editData.keywords === "string"
        ? [editData.keywords.trim()]
        : editData.keywords,
      sequence_id: editData.sequence_id || null,
    };
    updateEntry.mutate(payload, {
      onSuccess: () => setEditId(null),
    });
  };

  const handleDelete = (id) => {
    if (window.confirm("Supprimer cette source ?")) {
      deleteEntry.mutate(id);
    }
  };

  const startEdit = (entry) => {
    setEditId(entry.id);
    setEditData({
      source_type: entry.source_type,
      source_label: entry.source_label || "",
      source_url: entry.source_url || "",
      keywords: Array.isArray(entry.keywords) ? entry.keywords.join(" ") : entry.keywords || "",
      is_active: entry.is_active ?? true,
      sequence_id: entry.sequence_id || "",
    });
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Sources & Mots-cles</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Ajouter une source
          </button>
        )}
      </div>

      <div className="mb-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par label, URL ou mot-clé…"
          className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
        />
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        <span className="text-xs text-gray-400 self-center mr-1">Type:</span>
        {[{ value: "all", label: "Tout (" + allEntries.length + ")" }, ...SOURCE_TYPES.map((t) => ({ value: t.value, label: t.label + " (" + allEntries.filter((e) => e.source_type === t.value).length + ")" }))].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilterType(f.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              filterType === f.value
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Label</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Requete de recherche</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actif</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sequence</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {/* Add row */}
            {adding && (
              <tr className="bg-blue-50">
                <td className="px-4 py-2">
                  <select
                    value={newEntry.source_type}
                    onChange={(e) => setNewEntry({ ...newEntry, source_type: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  >
                    {SOURCE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <input
                    placeholder="Label"
                    value={newEntry.source_label}
                    onChange={(e) => setNewEntry({ ...newEntry, source_label: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    placeholder="URL"
                    value={newEntry.source_url}
                    onChange={(e) => setNewEntry({ ...newEntry, source_url: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    placeholder="ex: CRM whatsapp omnicanal"
                    value={newEntry.keywords}
                    onChange={(e) => setNewEntry({ ...newEntry, keywords: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={newEntry.is_active}
                    onChange={(e) => setNewEntry({ ...newEntry, is_active: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    placeholder="ID"
                    value={newEntry.sequence_id}
                    onChange={(e) => setNewEntry({ ...newEntry, sequence_id: e.target.value })}
                    className="w-20 rounded border-gray-300 text-sm"
                  />
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button onClick={handleCreate} className="text-sm text-blue-600 hover:text-blue-800 mr-2">Sauver</button>
                  <button onClick={() => { setAdding(false); setNewEntry({ ...emptyEntry }); }} className="text-sm text-gray-500 hover:text-gray-700">Annuler</button>
                </td>
              </tr>
            )}

            {entries.length === 0 && !adding ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  Aucune source configuree
                </td>
              </tr>
            ) : (
              entries.map((entry) =>
                editId === entry.id ? (
                  <tr key={entry.id} className="bg-yellow-50">
                    <td className="px-4 py-2">
                      <select
                        value={editData.source_type}
                        onChange={(e) => setEditData({ ...editData, source_type: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      >
                        {SOURCE_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editData.source_label}
                        onChange={(e) => setEditData({ ...editData, source_label: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editData.source_url}
                        onChange={(e) => setEditData({ ...editData, source_url: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editData.keywords}
                        onChange={(e) => setEditData({ ...editData, keywords: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={editData.is_active}
                        onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editData.sequence_id}
                        onChange={(e) => setEditData({ ...editData, sequence_id: e.target.value })}
                        className="w-20 rounded border-gray-300 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={handleUpdate} className="text-sm text-blue-600 hover:text-blue-800 mr-2">Sauver</button>
                      <button onClick={() => setEditId(null)} className="text-sm text-gray-500 hover:text-gray-700">Annuler</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-700">{typeLabel(entry.source_type)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{entry.source_label || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">
                      {entry.source_url ? (
                        <a href={entry.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          {entry.source_url}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {Array.isArray(entry.keywords) && entry.keywords.length > 0
                        ? <span className="font-mono text-xs">{entry.keywords.join(" ")}</span>
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${entry.is_active ? "bg-green-500" : "bg-gray-300"}`} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{entry.sequence_id || "—"}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(entry)} className="text-sm text-indigo-600 hover:text-indigo-800 mr-3">Modifier</button>
                      <button onClick={() => handleDelete(entry.id)} className="text-sm text-red-600 hover:text-red-800">Supprimer</button>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
