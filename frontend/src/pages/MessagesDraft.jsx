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

export default function MessagesDraft() {
  const [tab, setTab] = useState("linkedin"); // "linkedin" | "email"
  const [editedMessages, setEditedMessages] = useState({});
  const [editedEmails, setEditedEmails] = useState({}); // { id: { subject, body } }
  const [pendingIds, setPendingIds] = useState({});
  const [errors, setErrors] = useState({});

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

  const approve = useApproveMessage();
  const reject = useRejectMessage();
  const approveEmail = useApproveEmail();
  const rejectEmail = useRejectEmail();

  const linkedinLeads = linkedinData?.leads ?? [];
  const emailLeads = emailData?.leads ?? [];

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
          setErrors((e) => ({ ...e, [lead.id]: err?.response?.data?.error || err?.message || "Erreur inconnue" }));
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
          setErrors((e) => ({ ...e, [lead.id]: err?.response?.data?.error || err?.message || "Erreur inconnue" }));
        },
      }
    );
  };

  const isLoading = tab === "linkedin" ? linkedinLoading : emailLoading;
  const leads = tab === "linkedin" ? linkedinLeads : emailLeads;

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
        </div>

        {isLoading && (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        )}

        {!isLoading && leads.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            {tab === "linkedin"
              ? "Aucun message LinkedIn en attente."
              : "Aucun email en attente. Task D n'a pas encore tourné ou tous les emails ont été traités."}
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

        {/* Email drafts */}
        {tab === "email" && (
          <div className="space-y-4">
            {emailLeads.map((lead) => {
              const edited = editedEmails[lead.id];
              const subject = edited?.subject ?? lead.metadata?.draft_email_subject ?? "";
              const body = edited?.body ?? lead.metadata?.draft_email_body ?? "";
              const emailTo = lead.metadata?.draft_email_to || lead.email;
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
                    <div className="text-right">
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-50 text-orange-700 text-xs font-medium rounded-md border border-orange-200">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        {emailTo}
                      </span>
                    </div>
                  </div>

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

                  {/* Body (HTML preview + edit) */}
                  <div className="mb-2">
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Corps de l'email</label>
                    <textarea
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 font-mono"
                      rows={6}
                      value={body}
                      onChange={(e) => setEditedEmails((prev) => ({
                        ...prev,
                        [lead.id]: { ...(prev[lead.id] || {}), body: e.target.value, subject: prev[lead.id]?.subject ?? subject },
                      }))}
                    />
                  </div>

                  {errorMsg && (
                    <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-3 py-2 border border-red-200">
                      {errorMsg}
                    </div>
                  )}

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleApproveEmail(lead)}
                      disabled={isApproving || !subject.trim() || !body.trim()}
                      className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isApproving ? "Envoi…" : "Envoyer l'email"}
                    </button>
                    <button
                      onClick={() => handleRejectEmail(lead)}
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
      </div>
    </div>
  );
}
