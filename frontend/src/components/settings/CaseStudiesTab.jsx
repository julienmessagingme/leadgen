import { useState } from "react";
import {
  useCaseStudies,
  useCreateCaseStudy,
  useUpdateCaseStudy,
  useDeleteCaseStudy,
} from "../../hooks/useSettings";

const LANGUAGES = [
  { value: "fr", label: "FR" },
  { value: "en", label: "EN" },
];

const emptyCase = {
  client_name: "",
  sector: "",
  metric_label: "",
  metric_value: "",
  description: "",
  language: "fr",
  is_active: true,
};

export default function CaseStudiesTab() {
  const { data, isLoading } = useCaseStudies();
  const createCase = useCreateCaseStudy();
  const updateCase = useUpdateCaseStudy();
  const deleteCase = useDeleteCaseStudy();

  const [adding, setAdding] = useState(false);
  const [newCase, setNewCase] = useState({ ...emptyCase });
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});

  const cases = data?.cases ?? [];

  const handleCreate = () => {
    if (!newCase.client_name || !newCase.sector || !newCase.metric_label || !newCase.metric_value) {
      window.alert("Client, secteur, libelle metrique et valeur metrique sont obligatoires.");
      return;
    }
    createCase.mutate(
      {
        ...newCase,
        description: newCase.description || null,
      },
      {
        onSuccess: () => {
          setAdding(false);
          setNewCase({ ...emptyCase });
        },
      }
    );
  };

  const handleUpdate = () => {
    updateCase.mutate(
      { id: editId, ...editData, description: editData.description || null },
      {
        onSuccess: () => setEditId(null),
      }
    );
  };

  const handleDelete = (id, clientName) => {
    if (window.confirm(`Supprimer le cas client "${clientName}" ?`)) {
      deleteCase.mutate(id);
    }
  };

  const startEdit = (c) => {
    setEditId(c.id);
    setEditData({
      client_name: c.client_name || "",
      sector: c.sector || "",
      metric_label: c.metric_label || "",
      metric_value: c.metric_value || "",
      description: c.description || "",
      language: c.language || "fr",
      is_active: c.is_active ?? true,
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
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Cas clients</h2>
        <p className="text-sm text-gray-500 mt-1">
          Cas clients utilises par Task F (relance email J+14) pour citer un resultat concret.
          Sonnet choisit automatiquement le cas qui correspond au secteur du prospect.
        </p>
      </div>

      <div className="flex items-center justify-end mb-4">
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Ajouter un cas client
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Secteur</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Metrique</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Valeur</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Langue</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actif</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {/* Add row */}
            {adding && (
              <tr className="bg-blue-50">
                <td className="px-4 py-2">
                  <input
                    placeholder="Client"
                    value={newCase.client_name}
                    onChange={(e) => setNewCase({ ...newCase, client_name: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    placeholder="Secteur"
                    value={newCase.sector}
                    onChange={(e) => setNewCase({ ...newCase, sector: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    placeholder="ex: Taux de conversion"
                    value={newCase.metric_label}
                    onChange={(e) => setNewCase({ ...newCase, metric_label: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    placeholder="ex: +35%"
                    value={newCase.metric_value}
                    onChange={(e) => setNewCase({ ...newCase, metric_value: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  />
                </td>
                <td className="px-4 py-2">
                  <textarea
                    placeholder="Contexte et details (optionnel)"
                    rows={2}
                    value={newCase.description}
                    onChange={(e) => setNewCase({ ...newCase, description: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm resize-y"
                  />
                </td>
                <td className="px-4 py-2">
                  <select
                    value={newCase.language}
                    onChange={(e) => setNewCase({ ...newCase, language: e.target.value })}
                    className="w-full rounded border-gray-300 text-sm"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={newCase.is_active}
                    onChange={(e) => setNewCase({ ...newCase, is_active: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button onClick={handleCreate} className="text-sm text-blue-600 hover:text-blue-800 mr-2">Sauver</button>
                  <button onClick={() => { setAdding(false); setNewCase({ ...emptyCase }); }} className="text-sm text-gray-500 hover:text-gray-700">Annuler</button>
                </td>
              </tr>
            )}

            {cases.length === 0 && !adding ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  Aucun cas client configure.{" "}
                  <button
                    onClick={() => setAdding(true)}
                    className="text-blue-600 hover:text-blue-800 underline"
                  >
                    Ajouter le premier
                  </button>
                </td>
              </tr>
            ) : (
              cases.map((c) =>
                editId === c.id ? (
                  <tr key={c.id} className="bg-yellow-50">
                    <td className="px-4 py-2">
                      <input
                        value={editData.client_name}
                        onChange={(e) => setEditData({ ...editData, client_name: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editData.sector}
                        onChange={(e) => setEditData({ ...editData, sector: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editData.metric_label}
                        onChange={(e) => setEditData({ ...editData, metric_label: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editData.metric_value}
                        onChange={(e) => setEditData({ ...editData, metric_value: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <textarea
                        rows={2}
                        value={editData.description}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm resize-y"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={editData.language}
                        onChange={(e) => setEditData({ ...editData, language: e.target.value })}
                        className="w-full rounded border-gray-300 text-sm"
                      >
                        {LANGUAGES.map((l) => (
                          <option key={l.value} value={l.value}>{l.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={editData.is_active}
                        onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={handleUpdate} className="text-sm text-blue-600 hover:text-blue-800 mr-2">Sauver</button>
                      <button onClick={() => setEditId(null)} className="text-sm text-gray-500 hover:text-gray-700">Annuler</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-800">{c.client_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{c.sector}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{c.metric_label}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-800">{c.metric_value}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-md">
                      {c.description ? (
                        <span className="whitespace-pre-wrap">{c.description}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 uppercase">{c.language}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${c.is_active ? "bg-green-500" : "bg-gray-300"}`} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(c)} className="text-sm text-indigo-600 hover:text-indigo-800 mr-3">Modifier</button>
                      <button onClick={() => handleDelete(c.id, c.client_name)} className="text-sm text-red-600 hover:text-red-800">Supprimer</button>
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
