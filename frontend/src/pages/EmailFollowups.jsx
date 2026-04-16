import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import NavBar from "../components/shared/NavBar";

/**
 * /email-followups — "Relances à préparer"
 *
 * Daily queue of leads that could receive a 2nd email. Julien picks the
 * case study manually (instead of Sonnet auto-matching by sector), then
 * clicks "Générer avec ce cas" to drop a draft into /messages-draft
 * Relances mail tab for human approval.
 *
 * Window handled server-side: email_sent_at between J-3 and J-21, excluding
 * terminal / already-pending / already-sent statuses.
 */
export default function EmailFollowups() {
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

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">📬 Relances à préparer</h1>
          <p className="text-sm text-gray-500 mt-1">
            Leads dont le 1<sup>er</sup> email a été envoyé entre il y a 3 et 21 jours.
            Choisis le cas client à mettre en avant, Sonnet génère le draft et
            l'envoie dans <Link to="/messages-draft" className="text-indigo-600 underline">Relances mail</Link> pour validation.
          </p>
        </header>

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

        {candLoading || caseLoading ? (
          <div className="text-center py-12 text-gray-400">Chargement…</div>
        ) : candError ? (
          <div className="text-center py-12 text-red-600">Erreur : {candError.message}</div>
        ) : filtered.length === 0 ? (
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
      </main>
    </div>
  );
}

function CandidateRow({ candidate: c, cases }) {
  const qc = useQueryClient();
  const [selectedCaseId, setSelectedCaseId] = useState(() => {
    // Pre-select the case whose sector best matches the lead, so Julien only
    // has to confirm in the common case. "none" if no sector match.
    const leadSector = (c.company_sector || "").toLowerCase();
    if (leadSector) {
      for (const cs of cases) {
        const csSector = (cs.sector || "").toLowerCase();
        if (csSector && (leadSector.includes(csSector) || csSector.includes(leadSector))) {
          return String(cs.id);
        }
      }
    }
    return cases[0] ? String(cases[0].id) : "none";
  });

  const [feedback, setFeedback] = useState(null);

  const generate = useMutation({
    mutationFn: (body) => api.post(`/leads/${c.id}/generate-followup-now`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followup-candidates"] });
      qc.invalidateQueries({ queryKey: ["email-tracking"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  const onGenerate = async () => {
    setFeedback(null);
    try {
      await generate.mutateAsync({
        case_study_id: selectedCaseId === "none" ? "none" : Number.parseInt(selectedCaseId, 10),
      });
      setFeedback({ ok: true });
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
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Cas client</label>
            <select
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              className="text-sm rounded-md border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
              disabled={generate.isPending}
            >
              <option value="none">— Aucun (générique) —</option>
              {cases.map((cs) => (
                <option key={cs.id} value={String(cs.id)}>
                  {cs.client_name}{cs.sector ? " · " + cs.sector : ""}{cs.metric_label ? " · " + cs.metric_label + " " + cs.metric_value : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={onGenerate}
            disabled={generate.isPending}
            className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0"
          >
            {generate.isPending ? "Génération…" : "✉ Générer"}
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`mt-3 text-sm rounded p-2 ${feedback.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {feedback.ok ? (
            <>Draft prêt — <Link to="/messages-draft" className="underline font-medium">voir dans Relances mail →</Link></>
          ) : (
            <>Erreur : {feedback.msg}</>
          )}
        </div>
      )}
    </div>
  );
}
