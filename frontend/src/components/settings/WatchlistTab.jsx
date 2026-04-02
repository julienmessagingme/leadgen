import { useState } from "react";
import { useWatchlist, useCreateWatchlistEntry, useUpdateWatchlistEntry, useDeleteWatchlistEntry, useBeReachCredits } from "../../hooks/useSettings";

const SOURCE_TYPES = [
  { value: "competitor_page", label: "Page concurrent" },
  { value: "influencer", label: "Influenceur" },
  { value: "keyword", label: "Mot-cle" },
  { value: "job_keyword", label: "Offre emploi" },
];

const PRIORITIES = [
  { value: "P1", label: "P1", color: "bg-red-100 text-red-800" },
  { value: "P2", label: "P2", color: "bg-yellow-100 text-yellow-800" },
  { value: "P3", label: "P3", color: "bg-gray-100 text-gray-600" },
];

const priorityColor = (p) => PRIORITIES.find((x) => x.value === p)?.color || "bg-gray-100 text-gray-600";

const typeLabel = (type) => SOURCE_TYPES.find((t) => t.value === type)?.label || type;

const emptyEntry = {
  source_type: "competitor_page",
  source_label: "",
  source_url: "",
  keywords: "",
  is_active: true,
  sequence_id: "",
  priority: "P2",
};

function CreditGauge({ sources }) {
  const { data: histData } = useBeReachCredits();
  const histDays = Array.isArray(histData) ? histData : [];
  const DAILY_LIMIT = 300;

  const active = (sources || []).filter((s) => s.is_active);

  // Cost depends on source_type: keyword/job_keyword = 1 credit, influencer/competitor_page = 3 credits
  const creditCost = (s) => (s.source_type === "keyword" || s.source_type === "job_keyword") ? 1 : 3;

  const p1Sources = active.filter((s) => s.priority === "P1");
  const p2Sources = active.filter((s) => s.priority === "P2");
  const p3Sources = active.filter((s) => s.priority === "P3");
  const p1Count = p1Sources.length;
  const p2Count = p2Sources.length;
  const p3Count = p3Sources.length;

  // P1 = all daily, P2 = rotation, P3 = variable d'ajustement pour remplir jusqu'à 300
  const p1Credits = p1Sources.reduce((sum, s) => sum + creditCost(s), 0);
  const remainAfterP1 = Math.max(0, DAILY_LIMIT - p1Credits);
  const p2Max = p2Sources.reduce((sum, s) => sum + creditCost(s), 0);
  const p2Credits = Math.min(p2Max, remainAfterP1);
  const remainAfterP2 = Math.max(0, remainAfterP1 - p2Credits);
  const p3Max = p3Sources.reduce((sum, s) => sum + creditCost(s), 0);
  const p3Credits = Math.min(p3Max, remainAfterP2);
  const totalProjected = p1Credits + p2Credits + p3Credits;

  // Rotation P3 : en combien de jours on écluse tout
  const p3DailyBudget = remainAfterP2;
  const p3RotationDays = p3Max > 0 && p3DailyBudget > 0 ? Math.ceil(p3Max / p3DailyBudget) : 0;

  // Historical: last 3 days
  const today = new Date();
  const hist = [];
  for (let i = 3; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().substring(0, 10);
    const found = histDays.find((x) => x.day === key);
    hist.push({
      day: key,
      label: i === 1 ? "Hier" : d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }),
      used: found ? found.credits_used : 0,
    });
  }

  const pct = (v) => Math.min(100, (v / DAILY_LIMIT) * 100);

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4 sticky top-0 z-10">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Credits BeReach ({DAILY_LIMIT}/jour)</h3>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-400 inline-block" /> P1: {p1Count} sources ({p1Credits} cr/jour)</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-yellow-400 inline-block" /> P2: {p2Count} sources ({p2Max} cr. total)</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-gray-400 inline-block" /> P3: {p3Count} sources — rotation {p3RotationDays > 0 ? p3RotationDays + "j" : "—"}</span>
        </div>
      </div>

      {/* Projected daily bar: P1 (fixed) + P2 (rotation) + P3 (fills remaining) */}
      <div className="mb-3">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-xs font-medium text-gray-600">Projection journaliere</span>
          <span className="text-xs font-mono font-semibold text-gray-700">{totalProjected}/{DAILY_LIMIT}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4 flex overflow-hidden">
          {p1Credits > 0 && <div className="bg-red-400 h-4 transition-all" style={{ width: pct(p1Credits) + "%" }} title={"P1: " + p1Credits + " credits"} />}
          {p2Credits > 0 && <div className="bg-yellow-400 h-4 transition-all" style={{ width: pct(p2Credits) + "%" }} title={"P2: " + p2Credits + " credits"} />}
          {p3Credits > 0 && <div className="bg-gray-400 h-4 transition-all" style={{ width: pct(p3Credits) + "%" }} title={"P3: " + p3Credits + " credits"} />}
        </div>
      </div>

      {/* Historical: last 3 days */}
      {hist.some((h) => h.used > 0) && (
        <div className="border-t border-gray-100 pt-2">
          <p className="text-xs font-medium text-gray-500 mb-1.5">Historique (credits hors collection)</p>
          <div className="flex gap-3">
            {hist.map((h) => (
              <div key={h.day} className="flex-1">
                <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                  <span>{h.label}</span>
                  <span className="font-mono">{h.used}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-indigo-400 h-2 rounded-full transition-all" style={{ width: pct(h.used) + "%" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [filterPriority, setFilterPriority] = useState("all");

  const allEntries = data?.sources ?? [];
  const entries = allEntries.filter((e) => {
    if (filterType !== "all" && e.source_type !== filterType) return false;
    if (filterPriority !== "all" && (e.priority || "P1") !== filterPriority) return false;
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
      priority: entry.priority || "P2",
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
      <CreditGauge sources={allEntries} />

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
      <div className="flex gap-2 mb-4">
        <span className="text-xs text-gray-400 self-center mr-1">Priorite:</span>
        {[{ value: "all", label: "Tout" }, ...PRIORITIES.map((p) => ({ value: p.value, label: p.label + " (" + allEntries.filter((e) => (e.priority || "P1") === p.value).length + ")" }))].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilterPriority(f.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              filterPriority === f.value
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
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priorite</th>
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
                  <select
                    value={newEntry.priority}
                    onChange={(e) => setNewEntry({ ...newEntry, priority: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
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
                      <select
                        value={editData.priority}
                        onChange={(e) => setEditData({ ...editData, priority: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
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
                    <td className="px-4 py-3 text-sm">
                      <select
                        value={entry.priority || "P2"}
                        onChange={(e) => updateEntry.mutate({ id: entry.id, priority: e.target.value })}
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold border-0 cursor-pointer appearance-none text-center ${priorityColor(entry.priority)}`}
                        style={{ paddingRight: "1.2rem", backgroundPosition: "right 0.2rem center", backgroundSize: "0.6rem" }}
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </td>
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
