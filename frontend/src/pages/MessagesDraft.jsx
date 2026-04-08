import { useState } from "react";
import NavBar from "../components/shared/NavBar";
import TierBadge from "../components/shared/TierBadge";
import { useLeads } from "../hooks/useLeads";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

function useApproveMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, message }) => api.post(`/leads/${id}/approve-message`, { message }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function useRejectMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post(`/leads/${id}/reject-message`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function useApproveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, subject, body }) => api.post(`/leads/${id}/approve-email`, { subject, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function useRejectEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post(`/leads/${id}/reject-email`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function useRegenerateEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lang }) => api.post(`/leads/${id}/regenerate-email`, { lang }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function useApproveReinvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }) => api.post(`/leads/${id}/approve-reinvite`, { note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function useRejectReinvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post(`/leads/${id}/reject-reinvite`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export default function MessagesDraft() {
  const [tab, setTab] = useState("linkedin"); // "linkedin" | "email" | "reinvite"
  const [editedMessages, setEditedMessages] = useState({});
  const [editedEmails, setEditedEmails] = useState({}); // { id: { subject, body } }
  const [editedNotes, setEditedNotes] = useState({}); // { id: note }
  const [pendingIds, setPendingIds] = useState({});
  const [errors, setErrors] = useState({});
  const [editingHtml, setEditingHtml] = useState({}); // { id: true } = show raw HTML editor

  const { data: linkedinData, isLoading: linkedinLoading, refetch: refetchLinkedin } = useLeads({
    status: "message_pending",
    sort: "icp_score",
    order: "desc",
    limit: 100,
  });
  const { data: emailData, isLoading: emailLoading, refetch: refetchEmail } = useLeads({
    status: "email_pending",
    sort: "icp_score",
    order: "desc",
    limit: 100,
  });
  const { data: reinviteData, isLoading: reinviteLoading, refetch: refetchReinvite } = useLeads({
    status: "reinvite_pending",
    sort: "icp_score",
    order: "desc",
    limit: 100,
  });

  const approve = useApproveMessage();
  const reject = useRejectMessage();
  const approveEmail = useApproveEmail();
  const rejectEmail = useRejectEmail();
  const regenerateEmail = useRegenerateEmail();
  const approveReinvite = useApproveReinvite();
  const rejectReinvite = useRejectReinvite();

  const linkedinLeads = linkedinData?.leads ?? [];
  const emailLeads = emailData?.leads ?? [];
  const reinviteLeads = reinviteData?.leads ?? [];

  const handleApprove = (lead) => {
    const message = editedMessages[lead.id] ?? lead.metadata?.draft_message ?? "";
    setPendingIds((p) => ({ ...p, [lead.id]: "approving" }));
    setErrors((e) => ({ ...e, [lead.id]: null }));
    approve.mutate(
      { id: lead.id, message },
      {
        onSuccess: () => { setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; }); refetchLinkedin(); },
        onError: (err) => {
          setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
          setErrors((e) => ({ ...e, [lead.id]: err?.response?.data?.error || err?.message || "Erreur inconnue" }));
        },
      }
    );
  };

  const handleReject = (lead) => {
    setPendingIds((p) => ({ ...p, [lead.id]: "rejecting" }));
    reject.mutate(
      { id: lead.id },
      {
        onSuccess: () => { setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; }); refetchLinkedin(); },
        onError: (err) => {
          setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
          // 404 = lead already deleted (double-click race) — treat as success
          if (err?.status === 404) { refetchLinkedin(); return; }
          setErrors((e) => ({ ...e, [lead.id]: err?.message || "Erreur inconnue" }));
        },
      }
    );
  };

  const handleApproveEmail = (lead) => {
    const edited = editedEmails[lead.id];
    const subject = edited?.subject ?? lead.metadata?.draft_email_subject ?? "";
    const body = edited?.body ?? lead.metadata?.draft_email_body ?? "";
    setPendingIds((p) => ({ ...p, [lead.id]: "approving" }));
    setErrors((e) => ({ ...e, [lead.id]: null }));
    approveEmail.mutate(
      { id: lead.id, subject, body },
      {
        onSuccess: () => { setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; }); refetchEmail(); },
        onError: (err) => {
          setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
          setErrors((e) => ({ ...e, [lead.id]: err?.response?.data?.error || err?.message || "Erreur inconnue" }));
        },
      }
    );
  };

  const handleRejectEmail = (lead) => {
    setPendingIds((p) => ({ ...p, [lead.id]: "rejecting" }));
    rejectEmail.mutate(
      { id: lead.id },
      {
        onSuccess: () => { setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; }); refetchEmail(); },
        onError: (err) => {
          setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
          // 404 = lead already deleted (double-click race) — treat as success
          if (err?.status === 404) { refetchEmail(); return; }
          setErrors((e) => ({ ...e, [lead.id]: err?.message || "Erreur inconnue" }));
        },
      }
    );
  };

  const handleApproveReinvite = (lead) => {
    const note = editedNotes[lead.id] ?? lead.metadata?.draft_invitation_note ?? "";
    setPendingIds((p) => ({ ...p, [lead.id]: "approving" }));
    setErrors((e) => ({ ...e, [lead.id]: null }));
    approveReinvite.mutate(
      { id: lead.id, note },
      {
        onSuccess: () => { setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; }); refetchReinvite(); },
        onError: (err) => {
          setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
          setErrors((e) => ({ ...e, [lead.id]: err?.response?.data?.error || err?.message || "Erreur inconnue" }));
        },
      }
    );
  };

  const handleRejectReinvite = (lead) => {
    setPendingIds((p) => ({ ...p, [lead.id]: "rejecting" }));
    rejectReinvite.mutate(
      { id: lead.id },
      {
        onSuccess: () => { setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; }); refetchReinvite(); },
        onError: (err) => {
          setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
          // 404 = lead already deleted (double-click race) — treat as success
          if (err?.status === 404) { refetchReinvite(); return; }
          setErrors((e) => ({ ...e, [lead.id]: err?.message || "Erreur inconnue" }));
        },
      }
    );
  };

  const isLoading = tab === "linkedin" ? linkedinLoading : tab === "email" ? emailLoading : reinviteLoading;
  const leads = tab === "linkedin" ? linkedinLeads : tab === "email" ? emailLeads : reinviteLeads;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Messages à valider</h1>
          <p className="text-sm text-gray-500 mt-1">
            Relisez, modifiez si besoin, puis envoyez.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab("linkedin")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === "linkedin"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Messages LinkedIn
            {linkedinLeads.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
                {linkedinLeads.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("email")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === "email"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Emails J+7
            {emailLeads.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-full">
                {emailLeads.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("reinvite")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === "reinvite"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Re-invitations
            {reinviteLeads.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                {reinviteLeads.length}
              </span>
            )}
          </button>
        </div>

        {isLoading && (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        )}

        {!isLoading && leads.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            {tab === "linkedin"
              ? "Aucun message LinkedIn en attente."
              : tab === "email"
              ? "Aucun email en attente. Task D n'a pas encore tourné ou tous les emails ont été traités."
              : "Aucune re-invitation en attente."}
          </div>
        )}

        {/* LinkedIn drafts */}
        {tab === "linkedin" && (
          <div className="space-y-4">
            {linkedinLeads.map((lead) => {
              const draft = editedMessages[lead.id] ?? lead.metadata?.draft_message ?? "";
              const postText = lead.metadata?.post_text;
              const isApproving = pendingIds[lead.id] === "approving";
              const isRejecting = pendingIds[lead.id] === "rejecting";
              const errorMsg = errors[lead.id];

              return (
                <div key={lead.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-900 hover:text-blue-600">
                          {lead.full_name}
                        </a>
                        <TierBadge tier={lead.tier} />
                        <span className="text-xs text-gray-400">#{lead.icp_score}</span>
                      </div>
                      <p className="text-sm text-gray-500">{lead.headline}</p>
                      <p className="text-xs text-gray-400">{lead.company_name} · {lead.signal_source}</p>
                    </div>
                  </div>

                  {postText && (
                    <div className="mb-3 bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700 border border-blue-100">
                      <span className="font-medium">Post liké :</span> {postText.slice(0, 200)}{postText.length > 200 ? "…" : ""}
                    </div>
                  )}

                  <textarea
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                    rows={4}
                    value={draft}
                    onChange={(e) => setEditedMessages((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                  />

                  {errorMsg && (
                    <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-3 py-2 border border-red-200">
                      {errorMsg}
                    </div>
                  )}

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleApprove(lead)}
                      disabled={isApproving || !draft.trim()}
                      className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isApproving ? "Envoi…" : "Envoyer"}
                    </button>
                    <button
                      onClick={() => handleReject(lead)}
                      disabled={isRejecting}
                      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
                    >
                      Rejeter
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Re-invite drafts */}
        {tab === "reinvite" && (
          <div className="space-y-4">
            {reinviteLeads.map((lead) => {
              const note = editedNotes[lead.id] ?? lead.metadata?.draft_invitation_note ?? "";
              const reinviteCount = lead.metadata?.reinvite_count || 0;
              const isApproving = pendingIds[lead.id] === "approving";
              const isRejecting = pendingIds[lead.id] === "rejecting";
              const errorMsg = errors[lead.id];

              return (
                <div key={lead.id} className="bg-white rounded-xl shadow-sm border border-purple-200 p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-900 hover:text-blue-600">
                          {lead.full_name}
                        </a>
                        <TierBadge tier={lead.tier} />
                        <span className="text-xs text-gray-400">#{lead.icp_score}</span>
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                          Re-invite #{reinviteCount + 1}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">{lead.headline}</p>
                      <p className="text-xs text-gray-400">{lead.company_name} · {lead.signal_source}</p>
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="text-xs font-medium text-gray-500 mb-1 block">
                      Note d'invitation (max 280 car.)
                    </label>
                    <textarea
                      className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-purple-300"
                      rows={3}
                      maxLength={280}
                      value={note}
                      onChange={(e) => setEditedNotes((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                    />
                    <p className="text-xs text-gray-400 mt-1 text-right">{note.length}/280</p>
                  </div>

                  {errorMsg && (
                    <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-3 py-2 border border-red-200">
                      {errorMsg}
                    </div>
                  )}

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleApproveReinvite(lead)}
                      disabled={isApproving || !note.trim()}
                      className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isApproving ? "Envoi…" : "Re-inviter"}
                    </button>
                    <button
                      onClick={() => handleRejectReinvite(lead)}
                      disabled={isRejecting}
                      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
                    >
                      Rejeter
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Email drafts */}
        {tab === "email" && (
          <div className="space-y-4">
            {emailLeads.map((lead) => {
              const edited = editedEmails[lead.id];
              const subject = edited?.subject ?? lead.metadata?.draft_email_subject ?? "";
              const body = edited?.body ?? lead.metadata?.draft_email_body ?? "";
              const emailTo = lead.metadata?.draft_email_to || lead.email;
              const emailSource = lead.metadata?.email_source;
              const isFromHubspot = emailSource === "hubspot";
              const isApproving = pendingIds[lead.id] === "approving";
              const isRejecting = pendingIds[lead.id] === "rejecting";
              const errorMsg = errors[lead.id];

              return (
                <div key={lead.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-900 hover:text-blue-600">
                          {lead.full_name}
                        </a>
                        <TierBadge tier={lead.tier} />
                        <span className="text-xs text-gray-400">#{lead.icp_score}</span>
                      </div>
                      <p className="text-sm text-gray-500">{lead.headline}</p>
                      <p className="text-xs text-gray-400">{lead.company_name} · {lead.signal_source}</p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1.5">
                      {emailTo ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-50 text-orange-700 text-xs font-medium rounded-md border border-orange-200">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                          {emailTo}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 text-xs font-medium rounded-md border border-red-200">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" /></svg>
                          Email a trouver
                        </span>
                      )}
                      {isFromHubspot ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 text-xs font-medium rounded-md border border-green-200">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          HubSpot
                        </span>
                      ) : emailSource === "fullenrich" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 text-xs font-medium rounded-md border border-blue-200">
                          FullEnrich
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* HubSpot contact info — shown if lead is in HubSpot */}
                  {lead.metadata?.hubspot_contact_id && (
                    <div className="mb-3 bg-orange-50 rounded-lg px-3 py-2 text-xs border border-orange-200">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 bg-orange-200 text-orange-900 font-semibold rounded">
                            Contact HubSpot existant
                          </span>
                          {lead.metadata.hubspot_is_marketing === true ? (
                            <span className="inline-flex items-center px-2 py-0.5 bg-green-100 text-green-700 font-medium rounded">
                              Marketing : Oui
                            </span>
                          ) : lead.metadata.hubspot_is_marketing === false ? (
                            <span className="inline-flex items-center px-2 py-0.5 bg-red-50 text-red-600 font-medium rounded">
                              Marketing : Non
                            </span>
                          ) : null}
                          {lead.metadata.hubspot_owner_name && (
                            <span className="text-orange-800">
                              Responsable : <strong>{lead.metadata.hubspot_owner_name}</strong>
                            </span>
                          )}
                        </div>
                        <a
                          href={`https://app-eu1.hubspot.com/contacts/139615673/contact/${lead.metadata.hubspot_contact_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-orange-700 hover:text-orange-900 font-medium underline"
                        >
                          Voir dans HubSpot
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Signal context */}
                  {lead.metadata?.post_text && (
                    <div className="mb-3 bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700 border border-blue-100">
                      <span className="font-medium">Signal :</span> {lead.metadata.post_text.slice(0, 200)}{lead.metadata.post_text.length > 200 ? "…" : ""}
                    </div>
                  )}
                  {!lead.metadata?.post_text && lead.signal_source && (
                    <div className="mb-3 bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600 border border-gray-200">
                      <span className="font-medium">Signal :</span> {lead.signal_source}
                      {lead.metadata?.signal_category ? ` (${lead.metadata.signal_category})` : ""}
                    </div>
                  )}

                  {/* Subject */}
                  <div className="mb-2">
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Objet</label>
                    <input
                      type="text"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-300"
                      value={subject}
                      onChange={(e) => setEditedEmails((prev) => ({
                        ...prev,
                        [lead.id]: { ...(prev[lead.id] || {}), subject: e.target.value, body: prev[lead.id]?.body ?? body },
                      }))}
                    />
                  </div>

                  {/* Body (HTML preview / raw editor toggle) */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-500">Corps de l'email</label>
                      <button
                        type="button"
                        onClick={() => setEditingHtml((prev) => ({ ...prev, [lead.id]: !prev[lead.id] }))}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        {editingHtml[lead.id] ? "Apercu" : "Modifier le code"}
                      </button>
                    </div>
                    {editingHtml[lead.id] ? (
                      <textarea
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 font-mono"
                        rows={8}
                        value={body}
                        onChange={(e) => setEditedEmails((prev) => ({
                          ...prev,
                          [lead.id]: { ...(prev[lead.id] || {}), body: e.target.value, subject: prev[lead.id]?.subject ?? subject },
                        }))}
                      />
                    ) : (
                      <div
                        className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-800 bg-white prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: body }}
                      />
                    )}
                  </div>

                  {errorMsg && (
                    <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-3 py-2 border border-red-200">
                      {errorMsg}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => handleApproveEmail(lead)}
                      disabled={isApproving || !subject.trim() || !body.trim() || !emailTo}
                      className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={!emailTo ? "Email a trouver avant envoi" : ""}
                    >
                      {isApproving ? "Envoi…" : !emailTo ? "Email manquant" : "Envoyer l'email"}
                    </button>
                    <button
                      onClick={() => handleRejectEmail(lead)}
                      disabled={isRejecting}
                      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
                    >
                      Rejeter
                    </button>
                    <div className="ml-auto flex items-center gap-1">
                      {["fr", "en"].map((lang) => {
                        const isCurrent = body.includes("Programmer un echange") ? "fr" : body.includes("Schedule a call") ? "en" : "fr";
                        const isRegenerating = pendingIds[lead.id] === "regen-" + lang;
                        return (
                          <button
                            key={lang}
                            onClick={() => {
                              setPendingIds((p) => ({ ...p, [lead.id]: "regen-" + lang }));
                              regenerateEmail.mutate(
                                { id: lead.id, lang },
                                {
                                  onSuccess: () => {
                                    setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
                                    setEditedEmails((prev) => { const n = { ...prev }; delete n[lead.id]; return n; });
                                    refetchEmail();
                                  },
                                  onError: (err) => {
                                    setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
                                    setErrors((e) => ({ ...e, [lead.id]: err?.response?.data?.error || err?.message || "Erreur" }));
                                  },
                                }
                              );
                            }}
                            disabled={isRegenerating || (lang === isCurrent && !isRegenerating)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                              lang === isCurrent
                                ? "bg-indigo-100 text-indigo-700 border-indigo-300 cursor-default"
                                : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700"
                            } disabled:opacity-50`}
                          >
                            {isRegenerating ? "..." : lang === "fr" ? "FR" : "EN"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
