import { useState } from "react";
import NavBar from "../components/shared/NavBar";
import TierBadge from "../components/shared/TierBadge";
import { useLeads, useLeadAction } from "../hooks/useLeads";
import { api } from "../api/client";

export default function HubspotSignals() {
  const [expandedId, setExpandedId] = useState(null);
  const [emailCache, setEmailCache] = useState({}); // { leadId: { loading, data, error } }
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

  const toggleExpand = async (leadId) => {
    if (expandedId === leadId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(leadId);
    // Fetch email on-demand if not cached
    if (!emailCache[leadId]) {
      setEmailCache((prev) => ({ ...prev, [leadId]: { loading: true } }));
      try {
        const result = await api.get(`/leads/${leadId}/hubspot-email`);
        setEmailCache((prev) => ({ ...prev, [leadId]: { loading: false, data: result.email } }));
      } catch (err) {
        setEmailCache((prev) => ({ ...prev, [leadId]: { loading: false, error: err.message } }));
      }
    }
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact marketing</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Responsable</th>
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
                    ? `https://app-eu1.hubspot.com/contacts/${portalId}/contact/${meta.hubspot_contact_id}`
                    : null;

                  const emailState = emailCache[lead.id];
                  const colCount = 9;

                  return (
                    <>
                    <tr key={lead.id} className={`hover:bg-gray-50 cursor-pointer ${isExpanded ? "bg-indigo-50" : ""}`} onClick={() => toggleExpand(lead.id)}>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{displayName}</div>
                        <div className="text-xs text-gray-500">{lead.headline || ""}</div>
                        <div className="flex gap-2 mt-1">
                          {lead.linkedin_url && (
                            <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-blue-500 hover:underline" onClick={(e) => e.stopPropagation()}>LinkedIn</a>
                          )}
                          {hubspotUrl && (
                            <a href={hubspotUrl} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-orange-500 hover:underline" onClick={(e) => e.stopPropagation()}>HubSpot</a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {lead.company_name || "-"}
                        {lead.company_location && (
                          <span className="text-xs text-gray-400 ml-1">({lead.company_location})</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {meta.hubspot_is_marketing === true ? (
                          <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold bg-green-100 text-green-700 rounded-full">Oui</span>
                        ) : meta.hubspot_is_marketing === false ? (
                          <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold bg-red-50 text-red-600 rounded-full">Non</span>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {meta.hubspot_owner_name || <span className="text-xs text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3">
                        <TierBadge tier={lead.tier} />
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-800">
                        {lead.icp_score ?? "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-indigo-600">
                        {signalDesc}
                        <span className="ml-1 text-xs">{isExpanded ? "▲" : "▼"}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {lead.scored_at
                          ? new Date(lead.scored_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
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
                    {isExpanded && (
                      <tr key={lead.id + "-detail"}>
                        <td colSpan={colCount} className="px-4 py-4 bg-gray-50 border-b border-gray-200">
                          <div className="grid grid-cols-2 gap-4">
                            {/* Signal info */}
                            <div className="space-y-2">
                              <h4 className="text-xs font-semibold text-gray-500 uppercase">Signal LinkedIn</h4>
                              {meta.post_author_name && (
                                <p className="text-xs text-gray-700"><span className="font-medium">Auteur :</span> {meta.post_author_name}</p>
                              )}
                              {meta.post_text && (
                                <p className="text-xs text-gray-700"><span className="font-medium">Post :</span> {meta.post_text.slice(0, 300)}{meta.post_text.length > 300 ? "..." : ""}</p>
                              )}
                              {meta.comment_text && (
                                <p className="text-xs text-gray-700"><span className="font-medium">Commentaire :</span> {meta.comment_text}</p>
                              )}
                              {meta.post_url && (
                                <a href={meta.post_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline">
                                  Voir le post
                                </a>
                              )}
                            </div>
                            {/* Last HubSpot email */}
                            <div className="space-y-2">
                              <h4 className="text-xs font-semibold text-gray-500 uppercase">Dernier email HubSpot</h4>
                              {emailState?.loading && (
                                <p className="text-xs text-gray-400">Chargement...</p>
                              )}
                              {emailState?.error && (
                                <p className="text-xs text-red-500">{emailState.error}</p>
                              )}
                              {emailState && !emailState.loading && !emailState.error && !emailState.data && (
                                <p className="text-xs text-gray-400">Aucun email trouve.</p>
                              )}
                              {emailState?.data && (
                                <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded ${
                                      emailState.data.direction === "INCOMING_EMAIL"
                                        ? "bg-blue-100 text-blue-700"
                                        : "bg-green-100 text-green-700"
                                    }`}>
                                      {emailState.data.direction === "INCOMING_EMAIL" ? "Recu" : "Envoye"}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                      {emailState.data.date
                                        ? new Date(emailState.data.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                                        : ""}
                                    </span>
                                  </div>
                                  {emailState.data.subject && (
                                    <p className="text-sm font-medium text-gray-900">{emailState.data.subject}</p>
                                  )}
                                  <p className="text-xs text-gray-500">
                                    {emailState.data.from && <span>De : {emailState.data.from}</span>}
                                    {emailState.data.to && <span className="ml-2">A : {emailState.data.to}</span>}
                                  </p>
                                  {emailState.data.body && (
                                    <p className="text-xs text-gray-600 mt-1 whitespace-pre-line">{emailState.data.body}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </>
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
