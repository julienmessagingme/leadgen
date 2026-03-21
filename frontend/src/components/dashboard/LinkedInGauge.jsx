export default function LinkedInGauge({ data }) {
  if (!data) return null;

  const { sent, limit } = data;
  const pct = Math.min(100, Math.round((sent / limit) * 100));

  let barColor = "#6366f1";
  if (pct >= 100) barColor = "#ef4444";
  else if (pct >= 80) barColor = "#eab308";

  return (
    <div className="bg-white rounded-xl shadow-md p-5">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Invitations LinkedIn aujourd&#39;hui
      </h3>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-3xl font-bold text-gray-800">
          {sent}/{limit}
        </span>
        <span className="text-sm text-gray-400">{pct}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
        <div
          className="h-4 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}
