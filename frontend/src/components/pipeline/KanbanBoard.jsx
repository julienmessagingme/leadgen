import KanbanColumn from "./KanbanColumn";

export const KANBAN_COLUMNS = [
  {
    id: "nouveau",
    label: "Nouveau",
    statuses: ["new", "enriched", "scored"],
    color: "bg-gray-100",
  },
  {
    id: "prospecte",
    label: "Prospecte",
    statuses: ["prospected", "invitation_sent"],
    color: "bg-blue-50",
  },
  {
    id: "connecte",
    label: "Connecte",
    statuses: ["connected", "messaged"],
    color: "bg-indigo-50",
  },
  {
    id: "email",
    label: "Email envoye",
    statuses: ["email_sent"],
    color: "bg-purple-50",
  },
  {
    id: "whatsapp",
    label: "WhatsApp envoye",
    statuses: ["whatsapp_sent"],
    color: "bg-green-50",
  },
  {
    id: "gagne",
    label: "Gagne",
    statuses: ["replied", "meeting_booked"],
    color: "bg-emerald-50",
  },
];

export default function KanbanBoard({ leads = [], onLeadClick }) {
  // Group leads by column based on status
  const columnLeads = KANBAN_COLUMNS.map((col) => ({
    column: col,
    leads: leads.filter((lead) => col.statuses.includes(lead.status)),
  }));

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columnLeads.map(({ column, leads: colLeads }) => (
        <KanbanColumn
          key={column.id}
          column={column}
          leads={colLeads}
          onLeadClick={onLeadClick}
        />
      ))}
    </div>
  );
}
