import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

const COMPANY_SIZES = [
  { value: "", label: "Toutes tailles" },
  { value: "1-10", label: "1-10" },
  { value: "11-50", label: "11-50" },
  { value: "51-200", label: "51-200" },
  { value: "201-500", label: "201-500" },
  { value: "501-1000", label: "501-1000" },
  { value: "1000+", label: "1000+" },
];

export default function ColdSearchForm({ prefill, onSearchCreated }) {
  const [sector, setSector] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [geography, setGeography] = useState("");
  const [maxLeads, setMaxLeads] = useState(25);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Polling state
  const [activeSearchId, setActiveSearchId] = useState(null);

  // Pre-fill from Relancer
  useEffect(() => {
    if (prefill) {
      setSector(prefill.sector || "");
      setCompanySize(prefill.company_size || "");
      setJobTitle(prefill.job_title || "");
      setGeography(prefill.geography || "");
      setMaxLeads(prefill.max_leads || 25);
    }
  }, [prefill]);

  // Poll status when a search is active
  const { data: statusData } = useQuery({
    queryKey: ["cold-search-status", activeSearchId],
    queryFn: () => api.get(`/cold-outbound/searches/${activeSearchId}/status`),
    enabled: !!activeSearchId,
    refetchInterval: 3000,
  });

  // Stop polling when search completes or errors
  useEffect(() => {
    if (statusData && (statusData.status === "completed" || statusData.status === "error")) {
      setTimeout(() => {
        setActiveSearchId(null);
        setSubmitting(false);
        if (onSearchCreated) onSearchCreated();
      }, 1500);
    }
  }, [statusData, onSearchCreated]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await api.post("/cold-outbound/search", {
        sector: sector.trim(),
        company_size: companySize || undefined,
        job_title: jobTitle.trim(),
        geography: geography.trim() || undefined,
        max_leads: parseInt(maxLeads, 10),
      });
      setActiveSearchId(result.id);
      if (onSearchCreated) onSearchCreated();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const progress = statusData
    ? Math.round((statusData.leads_found / maxLeads) * 100)
    : 0;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {activeSearchId && statusData ? (
        /* Progress view */
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Recherche en cours...
          </h3>
          <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
            <div
              className="bg-indigo-600 h-3 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <p className="text-sm text-gray-500">
            {statusData.leads_found} / {maxLeads} leads trouves
            {statusData.leads_enriched > 0 &&
              ` (${statusData.leads_enriched} enrichis)`}
          </p>
          {statusData.status === "completed" && (
            <p className="text-sm text-green-600 mt-2 font-medium">
              Recherche terminee !
            </p>
          )}
          {statusData.status === "error" && (
            <p className="text-sm text-red-600 mt-2">
              Erreur : {statusData.error_message || "Erreur inconnue"}
            </p>
          )}
        </div>
      ) : (
        /* Form view */
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Secteur *
              </label>
              <input
                type="text"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="ex: SaaS, Immobilier, E-commerce..."
                required
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Taille entreprise
              </label>
              <select
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              >
                {COMPANY_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Titre / Poste *
              </label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="ex: CEO, Directeur Commercial, CTO..."
                required
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Zone geographique
              </label>
              <input
                type="text"
                value={geography}
                onChange={(e) => setGeography(e.target.value)}
                placeholder="ex: France, Ile-de-France, Paris..."
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nombre de leads (max 50)
              </label>
              <input
                type="number"
                value={maxLeads}
                onChange={(e) => setMaxLeads(e.target.value)}
                min={1}
                max={50}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {submitting ? "Lancement..." : "Lancer la recherche"}
          </button>
        </form>
      )}
    </div>
  );
}
