import { useState } from "react";
import NavBar from "../components/shared/NavBar";
import TierBadge from "../components/shared/TierBadge";
import EngagementBadges from "../components/shared/EngagementBadges";
import { useLeads } from "../hooks/useLeads";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import DOMPurify from "dompurify";
import { useQuery } from "@tanstack/react-query";
import { htmlToText, textToHtml } from "../utils/htmlText";
import FollowupCasePicker from "../components/followups/FollowupCasePicker";
import { useValidatedCampaigns } from "../hooks/useCampaigns";
import HubspotSignalsPanel from "../components/hubspot/HubspotSignalsPanel";

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

function useRegenerateMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lang }) => api.post(`/leads/${id}/regenerate-message`, { lang }),
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

function useApproveEmailFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, subject, body }) => api.post(`/leads/${id}/approve-email-followup`, { subject, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function useRejectEmailFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post(`/leads/${id}/reject-email-followup`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function useRegenerateEmailFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lang }) => api.post(`/leads/${id}/regenerate-email-followup`, { lang }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export default function MessagesDraft() {
  const [tab, setTab] = useState("linkedin"); // "linkedin" | "email" | "cold_email" | "campagne" | "hubspot" | "reinvite" | "followup_email"
  // followupSubTab state removed — the "Relances email" tab now shows drafts
  // (email_followup_pending) AND candidates (picker) on the same page.
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [editedMessages, setEditedMessages] = useState({});
  const [editedEmails, setEditedEmails] = useState({}); // { id: { subject, body } }
  const [editedFollowups, setEditedFollowups] = useState({}); // { id: { subject, body } }
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
  const { data: followupData, isLoading: followupLoading, refetch: refetchFollowup } = useLeads({
    status: "email_followup_pending",
    sort: "icp_score",
    order: "desc",
    limit: 100,
  });
  const { data: validatedCampaigns } = useValidatedCampaigns();
  const { data: campagneData, isLoading: campagneLoading, refetch: refetchCampagne } = useLeads({
    status: "email_pending",
    campaign_id: selectedCampaignId ?? undefined,
    sort: "icp_score",
    order: "desc",
    limit: 200,
  });
  const { data: hubspotData } = useLeads({
    status: "hubspot_existing",
    sort: "icp_score",
    order: "desc",
    limit: 100,
  });
  const hubspotLeadsCount = hubspotData?.leads?.length || 0;

  const approve = useApproveMessage();
  const reject = useRejectMessage();
  const approveEmail = useApproveEmail();
  const rejectEmail = useRejectEmail();
  const regenerateEmail = useRegenerateEmail();
  const regenerateMessage = useRegenerateMessage();
  const approveReinvite = useApproveReinvite();
  const rejectReinvite = useRejectReinvite();
  const approveFollowup = useApproveEmailFollowup();
  const rejectFollowup = useRejectEmailFollowup();
  const regenerateFollowup = useRegenerateEmailFollowup();

  const linkedinLeads = linkedinData?.leads ?? [];
  const allEmailLeads = emailData?.leads ?? [];
  // Exclude campaign-tagged leads from legacy tabs — they live under "Campagnes"
  const emailLeads = allEmailLeads.filter(function (l) { return !l.metadata?.cold_outbound && !l.metadata?.campaign_id; });
  const coldEmailLeads = allEmailLeads.filter(function (l) { return !!l.metadata?.cold_outbound && !l.metadata?.campaign_id; });
  const reinviteLeads = reinviteData?.leads ?? [];
  const followupLeads = followupData?.leads ?? [];
  const campagneLeads = campagneData?.leads ?? [];
  const campagnes = validatedCampaigns?.campaigns ?? [];

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

  const handleApproveFollowup = (lead) => {
    const edited = editedFollowups[lead.id];
    const subject = edited?.subject ?? lead.metadata?.draft_followup_subject ?? "";
    const body = edited?.body ?? lead.metadata?.draft_followup_body ?? "";
    setPendingIds((p) => ({ ...p, [lead.id]: "approving" }));
    setErrors((e) => ({ ...e, [lead.id]: null }));
    approveFollowup.mutate(
      { id: lead.id, subject, body },
      {
        onSuccess: () => { setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; }); refetchFollowup(); },
        onError: (err) => {
          setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
          if (err?.status === 404) { refetchFollowup(); return; }
          setErrors((e) => ({ ...e, [lead.id]: err?.message || "Erreur inconnue" }));
        },
      }
    );
  };

  const handleRejectFollowup = (lead) => {
    setPendingIds((p) => ({ ...p, [lead.id]: "rejecting" }));
    rejectFollowup.mutate(
      { id: lead.id },
      {
        onSuccess: () => { setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; }); refetchFollowup(); },
        onError: (err) => {
          setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
          if (err?.status === 404) { refetchFollowup(); return; }
          setErrors((e) => ({ ...e, [lead.id]: err?.message || "Erreur inconnue" }));
        },
      }
    );
  };

  // On the followup_email tab, the "case" sub-tab has its own loading/list
  // (candidates for relance preparation, handled by FollowupCasePicker below).
  // The legacy computations below apply to the "email" sub-tab and all the
  // other top-level tabs.
  const isLoading = tab === "linkedin" ? linkedinLoading
    : tab === "email" ? emailLoading
    : tab === "cold_email" ? emailLoading
    : tab === "campagne" ? (selectedCampaignId ? campagneLoading : false)
    : tab === "hubspot" ? false
    : tab === "reinvite" ? reinviteLoading
    : followupLoading;
  const leads = tab === "linkedin" ? linkedinLeads
    : tab === "email" ? emailLeads
    : tab === "cold_email" ? coldEmailLeads
    : tab === "campagne" ? campagneLeads
    : tab === "reinvite" ? reinviteLeads
    : followupLeads;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className={`${tab === "hubspot" ? "max-w-7xl" : "max-w-4xl"} mx-auto px-4 py-8`}>
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
            Emails J+3
            {emailLeads.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-full">
                {emailLeads.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("cold_email")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === "cold_email"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Cold Email
            {coldEmailLeads.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-teal-100 text-teal-700 rounded-full">
                {coldEmailLeads.length}
              </span>
            )}
          </button>
          <button
            onClick={() => { setTab("campagne"); setSelectedCampaignId(null); }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === "campagne"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Campagnes
            {campagnes.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                {campagnes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("hubspot")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === "hubspot"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Signaux HubSpot
            {hubspotLeadsCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                {hubspotLeadsCount}
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
          <button
            onClick={() => setTab("followup_email")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === "followup_email"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Relances email
            {followupLeads.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-pink-100 text-pink-700 rounded-full">
                {followupLeads.length}
              </span>
            )}
          </button>
        </div>

        {/* Relances email — vue unifiée. Vue principale = liste des
            candidats à relancer (FollowupCasePicker). Les drafts déjà
            générés (soit par Task F automatique J+14, soit par un clic
            "Générer" précédent) apparaissent SOUS la liste, collapsibles,
            pour ne pas parasiter la vue primaire. */}

        {/* HubSpot signals tab */}
        {tab === "hubspot" && <HubspotSignalsPanel />}

        {/* Campagne tab: list of validated campaigns (drill-down into drafts on click) */}
        {tab === "campagne" && !selectedCampaignId && (
          <div className="space-y-3">
            {campagnes.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                Aucune campagne validée. Crée-en une depuis <a href="/cold-outbound" className="text-indigo-600 hover:underline">Cold Outbound</a> ou <a href="/cold-outreach" className="text-indigo-600 hover:underline">AI Agents</a> en glissant des leads dans une Campagne puis en cliquant "Valider".
              </div>
            )}
            {campagnes.map((c) => {
              const cs = c.case_studies;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedCampaignId(c.id)}
                  className="w-full text-left bg-white rounded-xl shadow-sm border border-gray-200 p-4 hover:border-purple-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{c.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                          Slot {c.slot}
                        </span>
                        {cs && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                            Cas : {cs.client_name} · {cs.metric_value}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Validée le {new Date(c.validated_at).toLocaleString("fr-FR")}
                        {" · "}
                        {c.items_count} lead{c.items_count > 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {c.pending > 0 && (
                        <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                          {c.pending} à valider
                        </span>
                      )}
                      {c.sent > 0 && (
                        <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          {c.sent} envoyé{c.sent > 1 ? "s" : ""}
                        </span>
                      )}
                      {c.rejected > 0 && (
                        <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                          {c.rejected} rejeté{c.rejected > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Campagne drill-down header */}
        {tab === "campagne" && selectedCampaignId && (
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => setSelectedCampaignId(null)}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              ← Retour aux campagnes
            </button>
            {(() => {
              const c = campagnes.find((x) => x.id === selectedCampaignId);
              if (!c) return null;
              const cs = c.case_studies;
              return (
                <div className="text-sm text-gray-700">
                  <span className="font-semibold">{c.name}</span>
                  {cs && <span className="text-xs text-blue-700 ml-2">· Cas : {cs.client_name}</span>}
                </div>
              );
            })()}
          </div>
        )}

        {isLoading && tab !== "followup_email" && (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        )}

        {!isLoading && leads.length === 0 && tab !== "campagne" && tab !== "hubspot" && tab !== "followup_email" && (
          <div className="text-center py-12 text-gray-400">
            {tab === "linkedin" ? "Aucun message LinkedIn en attente."
             : tab === "email" ? "Aucun email en attente. Task D n'a pas encore tourné ou tous les emails ont été traités."
             : tab === "cold_email" ? "Aucun cold email en attente."
             : "Aucune re-invitation en attente."}
          </div>
        )}

        {!isLoading && tab === "campagne" && selectedCampaignId && campagneLeads.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            Aucun draft en attente pour cette campagne (tous envoyés ou rejetés).
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

                  <div className="flex items-center gap-2 mt-3">
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
                    <div className="ml-auto flex items-center gap-1">
                      {["fr", "en"].map((lang) => {
                        // Detect current language: "Bonjour" = fr, "Hi " = en
                        const isCurrent = draft.startsWith("Bonjour") ? "fr" : draft.startsWith("Hi ") ? "en" : "fr";
                        const isRegenerating = pendingIds[lead.id] === "regen-" + lang;
                        return (
                          <button
                            key={lang}
                            onClick={() => {
                              setPendingIds((p) => ({ ...p, [lead.id]: "regen-" + lang }));
                              regenerateMessage.mutate(
                                { id: lead.id, lang },
                                {
                                  onSuccess: () => {
                                    setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
                                    setEditedMessages((prev) => { const n = { ...prev }; delete n[lead.id]; return n; });
                                    refetchLinkedin();
                                  },
                                  onError: (err) => {
                                    setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
                                    setErrors((e) => ({ ...e, [lead.id]: err?.message || "Erreur" }));
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
        {(tab === "email" || tab === "cold_email" || (tab === "campagne" && selectedCampaignId)) && (
          <div className="space-y-4">
            {(tab === "cold_email"
              ? coldEmailLeads
              : tab === "campagne"
              ? campagneLeads
              : emailLeads
            ).map((lead) => {
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
                    <div className="mb-3 bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700 border border-blue-100 whitespace-pre-wrap">
                      <span className="font-medium">Signal :</span> {lead.metadata.post_text}
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
                        {editingHtml[lead.id] ? "Retour texte" : "HTML brut"}
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
                      <textarea
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
                        rows={10}
                        value={htmlToText(body)}
                        onChange={(e) => setEditedEmails((prev) => ({
                          ...prev,
                          [lead.id]: {
                            ...(prev[lead.id] || {}),
                            body: textToHtml(e.target.value),
                            subject: prev[lead.id]?.subject ?? subject,
                          },
                        }))}
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
                    <RegenerateWithCases leadId={lead.id} onSuccess={() => {
                      setEditedEmails((p) => { const n = { ...p }; delete n[lead.id]; return n; });
                      refetchEmail();
                    }} />
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

        {/* Liste principale — candidats à relancer (FollowupCasePicker) */}
        {tab === "followup_email" && <FollowupCasePicker />}

        {/* Drafts déjà générés (Task F auto + générations précédentes) :
            collapsible en dessous pour ne pas parasiter la vue primaire. */}
        {tab === "followup_email" && followupLeads.length > 0 && (
          <details className="mb-2 mt-8 bg-pink-50 border border-pink-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-pink-800 hover:bg-pink-100 rounded-lg flex items-center gap-2">
              <span>📬 {followupLeads.length} draft{followupLeads.length > 1 ? "s" : ""} de relance déjà généré{followupLeads.length > 1 ? "s" : ""} à valider</span>
              <span className="text-xs font-normal text-pink-600">(relances automatiques Task F ou générations précédentes)</span>
            </summary>
            <div className="space-y-4 p-4">
            {followupLeads.map((lead) => {
              const edited = editedFollowups[lead.id];
              const subject = edited?.subject ?? lead.metadata?.draft_followup_subject ?? "";
              const body = edited?.body ?? lead.metadata?.draft_followup_body ?? "";
              const emailTo = lead.metadata?.draft_followup_to || lead.email;
              const previousSubject = lead.metadata?.email_subject;
              const caseId = lead.metadata?.draft_followup_case_id;
              const isApproving = pendingIds[lead.id] === "approving";
              const isRejecting = pendingIds[lead.id] === "rejecting";
              const errorMsg = errors[lead.id];

              return (
                <div key={lead.id} className="bg-white rounded-xl shadow-sm border border-pink-200 p-5">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-900 hover:text-blue-600">
                          {lead.full_name}
                        </a>
                        <TierBadge tier={lead.tier} />
                        <span className="text-xs text-gray-400">#{lead.icp_score}</span>
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-pink-100 text-pink-700 rounded-full">
                          Relance #2
                        </span>
                        <EngagementBadges leadId={lead.id} />
                      </div>
                      <p className="text-sm text-gray-500">{lead.headline}</p>
                      <p className="text-xs text-gray-400">{lead.company_name} · {emailTo || "Pas d'email"}</p>
                    </div>
                  </div>

                  {/* Context: 1st email */}
                  {previousSubject && (
                    <div className="mb-3 bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600 border border-gray-200">
                      <span className="font-medium">1er email envoyé :</span> {previousSubject}
                    </div>
                  )}

                  {/* Case study used */}
                  {caseId && (
                    <div className="mb-3 bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700 border border-blue-100">
                      <span className="font-medium">Cas client utilisé :</span> #{caseId}
                    </div>
                  )}

                  {/* Subject input */}
                  <div className="mb-2">
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Objet</label>
                    <input
                      type="text"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-300"
                      value={subject}
                      onChange={(e) => setEditedFollowups((prev) => ({
                        ...prev,
                        [lead.id]: { ...(prev[lead.id] || {}), subject: e.target.value, body: prev[lead.id]?.body ?? body },
                      }))}
                    />
                  </div>

                  {/* Body (HTML preview/raw editor toggle) */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-500">Corps de l'email</label>
                      <button
                        type="button"
                        onClick={() => setEditingHtml((prev) => ({ ...prev, [lead.id]: !prev[lead.id] }))}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        {editingHtml[lead.id] ? "Retour texte" : "HTML brut"}
                      </button>
                    </div>
                    {editingHtml[lead.id] ? (
                      <textarea
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-pink-300 font-mono"
                        rows={8}
                        value={body}
                        onChange={(e) => setEditedFollowups((prev) => ({
                          ...prev,
                          [lead.id]: { ...(prev[lead.id] || {}), body: e.target.value, subject: prev[lead.id]?.subject ?? subject },
                        }))}
                      />
                    ) : (
                      <textarea
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-pink-300"
                        rows={10}
                        value={htmlToText(body)}
                        onChange={(e) => setEditedFollowups((prev) => ({
                          ...prev,
                          [lead.id]: {
                            ...(prev[lead.id] || {}),
                            body: textToHtml(e.target.value),
                            subject: prev[lead.id]?.subject ?? subject,
                          },
                        }))}
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
                      onClick={() => handleApproveFollowup(lead)}
                      disabled={isApproving || !subject.trim() || !body.trim() || !emailTo}
                      className="px-4 py-2 bg-pink-600 text-white text-sm font-medium rounded-lg hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={!emailTo ? "Email manquant" : ""}
                    >
                      {isApproving ? "Envoi…" : !emailTo ? "Email manquant" : "Envoyer la relance"}
                    </button>
                    <button
                      onClick={() => handleRejectFollowup(lead)}
                      disabled={isRejecting}
                      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
                    >
                      Rejeter
                    </button>
                    <RegenerateWithCases
                      leadId={lead.id}
                      apiPath="regenerate-email-followup"
                      onSuccess={() => {
                        setEditedFollowups((p) => { const n = { ...p }; delete n[lead.id]; return n; });
                        refetchFollowup();
                      }}
                    />
                    <div className="ml-auto flex items-center gap-1">
                      {["fr", "en"].map((lang) => {
                        const isCurrent = body.includes("Programmer un echange") ? "fr" : body.includes("Schedule a call") ? "en" : "fr";
                        const isRegenerating = pendingIds[lead.id] === "regen-" + lang;
                        return (
                          <button
                            key={lang}
                            onClick={() => {
                              setPendingIds((p) => ({ ...p, [lead.id]: "regen-" + lang }));
                              regenerateFollowup.mutate(
                                { id: lead.id, lang },
                                {
                                  onSuccess: () => {
                                    setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
                                    setEditedFollowups((prev) => { const n = { ...prev }; delete n[lead.id]; return n; });
                                    refetchFollowup();
                                  },
                                  onError: (err) => {
                                    setPendingIds((p) => { const n = { ...p }; delete n[lead.id]; return n; });
                                    setErrors((e) => ({ ...e, [lead.id]: err?.message || "Erreur" }));
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
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * RegenerateWithCases — "Refaire le mail" button with multi-select case studies.
 * Sits next to "Envoyer" and "Rejeter" on email draft cards.
 * `apiPath` lets us reuse the same UI for 1st emails (regenerate-email) and
 * relance drafts (regenerate-email-followup). Both endpoints accept the same
 * { case_study_ids } body shape.
 */
function RegenerateWithCases({ leadId, onSuccess, apiPath }) {
  const path = apiPath || "regenerate-email";
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const { data: caseData } = useQuery({
    queryKey: ["case-studies"],
    queryFn: () => api.get("/settings/case-studies"),
    staleTime: 300_000,
    enabled: open,
  });
  const cases = (caseData?.cases || []).filter((c) => c.is_active);

  const toggle = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const onRegenerate = async () => {
    setPending(true);
    setFeedback(null);
    try {
      await api.post(`/leads/${leadId}/${path}`, {
        case_study_ids: selectedIds.length > 0 ? selectedIds : undefined,
      });
      setFeedback({ ok: true });
      setOpen(false);
      setSelectedIds([]);
      if (onSuccess) onSuccess();
    } catch (err) {
      setFeedback({ ok: false, msg: err.message });
    }
    setPending(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-100 border border-indigo-200"
      >
        🔄 Refaire le mail
      </button>
    );
  }

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 mt-2">
      <div className="text-xs font-semibold text-indigo-800 mb-2">Cas clients à injecter dans le nouveau mail :</div>
      <div className="flex flex-wrap gap-1 mb-3">
        {cases.map((cs) => {
          const isOn = selectedIds.includes(cs.id);
          return (
            <button
              key={cs.id}
              type="button"
              onClick={() => toggle(cs.id)}
              disabled={pending}
              title={cs.description || ""}
              className={`px-2 py-1 text-[11px] rounded-full border transition-colors ${
                isOn
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              {cs.client_name}{cs.metric_value ? " · " + cs.metric_value : ""}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onRegenerate}
          disabled={pending}
          className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {pending ? "Régénération…" : "🔄 Regénérer avec " + selectedIds.length + " cas"}
        </button>
        <button
          onClick={() => { setOpen(false); setSelectedIds([]); setFeedback(null); }}
          disabled={pending}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
        >
          Annuler
        </button>
        {feedback && !feedback.ok && <span className="text-xs text-red-600">{feedback.msg}</span>}
        {feedback && feedback.ok && <span className="text-xs text-green-700">✅ Nouveau mail généré</span>}
      </div>
    </div>
  );
}
