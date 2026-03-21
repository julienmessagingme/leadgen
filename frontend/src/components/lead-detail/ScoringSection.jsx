import { useState } from "react";
import TierBadge from "../shared/TierBadge";

function scoreColor(score) {
  if (score >= 70) return "bg-green-100 text-green-800 border-green-300";
  if (score >= 40) return "bg-yellow-100 text-yellow-800 border-yellow-300";
  return "bg-red-100 text-red-800 border-red-300";
}

export default function ScoringSection({ lead }) {
  const [expanded, setExpanded] = useState(false);
  const meta = lead.scoring_metadata;

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Score ICP
      </h3>

      <div className="flex items-center gap-3 mb-3">
        <span
          className={`inline-flex items-center justify-center w-12 h-12 rounded-lg border text-lg font-bold ${scoreColor(lead.icp_score)}`}
        >
          {lead.icp_score ?? "?"}
        </span>
        <TierBadge tier={lead.tier} />
      </div>

      {meta && (
        <>
          {/* Score breakdown */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-3">
            {meta.haiku_score != null && (
              <>
                <span className="text-gray-500">Score Haiku</span>
                <span className="text-gray-800 font-medium">{meta.haiku_score}</span>
              </>
            )}
            {meta.signal_bonus != null && (
              <>
                <span className="text-gray-500">Bonus signal</span>
                <span className="text-gray-800 font-medium">+{meta.signal_bonus}</span>
              </>
            )}
            {meta.freshness_malus != null && (
              <>
                <span className="text-gray-500">Malus anciennete</span>
                <span className="text-gray-800 font-medium">{meta.freshness_malus}</span>
              </>
            )}
            {meta.news_bonus != null && (
              <>
                <span className="text-gray-500">Bonus actualite</span>
                <span className="text-gray-800 font-medium">+{meta.news_bonus}</span>
              </>
            )}
          </div>

          {/* Expandable reasoning */}
          {meta.reasoning && (
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                {expanded ? "Masquer le raisonnement" : "Voir le raisonnement"}
              </button>
              {expanded && (
                <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">
                  {meta.reasoning}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
