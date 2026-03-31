import { useState } from "react";
import NavBar from "../components/shared/NavBar";
import TierBadge from "../components/shared/TierBadge";
import { useLeads, useLeadAction } from "../hooks/useLeads";

export default function HubspotSignals() {
  const [expandedId, setExpandedId] = useState(null);
  const { data, isLoading, refetch } = useLeads({
    status: "hubspot_existing",
    sort: "icp_score",
    order: "desc",
    limit: 100,
  });
  const leadAction = useLeadAction();

  const leads = data?.leads ?? [];

  const handleConvert = (id) => {
    leadAction.mutate(
      { id, action: "convert_from_hubspot" },
      { onSuccess: () => refetch() }
    );
  };

  const handleExclude = (id) => {
    leadAction.mutate(
      { id, action: "exclude" },
      { onSuccess: () => refetch() }
    );
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Signaux HubSpot</h1>
            <p className="text-sm text-gray-500 mt-1">
              Contacts deja dans HubSpot qui ont montre un signal chaud sur LinkedIn.
              Ils ne sont pas dans la sequence automatique.
            </p>
          </div>
          <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-sm font-medium">
            {leads.length} contact{leads.length !== 1 ? "s" : ""}
          </span>
        </div>

        {isLoading ? (
          <p className="text-gray-500">Chargement...</p>
        ) : leads.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <p className="text-gray-500">Aucun signal HubSpot detecte pour le moment.</p>
            <p className="text-gray-400 text-sm mt-2">
              Les contacts HubSpot qui likent ou commentent des posts d'influenceurs/concurrents apparaitront ici.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entreprise</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score ICP</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Signal</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score le</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leads.map((lead) => {
                  const displayName =
                    lead.full_name ||
                    [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
                    "Inconnu";
                  const isExpanded = expandedId === lead.id;
                  const meta = lead.metadata || {};
                  const signalDesc =
                    (lead.signal_type || "") + " — " + (lead.signal_source || "");
                  const portalId = import.meta.env.VITE_HUBSPOT_PORTAL_ID;
                  const hubspotUrl = portalId && meta.hubspot_contact_id
                    ? `https://app.hubspot.com/contacts/${portalId}/contact/${meta.hubspot_contact_id}`
                    : null;

                  return (
                    <tr key={lead.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{displayName}</div>
                        <div className="text-xs text-gray-500">{lead.headline || ""}</div>
                        <div className="flex gap-2 mt-1">
                          {lead.linkedin_url && (
                            <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-blue-500 hover:underline">LinkedIn</a>
                          )}
                          {hubspotUrl && (
                            <a href={hubspotUrl} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-orange-500 hover:underline">HubSpot ↗</a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {lead.company_name || "-"}
                        {lead.company_location && (
                          <span className="text-xs text-gray-400 ml-1">({lead.company_location})</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <TierBadge tier={lead.tier} />
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-800">
                        {lead.icp_score ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                          className="text-sm text-indigo-600 hover:text-indigo-800 text-left"
                        >
                          {signalDesc}
                          <span className="ml-1 text-xs">{isExpanded ? "▲" : "▼"}</span>
                        </button>
                        {isExpanded && (
                          <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-700 space-y-1">
                            {meta.post_author_name && (
                              <p><span className="font-medium">Auteur du post :</span> {meta.post_author_name} {meta.post_author_headline ? "— " + meta.post_author_headline : ""}</p>
                            )}
                            {meta.post_text && (
                              <p><span className="font-medium">Post :</span> {meta.post_text.slice(0, 200)}{meta.post_text.length > 200 ? "..." : ""}</p>
                            )}
                            {meta.comment_text && (
                              <p><span className="font-medium">Commentaire :</span> {meta.comment_text}</p>
                            )}
                            {meta.post_url && (
                              <a href={meta.post_url} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">
                                Voir le post LinkedIn
                              </a>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {lead.scored_at
                          ? new Date(lead.scored_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleConvert(lead.id)}
                            className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded hover:bg-green-200"
                          >
                            Convertir
                          </button>
                          <button
                            onClick={() => handleExclude(lead.id)}
                            className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded hover:bg-red-200"
                          >
                            Ignorer
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
