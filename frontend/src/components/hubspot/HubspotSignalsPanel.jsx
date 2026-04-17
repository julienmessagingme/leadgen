import { useState } from "react";
import TierBadge from "../shared/TierBadge";
import { useLeads, useLeadAction } from "../../hooks/useLeads";
import { api } from "../../api/client";

/**
 * Panel version of HubspotSignals (the old standalone page).
 * Rendered inside MessagesDraft as a tab — no NavBar, no outer layout.
 */
export default function HubspotSignalsPanel() {
  const [expandedId, setExpandedId] = useState(null);
  const [emailCache, setEmailCache] = useState({});
  const { data, isLoading, refetch } = useLeads({
    status: "hubspot_existing",
    sort: "icp_score",
    order: "desc",
    limit: 100,
  });
  const leadAction = useLeadAction();

  const leads = data?.leads ?? [];

  const handleConvert = (id) => {
    leadAction.mutate({ id, action: "convert_from_hubspot" }, { onSuccess: () => refetch() });
  };
  const handleExclude = (id) => {
    leadAction.mutate({ id, action: "exclude" }, { onSuccess: () => refetch() });
  };

  const toggleExpand = async (leadId) => {
    if (expandedId === leadId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(leadId);
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

  if (isLoading) return <p className="text-gray-500 text-sm">Chargement…</p>;
  if (leads.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <p className="text-gray-500">Aucun signal HubSpot détecté pour le moment.</p>
        <p className="text-gray-400 text-xs mt-2">
          Les contacts HubSpot qui likent ou commentent des posts d'influenceurs/concurrents apparaîtront ici.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entreprise</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Marketing</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Responsable</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ICP</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Signal</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {leads.map((lead) => {
            const displayName = lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Inconnu";
            const isExpanded = expandedId === lead.id;
            const meta = lead.metadata || {};
            const signalDesc = (lead.signal_type || "") + " — " + (lead.signal_source || "");
            const portalId = import.meta.env.VITE_HUBSPOT_PORTAL_ID;
            const hubspotUrl = portalId && meta.hubspot_contact_id
              ? `https://app-eu1.hubspot.com/contacts/${portalId}/contact/${meta.hubspot_contact_id}`
              : null;
            const emailState = emailCache[lead.id];

            return (
              <>
                <tr key={lead.id} className={`hover:bg-gray-50 cursor-pointer ${isExpanded ? "bg-indigo-50" : ""}`} onClick={() => toggleExpand(lead.id)}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{displayName}</div>
                    <div className="text-xs text-gray-500 truncate max-w-[240px]">{lead.headline || ""}</div>
                    <div className="flex gap-2 mt-1">
                      {lead.linkedin_url && (
                        <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline" onClick={(e) => e.stopPropagation()}>LinkedIn</a>
                      )}
                      {hubspotUrl && (
                        <a href={hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-orange-500 hover:underline" onClick={(e) => e.stopPropagation()}>HubSpot</a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {lead.company_name || "-"}
                    {lead.company_location && <span className="text-xs text-gray-400 ml-1">({lead.company_location})</span>}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {meta.hubspot_is_marketing === true ? (
                      <span className="inline-flex px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-700 rounded-full">Oui</span>
                    ) : meta.hubspot_is_marketing === false ? (
                      <span className="inline-flex px-2 py-0.5 text-xs font-semibold bg-red-50 text-red-600 rounded-full">Non</span>
                    ) : (<span className="text-xs text-gray-400">-</span>)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {meta.hubspot_owner_name || <span className="text-xs text-gray-400">-</span>}
                  </td>
                  <td className="px-4 py-3"><TierBadge tier={lead.tier} /></td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-800">{lead.icp_score ?? "-"}</td>
                  <td className="px-4 py-3 text-sm text-indigo-600">
                    {signalDesc}
                    <span className="ml-1 text-xs">{isExpanded ? "▲" : "▼"}</span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => handleConvert(lead.id)} className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded hover:bg-green-200">Convertir</button>
                      <button onClick={() => handleExclude(lead.id)} className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded hover:bg-red-200">Ignorer</button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={lead.id + "-detail"}>
                    <td colSpan={8} className="px-4 py-4 bg-gray-50 border-b border-gray-200">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-gray-500 uppercase">Signal LinkedIn</h4>
                          {meta.post_author_name && <p className="text-xs text-gray-700"><span className="font-medium">Auteur :</span> {meta.post_author_name}</p>}
                          {meta.post_text && <p className="text-xs text-gray-700"><span className="font-medium">Post :</span> {meta.post_text.slice(0, 300)}{meta.post_text.length > 300 ? "…" : ""}</p>}
                          {meta.comment_text && <p className="text-xs text-gray-700"><span className="font-medium">Commentaire :</span> {meta.comment_text}</p>}
                          {meta.post_url && <a href={meta.post_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline">Voir le post</a>}
                        </div>
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-gray-500 uppercase">Dernier email HubSpot</h4>
                          {emailState?.loading && <p className="text-xs text-gray-400">Chargement…</p>}
                          {emailState?.error && <p className="text-xs text-red-500">{emailState.error}</p>}
                          {emailState && !emailState.loading && !emailState.error && !emailState.data && <p className="text-xs text-gray-400">Aucun email trouvé.</p>}
                          {emailState?.data && (
                            <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${emailState.data.direction === "INCOMING_EMAIL" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                                  {emailState.data.direction === "INCOMING_EMAIL" ? "Reçu" : "Envoyé"}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {emailState.data.date ? new Date(emailState.data.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                                </span>
                              </div>
                              {emailState.data.subject && <p className="text-sm font-medium text-gray-900">{emailState.data.subject}</p>}
                              <p className="text-xs text-gray-500">
                                {emailState.data.from && <span>De : {emailState.data.from}</span>}
                                {emailState.data.to && <span className="ml-2">À : {emailState.data.to}</span>}
                              </p>
                              {emailState.data.body && <p className="text-xs text-gray-600 mt-1 whitespace-pre-line">{emailState.data.body}</p>}
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
  );
}
