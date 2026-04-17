import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * FollowupCasePicker — embedded inside MessagesDraft > "Relances email" tab.
 *
 * Lists leads eligible for a manual relance (email_sent_at between J-3 and
 * J-21, no follow-up sent/pending, not in a terminal status). For each lead,
 * Julien picks the case study to cite (or "Auto" sector-matching, or "None"
 * for a generic follow-up), then clicks "Générer" which creates the draft
 * via POST /leads/:id/generate-followup-now. The draft then flows into the
 * sibling sub-tab "Email à valider" for approval.
 *
 * The whole flow lives in one page — the old standalone /email-followups
 * route was folded in here to avoid dividing attention across two menus.
 */
export default function FollowupCasePicker() {
  const { data: candData, isLoading: candLoading, error: candError } = useQuery({
    queryKey: ["followup-candidates"],
    queryFn: () => api.get("/dashboard/followup-candidates"),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const { data: caseData, isLoading: caseLoading } = useQuery({
    queryKey: ["case-studies"],
    queryFn: () => api.get("/settings/case-studies"),
    staleTime: 300_000,
  });

  const candidates = candData?.candidates || [];
  const activeCases = (caseData?.cases || []).filter((c) => c.is_active);

  const [filter, setFilter] = useState("all");
  const filtered = candidates.filter((c) => {
    if (filter === "opened") return c.opens > 0;
    if (filter === "clicked") return c.clicks > 0;
    return true;
  });

  if (candLoading || caseLoading) {
    return <div className="text-center py-12 text-gray-400">Chargement…</div>;
  }
  if (candError) {
    return <div className="text-center py-12 text-red-600">Erreur : {candError.message}</div>;
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Leads dont le 1<sup>er</sup> email a été envoyé entre il y a 3 et 21 jours.
        Choisis le cas client à mettre en avant et clique « Générer ». Le draft
        apparaîtra dans l'onglet <b>Email à valider</b> juste à côté.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">Filtre :</span>
        {[
          { v: "all", label: "Tous (" + candidates.length + ")" },
          { v: "opened", label: "Ouverts (" + candidates.filter((c) => c.opens > 0).length + ")" },
          { v: "clicked", label: "Clics (" + candidates.filter((c) => c.clicks > 0).length + ")" },
        ].map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              filter === f.v ? "bg-indigo-600 text-white" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          Aucun lead éligible pour l'instant. La fenêtre est J-3 à J-21 après le 1<sup>er</sup> email.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {filtered.map((c) => (
            <CandidateRow key={c.id} candidate={c} cases={activeCases} />
          ))}
        </div>
      )}
    </div>
  );
}

function useFirstEmail(leadId, enabled) {
  return useQuery({
    queryKey: ["lead-first-email", leadId],
    queryFn: () => api.get(`/leads/${leadId}/first-email`),
    enabled: Boolean(enabled && leadId),
    staleTime: 5 * 60_000,
  });
}

function CandidateRow({ candidate: c, cases }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const { data: firstEmail, isLoading: firstEmailLoading } = useFirstEmail(c.id, expanded);

  const [selectedCaseIds, setSelectedCaseIds] = useState(() => {
    // Pre-select the best sector-matching case
    const leadSector = (c.company_sector || "").toLowerCase();
    if (leadSector) {
      for (const cs of cases) {
        const csSector = (cs.sector || "").toLowerCase();
        if (csSector && (leadSector.includes(csSector) || csSector.includes(leadSector))) {
          return [cs.id];
        }
      }
    }
    return [];
  });

  const toggleCase = (id) => {
    setSelectedCaseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const [feedback, setFeedback] = useState(null);

  const generate = useMutation({
    mutationFn: (body) => api.post(`/leads/${c.id}/generate-followup-now`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followup-candidates"] });
      qc.invalidateQueries({ queryKey: ["email-tracking"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  const rejectFollowup = useMutation({
    mutationFn: () => api.post(`/leads/${c.id}/reject-followup`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followup-candidates"] });
    },
  });

  const onGenerate = async () => {
    setFeedback(null);
    try {
      await generate.mutateAsync({
        case_study_ids: selectedCaseIds.length > 0 ? selectedCaseIds : ["none"],
      });
      setFeedback({ ok: true });
    } catch (err) {
      setFeedback({ ok: false, msg: err.message || "Erreur" });
    }
  };

  const onReject = async () => {
    if (!window.confirm(`Rejeter la relance pour ${c.full_name || "ce lead"} ? Il disparaîtra de cette liste sans changer son statut.`)) return;
    setFeedback(null);
    try {
      await rejectFollowup.mutateAsync();
      // On success the lead vanishes from the list on refetch
    } catch (err) {
      setFeedback({ ok: false, msg: err.message || "Erreur" });
    }
  };

  const tierBadge = {
    hot: "bg-red-100 text-red-800",
    warm: "bg-yellow-100 text-yellow-800",
    cold: "bg-gray-100 text-gray-600",
  }[c.tier] || "bg-gray-100 text-gray-600";

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-[280px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{c.full_name || "—"}</span>
            {c.linkedin_url && (
              <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">LinkedIn ↗</a>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${tierBadge}`}>{c.tier || "—"}</span>
            <span className="text-[10px] text-gray-500">score {c.icp_score ?? "?"}</span>
            {c.cold_outbound && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">cold</span>}
          </div>
          <div className="text-sm text-gray-700 mt-0.5">
            {c.headline || "—"}
            {c.company_name && <span className="text-gray-500"> · {c.company_name}</span>}
            {c.company_sector && <span className="text-gray-400"> · {c.company_sector}</span>}
          </div>
          <div className="text-xs text-gray-500 mt-1 flex gap-3 flex-wrap">
            <span>📧 {c.email || "—"}</span>
            <span>Envoyé il y a <b>{c.days_since_sent}j</b></span>
            <span className={c.opens > 0 ? "text-green-700" : "text-gray-400"}>
              {c.opens > 0 ? "👁 " + c.opens + " ouv." : "👁 pas lu"}
            </span>
            <span className={c.clicks > 0 ? "text-blue-700" : "text-gray-400"}>
              {c.clicks > 0 ? "🖱 " + c.clicks + " clic" : ""}
            </span>
          </div>
        </div>

        <div className="flex items-end gap-2 shrink-0">
          <div className="max-w-md">
            <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">
              Cas clients à citer ({selectedCaseIds.length} sélectionné{selectedCaseIds.length > 1 ? "s" : ""})
            </label>
            <div className="flex flex-wrap gap-1">
              {cases.map((cs) => {
                const isOn = selectedCaseIds.includes(cs.id);
                return (
                  <button
                    key={cs.id}
                    type="button"
                    onClick={() => toggleCase(cs.id)}
                    disabled={generate.isPending}
                    className={`px-2 py-1 text-[11px] rounded-full border transition-colors ${
                      isOn
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50"
                    }`}
                    title={cs.description ? cs.description.slice(0, 120) : undefined}
                  >
                    {cs.client_name}{cs.metric_value ? " · " + cs.metric_value : ""}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            onClick={onGenerate}
            disabled={generate.isPending || rejectFollowup.isPending}
            className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0"
          >
            {generate.isPending ? "Génération…" : "✉ Générer"}
          </button>
          <button
            onClick={onReject}
            disabled={generate.isPending || rejectFollowup.isPending}
            className="px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 shrink-0"
            title="Ne pas relancer ce lead (il sort de la liste, son statut reste inchangé)"
          >
            {rejectFollowup.isPending ? "…" : "✕ Rejeter"}
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`mt-3 text-sm rounded p-2 ${feedback.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {feedback.ok ? (
            <>Draft prêt — il apparaît dans l'onglet <b>Email à valider</b> à côté.</>
          ) : (
            <>Erreur : {feedback.msg}</>
          )}
        </div>
      )}

      <div className="mt-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <span className="inline-block w-3 transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
          {expanded ? "Masquer le 1er mail" : "Voir le 1er mail envoyé"}
        </button>

        {expanded && (
          <div className="mt-2 border border-gray-200 rounded-md bg-gray-50 p-3">
            {firstEmailLoading ? (
              <div className="text-xs text-gray-400">Chargement…</div>
            ) : !firstEmail ? (
              <div className="text-xs text-red-600">Impossible de charger le mail.</div>
            ) : (
              <>
                <div className="text-xs text-gray-500 mb-1">
                  Envoyé le{" "}
                  <span className="font-mono">
                    {new Date(firstEmail.sent_at).toLocaleString("fr-FR", {
                      day: "2-digit", month: "2-digit", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>
                {firstEmail.subject && (
                  <div className="text-sm font-semibold text-gray-800 mb-2">
                    Objet : {firstEmail.subject}
                  </div>
                )}
                {firstEmail.body_archived && firstEmail.body ? (
                  <div
                    className="text-sm text-gray-700 bg-white rounded border border-gray-200 p-3 prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: firstEmail.body }}
                  />
                ) : (
                  <div className="text-xs text-gray-500 italic">
                    Corps du mail non archivé pour ce lead (antérieur à la feature). Si besoin,
                    retrouve-le dans Gmail Sent avec l'ID{" "}
                    <span className="font-mono">{firstEmail.message_id || "—"}</span>.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
