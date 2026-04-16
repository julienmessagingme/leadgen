import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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

function useGenerateFollowupNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, case_study_id }) =>
      api.post(`/leads/${leadId}/generate-followup-now`, { case_study_id }),
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

export default function EmailTracking() {
  var { data, isLoading } = useQuery({
    queryKey: ["email-tracking"],
    queryFn: function () { return api.get("/dashboard/email-tracking"); },
    refetchInterval: 120000,
  });

  var rows = data?.rows || [];

  // Stats: compute from initial emails only (avoid double-counting the lead)
  var initialRows = rows.filter(function (r) { return r.email_type === "email_1"; });
  var totalSent = initialRows.length;
  var totalOpened = initialRows.filter(function (l) { return l.opens > 0; }).length;
  var totalClicked = initialRows.filter(function (l) { return l.clicks > 0; }).length;
  var openRate = totalSent > 0 ? Math.round(totalOpened / totalSent * 100) : 0;
  var clickRate = totalSent > 0 ? Math.round(totalClicked / totalSent * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">Email Tracking</h1>
          <p className="text-sm text-gray-500 mt-1">
            Suivi des emails envoyés — ouvertures et clics. Quand un prospect a ouvert
            mais pas répondu, utilise le bouton « ✉ Relancer » pour générer tout de
            suite un 2<sup>e</sup> mail (draft visible dans <Link to="/messages-draft" className="text-indigo-600 underline">Relances mail</Link>).
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Stat label="Envoyés" value={totalSent} />
          <Stat label="Ouverts" value={totalOpened} color="text-green-600" />
          <Stat label="Taux ouverture" value={openRate + "%"} color="text-green-600" />
          <Stat label="Clics" value={totalClicked} color="text-blue-600" />
          <Stat label="Taux clic" value={clickRate + "%"} color="text-blue-600" />
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-gray-400">Aucun email envoyé pour le moment.</div>
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
                  return <EmailRow key={r.row_key} row={r} />;
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
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

function EmailRow({ row }) {
  var isFollowup = row.email_type === "email_followup";
  var hasOpened = row.opens > 0;
  var hasClicked = row.clicks > 0;
  var noResponse = hasOpened && !["replied", "meeting_booked"].includes(row.status);

  var rowBg = "";
  if (isFollowup) rowBg = "bg-indigo-50/40";
  else if (noResponse) rowBg = "bg-amber-50/50";
  else if (hasOpened) rowBg = "bg-green-50/30";

  return (
    <tr className={rowBg}>
      <td className="px-4 py-3">
        <div className={`text-sm ${isFollowup ? "text-gray-500" : "font-medium text-gray-900"}`}>
          {isFollowup && <span className="text-indigo-500 mr-1">↳</span>}
          {isFollowup ? "Relance J+14" : row.full_name}
        </div>
        {!isFollowup && row.linkedin_url && (
          <a href={row.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">LinkedIn</a>
        )}
      </td>
      <td className="px-4 py-3 text-xs whitespace-nowrap">
        <TypeBadge origin={row.origin} isFollowup={isFollowup} />
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
        {!isFollowup && <FollowupAction row={row} />}
      </td>
    </tr>
  );
}

function TypeBadge({ origin, isFollowup }) {
  // Two axes: origin of the lead (pipeline / cold / troudebal) × email type
  // (initial / followup). Pipeline leads get distinct colours so the eye
  // picks them out quickly; follow-up rows are always prefixed with "Relance".
  const originConf = {
    pipeline:  { label: "Pipeline",   cls: "bg-emerald-100 text-emerald-800" },
    cold:      { label: "Cold",       cls: "bg-amber-100 text-amber-800" },
    troudebal: { label: "Troudebal",  cls: "bg-indigo-100 text-indigo-800" },
  };
  const conf = originConf[origin] || { label: origin || "?", cls: "bg-gray-100 text-gray-700" };
  const prefix = isFollowup ? "Relance · " : "1er mail · ";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium uppercase tracking-wide ${conf.cls}`}>
      {prefix}{conf.label}
    </span>
  );
}

function StatusBadge({ row, isFollowup, hasOpened, hasClicked, noResponse }) {
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
  const [selectedCaseId, setSelectedCaseId] = useState("auto"); // "auto" | "none" | "<id>"
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
    // Map UI choice → API contract
    // "auto" means "let the server do sector-matching" → omit case_study_id
    // "none" means "no case" → pass the literal "none"
    // otherwise integer id
    const payloadId =
      selectedCaseId === "auto"
        ? undefined
        : selectedCaseId === "none"
          ? "none"
          : Number.parseInt(selectedCaseId, 10);
    try {
      await generate.mutateAsync({ leadId: row.lead_id, case_study_id: payloadId });
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
      <select
        value={selectedCaseId}
        onChange={(e) => setSelectedCaseId(e.target.value)}
        className="text-xs rounded border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 max-w-[200px]"
        disabled={generate.isPending}
        autoFocus
      >
        <option value="auto">— Auto (secteur) —</option>
        <option value="none">— Sans cas client —</option>
        {activeCases.map((cs) => (
          <option key={cs.id} value={String(cs.id)}>
            {cs.client_name}{cs.sector ? " · " + cs.sector : ""}
          </option>
        ))}
      </select>
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
