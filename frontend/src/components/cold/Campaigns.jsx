import { useState, useEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  useActiveCampaigns,
  useAddToCampaign,
  useRemoveFromCampaign,
  useRenameCampaign,
  useValidateCampaign,
  useCaseStudies,
} from "../../hooks/useCampaigns";
import { useColdScenarios } from "../../hooks/useColdOutbound";

/**
 * <Campaigns /> — shared bucket panel used by /cold-outbound AND /cold-outreach.
 *
 * Persisted server-side (table `campaigns`). Always 3 draft slots. Validating
 * a campaign generates email drafts and archives it under /messages-draft tab
 * "Campagne".
 */
export default function Campaigns() {
  const { data, isLoading } = useActiveCampaigns();
  const campaigns = data?.campaigns || [];

  if (isLoading && campaigns.length === 0) {
    return <div className="h-full flex items-center justify-center text-xs text-gray-400">Chargement…</div>;
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      {campaigns.map((c) => (
        <CampaignCard key={c.id} campaign={c} />
      ))}
    </div>
  );
}

function CampaignCard({ campaign }) {
  const { setNodeRef, isOver } = useDroppable({ id: `campaign-${campaign.id}`, data: { campaignId: campaign.id } });

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(campaign.name);
  const rename = useRenameCampaign();
  const remove = useRemoveFromCampaign();

  useEffect(() => { setEditName(campaign.name); }, [campaign.name]);

  const items = campaign.items || [];

  const saveName = () => {
    setIsEditing(false);
    const trimmed = editName.trim();
    if (trimmed && trimmed !== campaign.name) {
      rename.mutate({ campaignId: campaign.id, name: trimmed });
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-full flex-1 min-h-0 rounded-lg border-2 transition-all duration-150 ${
        isOver ? "border-indigo-400 bg-indigo-50/50 scale-[1.01] shadow-lg" : "border-gray-200 bg-gray-50"
      }`}
    >
      <div className="px-2 py-2 border-b border-gray-200 bg-white rounded-t-lg">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setIsEditing(false); }}
            autoFocus
            className="w-full text-xs font-semibold text-gray-800 border border-indigo-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        ) : (
          <div
            className="flex items-center justify-between cursor-pointer"
            onDoubleClick={() => { setIsEditing(true); setEditName(campaign.name); }}
            title="Double-clic pour renommer"
          >
            <span className="text-xs font-semibold text-gray-800 truncate">{campaign.name}</span>
            <span className="text-xs text-gray-400 ml-1">({items.length})</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1.5">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center border-2 border-dashed border-gray-300 rounded-md p-3">
            <span className="text-xs text-gray-400 text-center">Glisser des profils ici</span>
          </div>
        ) : (
          items.map((it) => (
            <LeadPill
              key={it.id}
              item={it}
              onRemove={() => remove.mutate({ campaignId: campaign.id, linkedin_url: it.linkedin_url })}
            />
          ))
        )}
      </div>

      {items.length > 0 && (
        <div className="px-1.5 py-1.5 border-t border-gray-200 bg-white rounded-b-lg">
          <ValidateButton campaign={campaign} />
        </div>
      )}
    </div>
  );
}

function LeadPill({ item, onRemove }) {
  const p = item.profile_snapshot || {};
  const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "--";
  const headline = p.headline || p.company_name || p.company || "";
  const source = item.lead_id ? "AI Agent" : item.cold_search_id ? "Cold search" : null;

  return (
    <div className="bg-white rounded-md p-2 shadow-sm border border-gray-100 group">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-gray-900 truncate">{name}</div>
          {headline && <div className="text-[10px] text-gray-500 truncate">{headline}</div>}
          {source && (
            <span className={`inline-block mt-0.5 px-1 py-0 text-[9px] font-medium rounded ${
              item.lead_id ? "bg-indigo-100 text-indigo-700" : "bg-amber-100 text-amber-700"
            }`}>
              {source}
            </span>
          )}
        </div>
        <button
          onClick={onRemove}
          className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded w-5 h-5 flex items-center justify-center flex-shrink-0 text-sm leading-none transition-colors"
          title="Retirer de la campagne"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function ValidateButton({ campaign }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState("scenario"); // scenario → case_study → submitting
  const [scenarioIndex, setScenarioIndex] = useState(null);
  const validate = useValidateCampaign();
  const { data: scenariosData } = useColdScenarios();
  const { data: csData } = useCaseStudies();
  const scenarios = scenariosData?.scenarios || [];
  const caseStudies = (csData?.cases || []).filter((c) => c.is_active !== false);

  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  const submit = async (caseStudyId) => {
    setStep("submitting");
    try {
      await validate.mutateAsync({
        campaignId: campaign.id,
        scenario_index: scenarioIndex,
        case_study_id: caseStudyId,
      });
      setOpen(false);
      setStep("scenario");
      setScenarioIndex(null);
    } catch (err) {
      alert("Erreur : " + (err.message || "inconnue"));
      setStep("scenario");
    }
  };

  const pickScenario = (idx) => {
    setScenarioIndex(idx);
    setStep("case_study");
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => { setOpen(!open); setStep("scenario"); }}
        disabled={validate.isPending || step === "submitting"}
        className="w-full px-2 py-1.5 text-[10px] font-medium rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {step === "submitting" || validate.isPending
          ? "Génération en cours…"
          : `Valider la campagne (${campaign.items?.length || 0}) ▾`}
      </button>
      {open && step !== "submitting" && (
        <div className="absolute z-50 left-0 bottom-full mb-1 w-full bg-white rounded-lg shadow-xl border border-gray-200 py-1 max-h-72 overflow-y-auto">
          {step === "scenario" && (
            <>
              <div className="px-2 py-1 text-[9px] uppercase tracking-wide text-gray-400 font-semibold">1. Scénario</div>
              {scenarios.length > 0 && scenarios.map((sc, i) => (
                <button key={i} onClick={() => pickScenario(i)} className="w-full text-left px-2 py-1.5 text-[10px] hover:bg-purple-50">
                  <span className="font-medium text-gray-900">{sc.name || `Scénario ${i + 1}`}</span>
                </button>
              ))}
              <button onClick={() => pickScenario(null)} className="w-full text-left px-2 py-1.5 text-[10px] text-gray-500 hover:bg-gray-50 border-t border-gray-100">
                — Pas de scénario (angle agent seul) —
              </button>
            </>
          )}
          {step === "case_study" && (
            <>
              <div className="px-2 py-1 text-[9px] uppercase tracking-wide text-gray-400 font-semibold">2. Cas client (optionnel)</div>
              <button
                onClick={() => submit(null)}
                className="w-full text-left px-2 py-1.5 text-[10px] text-gray-500 hover:bg-gray-50 italic border-b border-gray-100"
              >
                — Sans cas client —
              </button>
              {caseStudies.map((cs) => (
                <button
                  key={cs.id}
                  onClick={() => submit(cs.id)}
                  className="w-full text-left px-2 py-1.5 text-[10px] hover:bg-purple-50"
                >
                  <div className="font-medium text-gray-900">{cs.client_name}</div>
                  <div className="text-[9px] text-gray-500">{cs.sector} · {cs.metric_label}: {cs.metric_value}</div>
                </button>
              ))}
              {caseStudies.length === 0 && (
                <div className="px-2 py-1.5 text-[10px] text-gray-400 italic">Aucun cas client — ajoute-en dans Paramètres</div>
              )}
              <button
                onClick={() => setStep("scenario")}
                className="w-full text-left px-2 py-1.5 text-[9px] text-gray-400 hover:bg-gray-50 border-t border-gray-100"
              >
                ← Retour scénario
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
