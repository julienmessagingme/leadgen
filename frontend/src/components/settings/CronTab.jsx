import { useCronSchedule } from "../../hooks/useSettings";

export default function CronTab() {
  const { data, isLoading } = useCronSchedule();
  const schedules = data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Planning Cron</h2>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tache</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Horaire</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Jours</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expression Cron</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {schedules.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  Aucune tache cron configuree
                </td>
              </tr>
            ) : (
              schedules.map((s, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-700">{s.task || s.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{s.time || "—"}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{s.days || "—"}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-500">{s.cron || s.expression}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Le planning cron est configure dans le code. Contactez l'administrateur pour toute modification.
      </p>
    </div>
  );
}
