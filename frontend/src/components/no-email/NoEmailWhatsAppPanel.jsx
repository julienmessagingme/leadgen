import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * NoEmailWhatsAppPanel — onglet "Sans email" dans /messages-draft.
 *
 * Liste les leads ou Task D n'a pas reussi a trouver d'email (FullEnrich +
 * HubSpot ont toutes deux echoue). Aucune generation Sonnet n'a tourne pour
 * eux (economise tokens). Julien decide un-par-un s'il vaut la peine de
 * depenser 10 credits pour chercher un numero WhatsApp.
 *
 * Flow par lead :
 *   1. Status 'email_not_found' → bouton "Chercher numero (10 credits)"
 *   2. Click → POST /leads/:id/find-phone
 *      - Phone trouve → status 'whatsapp_ready' → bouton "Envoyer WhatsApp"
 *      - Phone pas trouve → status 'disqualified' → lead disparait de la liste
 *   3. Click "Envoyer WhatsApp" → POST /leads/:id/send-whatsapp (endpoint
 *      existant, meme flow que depuis /email-tracking).
 */
export default function NoEmailWhatsAppPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["no-email-candidates"],
    queryFn: () => api.get("/dashboard/no-email-candidates"),
    staleTime: 30_000,
  });

  if (isLoading) return <p className="text-gray-500 text-sm">Chargement…</p>;

  const candidates = data?.candidates || [];

  if (candidates.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <p className="text-gray-500">Aucun lead sans email.</p>
        <p className="text-gray-400 text-xs mt-2">
          Les leads ou FullEnrich/HubSpot n'ont pas trouve d'email apparaissent ici,
          avec leur contexte complet pour decider si ca vaut un lookup WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500 mb-2">
        {candidates.length} lead{candidates.length > 1 ? "s" : ""} sans email.
        Chaque lookup numero coute <b>10 credits FullEnrich</b> — decide au cas par cas.
      </div>
      {candidates.map((c) => (
        <Card key={c.id} candidate={c} qc={qc} />
      ))}
    </div>
  );
}

function Card({ candidate: c, qc }) {
  const [feedback, setFeedback] = useState(null);
  const [whapiMode, setWhapiMode] = useState(false); // toggled when user clicks "Message perso"
  const [whapiDraft, setWhapiDraft] = useState("");

  const findPhone = useMutation({
    mutationFn: () => api.post(`/leads/${c.id}/find-phone`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["no-email-candidates"] }),
  });

  const sendWhatsApp = useMutation({
    mutationFn: () => api.post(`/leads/${c.id}/send-whatsapp`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["no-email-candidates"] }),
  });

  const genWhapiDraft = useMutation({
    mutationFn: () => api.post(`/leads/${c.id}/generate-whapi-draft`, {}),
  });

  const sendWhapi = useMutation({
    mutationFn: (text) => api.post(`/leads/${c.id}/send-whapi-text`, { text }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["no-email-candidates"] }),
  });

  const onFindPhone = async () => {
    if (!window.confirm(`Chercher le numero WhatsApp de ${c.full_name || "ce lead"} ? Ca coute 10 credits FullEnrich.`)) return;
    setFeedback(null);
    try {
      const res = await findPhone.mutateAsync();
      if (res.ok) {
        setFeedback({ ok: true, msg: "Numero trouve : " + res.phone });
      } else {
        setFeedback({ ok: false, msg: "Pas de numero trouve — lead archive" });
      }
    } catch (err) {
      setFeedback({ ok: false, msg: err?.response?.data?.error || err?.message || "Erreur" });
    }
  };

  const onSendWhatsApp = async () => {
    if (!window.confirm(`Envoyer le template WhatsApp a ${c.full_name || "ce lead"} ?`)) return;
    setFeedback(null);
    try {
      await sendWhatsApp.mutateAsync();
      setFeedback({ ok: true, msg: "WhatsApp envoye" });
    } catch (err) {
      setFeedback({ ok: false, msg: err?.response?.data?.error || err?.message || "Erreur" });
    }
  };

  const onOpenWhapi = async () => {
    setFeedback(null);
    setWhapiMode(true);
    try {
      const res = await genWhapiDraft.mutateAsync();
      setWhapiDraft(res.text || "");
    } catch (err) {
      setFeedback({ ok: false, msg: err?.response?.data?.error || err?.message || "Erreur" });
    }
  };

  const onSendWhapi = async () => {
    if (!whapiDraft.trim()) return;
    if (!window.confirm(`Envoyer ce message depuis TON WhatsApp perso a ${c.full_name || "ce lead"} ?`)) return;
    setFeedback(null);
    try {
      await sendWhapi.mutateAsync(whapiDraft);
      setFeedback({ ok: true, msg: "Envoye via ton WhatsApp perso" });
      setWhapiMode(false);
      setWhapiDraft("");
    } catch (err) {
      const code = err?.response?.data?.error;
      if (code === "daily_cap_reached") {
        setFeedback({ ok: false, msg: "Cap quotidien atteint (15 msg/jour via Whapi)" });
      } else {
        setFeedback({ ok: false, msg: code || err?.message || "Erreur" });
      }
    }
  };

  const tierBadge = {
    hot: "bg-red-100 text-red-800",
    warm: "bg-yellow-100 text-yellow-800",
    cold: "bg-gray-100 text-gray-600",
  }[c.tier] || "bg-gray-100 text-gray-600";

  const isBusy = findPhone.isPending || sendWhatsApp.isPending || genWhapiDraft.isPending || sendWhapi.isPending;
  const isReady = c.status === "whatsapp_ready";
  const isSent = Boolean(c.whatsapp_sent_at);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      {/* Header : nom + tier + score */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{c.full_name || "—"}</span>
            {c.linkedin_url && (
              <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">LinkedIn ↗</a>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${tierBadge}`}>{c.tier || "—"}</span>
            <span className="text-[10px] text-gray-500">ICP {c.icp_score ?? "?"}</span>
            {isReady && !isSent && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">numero trouve</span>
            )}
            {isSent && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">WhatsApp envoye</span>
            )}
          </div>
          <div className="text-sm text-gray-700 mt-0.5">
            {c.headline || "—"}
            {c.company_name && <span className="text-gray-500"> · {c.company_name}</span>}
            {c.company_sector && <span className="text-gray-400"> · {c.company_sector}</span>}
          </div>
        </div>
      </div>

      {/* Inducteur du signal — le hot trigger qu'on a detecte */}
      {c.post_text && (
        <div className="bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700 border border-blue-100 whitespace-pre-wrap mb-3">
          <div className="mb-1">
            <span className="font-medium">Signal</span>
            {c.signal_source && <span className="text-blue-500"> · {c.signal_source}</span>}
            {c.post_author_name && <span className="text-blue-500"> · post de {c.post_author_name}</span>}
          </div>
          {c.post_text}
          {c.post_url && (
            <div className="mt-1">
              <a href={c.post_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline text-[11px]">Voir le post ↗</a>
            </div>
          )}
          {c.comment_text && (
            <div className="mt-2 text-[11px] italic text-blue-600">
              Commentaire du prospect : « {c.comment_text} »
            </div>
          )}
        </div>
      )}
      {!c.post_text && c.signal_source && (
        <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600 border border-gray-200 mb-3">
          <span className="font-medium">Signal :</span> {c.signal_source}
          {c.signal_category && <span className="text-gray-500"> ({c.signal_category})</span>}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {!isReady && (
          <button
            onClick={onFindPhone}
            disabled={isBusy}
            className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {findPhone.isPending ? "Recherche…" : "Chercher numero (10 credits)"}
          </button>
        )}
        {isReady && !isSent && !whapiMode && (
          <>
            <button
              onClick={onSendWhatsApp}
              disabled={isBusy}
              className="px-3 py-2 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              title="Template Meta pro via uChat — pointe vers MessagingMe"
            >
              {sendWhatsApp.isPending ? "Envoi…" : "📱 Template pro (uChat)"}
            </button>
            <button
              onClick={onOpenWhapi}
              disabled={isBusy}
              className="px-3 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              title="Message perso via ton numero WhatsApp — Sonnet te prepare un brouillon a editer"
            >
              {genWhapiDraft.isPending ? "Generation…" : "💬 Message perso (Whapi)"}
            </button>
          </>
        )}
        {isReady && !isSent && whapiMode && (
          <div className="w-full">
            <div className="text-xs text-emerald-700 font-medium mb-1">
              Brouillon Whapi — edite et envoie depuis ton WhatsApp perso (+33 6 33 92 15 77) :
            </div>
            <textarea
              value={whapiDraft}
              onChange={(e) => setWhapiDraft(e.target.value)}
              rows={5}
              disabled={sendWhapi.isPending}
              className="w-full border border-emerald-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
              placeholder={genWhapiDraft.isPending ? "Generation du brouillon…" : ""}
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={onSendWhapi}
                disabled={sendWhapi.isPending || !whapiDraft.trim()}
                className="px-3 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {sendWhapi.isPending ? "Envoi…" : "Envoyer via mon WhatsApp"}
              </button>
              <button
                onClick={() => { setWhapiMode(false); setWhapiDraft(""); setFeedback(null); }}
                disabled={sendWhapi.isPending}
                className="px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={onOpenWhapi}
                disabled={isBusy}
                className="text-xs text-emerald-600 hover:text-emerald-800 ml-auto"
                title="Regenere le brouillon avec Sonnet"
              >
                {genWhapiDraft.isPending ? "…" : "🔄 regenerer"}
              </button>
            </div>
          </div>
        )}
        {isSent && (
          <span className="text-xs text-gray-500">
            Envoye le {new Date(c.whatsapp_sent_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {feedback && (
        <div className={`mt-2 text-xs rounded p-2 ${feedback.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {feedback.ok ? feedback.msg : <>Erreur : {feedback.msg}</>}
        </div>
      )}
    </div>
  );
}
