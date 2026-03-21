import KanbanCard from "./KanbanCard";

export default function KanbanColumn({ column, leads = [], onLeadClick }) {
  return (
    <div className={`w-72 flex-shrink-0 rounded-lg ${column.color} p-3`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{column.label}</h3>
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white text-xs font-medium text-gray-600 shadow-sm">
          {leads.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2 max-h-[calc(100vh-16rem)] overflow-y-auto">
        {leads.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Aucun lead</p>
        ) : (
          leads.map((lead) => (
            <KanbanCard
              key={lead.id}
              lead={lead}
              onClick={() => onLeadClick(lead.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
