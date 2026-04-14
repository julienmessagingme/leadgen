function relativeTime(dateStr) {
  if (!dateStr) return "jamais";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "a l\u0027instant";
  if (mins < 60) return `il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(new Date(dateStr));
}

const STATUS = {
  ok: "bg-green-500",
  error: "bg-red-500",
  running: "bg-yellow-400 animate-pulse",
  never: "bg-gray-300",
};

export default function CronMonitor({ data }) {
  if (!data?.tasks) return null;

  return (
    <div className="bg-white rounded-xl shadow-md p-5">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Taches cron
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {data.tasks.map((t) => (
          <div key={t.task} className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-gray-50">
            <span className={`inline-block w-3 h-3 rounded-full ${STATUS[t.status] || STATUS.never}`} />
            <span className="text-sm font-medium text-gray-700">{t.label}</span>
            <span className="text-xs text-gray-400">{relativeTime(t.lastRun)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
