import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * Displays click + open engagement badges for a lead.
 * Renders nothing if no events. Click badge is reliable, open badge includes a warning tooltip
 * (Apple Mail Privacy produces false positives).
 */
function useEmailEvents(leadId) {
  return useQuery({
    queryKey: ["email-events", leadId],
    queryFn: () => api.get(`/leads/${leadId}/email-events`),
    enabled: !!leadId,
    staleTime: 60_000,
  });
}

function fmt(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch { return ""; }
}

export default function EngagementBadges({ leadId }) {
  const { data } = useEmailEvents(leadId);
  const events = data?.events ?? [];

  if (events.length === 0) return null;

  // Get the most recent click and the most recent open
  const lastClick = events.find((e) => e.event_type === "click");
  const lastOpen = events.find((e) => e.event_type === "open");

  if (!lastClick && !lastOpen) return null;

  return (
    <div className="inline-flex items-center gap-1.5">
      {lastClick && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
          </svg>
          Cliqué {fmt(lastClick.created_at)}
        </span>
      )}
      {lastOpen && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded italic"
          title="Tracking d'ouverture peu fiable (faux positifs Apple Mail Privacy)"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Ouvert {fmt(lastOpen.created_at)}
        </span>
      )}
    </div>
  );
}
