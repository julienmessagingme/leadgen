import TierBadge from "../shared/TierBadge";

export default function KanbanCard({ lead, onClick }) {
  const displayName =
    lead.full_name ||
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
    "Inconnu";
  const isPaused = lead.metadata?.is_paused;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="bg-white rounded-lg p-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {displayName}
          </p>
          {lead.company_name && (
            <p className="text-xs text-gray-500 truncate mt-0.5">
              {lead.company_name}
            </p>
          )}
        </div>
        {isPaused && (
          <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 shrink-0 mt-1.5" title="En pause" />
        )}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <TierBadge tier={lead.tier} />
        {lead.icp_score != null && (
          <span className="text-xs text-gray-500 font-medium">
            ICP {lead.icp_score}
          </span>
        )}
      </div>
    </div>
  );
}
