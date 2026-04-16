import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * Live BeReach quota dashboard widget.
 *
 * Source of truth: BeReach /me/limits, proxied via /api/dashboard/bereach-live
 * (cached 30s server-side). Counters reflect EVERYTHING hitting the BeReach
 * key: leadgen pipeline (Task A/B/C/D), Troudebal cold outreach agent, and
 * manual cold-outbound searches. So Julien can see at a glance how much
 * headroom is left before launching Troudebal or a manual research.
 *
 * We surface the two action types that actually matter for daily planning:
 *   - `scraping` (main bar): collect/search endpoints — the heavy lifters
 *   - `profile_visit`: enrichment bandwidth (Troudebal consumes a lot of these)
 *
 * The other limits (connection_request, message, chat_search) are shown as
 * compact chips below.
 */
function useBeReachLive() {
  return useQuery({
    queryKey: ["bereach-live"],
    queryFn: () => api.get("/dashboard/bereach-live"),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

function barColorFor(pct) {
  if (pct >= 100) return "#ef4444";
  if (pct >= 80) return "#eab308";
  return "#6366f1";
}

function Bar({ label, action }) {
  if (!action) return null;
  const pct = Math.min(100, Math.round((action.current / action.limit) * 100));
  const color = barColorFor(pct);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <span className="text-xs text-gray-500">
          <span className="font-mono text-gray-700">{action.current}</span>
          <span className="text-gray-400">/{action.limit}</span>
          <span className="text-gray-400 ml-1">(reste {action.remaining})</span>
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
        <div className="h-3 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function Chip({ label, action }) {
  if (!action) return null;
  const pct = Math.min(100, Math.round((action.current / action.limit) * 100));
  const tone = pct >= 80 ? "text-yellow-700 bg-yellow-50 border-yellow-200" : "text-gray-600 bg-gray-50 border-gray-200";
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded border ${tone}`}>
      {label} <span className="font-mono">{action.current}/{action.limit}</span>
    </span>
  );
}

export default function BeReachCreditsGauge() {
  const { data, isLoading, error } = useBeReachLive();

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-md p-5 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-12 bg-gray-100 rounded" />
      </div>
    );
  }

  if (error || !data || !data.actions) {
    return (
      <div className="bg-white rounded-xl shadow-md p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Crédits BeReach
        </h3>
        <p className="text-xs text-red-600">Impossible de joindre BeReach : {error?.message || "pas de données"}</p>
      </div>
    );
  }

  const a = data.actions;

  return (
    <div className="bg-white rounded-xl shadow-md p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Crédits BeReach aujourd&#39;hui
        </h3>
        <span className="text-[10px] text-gray-400">
          maj {new Date(data.updated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <div className="space-y-3">
        <Bar label="Scraping (collect/search)" action={a.scraping} />
        <Bar label="Profile visits (enrichissement)" action={a.profile_visit} />
      </div>

      <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-gray-100">
        <Chip label="Invitations" action={a.connection_request} />
        <Chip label="Messages" action={a.message} />
        <Chip label="Lookups" action={a.chat_search} />
      </div>
    </div>
  );
}
