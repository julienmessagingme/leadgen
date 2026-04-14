import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import NavBar from "../components/shared/NavBar";

function relativeTime(dateStr) {
  if (!dateStr) return "--";
  var diff = Date.now() - new Date(dateStr).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return "a l'instant";
  if (mins < 60) return "il y a " + mins + "min";
  var hours = Math.floor(mins / 60);
  if (hours < 24) return "il y a " + hours + "h";
  var days = Math.floor(hours / 24);
  if (days < 7) return "il y a " + days + "j";
  return new Date(dateStr).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

export default function EmailTracking() {
  var { data, isLoading } = useQuery({
    queryKey: ["email-tracking"],
    queryFn: function () { return api.get("/dashboard/email-tracking"); },
    refetchInterval: 120000,
  });

  var leads = data?.leads || [];

  // Stats
  var totalSent = leads.length;
  var totalOpened = leads.filter(function (l) { return l.opens > 0; }).length;
  var totalClicked = leads.filter(function (l) { return l.clicks > 0; }).length;
  var openRate = totalSent > 0 ? Math.round(totalOpened / totalSent * 100) : 0;
  var clickRate = totalSent > 0 ? Math.round(totalClicked / totalSent * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">Email Tracking</h1>
          <p className="text-sm text-gray-500 mt-1">Suivi des emails envoyes — ouvertures et clics</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-white rounded-lg border p-3">
            <div className="text-xs text-gray-500">Envoyes</div>
            <div className="text-2xl font-bold text-gray-900">{totalSent}</div>
          </div>
          <div className="bg-white rounded-lg border p-3">
            <div className="text-xs text-gray-500">Ouverts</div>
            <div className="text-2xl font-bold text-green-600">{totalOpened}</div>
          </div>
          <div className="bg-white rounded-lg border p-3">
            <div className="text-xs text-gray-500">Taux ouverture</div>
            <div className="text-2xl font-bold text-green-600">{openRate}%</div>
          </div>
          <div className="bg-white rounded-lg border p-3">
            <div className="text-xs text-gray-500">Clics</div>
            <div className="text-2xl font-bold text-blue-600">{totalClicked}</div>
          </div>
          <div className="bg-white rounded-lg border p-3">
            <div className="text-xs text-gray-500">Taux clic</div>
            <div className="text-2xl font-bold text-blue-600">{clickRate}%</div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        ) : leads.length === 0 ? (
          <div className="text-center py-12 text-gray-400">Aucun email envoye pour le moment.</div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entreprise</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Envoye</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Ouvertures</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Clics</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Relance</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leads.map(function (l) {
                  var hasOpened = l.opens > 0;
                  var hasClicked = l.clicks > 0;
                  var noResponse = hasOpened && !["replied", "meeting_booked"].includes(l.status);
                  return (
                    <tr key={l.id} className={noResponse ? "bg-amber-50/50" : hasOpened ? "bg-green-50/30" : ""}>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{l.full_name}</div>
                        {l.linkedin_url && (
                          <a href={l.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">LinkedIn</a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{l.company_name || "--"}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{l.email || "--"}</td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">{relativeTime(l.email_sent_at)}</td>
                      <td className="px-4 py-3 text-center">
                        {hasOpened ? (
                          <div>
                            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700">{l.opens}x</span>
                            <div className="text-[10px] text-gray-400 mt-0.5">{relativeTime(l.first_open)}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {hasClicked ? (
                          <div>
                            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700">{l.clicks}x</span>
                            <div className="text-[10px] text-gray-400 mt-0.5">{relativeTime(l.first_click)}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">
                        {l.email_followup_sent_at ? relativeTime(l.email_followup_sent_at) : "--"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {noResponse ? (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-700">A appeler</span>
                        ) : hasClicked ? (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700">Clic</span>
                        ) : hasOpened ? (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700">Ouvert</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-500">Non lu</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
