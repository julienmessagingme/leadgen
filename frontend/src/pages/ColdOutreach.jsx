import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDraggable,
} from "@dnd-kit/core";
import { api } from "../api/client";
import NavBar from "../components/shared/NavBar";
import Campaigns from "../components/cold/Campaigns";
import { useColdRuns, useColdRun, useGenerateColdEmail } from "../hooks/useColdOutreach";
import { useActiveCampaigns, useAddToCampaign } from "../hooks/useCampaigns";

/**
 * /cold-outreach — AI Agents dashboard.
 * Launch the multi-agent cold prospecting pipeline (Researcher → Qualifier
 * → Challenger) and see the history of past runs + their leads.
 *
 * Each lead card is draggable to one of the 3 shared Campagnes (right sidebar,
 * sticky). Validating a Campagne generates email drafts → /messages-draft > Campagne.
 */
export default function ColdOutreach() {
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [activeDrag, setActiveDrag] = useState(null);
  const { data: runsData, isLoading: runsLoading, error: runsError } = useColdRuns();
  const runs = runsData?.runs || [];

  const { data: campaignsData } = useActiveCampaigns();
  const campaigns = campaignsData?.campaigns || [];
  const campaignedUrls = new Set();
  campaigns.forEach((c) => (c.items || []).forEach((it) => it.linkedin_url && campaignedUrls.add(it.linkedin_url)));

  const addToCampaign = useAddToCampaign();

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const keyboardSensor = useSensor(KeyboardSensor);
  const sensors = useSensors(pointerSensor, keyboardSensor);

  const handleDragStart = (event) => {
    const d = event.active.data.current;
    if (d) setActiveDrag(d);
  };

  const handleDragEnd = (event) => {
    setActiveDrag(null);
    if (!event.over) return;
    const targetId = event.over.id;
    const dragData = event.active.data.current;
    if (!dragData || typeof targetId !== "string" || !targetId.startsWith("campaign-")) return;
    const campaignId = Number.parseInt(targetId.replace("campaign-", ""), 10);
    if (!Number.isInteger(campaignId)) return;
    const lead = dragData.lead;
    if (!lead || !lead.linkedin_url) return;

    addToCampaign.mutate({
      campaignId,
      payload: {
        lead_id: lead.id,
        linkedin_url: lead.linkedin_url,
        profile_snapshot: {
          full_name: lead.full_name,
          headline: lead.headline,
          company_name: lead.company_name,
          company_sector: lead.company_sector,
          location: lead.company_location || lead.location,
          email: lead.email,
        },
      },
    });
  };

  const handleDragCancel = () => setActiveDrag(null);

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <main className="max-w-full mx-auto px-4 py-6">
          <div className="mb-6 max-w-7xl">
            <h1 className="text-2xl font-bold text-gray-800">🤖 AI Agents — Cold Outreach</h1>
            <p className="text-sm text-gray-600 mt-1">
              Pipeline multi-agents : Chercheur (BeReach) → Qualifieur (enrichissement + 5 checks) → Challenger (critique).
              Glisse un lead dans une Campagne à droite pour grouper les drafts, puis valide avec un cas client optionnel.
            </p>
          </div>

          <div className="max-w-7xl mb-6">
            <LaunchForm />
          </div>

          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
                  <div className="bg-white rounded-lg shadow">
                    <div className="px-4 py-3 border-b border-gray-200">
                      <h2 className="font-semibold text-gray-800">Historique des runs</h2>
                    </div>
                    {runsLoading && <div className="p-4 text-gray-500 text-sm">Chargement...</div>}
                    {runsError && <div className="p-4 text-red-600 text-sm">Erreur : {runsError.message}</div>}
                    {!runsLoading && runs.length === 0 && (
                      <div className="p-4 text-gray-500 text-sm">Aucun run pour l'instant. Le prochain est prévu demain 11h00 Paris.</div>
                    )}
                    <ul className="divide-y divide-gray-100">
                      {runs.map((run) => {
                        const isRunning = run.status === "running";
                        const isFailed = run.status === "failed";
                        const phaseLabel = { researcher: "1/4 Researcher", qualifier: "2/4 Qualifier", challenger: "3/4 Challenger", persist: "4/4 Persist" }[run.phase] || run.phase;
                        const theme = run.brief?.theme || run.metadata?.brief?.theme || run.metadata?.run_notes || "—";
                        return (
                          <li key={run.id}>
                            <button
                              onClick={() => setSelectedRunId(run.id)}
                              className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                                selectedRunId === run.id ? "bg-indigo-50 border-l-4 border-indigo-500" : ""
                              } ${isRunning ? "bg-yellow-50/50" : ""} ${isFailed ? "bg-red-50/30" : ""}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-gray-800">{run.run_date}</span>
                                {isRunning && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-200 text-yellow-900 font-semibold animate-pulse">
                                    ⏳ {phaseLabel}
                                  </span>
                                )}
                                {isFailed && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">
                                    ✗ Échoué
                                  </span>
                                )}
                                {!isRunning && !isFailed && (
                                  <span className="text-xs text-gray-500">{run.agent_name}</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-600 mt-1 truncate italic">« {theme} »</div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {isRunning
                                  ? "Démarré " + new Date(run.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                                  : run.leads_count + " leads · " + run.credits_used + " crédits"}
                              </div>
                              {isFailed && run.error_message && (
                                <div className="text-[10px] text-red-600 mt-0.5 truncate">{run.error_message}</div>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>

                <div className="lg:col-span-2">
                  {selectedRunId ? (
                    <RunDetail runId={selectedRunId} campaignedUrls={campaignedUrls} />
                  ) : (
                    <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                      Sélectionne un run à gauche pour voir les leads proposés.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="w-[420px] flex-shrink-0">
              <div className="sticky top-4 h-[calc(100vh-6rem)]">
                <Campaigns />
              </div>
            </div>
          </div>
        </main>

        <DragOverlay>
          {activeDrag?.lead ? (
            <div className="bg-white rounded-lg shadow-lg border border-indigo-200 px-3 py-2 w-64 opacity-90">
              <div className="text-sm font-medium text-gray-900 truncate">{activeDrag.lead.full_name || "--"}</div>
              <div className="text-xs text-gray-500 truncate">{activeDrag.lead.headline || "--"}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function RunDetail({ runId, campaignedUrls }) {
  const { data, isLoading, error } = useColdRun(runId);
  if (isLoading) return <div className="bg-white rounded-lg shadow p-6 text-gray-500">Chargement...</div>;
  if (error) return <div className="bg-white rounded-lg shadow p-6 text-red-600">Erreur : {error.message}</div>;
  if (!data) return null;

  const { run, leads } = data;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">Run du {run.run_date}</h2>
          <div className="text-sm text-gray-500">
            {leads.length} leads · {run.credits_used} crédits consommés
          </div>
        </div>
        {run.metadata?.run_notes && (
          <p className="text-sm text-gray-600 mt-2 italic">« {run.metadata.run_notes} »</p>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {leads.length === 0 && (
          <div className="p-6 text-gray-500 text-sm">Aucun lead dans ce run.</div>
        )}
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} inCampaign={campaignedUrls.has(lead.linkedin_url)} />
        ))}
      </div>
    </div>
  );
}

function LeadCard({ lead, inCampaign }) {
  const md = lead.metadata || {};
  const generate = useGenerateColdEmail();
  const [feedback, setFeedback] = useState(null);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `ai-lead-${lead.id}`,
    data: { lead },
    disabled: !lead.linkedin_url,
  });

  const onGenerate = async () => {
    setFeedback(null);
    try {
      await generate.mutateAsync(lead.id);
      setFeedback({ ok: true, msg: "Draft généré — vérifie l'onglet « À valider » (tab Email)." });
    } catch (err) {
      setFeedback({ ok: false, msg: err.message || "Erreur lors de la génération" });
    }
  };

  const hasEmail = Boolean(lead.email);
  const hasDraft = Boolean(md.draft_email_body);
  const status = lead.status;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      className={`px-6 py-4 transition-opacity ${isDragging ? "opacity-40" : ""} ${inCampaign ? "bg-teal-50/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              {...listeners}
              className="cursor-grab active:cursor-grabbing select-none font-semibold text-gray-900 hover:text-indigo-700"
              title="Glisser vers une campagne"
            >
              ⋮⋮ {lead.full_name || "—"}
            </span>
            {lead.linkedin_url && (
              <a
                href={lead.linkedin_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-600 hover:underline"
              >
                LinkedIn ↗
              </a>
            )}
            <StatusBadge status={status} />
            {inCampaign && (
              <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide bg-teal-100 text-teal-700">
                En campagne
              </span>
            )}
          </div>
          <div className="text-sm text-gray-700 mt-0.5">
            {lead.headline || "—"}
            {lead.company_name && <span className="text-gray-500"> · {lead.company_name}</span>}
            {lead.company_sector && <span className="text-gray-400"> · {lead.company_sector}</span>}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {lead.email || <span className="italic">email manquant</span>}
            {lead.company_size && <span> · {lead.company_size}</span>}
            {lead.company_location && <span> · {lead.company_location}</span>}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          {hasEmail && !hasDraft && status !== "email_sent" && (
            <button
              onClick={onGenerate}
              disabled={generate.isPending}
              className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {generate.isPending ? "Génération..." : "✉ Générer email (direct)"}
            </button>
          )}
          {hasDraft && (
            <Link
              to="/messages-draft"
              className="px-3 py-1.5 text-sm rounded-md bg-green-600 text-white hover:bg-green-700"
            >
              Voir le draft →
            </Link>
          )}
          {!hasEmail && (
            <span className="text-xs text-gray-400">pas d'email — pas de génération possible</span>
          )}
        </div>
      </div>

      {(md.icp_fit_reasoning || md.angle_of_approach) && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {md.icp_fit_reasoning && (
            <div className="bg-gray-50 rounded p-3">
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Pourquoi ICP</div>
              <div className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{md.icp_fit_reasoning}</div>
            </div>
          )}
          {md.angle_of_approach && (
            <div className="bg-amber-50 rounded p-3">
              <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Angle d'attaque</div>
              <div className="text-sm text-amber-900 mt-1 whitespace-pre-wrap">{md.angle_of_approach}</div>
            </div>
          )}
        </div>
      )}

      {md.enrichment && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Détails enrichissement</summary>
          <pre className="mt-2 bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto text-[11px]">
            {JSON.stringify(md.enrichment, null, 2)}
          </pre>
        </details>
      )}

      {feedback && (
        <div className={`mt-3 text-sm rounded p-2 ${feedback.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {feedback.msg}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    scored: { label: "Proposé", cls: "bg-blue-100 text-blue-800" },
    email_pending: { label: "Draft prêt", cls: "bg-yellow-100 text-yellow-800" },
    email_sent: { label: "Email envoyé", cls: "bg-green-100 text-green-800" },
    disqualified: { label: "Rejeté", cls: "bg-gray-100 text-gray-600" },
  };
  const entry = map[status] || { label: status, cls: "bg-gray-100 text-gray-700" };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${entry.cls}`}>
      {entry.label}
    </span>
  );
}

/**
 * LaunchForm — brief du jour + bouton "Lancer aujourd'hui"
 */
function LaunchForm() {
  const qc = useQueryClient();
  const [theme, setTheme] = useState("");
  const [geo, setGeo] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [feedback, setFeedback] = useState(null);

  const launch = useMutation({
    mutationFn: (body) => api.post("/cold-outreach/run-today", body),
    onSuccess: (data) => {
      setFeedback({ ok: true, runId: data.run_id });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["cold-runs"] }), 5000);
    },
    onError: (err) => {
      setFeedback({ ok: false, msg: err.message });
    },
  });

  const onSubmit = (e) => {
    e.preventDefault();
    if (!theme.trim()) return;
    setFeedback(null);
    launch.mutate({ theme: theme.trim(), geo: geo.trim() || undefined, exclusions: exclusions.trim() || undefined });
  };

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h2 className="text-sm font-semibold text-gray-800 mb-3">🚀 Lancer un run aujourd'hui</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Thème / cible du jour <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder='ex: "transporteurs 200+ salariés PACA" ou "courtage assurance Bordeaux"'
            className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            required
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Géo (optionnel)</label>
            <input
              type="text"
              value={geo}
              onChange={(e) => setGeo(e.target.value)}
              placeholder="ex: PACA, IDF, France, GCC"
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Exclusions (optionnel)</label>
            <input
              type="text"
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              placeholder="ex: Keolis, Transdev (en plus de la blacklist standard)"
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={launch.isPending || !theme.trim()}
            className="px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {launch.isPending ? "Lancement en cours..." : "🚀 Lancer aujourd'hui"}
          </button>
          {feedback && feedback.ok && (
            <div className="text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded-md">
              ✅ Pipeline lancé (run {feedback.runId.slice(0, 8)}…). Les résultats apparaîtront dans l'historique dans ~5-15 min.
            </div>
          )}
          {feedback && !feedback.ok && (
            <div className="text-sm text-red-700 bg-red-50 px-3 py-1.5 rounded-md">
              ❌ {feedback.msg}
            </div>
          )}
        </div>
      </form>
      <div className="mt-3 text-[11px] text-gray-400 leading-relaxed">
        Pipeline : Chercheur (Sonnet + BeReach ~150 cr) → Qualifieur (Sonnet + enrich ~100 cr + FullEnrich ~15 cr) → Challenger (Sonnet, 0 tool). Durée ~5-15 min. Coût Claude ~$0.60/run.
      </div>
    </div>
  );
}
