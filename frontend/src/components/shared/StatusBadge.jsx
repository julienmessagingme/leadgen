const STATUS_MAP = {
  new: { label: "Nouveau", colors: "bg-gray-100 text-gray-700" },
  enriched: { label: "Nouveau", colors: "bg-gray-100 text-gray-700" },
  scored: { label: "Nouveau", colors: "bg-gray-100 text-gray-700" },
  prospected: { label: "Prospecte", colors: "bg-blue-100 text-blue-700" },
  invitation_sent: { label: "Prospecte", colors: "bg-blue-100 text-blue-700" },
  connected: { label: "Connecte", colors: "bg-indigo-100 text-indigo-700" },
  message_pending: { label: "Msg en attente", colors: "bg-amber-100 text-amber-700" },
  messaged: { label: "Connecte", colors: "bg-indigo-100 text-indigo-700" },
  email_pending: { label: "Email en attente", colors: "bg-orange-100 text-orange-700" },
  email_sent: { label: "Email", colors: "bg-purple-100 text-purple-700" },
  email_followup_pending: { label: "Relance en attente", colors: "bg-pink-100 text-pink-700" },
  email_followup_sent: { label: "Relance envoyee", colors: "bg-purple-100 text-purple-700" },
  whatsapp_sent: { label: "WhatsApp", colors: "bg-green-100 text-green-700" },
  replied: { label: "Gagne", colors: "bg-emerald-100 text-emerald-700" },
  meeting_booked: { label: "Gagne", colors: "bg-emerald-100 text-emerald-700" },
  hubspot_existing: { label: "HubSpot", colors: "bg-orange-100 text-orange-700" },
  invitation_expired: { label: "Invit. expiree", colors: "bg-gray-100 text-gray-500" },
  reinvite_pending: { label: "Re-invit. en attente", colors: "bg-purple-100 text-purple-700" },
  disqualified: { label: "Exclu", colors: "bg-red-100 text-red-700" },
};

const PAUSED = { label: "En pause", colors: "bg-yellow-100 text-yellow-700" };

export default function StatusBadge({ status, isPaused }) {
  const info = isPaused ? PAUSED : STATUS_MAP[status] || { label: status, colors: "bg-gray-100 text-gray-700" };

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium uppercase ${info.colors}`}
    >
      {info.label}
    </span>
  );
}
