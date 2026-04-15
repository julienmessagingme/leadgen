import { useState } from "react";
import { Link } from "react-router-dom";
import NavBar from "../components/shared/NavBar";
import { useColdRuns, useColdRun, useGenerateColdEmail } from "../hooks/useColdOutreach";

/**
 * /cold-outreach — dashboard page for the autonomous cold outreach agent
 * (Troudebal on OpenClaw). Shows the history of runs, lets you drill into
 * a run to see the proposed leads, and exposes a "Générer email" button per
 * lead that calls Sonnet to draft an email (which then shows up in the
 * existing /messages-draft email tab for human approval).
 */
export default function ColdOutreach() {
  const [selectedRunId, setSelectedRunId] = useState(null);
  const { data: runsData, isLoading: runsLoading, error: runsError } = useColdRuns();
  const runs = runsData?.runs || [];

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Cold Outreach — Troudebal</h1>
          <p className="text-sm text-gray-600 mt-1">
            Historique des runs quotidiens de l'agent de prospection froide.
            Chaque run propose jusqu'à 10 leads cold + angle d'approche + enrichissement.
            Le bouton « Générer email » déclenche Sonnet avec ce contexte et fait
            apparaître le draft dans <Link to="/messages-draft" className="text-indigo-600 underline">À valider</Link>.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Runs list (left column) */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="font-semibold text-gray-800">Runs</h2>
              </div>
              {runsLoading && <div className="p-4 text-gray-500 text-sm">Chargement...</div>}
              {runsError && <div className="p-4 text-red-600 text-sm">Erreur : {runsError.message}</div>}
              {!runsLoading && runs.length === 0 && (
                <div className="p-4 text-gray-500 text-sm">Aucun run pour l'instant. Le prochain est prévu demain 11h00 Paris.</div>
              )}
              <ul className="divide-y divide-gray-100">
                {runs.map((run) => (
                  <li key={run.id}>
                    <button
                      onClick={() => setSelectedRunId(run.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                        selectedRunId === run.id ? "bg-indigo-50 border-l-4 border-indigo-500" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800">{run.run_date}</span>
                        <span className="text-xs text-gray-500">{run.agent_name}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {run.leads_count} leads · {run.credits_used} crédits
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Run detail (right column) */}
          <div className="lg:col-span-2">
            {selectedRunId ? (
              <RunDetail runId={selectedRunId} />
            ) : (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                Sélectionne un run à gauche pour voir les leads proposés.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function RunDetail({ runId }) {
  const { data, isLoading, error } = useColdRun(runId);
  if (isLoading) return <div className="bg-white rounded-lg shadow p-6 text-gray-500">Chargement...</div>;
  if (error) return <div className="bg-white rounded-lg shadow p-6 text-red-600">Erreur : {error.message}</div>;
  if (!data) return null;

  const { run, leads } = data;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">
            Run du {run.run_date}
          </h2>
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
          <LeadCard key={lead.id} lead={lead} />
        ))}
      </div>
    </div>
  );
}

function LeadCard({ lead }) {
  const md = lead.metadata || {};
  const generate = useGenerateColdEmail();
  const [feedback, setFeedback] = useState(null);

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
    <div className="px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{lead.full_name || "—"}</span>
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
              {generate.isPending ? "Génération..." : "✉ Générer email"}
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
