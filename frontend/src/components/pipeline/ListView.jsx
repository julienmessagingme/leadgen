import TierBadge from "../shared/TierBadge";
import StatusBadge from "../shared/StatusBadge";

export default function ListView({ leads = [], onLeadClick }) {
  if (leads.length === 0) {
    return (
      <p className="text-center text-gray-400 py-12">Aucun lead trouve</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <th className="py-3 px-4">Nom</th>
            <th className="py-3 px-4">Entreprise</th>
            <th className="py-3 px-4">Tier</th>
            <th className="py-3 px-4">Score ICP</th>
            <th className="py-3 px-4">Statut</th>
            <th className="py-3 px-4">Source</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const displayName =
              lead.full_name ||
              [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
              "Inconnu";
            const isPaused = lead.metadata?.is_paused;

            return (
              <tr
                key={lead.id}
                onClick={() => onLeadClick(lead.id)}
                className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <td className="py-3 px-4 font-medium text-gray-900">
                  {displayName}
                </td>
                <td className="py-3 px-4 text-gray-600">
                  {lead.company_name || "-"}
                </td>
                <td className="py-3 px-4">
                  <TierBadge tier={lead.tier} />
                </td>
                <td className="py-3 px-4 text-gray-700">
                  {lead.icp_score ?? "-"}
                </td>
                <td className="py-3 px-4">
                  <StatusBadge status={lead.status} isPaused={isPaused} />
                </td>
                <td className="py-3 px-4 text-gray-600">
                  {lead.signal_source || "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
