import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

const STATUS_BADGES = {
  pending: "bg-yellow-100 text-yellow-800",
  running: "bg-blue-100 text-blue-800 animate-pulse",
  completed: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};

const STATUS_LABELS = {
  pending: "En attente",
  running: "En cours",
  completed: "Termine",
  error: "Erreur",
};

function formatDate(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function filterSummary(filters) {
  const parts = [filters.sector, filters.job_title].filter(Boolean);
  if (filters.geography) parts.push(filters.geography);
  if (filters.company_size) parts.push(filters.company_size);
  return parts.join(" / ");
}

export default function ColdSearchHistory({ onRelaunch }) {
  const { data, isLoading } = useQuery({
    queryKey: ["cold-searches"],
    queryFn: () => api.get("/cold-outbound/searches"),
    refetchInterval: (query) => {
      const searches = query.state.data?.searches;
      if (!searches) return false;
      const hasRunning = searches.some(
        (s) => s.status === "pending" || s.status === "running"
      );
      return hasRunning ? 10000 : false;
    },
  });

  const searches = data?.searches ?? [];

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6 flex justify-center">
        <div className="w-6 h-6 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (searches.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center text-gray-400">
        Aucune recherche cold pour le moment
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Filtres
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                Leads trouves
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                Leads enrichis
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                Statut
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {searches.map((search) => (
              <tr key={search.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                  {formatDate(search.created_at)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {filterSummary(search.filters)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 text-center">
                  {search.leads_found}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 text-center">
                  {search.leads_enriched}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                      STATUS_BADGES[search.status] || "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {STATUS_LABELS[search.status] || search.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onRelaunch(search.filters)}
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    Relancer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
