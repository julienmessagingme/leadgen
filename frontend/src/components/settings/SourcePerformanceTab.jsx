import { useState, useMemo } from "react";
import { useWatchlistStats } from "../../hooks/useSettings";

const SOURCE_TYPE_LABELS = {
  competitor_page: "Concurrent",
  influencer: "Influenceur",
  keyword: "Mot-cle",
  job_keyword: "Offre emploi",
  unknown: "Inconnu",
};

const PRIORITY_COLORS = {
  P1: "bg-red-100 text-red-700",
  P2: "bg-yellow-100 text-yellow-700",
  P3: "bg-gray-100 text-gray-600",
};

const FILTERS = [
  { value: "all", label: "Toutes" },
  { value: "with_leads", label: "Avec leads" },
  { value: "no_leads", label: "Sans leads" },
  { value: "inactive", label: "Inactives" },
];

const SORTS = [
  { value: "leads_desc", label: "Leads (plus)" },
  { value: "hot_pct_desc", label: "% Hot (plus)" },
  { value: "avg_score_desc", label: "Score moyen (plus)" },
  { value: "leads_asc", label: "Leads (moins)" },
  { value: "last_lead_desc", label: "Dernier lead (recent)" },
];

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function sourceTypeBadge(type) {
  const label = SOURCE_TYPE_LABELS[type] || type;
  const colors = {
    competitor_page: "bg-purple-100 text-purple-700",
    influencer: "bg-blue-100 text-blue-700",
    keyword: "bg-green-100 text-green-700",
    job_keyword: "bg-teal-100 text-teal-700",
    unknown: "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${colors[type] || colors.unknown}`}>
      {label}
    </span>
  );
}

function avgScoreBadge(score) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  let colors;
  if (score >= 70) colors = "bg-red-100 text-red-700";
  else if (score >= 50) colors = "bg-orange-100 text-orange-700";
  else if (score >= 30) colors = "bg-yellow-100 text-yellow-700";
  else colors = "bg-gray-100 text-gray-500";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-mono font-semibold rounded ${colors}`}>
      {score}
    </span>
  );
}

function hotPctBar(hotPct) {
  if (hotPct === 0) return <span className="text-xs text-gray-400">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-orange-400 to-red-500 transition-all"
          style={{ width: `${hotPct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-gray-700 w-10 text-right">{hotPct}%</span>
    </div>
  );
}

function tierBreakdown(hot, warm, cold) {
  const total = hot + warm + cold;
  if (total === 0) return <span className="text-xs text-gray-400">—</span>;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {hot > 0 && <span className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-mono">{hot}H</span>}
      {warm > 0 && <span className="px-1.5 py-0.5 bg-yellow-50 text-yellow-700 rounded font-mono">{warm}W</span>}
      {cold > 0 && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-mono">{cold}C</span>}
    </div>
  );
}

export default function SourcePerformanceTab() {
  const { data, isLoading } = useWatchlistStats();
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("leads_desc");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const allStats = data?.stats ?? [];
  const totalLeads = data?.total_leads ?? 0;

  const filtered = useMemo(() => {
    let rows = allStats.slice();

    if (typeFilter !== "all") {
      rows = rows.filter((r) => r.source_type === typeFilter);
    }

    if (filter === "with_leads") {
      rows = rows.filter((r) => r.leads_count > 0);
    } else if (filter === "no_leads") {
      rows = rows.filter((r) => r.leads_count === 0);
    } else if (filter === "inactive") {
      rows = rows.filter((r) => r.is_active === false);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => (r.source_label || "").toLowerCase().includes(q));
    }

    // Sort
    rows.sort((a, b) => {
      if (sort === "leads_desc") return b.leads_count - a.leads_count;
      if (sort === "leads_asc") return a.leads_count - b.leads_count;
      if (sort === "hot_pct_desc") return b.hot_pct - a.hot_pct;
      if (sort === "avg_score_desc") return (b.avg_score ?? -1) - (a.avg_score ?? -1);
      if (sort === "last_lead_desc") {
        if (!a.last_lead_at && !b.last_lead_at) return 0;
        if (!a.last_lead_at) return 1;
        if (!b.last_lead_at) return -1;
        return b.last_lead_at.localeCompare(a.last_lead_at);
      }
      return 0;
    });

    return rows;
  }, [allStats, filter, sort, typeFilter, search]);

  // Aggregated summary
  const summary = useMemo(() => {
    const withLeads = allStats.filter((s) => s.leads_count > 0).length;
    const zero = allStats.filter((s) => s.leads_count === 0 && s.is_active !== false).length;
    const bestSource = allStats.slice().sort((a, b) => b.leads_count - a.leads_count)[0];
    return { total: allStats.length, withLeads, zero, bestSource };
  }, [allStats]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Performance des sources</h2>
        <p className="text-sm text-gray-500 mt-1">
          Combien de leads rapporte chaque mot-cle / influenceur / concurrent — et quelle est leur temperature moyenne.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500">Sources totales</div>
          <div className="text-2xl font-bold text-gray-900">{summary.total}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500">Qui produisent</div>
          <div className="text-2xl font-bold text-green-600">{summary.withLeads}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500">0 leads (actives)</div>
          <div className="text-2xl font-bold text-red-500">{summary.zero}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500">Total leads collectes</div>
          <div className="text-2xl font-bold text-blue-600">{totalLeads}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          placeholder="Rechercher une source..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-md w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
        />

        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === f.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 border-0 text-gray-700"
        >
          <option value="all">Tous types</option>
          {Object.entries(SOURCE_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 border-0 text-gray-700 ml-auto"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>Tri : {s.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priorite</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Leads</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Repartition</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">% Hot</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Score moy.</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dernier lead</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actif</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">
                  Aucune source trouvee
                </td>
              </tr>
            ) : (
              filtered.map((s, idx) => {
                const rowKey = s.id || `orphan-${idx}`;
                const isZero = s.leads_count === 0;
                const isOrphan = s.orphan === true;
                return (
                  <tr
                    key={rowKey}
                    className={`${isZero ? "bg-red-50/30" : "hover:bg-gray-50"} ${isOrphan ? "italic" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{s.source_label || "—"}</span>
                        {isOrphan && (
                          <span className="text-xs text-orange-500" title="Source detectee dans les leads mais absente de la watchlist">
                            ⚠ orphelin
                          </span>
                        )}
                      </div>
                      {s.source_url && (
                        <a
                          href={s.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline truncate max-w-xs block"
                        >
                          {s.source_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        </a>
                      )}
                      {Array.isArray(s.keywords) && s.keywords.length > 0 && (
                        <div className="text-xs text-gray-400 font-mono mt-0.5">{s.keywords.join(" ")}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{sourceTypeBadge(s.source_type)}</td>
                    <td className="px-4 py-3">
                      {s.priority ? (
                        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded ${PRIORITY_COLORS[s.priority] || "bg-gray-100"}`}>
                          {s.priority}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-mono font-semibold ${isZero ? "text-red-400" : "text-gray-900"}`}>
                        {s.leads_count}
                      </span>
                    </td>
                    <td className="px-4 py-3">{tierBreakdown(s.hot_count, s.warm_count, s.cold_count)}</td>
                    <td className="px-4 py-3">{hotPctBar(s.hot_pct)}</td>
                    <td className="px-4 py-3 text-center">{avgScoreBadge(s.avg_score)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(s.last_lead_at)}</td>
                    <td className="px-4 py-3 text-center">
                      {s.is_active === null ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : (
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.is_active ? "bg-green-500" : "bg-gray-300"}`} />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        H = Hot, W = Warm, C = Cold. Les sources "orphelines" sont detectees dans les leads mais n'existent plus dans la watchlist.
      </p>
    </div>
  );
}
