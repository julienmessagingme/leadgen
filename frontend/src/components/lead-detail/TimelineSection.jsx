const TIMELINE_EVENTS = [
  { label: "Detecte", field: "created_at" },
  { label: "Invitation envoyee", field: "invitation_sent_at" },
  { label: "Connexion acceptee", field: "connected_at" },
  { label: "Message de suivi", field: "message_sent_at" },
  { label: "Email J+3", field: "email_sent_at" },
  { label: "WhatsApp J+14", field: "whatsapp_sent_at" },
  { label: "Reponse recue", field: "replied_at" },
];

const DATE_OPTIONS = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

export default function TimelineSection({ lead }) {
  const events = TIMELINE_EVENTS.filter((e) => lead[e.field]).map((e) => ({
    ...e,
    date: lead[e.field],
  }));

  if (events.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Timeline
      </h3>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gray-200" />

        <div className="space-y-4">
          {events.map((event, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center z-10 shrink-0">
                <div className="w-2 h-2 rounded-full bg-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {event.label}
                </p>
                <p className="text-xs text-gray-500">
                  {new Date(event.date).toLocaleDateString("fr-FR", DATE_OPTIONS)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
