import { useState } from "react";
import { useColdSearches } from "../../hooks/useColdOutbound";

function formatDate(iso) {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function filterSummary(filters) {
  if (!filters) return "--";
  const parts = [];
  if (filters.company) parts.push(filters.company);
  if (filters.job_title) parts.push(filters.job_title);
  if (filters.sector) parts.push(filters.sector);
  if (filters.geography) parts.push(filters.geography);
  if (filters.company_size) parts.push(filters.company_size);
  return parts.join(" / ") || "--";
}

export default function ColdSearchHistory({ onRelaunch, onViewResults }) {
  const { data, isLoading } = useColdSearches();
  const [collapsed, setCollapsed] = useState(true);

  const searches = data?.searches || [];

  if (isLoading) {
    return <div className="h-8 bg-gray-200 rounded animate-pulse" />;
  }

  if (searches.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">Aucune recherche precedente.</p>
    );
  }

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800 mb-2"
      >
        <svg
          className={`w-4 h-4 transition-transform ${collapsed ? "" : "rotate-90"}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Historique ({searches.length} recherches)
      </button>

      {!collapsed && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Filtres</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">Trouves</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">Enrichis</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {searches.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                    {formatDate(s.created_at)}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-700 max-w-sm truncate">
                    {filterSummary(s.filters)}
                  </td>
                  <td className="px-4 py-2.5 text-center text-sm font-mono text-gray-700">
                    {s.leads_found || 0}
                  </td>
                  <td className="px-4 py-2.5 text-center text-sm font-mono text-gray-700">
                    {s.leads_enriched || 0}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => onViewResults && onViewResults(s.id)}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                      >
                        Voir
                      </button>
                      <button
                        onClick={() => onRelaunch && onRelaunch(s.filters)}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                      >
                        Relancer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
