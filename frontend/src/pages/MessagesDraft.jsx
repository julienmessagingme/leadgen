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

export default function MessagesDraft() {
  const [editedMessages, setEditedMessages] = useState({});
  const { data, isLoading, refetch } = useLeads({
    status: "message_pending",
    sort: "icp_score",
    order: "desc",
    limit: 100,
  });
  const approve = useApproveMessage();
  const reject = useRejectMessage();

  const leads = data?.leads ?? [];

  const handleApprove = (lead) => {
    const message = editedMessages[lead.id] ?? lead.metadata?.draft_message ?? "";
    approve.mutate({ id: lead.id, message }, { onSuccess: () => refetch() });
  };

  const handleReject = (lead) => {
    reject.mutate({ id: lead.id }, { onSuccess: () => refetch() });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Messages à valider</h1>
          <p className="text-sm text-gray-500 mt-1">
            {leads.length} message{leads.length !== 1 ? "s" : ""} en attente — relisez, modifiez si besoin, puis envoyez.
          </p>
        </div>

        {isLoading && (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        )}

        {!isLoading && leads.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            Aucun message en attente. Task C n'a pas encore tourné ou tous les messages ont été traités.
          </div>
        )}

        <div className="space-y-4">
          {leads.map((lead) => {
            const draft = editedMessages[lead.id] ?? lead.metadata?.draft_message ?? "";
            const postText = lead.metadata?.post_text;
            const isApproving = approve.isPending;
            const isRejecting = reject.isPending;

            return (
              <div key={lead.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <a
                        href={lead.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-gray-900 hover:text-blue-600"
                      >
                        {lead.full_name}
                      </a>
                      <TierBadge tier={lead.tier} />
                      <span className="text-xs text-gray-400">#{lead.icp_score}</span>
                    </div>
                    <p className="text-sm text-gray-500">{lead.headline}</p>
                    <p className="text-xs text-gray-400">{lead.company_name} · {lead.signal_source}</p>
                  </div>
                </div>

                {/* Post context */}
                {postText && (
                  <div className="mb-3 bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700 border border-blue-100">
                    <span className="font-medium">Post liké :</span> {postText.slice(0, 200)}{postText.length > 200 ? "…" : ""}
                  </div>
                )}

                {/* Editable message */}
                <textarea
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                  rows={4}
                  value={draft}
                  onChange={(e) =>
                    setEditedMessages((prev) => ({ ...prev, [lead.id]: e.target.value }))
                  }
                />

                {/* Actions */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleApprove(lead)}
                    disabled={isApproving || !draft.trim()}
                    className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isApproving ? "Envoi…" : "✓ Envoyer"}
                  </button>
                  <button
                    onClick={() => handleReject(lead)}
                    disabled={isRejecting}
                    className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    ✗ Rejeter
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
