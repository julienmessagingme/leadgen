import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { htmlToText, textToHtml } from "../../utils/htmlText";

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
        Choisis le(s) cas client à citer, clique <b>Générer</b> : le mail apparaît
        directement sous la card pour édition et envoi. Refaire avec d'autres cas
        autant de fois que tu veux avant d'envoyer.
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

/**
 * Compact dropdown for picking one or more case studies. Replaces the
 * previous grid of 20 chip buttons that overwhelmed the card.
 */
function CaseDropdown({ cases, selectedIds, onToggle, disabled }) {
  const [open, setOpen] = useState(false);
  const count = selectedIds.length;
  const label = count === 0
    ? "Aucun cas"
    : count === 1
      ? (cases.find((c) => c.id === selectedIds[0])?.client_name || "1 cas")
      : `${count} cas sélectionnés`;
  return (
    <div className="relative">
      <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">
        Cas clients
      </label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="px-3 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 min-w-[220px] text-left flex items-center justify-between gap-2"
      >
        <span className={count > 0 ? "text-gray-800" : "text-gray-400"}>{label}</span>
        <span className="text-xs text-gray-400">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-80 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
            {cases.length === 0 ? (
              <div className="p-3 text-xs text-gray-400">Aucun cas actif.</div>
            ) : (
              cases.map((cs) => {
                const isOn = selectedIds.includes(cs.id);
                return (
                  <label
                    key={cs.id}
                    className={`flex items-start gap-2 px-3 py-2 text-sm hover:bg-indigo-50 cursor-pointer ${isOn ? "bg-indigo-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => onToggle(cs.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-800 truncate">{cs.client_name}</div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {cs.sector}{cs.metric_value ? ` · ${cs.metric_value}` : ""}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CandidateRow({ candidate: c, cases }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const { data: firstEmail, isLoading: firstEmailLoading } = useFirstEmail(c.id, expanded);

  // Pre-select: the case already used in the existing draft, else sector-match
  const initialSelection = (() => {
    if (c.draft_case_id) return [c.draft_case_id];
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
  })();
  const [selectedCaseIds, setSelectedCaseIds] = useState(initialSelection);
  const toggleCase = (id) =>
    setSelectedCaseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  // Inline draft state — seeded from the lead if a draft already exists.
  // Mutations update this in place so the row acts like an inline editor.
  const [draft, setDraft] = useState(
    c.draft_subject && c.draft_body
      ? { subject: c.draft_subject, body: c.draft_body }
      : null
  );
  const [showHtml, setShowHtml] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // generate-followup-now (first generation) vs regenerate-email-followup (refaire)
  const generate = useMutation({
    mutationFn: (body) => {
      const endpoint = draft ? "regenerate-email-followup" : "generate-followup-now";
      return api.post(`/leads/${c.id}/${endpoint}`, body);
    },
    // Deliberately NOT invalidating the candidates list so the row stays
    // in place — the inline draft is the whole point.
  });

  const approve = useMutation({
    mutationFn: (payload) => api.post(`/leads/${c.id}/approve-email-followup`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followup-candidates"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  const rejectFollowup = useMutation({
    mutationFn: () => api.post(`/leads/${c.id}/reject-followup`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["followup-candidates"] }),
  });

  const onGenerate = async () => {
    setFeedback(null);
    try {
      const res = await generate.mutateAsync({
        case_study_ids: selectedCaseIds.length > 0 ? selectedCaseIds : ["none"],
      });
      if (res && res.subject && res.body) {
        setDraft({ subject: res.subject, body: res.body });
      }
      setFeedback({ ok: true, msg: draft ? "Mail régénéré" : "Mail généré" });
    } catch (err) {
      setFeedback({ ok: false, msg: err?.message || "Erreur" });
    }
  };

  const onSend = async () => {
    if (!draft) return;
    setFeedback(null);
    try {
      await approve.mutateAsync({ subject: draft.subject, body: draft.body });
      // Row disappears on refetch after success
    } catch (err) {
      setFeedback({ ok: false, msg: err?.message || "Erreur" });
    }
  };

  const onReject = async () => {
    if (!window.confirm(`Rejeter la relance pour ${c.full_name || "ce lead"} ?`)) return;
    setFeedback(null);
    try {
      await rejectFollowup.mutateAsync();
    } catch (err) {
      setFeedback({ ok: false, msg: err?.message || "Erreur" });
    }
  };

  const tierBadge = {
    hot: "bg-red-100 text-red-800",
    warm: "bg-yellow-100 text-yellow-800",
    cold: "bg-gray-100 text-gray-600",
  }[c.tier] || "bg-gray-100 text-gray-600";

  const isBusy = generate.isPending || approve.isPending || rejectFollowup.isPending;

  return (
    <div className="px-5 py-4">
      {/* Candidate info + controls */}
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
            {c.status === "email_followup_pending" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">draft prêt</span>
            )}
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
          <CaseDropdown
            cases={cases}
            selectedIds={selectedCaseIds}
            onToggle={toggleCase}
            disabled={isBusy}
          />
          <button
            onClick={onGenerate}
            disabled={isBusy}
            className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0"
          >
            {generate.isPending
              ? (draft ? "Régénération…" : "Génération…")
              : (draft ? "🔄 Refaire avec ces cas" : "✉ Générer")}
          </button>
        </div>
      </div>

      {/* Inline draft editor — shows as soon as a draft exists */}
      {draft && (
        <div className="mt-4 border border-indigo-200 rounded-lg bg-white p-3">
          <div className="text-[10px] text-indigo-700 uppercase tracking-wide mb-2 font-semibold">
            Mail de relance à envoyer
          </div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1">Objet</label>
          <input
            type="text"
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            disabled={isBusy}
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm mb-3"
          />
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[10px] text-gray-500 uppercase">Corps</label>
            <button
              type="button"
              onClick={() => setShowHtml((v) => !v)}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >
              {showHtml ? "Retour texte" : "HTML brut"}
            </button>
          </div>
          {showHtml ? (
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              disabled={isBusy}
              rows={14}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          ) : (
            <textarea
              value={htmlToText(draft.body)}
              onChange={(e) => setDraft({ ...draft, body: textToHtml(e.target.value) })}
              disabled={isBusy}
              rows={12}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={onSend}
              disabled={isBusy || !draft.subject.trim() || !draft.body.trim() || !c.email}
              className="px-4 py-2 text-sm rounded-md bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
              title={!c.email ? "Email manquant" : ""}
            >
              {approve.isPending ? "Envoi…" : !c.email ? "Email manquant" : "Envoyer la relance"}
            </button>
            <button
              onClick={onReject}
              disabled={isBusy}
              className="px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {rejectFollowup.isPending ? "…" : "Rejeter"}
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <div className={`mt-3 text-sm rounded p-2 ${feedback.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {feedback.ok ? feedback.msg : <>Erreur : {feedback.msg}</>}
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
