import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import NavBar from "../components/shared/NavBar";
import { useValidatedCampaigns } from "../hooks/useCampaigns";

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

function useGenerateFollowupNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, case_study_ids }) =>
      api.post(`/leads/${leadId}/generate-followup-now`, { case_study_ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-tracking"] });
      qc.invalidateQueries({ queryKey: ["followup-candidates"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

function useCaseStudies() {
  return useQuery({
    queryKey: ["case-studies"],
    queryFn: () => api.get("/settings/case-studies"),
    staleTime: 300_000,
  });
}

function useSentEmailBody(leadId, emailType, enabled) {
  // email_type is either "email_1" (→ /first-email) or "email_followup"
  // (→ /followup-email). Keyed by both so each row caches independently.
  const path = emailType === "email_followup" ? "followup-email" : "first-email";
  return useQuery({
    queryKey: ["sent-email", leadId, emailType],
    queryFn: () => api.get(`/leads/${leadId}/${path}`),
    enabled: Boolean(enabled && leadId),
    staleTime: 5 * 60_000,
  });
}

export default function EmailTracking() {
  var { data, isLoading } = useQuery({
    queryKey: ["email-tracking"],
    queryFn: function () { return api.get("/dashboard/email-tracking"); },
    refetchInterval: 120000,
  });

  var rawRows = data?.rows || [];

  const [trackingTab, setTrackingTab] = useState("solo"); // "solo" | "campagne"
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | opened | clicked | unread | to_relaunch
  const [originFilter, setOriginFilter] = useState("all"); // all | pipeline | cold | troudebal
  const [expandedRow, setExpandedRow] = useState(null);

  // Filter rawRows by origin for the "Solo" sub-tab. In Solo view we exclude
  // campaign-batched emails (they have their own sub-tab).
  const effectiveRawRows = trackingTab === "solo"
    ? rawRows.filter((r) => !r.campaign_id && (originFilter === "all" || r.origin === originFilter))
    : rawRows.filter((r) => !!r.campaign_id);

  // Group initial+follow-up rows by lead so a prospect's thread stays together
  // when we sort/filter/search. The backend already emits them in lead-then-
  // type order but we need to re-sort globally.
  const groups = [];
  const byLead = {};
  for (const r of effectiveRawRows) {
    if (!byLead[r.lead_id]) {
      byLead[r.lead_id] = { lead_id: r.lead_id, rows: [] };
      groups.push(byLead[r.lead_id]);
    }
    byLead[r.lead_id].rows.push(r);
  }

  // Sort groups: leads who opened first (desc by last_open on email_1), then
  // leads who clicked but haven't opened recently, then the rest by sent_at.
  // "Ceux qui ont ouvert" = les plus chauds = en tête, comme demandé par Julien.
  function initialOf(g) {
    return g.rows.find((r) => r.email_type === "email_1") || g.rows[0];
  }
  groups.sort((a, b) => {
    const ia = initialOf(a);
    const ib = initialOf(b);
    // Opened beats un-opened
    if ((ia.opens > 0) !== (ib.opens > 0)) return ia.opens > 0 ? -1 : 1;
    // Among opened: most recent open first
    if (ia.opens > 0 && ib.opens > 0) {
      const la = new Date(ia.last_open || ia.first_open || 0).getTime();
      const lb = new Date(ib.last_open || ib.first_open || 0).getTime();
      if (la !== lb) return lb - la;
    }
    // Fallback: most recent send first
    return new Date(ib.sent_at).getTime() - new Date(ia.sent_at).getTime();
  });

  // Apply text search + status filter at the group level (we show/hide the
  // whole thread, not individual rows).
  const q = search.trim().toLowerCase();
  const filteredGroups = groups.filter((g) => {
    const init = initialOf(g);
    if (q) {
      const hay = [init.full_name, init.company_name, init.email].map((s) => (s || "").toLowerCase()).join(" ");
      if (!hay.includes(q)) return false;
    }
    if (statusFilter === "opened") return init.opens > 0;
    if (statusFilter === "clicked") return init.clicks > 0;
    if (statusFilter === "unread") return init.opens === 0;
    if (statusFilter === "to_relaunch") {
      return init.opens > 0 && !init.has_followup_sent && !init.has_followup_pending && !["replied", "meeting_booked", "disqualified"].includes(init.status);
    }
    return true;
  });

  // Flatten back to rows keeping each group's internal order.
  const rows = filteredGroups.flatMap((g) => g.rows);

  // Stats: compute from initial emails only (avoid double-counting the lead)
  var initialRows = effectiveRawRows.filter(function (r) { return r.email_type === "email_1"; });
  var totalSent = initialRows.length;
  var totalOpened = initialRows.filter(function (l) { return l.opens > 0; }).length;
  var totalClicked = initialRows.filter(function (l) { return l.clicks > 0; }).length;
  var openRate = totalSent > 0 ? Math.round(totalOpened / totalSent * 100) : 0;
  var clickRate = totalSent > 0 ? Math.round(totalClicked / totalSent * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-800">Tracking</h1>
          <p className="text-sm text-gray-500 mt-1">
            Suivi des emails envoyés — 1 à 1 (Solo) ou en batch via une Campagne.
            Relance manuelle via <Link to="/messages-draft" className="text-indigo-600 underline">À valider</Link>.
          </p>
        </div>

        {/* Top-level Solo / Campagne */}
        <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTrackingTab("solo")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              trackingTab === "solo" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            ✉ Solo
          </button>
          <button
            onClick={() => setTrackingTab("campagne")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              trackingTab === "campagne" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            📦 Campagnes
          </button>
        </div>

        {trackingTab === "campagne" && <CampagnesTracking rawRows={rawRows} />}
        {trackingTab === "solo" && (
          <>
            {/* Origin macro filter — only in Solo tab */}
            <div className="flex gap-1 mb-4 flex-wrap">
              {[
                { v: "all",       label: "Tous",        color: "indigo" },
                { v: "pipeline",  label: "Pipeline",    color: "blue" },
                { v: "cold",      label: "Cold",        color: "teal" },
                { v: "troudebal", label: "Agent AI",    color: "purple" },
              ].map((f) => {
                const count = rawRows.filter((r) => r.email_type === "email_1" && !r.campaign_id && (f.v === "all" || r.origin === f.v)).length;
                const isActive = originFilter === f.v;
                return (
                  <button
                    key={f.v}
                    onClick={() => setOriginFilter(f.v)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                      isActive
                        ? `bg-${f.color}-600 text-white border-${f.color}-600`
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {f.label} <span className="ml-1 opacity-75">({count})</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {trackingTab === "solo" && (
        <>
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Stat label="Envoyés" value={totalSent} />
          <Stat label="Ouverts" value={totalOpened} color="text-green-600" />
          <Stat label="Taux ouverture" value={openRate + "%"} color="text-green-600" />
          <Stat label="Clics" value={totalClicked} color="text-blue-600" />
          <Stat label="Taux clic" value={clickRate + "%"} color="text-blue-600" />
        </div>

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4 items-stretch sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher nom, entreprise ou email…"
            className="flex-1 px-3 py-2 text-sm rounded-md border border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white"
          />
          <div className="flex gap-1 flex-wrap">
            {[
              { v: "all",         label: "Tous (" + initialRows.length + ")" },
              { v: "opened",      label: "Ouverts (" + totalOpened + ")" },
              { v: "clicked",     label: "Clics (" + totalClicked + ")" },
              { v: "to_relaunch", label: "À relancer (" + initialRows.filter((r) => r.opens > 0 && !r.has_followup_sent && !r.has_followup_pending && !["replied","meeting_booked","disqualified"].includes(r.status)).length + ")" },
              { v: "unread",      label: "Non lus (" + (initialRows.length - totalOpened) + ")" },
            ].map((f) => (
              <button
                key={f.v}
                onClick={() => setStatusFilter(f.v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
                  statusFilter === f.v
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {search || statusFilter !== "all" ? (
          <div className="mb-3 text-xs text-gray-500">
            {filteredGroups.length} prospect{filteredGroups.length > 1 ? "s" : ""} affiché{filteredGroups.length > 1 ? "s" : ""} sur {groups.length}
          </div>
        ) : null}

        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        ) : effectiveRawRows.length === 0 ? (
          <div className="text-center py-12 text-gray-400">Aucun email envoyé pour le moment.</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            Aucun résultat pour ces critères.
            <button onClick={() => { setSearch(""); setStatusFilter("all"); }} className="ml-2 text-indigo-600 hover:underline">Réinitialiser</button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entreprise</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Envoyé</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Ouvertures</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Clics</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Statut</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(function (r) {
                  return (
                    <EmailRow
                      key={r.row_key}
                      row={r}
                      expanded={expandedRow === r.row_key}
                      onToggle={() => setExpandedRow((k) => (k === r.row_key ? null : r.row_key))}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

// ── Campagnes sub-tab: aggregate stats per validated campaign ──

function CampagnesTracking({ rawRows }) {
  const { data: campaignsData } = useValidatedCampaigns();
  const campagnes = campaignsData?.campaigns || [];

  // Group initial emails by campaign_id
  const initialRows = rawRows.filter((r) => r.email_type === "email_1" && r.campaign_id);
  const byCampaign = {};
  for (const r of initialRows) {
    if (!byCampaign[r.campaign_id]) byCampaign[r.campaign_id] = [];
    byCampaign[r.campaign_id].push(r);
  }

  if (campagnes.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500 text-sm">
        Aucune campagne validée. Crée-en une depuis{" "}
        <Link to="/cold-outbound" className="text-indigo-600 hover:underline">Cold Outbound</Link> ou{" "}
        <Link to="/cold-outreach" className="text-indigo-600 hover:underline">AI Agents</Link>.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {campagnes.map((c) => {
        const rows = byCampaign[c.id] || [];
        const sent = rows.length;
        const opened = rows.filter((r) => r.opens > 0).length;
        const clicked = rows.filter((r) => r.clicks > 0).length;
        const replied = rows.filter((r) => ["replied", "meeting_booked"].includes(r.status)).length;
        const openRate = sent > 0 ? Math.round((opened / sent) * 100) : 0;
        const clickRate = sent > 0 ? Math.round((clicked / sent) * 100) : 0;
        const replyRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;
        const cs = c.case_studies;

        return (
          <div key={c.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{c.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Slot {c.slot}</span>
                  {cs && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                      Cas : {cs.client_name} · {cs.metric_value}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Validée le {new Date(c.validated_at).toLocaleString("fr-FR")} · {c.items_count} leads
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <MiniStat label="Envoyés" value={sent} />
              <MiniStat label="Ouverts" value={opened + " (" + openRate + "%)"} color="text-green-600" />
              <MiniStat label="Clics" value={clicked + " (" + clickRate + "%)"} color="text-blue-600" />
              <MiniStat label="Réponses" value={replied + " (" + replyRate + "%)"} color="text-purple-600" />
              <MiniStat label="En attente" value={c.pending} color="text-yellow-600" />
            </div>

            {rows.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                  Voir les {rows.length} leads de cette campagne
                </summary>
                <div className="mt-2 space-y-1">
                  {rows.map((r) => (
                    <div key={r.row_key} className="text-xs bg-gray-50 rounded px-2 py-1 flex items-center justify-between">
                      <div className="truncate">
                        <span className="font-medium text-gray-900">{r.full_name}</span>
                        <span className="text-gray-500 ml-1">· {r.company_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] shrink-0">
                        {r.opens > 0 && <span className="text-green-700">✉ {r.opens}</span>}
                        {r.clicks > 0 && <span className="text-blue-700">🔗 {r.clicks}</span>}
                        {r.status === "replied" && <span className="text-purple-700">Répondu</span>}
                        {r.status === "meeting_booked" && <span className="text-pink-700">RDV</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div className="bg-gray-50 rounded p-2">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-semibold ${color || "text-gray-800"}`}>{value}</div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="bg-white rounded-lg border p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${color || "text-gray-900"}`}>{value}</div>
    </div>
  );
}

function EmailRow({ row, expanded, onToggle }) {
  var isFollowup = row.email_type === "email_followup";
  var isWhatsapp = row.email_type === "whatsapp";
  var isEmailLike = !isWhatsapp; // Accordion + tracking counters only apply to email rows
  var hasOpened = row.opens > 0;
  var hasClicked = row.clicks > 0;
  var noResponse = hasOpened && !["replied", "meeting_booked"].includes(row.status);

  var rowBg = "";
  if (isWhatsapp) rowBg = "bg-purple-50/40";
  else if (isFollowup) rowBg = "bg-indigo-50/40";
  else if (noResponse) rowBg = "bg-amber-50/50";
  else if (hasOpened) rowBg = "bg-green-50/30";

  return (
    <>
    <tr className={rowBg}>
      <td className="px-4 py-3">
        <div className="flex items-start gap-1.5">
          {isEmailLike ? (
            <button
              onClick={onToggle}
              className="text-gray-400 hover:text-gray-700 mt-0.5 shrink-0"
              title={expanded ? "Masquer le contenu" : "Voir le contenu du mail"}
            >
              <span className="inline-block w-3 transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
            </button>
          ) : (
            <span className="inline-block w-3 shrink-0" />
          )}
          <div>
            <div className={`text-sm ${isFollowup || isWhatsapp ? "text-gray-500" : "font-medium text-gray-900"}`}>
              {isFollowup && <span className="text-indigo-500 mr-1">↳</span>}
              {isWhatsapp && <span className="text-purple-500 mr-1">↳</span>}
              {isFollowup ? "Relance J+14"
               : isWhatsapp ? ("WhatsApp" + (row.phone ? " · " + row.phone : ""))
               : row.full_name}
            </div>
            {!isFollowup && !isWhatsapp && row.linkedin_url && (
              <a href={row.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">LinkedIn</a>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-xs whitespace-nowrap">
        <TypeBadge origin={row.origin} isFollowup={isFollowup} isWhatsapp={isWhatsapp} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{isFollowup ? "" : (row.company_name || "--")}</td>
      <td className="px-4 py-3 text-xs text-gray-500">{isFollowup ? "" : (row.email || "--")}</td>
      <td className="px-4 py-3 text-center text-xs text-gray-500">{relativeTime(row.sent_at)}</td>
      <td className="px-4 py-3 text-center">
        {hasOpened ? (
          <div>
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700">{row.opens}x</span>
            <div className="text-[10px] text-gray-400 mt-0.5">{relativeTime(row.first_open)}</div>
          </div>
        ) : (
          <span className="text-xs text-gray-300">--</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        {hasClicked ? (
          <div>
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700">{row.clicks}x</span>
            <div className="text-[10px] text-gray-400 mt-0.5">{relativeTime(row.first_click)}</div>
          </div>
        ) : (
          <span className="text-xs text-gray-300">--</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <StatusBadge row={row} isFollowup={isFollowup} hasOpened={hasOpened} hasClicked={hasClicked} noResponse={noResponse} />
      </td>
      <td className="px-4 py-3 text-right">
        {!isFollowup && !isWhatsapp && (
          <div className="flex flex-col items-end gap-1.5">
            <FollowupAction row={row} />
            <WhatsappAction row={row} />
          </div>
        )}
      </td>
    </tr>
    {expanded && <EmailContentRow row={row} />}
    </>
  );
}

function EmailContentRow({ row }) {
  const { data, isLoading, error } = useSentEmailBody(row.lead_id, row.email_type, true);

  return (
    <tr>
      <td colSpan={9} className="px-4 pb-3 bg-gray-50 border-t-0">
        <div className="border border-gray-200 rounded-md bg-white p-3 ml-6 mr-2">
          {isLoading ? (
            <div className="text-xs text-gray-400">Chargement du contenu…</div>
          ) : error ? (
            <div className="text-xs text-red-600">Erreur : {error.message}</div>
          ) : !data ? (
            <div className="text-xs text-gray-500">Aucune donnée.</div>
          ) : (
            <>
              <div className="text-xs text-gray-500 mb-1">
                Envoyé le{" "}
                <span className="font-mono">
                  {new Date(data.sent_at).toLocaleString("fr-FR", {
                    day: "2-digit", month: "2-digit", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>
              {data.subject && (
                <div className="text-sm font-semibold text-gray-800 mb-2">
                  Objet : {data.subject}
                </div>
              )}
              {data.body_archived && data.body ? (
                <div
                  className="text-sm text-gray-700 prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: data.body }}
                />
              ) : (
                <div className="text-xs text-gray-500 italic">
                  Corps non archivé (mail antérieur à la feature). Retrouve-le dans Gmail Sent avec l'ID{" "}
                  <span className="font-mono">{data.message_id || "—"}</span>.
                </div>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * WhatsApp trigger. Click → POST /leads/:id/send-whatsapp. If the backend
 * returns 404 phone_required (FullEnrich didn't find the number and nothing
 * stored on the lead), we open a modal so Julien can type it in. Otherwise
 * the flow fires, a purple "WhatsApp envoyé" sub-row appears under the
 * lead, and the webhook is responsible for updating delivery status.
 */
function WhatsappAction({ row }) {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [feedback, setFeedback] = useState(null);

  const sendWhatsapp = useMutation({
    mutationFn: (body) => api.post(`/leads/${row.lead_id}/send-whatsapp`, body || {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-tracking"] });
    },
  });

  if (row.has_whatsapp_sent) {
    return <span className="text-[10px] text-gray-500">WhatsApp parti</span>;
  }
  if (["replied", "meeting_booked", "disqualified"].includes(row.status)) return null;

  const fire = async (body) => {
    setFeedback(null);
    try {
      const res = await sendWhatsapp.mutateAsync(body);
      setFeedback({ ok: true, msg: "WhatsApp envoyé à " + res.phone_used });
      setModalOpen(false);
      setManualPhone("");
    } catch (err) {
      if (err.status === 404) {
        // Backend told us FullEnrich couldn't find the number — open modal
        setModalOpen(true);
        setFeedback(null);
      } else {
        setFeedback({ ok: false, msg: err.message || "Erreur" });
      }
    }
  };

  const onClick = () => fire();
  const onSubmitManual = (e) => {
    e.preventDefault();
    if (!manualPhone.trim()) return;
    fire({ manual_phone: manualPhone.trim() });
  };

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={onClick}
        disabled={sendWhatsapp.isPending}
        className="px-2.5 py-1 text-xs rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        title="Envoyer le template WhatsApp (FullEnrich si pas de numéro)"
      >
        {sendWhatsapp.isPending ? "…" : "💬 WhatsApp"}
      </button>
      {feedback && (
        <span className={`text-[10px] ${feedback.ok ? "text-green-700" : "text-red-600"}`} title={feedback.msg}>
          {feedback.ok ? "✓ envoyé" : feedback.msg.slice(0, 30)}
        </span>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl p-5 w-[420px] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Numéro non trouvé par FullEnrich</h3>
            <p className="text-xs text-gray-500 mb-3">
              Saisis le numéro de <b>{row.full_name}</b> (WhatsApp attendu, format international avec +33 / +971 …) pour envoyer le template.
            </p>
            <form onSubmit={onSubmitManual}>
              <input
                autoFocus
                type="tel"
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                placeholder="+33612345678"
                className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => { setModalOpen(false); setManualPhone(""); setFeedback(null); }}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={sendWhatsapp.isPending || !manualPhone.trim()}
                  className="px-3 py-1.5 text-sm rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {sendWhatsapp.isPending ? "Envoi…" : "Envoyer WhatsApp"}
                </button>
              </div>
              {feedback && !feedback.ok && (
                <div className="text-xs text-red-600 mt-2">{feedback.msg}</div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TypeBadge({ origin, isFollowup, isWhatsapp }) {
  // Two axes: origin of the lead (pipeline / cold / troudebal) × row kind
  // (1er mail / relance / whatsapp). The origin colour is inherited from the
  // underlying lead so a WhatsApp sent on a cold lead stays amber etc.
  const originConf = {
    pipeline:  { label: "Pipeline",   cls: "bg-emerald-100 text-emerald-800" },
    cold:      { label: "Cold",       cls: "bg-amber-100 text-amber-800" },
    troudebal: { label: "Troudebal",  cls: "bg-indigo-100 text-indigo-800" },
  };
  const conf = originConf[origin] || { label: origin || "?", cls: "bg-gray-100 text-gray-700" };
  const prefix = isWhatsapp ? "WhatsApp · "
               : isFollowup ? "Relance · "
               : "1er mail · ";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium uppercase tracking-wide ${conf.cls}`}>
      {prefix}{conf.label}
    </span>
  );
}

function StatusBadge({ row, isFollowup, hasOpened, hasClicked, noResponse }) {
  if (row.email_type === "whatsapp") {
    const map = {
      failed:    { label: "Non parvenu" + (row.whatsapp_error_code ? " · " + row.whatsapp_error_code : ""), cls: "bg-red-100 text-red-800" },
      read:      { label: "Lu",        cls: "bg-green-100 text-green-800" },
      delivered: { label: "Délivré",   cls: "bg-blue-100 text-blue-800" },
      sent:      { label: "Envoyé",    cls: "bg-purple-100 text-purple-800" },
    };
    const entry = map[row.whatsapp_status] || { label: "Envoyé", cls: "bg-purple-100 text-purple-800" };
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded uppercase ${entry.cls}`}
        title={row.whatsapp_error_message || undefined}
      >
        {entry.label}
      </span>
    );
  }
  if (isFollowup) {
    return <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded bg-indigo-100 text-indigo-700 uppercase">Relance envoyée</span>;
  }
  if (row.has_followup_pending) {
    return <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-700">Draft relance</span>;
  }
  if (noResponse) {
    return <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-700">À relancer</span>;
  }
  if (hasClicked) return <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700">Clic</span>;
  if (hasOpened) return <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700">Ouvert</span>;
  return <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-500">Non lu</span>;
}

function FollowupAction({ row }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState([]); // array of case study ids
  const generate = useGenerateFollowupNow();
  const { data: caseData } = useCaseStudies();
  const activeCases = (caseData?.cases || []).filter((c) => c.is_active);

  // Short-circuit states: no "Relancer" button needed when already done or in progress.
  if (row.has_followup_sent) {
    return <span className="text-[10px] text-gray-400">Relance partie</span>;
  }
  if (row.has_followup_pending) {
    return (
      <Link to="/messages-draft" className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline">
        Voir le draft →
      </Link>
    );
  }
  if (["replied", "meeting_booked", "disqualified"].includes(row.status)) {
    return <span className="text-[10px] text-gray-400">{row.status}</span>;
  }

  const onGenerate = async () => {
    setFeedback(null);
    try {
      await generate.mutateAsync({
        leadId: row.lead_id,
        case_study_ids: selectedCaseIds.length > 0 ? selectedCaseIds : undefined,
      });
      setFeedback({ ok: true });
      setOpen(false);
    } catch (err) {
      setFeedback({ ok: false, msg: err.message || "Erreur" });
    }
  };

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <button
          onClick={() => setOpen(true)}
          className="px-2.5 py-1 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          title="Préparer une relance avec un cas client au choix"
        >
          ✉ Relancer
        </button>
        {feedback && feedback.ok && (
          <Link to="/messages-draft" className="text-[10px] text-green-700 hover:underline">
            Draft prêt →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 justify-end bg-white border border-indigo-200 rounded-md shadow-sm p-1.5">
      <div className="flex flex-wrap gap-0.5 max-w-[300px]">
        {activeCases.map((cs) => {
          const isOn = selectedCaseIds.includes(cs.id);
          return (
            <button
              key={cs.id}
              type="button"
              onClick={() => setSelectedCaseIds((prev) => prev.includes(cs.id) ? prev.filter((x) => x !== cs.id) : [...prev, cs.id])}
              disabled={generate.isPending}
              className={`px-1.5 py-0.5 text-[10px] rounded-full border transition-colors ${
                isOn ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-500 border-gray-200 hover:border-indigo-300"
              }`}
            >
              {cs.client_name}
            </button>
          );
        })}
      </div>
      <button
        onClick={onGenerate}
        disabled={generate.isPending}
        className="px-2 py-1 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {generate.isPending ? "…" : "Générer"}
      </button>
      <button
        onClick={() => { setOpen(false); setFeedback(null); }}
        disabled={generate.isPending}
        className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-700"
        title="Annuler"
      >
        ✕
      </button>
      {feedback && !feedback.ok && (
        <span className="text-[10px] text-red-600 ml-1" title={feedback.msg}>err</span>
      )}
    </div>
  );
}
