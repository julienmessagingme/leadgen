import { useBeReachCredits } from "../../hooks/useSettings";
import { useColdRuns } from "../../hooks/useColdOutreach";

/**
 * Daily BeReach credits consumed (plan: 900/day, reset at midnight Paris).
 *
 * Sums two sources:
 *  - leadgen pipeline (Task A/B/C/D) via the existing /settings/bereach-credits
 *    parser that reads log lines
 *  - cold outreach agent (Troudebal) via cold_outreach_runs.credits_used for today
 *
 * Kept simple — one component, client-side aggregation. If this becomes
 * unreliable we'll promote it to a dedicated backend endpoint.
 */
const DAILY_LIMIT = 900;

export default function BeReachCreditsGauge() {
  const { data: history } = useBeReachCredits();
  const { data: runsData } = useColdRuns();

  const today = new Date().toISOString().slice(0, 10);

  const leadgenToday = Array.isArray(history)
    ? (history.find((h) => h.day === today)?.credits_used || 0)
    : 0;

  const runs = runsData?.runs || [];
  const coldToday = runs
    .filter((r) => r.run_date === today)
    .reduce((sum, r) => sum + (Number(r.credits_used) || 0), 0);

  const total = leadgenToday + coldToday;
  const pct = Math.min(100, Math.round((total / DAILY_LIMIT) * 100));

  let barColor = "#6366f1";
  if (pct >= 100) barColor = "#ef4444";
  else if (pct >= 80) barColor = "#eab308";

  return (
    <div className="bg-white rounded-xl shadow-md p-5">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Crédits BeReach aujourd&#39;hui
      </h3>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-3xl font-bold text-gray-800">
          {total}/{DAILY_LIMIT}
        </span>
        <span className="text-sm text-gray-400">{pct}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
        <div
          className="h-4 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      <div className="mt-3 flex gap-4 text-xs text-gray-500">
        <span>Leadgen : <span className="font-mono text-gray-700">{leadgenToday}</span></span>
        <span>Troudebal : <span className="font-mono text-gray-700">{coldToday}</span></span>
      </div>
    </div>
  );
}
