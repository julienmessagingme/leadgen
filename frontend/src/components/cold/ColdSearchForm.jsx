import { useState, useEffect } from "react";
import { useColdSearchMutation } from "../../hooks/useColdOutbound";

const COMPANY_SIZES = [
  { value: "", label: "Toutes tailles" },
  { value: "1-10", label: "1-10" },
  { value: "11-50", label: "11-50" },
  { value: "51-200", label: "51-200" },
  { value: "201-500", label: "201-500" },
  { value: "501-1000", label: "501-1000" },
  { value: "1000+", label: "1000+" },
];

export default function ColdSearchForm({ prefill, onSearchComplete }) {
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [sector, setSector] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [geography, setGeography] = useState("");
  const [maxLeads, setMaxLeads] = useState(25);

  const searchMutation = useColdSearchMutation();

  // Pre-fill from Relancer — auto-submit if _ts is present (means "Relancer" was clicked)
  useEffect(() => {
    if (prefill) {
      var co = prefill.company || "";
      var jt = prefill.job_title || "";
      var se = prefill.sector || "";
      var cs = prefill.company_size || "";
      var ge = prefill.geography || "";
      var ml = prefill.max_leads || 25;
      setCompany(co);
      setJobTitle(jt);
      setSector(se);
      setCompanySize(cs);
      setGeography(ge);
      setMaxLeads(ml);

      // Auto-launch if triggered by Relancer button
      if (prefill._ts && jt) {
        searchMutation.mutateAsync({
          company: co.trim() || undefined,
          job_title: jt.trim(),
          sector: se.trim() || undefined,
          company_size: cs || undefined,
          geography: ge.trim() || undefined,
          max_leads: parseInt(ml, 10),
        }).then(function (result) {
          if (onSearchComplete) onSearchComplete(result);
        }).catch(function () {});
      }
    }
  }, [prefill]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const result = await searchMutation.mutateAsync({
        company: company.trim() || undefined,
        job_title: jobTitle.trim(),
        sector: sector.trim() || undefined,
        company_size: companySize || undefined,
        geography: geography.trim() || undefined,
        max_leads: parseInt(maxLeads, 10),
      });
      if (onSearchComplete) onSearchComplete(result);
    } catch (_err) {
      // Error handled by mutation state
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Entreprise
            </label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="ex: Carrefour, LVMH, Odalys..."
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Poste / Titre *
            </label>
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="ex: Directeur CRM, CMO, Head of Digital..."
              required
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Secteur
            </label>
            <input
              type="text"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="ex: Retail, SaaS, Immobilier..."
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
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Zone geographique
            </label>
            <input
              type="text"
              value={geography}
              onChange={(e) => setGeography(e.target.value)}
              placeholder="ex: France, Ile-de-France..."
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max resultats (1-50)
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

        {searchMutation.isError && (
          <p className="text-sm text-red-600">
            {searchMutation.error?.message || "Erreur lors de la recherche"}
          </p>
        )}

        <button
          type="submit"
          disabled={searchMutation.isPending}
          className="w-full sm:w-auto px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
        >
          {searchMutation.isPending && (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          {searchMutation.isPending ? "Recherche en cours..." : "Lancer la recherche"}
        </button>
      </form>
    </div>
  );
}
