import { useState } from "react";
import { useNavigate } from "react-router-dom";
import NavBar from "../components/shared/NavBar";
import TierBadge from "../components/shared/TierBadge";
import { useLeads } from "../hooks/useLeads";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

function useMarkConnected() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post(`/leads/${id}/mark-connected`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function Invitations() {
  const navigate = useNavigate();
  const [pendingIds, setPendingIds] = useState({});
  const [doneIds, setDoneIds] = useState({});
  const [errors, setErrors] = useState({});
  const [search, setSearch] = useState("");

  const { data, isLoading } = useLeads({
    status: "invitation_sent",
    sort: "invitation_sent_at",
    order: "desc",
    limit: 100,
  });

  const markConnected = useMarkConnected();
  const allLeads = data?.leads ?? [];
  const q = search.toLowerCase().trim();
  const leads = q
    ? allLeads.filter((l) =>
        (l.full_name || "").toLowerCase().includes(q) ||
        (l.company_name || "").toLowerCase().includes(q) ||
        (l.headline || "").toLowerCase().includes(q)
      )
    : allLeads;

  const handleAccepted = (lead) => {
    setPendingIds((p) => ({ ...p, [lead.id]: true }));
    setErrors((e) => ({ ...e, [lead.id]: null }));
    markConnected.mutate(lead.id, {
      onSuccess: (res) => {
        setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
        setDoneIds((d) => ({ ...d, [lead.id]: res.data?.message || true }));
      },
      onError: (err) => {
        setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
        setErrors((e) => ({ ...e, [lead.id]: err?.response?.data?.error || err?.message || "Erreur" }));
      },
    });
  };

  const pendingCount = Object.keys(pendingIds).length;
  const doneCount = Object.keys(doneIds).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Invitations envoyées</h1>
            <p className="text-sm text-gray-500 mt-1">
              {leads.length}{q ? ` / ${allLeads.length}` : ""} invitation{leads.length !== 1 ? "s" : ""} en attente — marque ceux qui ont accepté sur LinkedIn
            </p>
          </div>
          {doneCount > 0 && (
            <button
              onClick={() => navigate("/messages-draft")}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
            >
              Voir les {doneCount} draft{doneCount > 1 ? "s" : ""} à valider →
            </button>
          )}
        </div>

        {/* Search bar */}
        <div className="mb-4 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, entreprise, titre..."
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
          />
        </div>

        {isLoading && (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        )}

        {!isLoading && leads.length === 0 && (
          <div className="text-center py-12 text-gray-400">Aucune invitation en attente.</div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {leads.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Personne</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Signal</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Invité il y a</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leads.map((lead) => {
                  const days = daysSince(lead.invitation_sent_at);
                  const isPending = !!pendingIds[lead.id];
                  const isDone = !!doneIds[lead.id];
                  const errorMsg = errors[lead.id];

                  return (
                    <tr key={lead.id} className={isDone ? "bg-green-50" : "hover:bg-gray-50"}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <a
                                href={lead.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-gray-900 hover:text-blue-600"
                              >
                                {lead.full_name}
                              </a>
                              <TierBadge tier={lead.tier} />
                            </div>
                            <p className="text-xs text-gray-500 truncate max-w-xs">{lead.headline}</p>
                            <p className="text-xs text-gray-400">{lead.company_name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{lead.signal_source}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${days >= 7 ? "text-orange-600" : "text-gray-500"}`}>
                          {days === 0 ? "aujourd'hui" : days === 1 ? "1 jour" : `${days} jours`}
                          {days >= 7 && " ⚠"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isDone ? (
                          <span className="text-xs text-green-600 font-medium">✓ Draft généré</span>
                        ) : errorMsg ? (
                          <span className="text-xs text-red-500">{errorMsg}</span>
                        ) : (
                          <button
                            onClick={() => handleAccepted(lead)}
                            disabled={isPending}
                            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isPending ? "Génération…" : "✓ A accepté"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
