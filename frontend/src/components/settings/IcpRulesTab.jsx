import { useState } from "react";
import { useIcpRules, useCreateIcpRule, useUpdateIcpRule, useDeleteIcpRule } from "../../hooks/useSettings";

const CATEGORIES = [
  "title_positive",
  "title_negative",
  "sector",
  "company_size",
  "seniority",
  "freshness",
  "signal_weights",
];

const CATEGORY_LABELS = {
  title_positive: "Titre positif",
  title_negative: "Titre negatif",
  sector: "Secteur",
  company_size: "Taille entreprise",
  seniority: "Seniorite",
  freshness: "Fraicheur",
  signal_weights: "Poids signaux",
};

const emptyRule = { category: "title_positive", key: "", value: "", numeric_value: 0, threshold: 0 };

export default function IcpRulesTab() {
  const { data, isLoading } = useIcpRules();
  const createRule = useCreateIcpRule();
  const updateRule = useUpdateIcpRule();
  const deleteRule = useDeleteIcpRule();

  const [adding, setAdding] = useState(false);
  const [newRule, setNewRule] = useState({ ...emptyRule });
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});

  const rules = data?.rules ?? [];

  const handleCreate = () => {
    createRule.mutate(newRule, {
      onSuccess: () => {
        setAdding(false);
        setNewRule({ ...emptyRule });
      },
    });
  };

  const handleUpdate = () => {
    updateRule.mutate({ id: editId, ...editData }, {
      onSuccess: () => setEditId(null),
    });
  };

  const handleDelete = (id) => {
    if (window.confirm("Supprimer cette regle ?")) {
      deleteRule.mutate(id);
    }
  };

  const startEdit = (rule) => {
    setEditId(rule.id);
    setEditData({
      category: rule.category,
      key: rule.key || "",
      value: rule.value || "",
      numeric_value: rule.numeric_value ?? 0,
      threshold: rule.threshold ?? 0,
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

  // Group by category
  const grouped = {};
  for (const rule of rules) {
    if (!grouped[rule.category]) grouped[rule.category] = [];
    grouped[rule.category].push(rule);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Regles de scoring ICP</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Ajouter une regle
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Categorie</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cle / Valeur</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Poids / Seuil</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {/* Add row */}
            {adding && (
              <tr className="bg-blue-50">
                <td className="px-4 py-2">
                  <select
                    value={newRule.category}
                    onChange={(e) => setNewRule({ ...newRule, category: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <input
                      placeholder="Cle"
                      value={newRule.key}
                      onChange={(e) => setNewRule({ ...newRule, key: e.target.value })}
                      className="w-1/2 rounded border-gray-300 text-sm"
                    />
                    <input
                      placeholder="Valeur"
                      value={newRule.value}
                      onChange={(e) => setNewRule({ ...newRule, value: e.target.value })}
                      className="w-1/2 rounded border-gray-300 text-sm"
                    />
                  </div>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Poids"
                      value={newRule.numeric_value}
                      onChange={(e) => setNewRule({ ...newRule, numeric_value: Number(e.target.value) })}
                      className="w-1/2 rounded border-gray-300 text-sm"
                    />
                    <input
                      type="number"
                      placeholder="Seuil"
                      value={newRule.threshold}
                      onChange={(e) => setNewRule({ ...newRule, threshold: Number(e.target.value) })}
                      className="w-1/2 rounded border-gray-300 text-sm"
                    />
                  </div>
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={handleCreate} className="text-sm text-blue-600 hover:text-blue-800 mr-2">Sauver</button>
                  <button onClick={() => { setAdding(false); setNewRule({ ...emptyRule }); }} className="text-sm text-gray-500 hover:text-gray-700">Annuler</button>
                </td>
              </tr>
            )}

            {/* Existing rules */}
            {rules.length === 0 && !adding ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  Aucune regle ICP configuree
                </td>
              </tr>
            ) : (
              rules.map((rule) =>
                editId === rule.id ? (
                  <tr key={rule.id} className="bg-yellow-50">
                    <td className="px-4 py-2">
                      <select
                        value={editData.category}
                        onChange={(e) => setEditData({ ...editData, category: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <input
                          value={editData.key}
                          onChange={(e) => setEditData({ ...editData, key: e.target.value })}
                          className="w-1/2 rounded border-gray-300 text-sm"
                        />
                        <input
                          value={editData.value}
                          onChange={(e) => setEditData({ ...editData, value: e.target.value })}
                          className="w-1/2 rounded border-gray-300 text-sm"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={editData.numeric_value}
                          onChange={(e) => setEditData({ ...editData, numeric_value: Number(e.target.value) })}
                          className="w-1/2 rounded border-gray-300 text-sm"
                        />
                        <input
                          type="number"
                          value={editData.threshold}
                          onChange={(e) => setEditData({ ...editData, threshold: Number(e.target.value) })}
                          className="w-1/2 rounded border-gray-300 text-sm"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={handleUpdate} className="text-sm text-blue-600 hover:text-blue-800 mr-2">Sauver</button>
                      <button onClick={() => setEditId(null)} className="text-sm text-gray-500 hover:text-gray-700">Annuler</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={rule.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {CATEGORY_LABELS[rule.category] || rule.category}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {rule.key && <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded mr-1">{rule.key}</span>}
                      {rule.value || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <span className="font-medium">{rule.numeric_value ?? "—"}</span>
                      {rule.threshold ? <span className="text-gray-400 ml-2">seuil: {rule.threshold}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => startEdit(rule)} className="text-sm text-indigo-600 hover:text-indigo-800 mr-3">Modifier</button>
                      <button onClick={() => handleDelete(rule.id)} className="text-sm text-red-600 hover:text-red-800">Supprimer</button>
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
