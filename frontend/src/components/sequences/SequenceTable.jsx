import { useState } from "react";
import StepIndicator from "./StepIndicator";
import TierBadge from "../shared/TierBadge";
import StatusBadge from "../shared/StatusBadge";
import ConfirmDialog from "../shared/ConfirmDialog";

function SortHeader({ label, field, sortField, sortOrder, onSortChange }) {
  const isActive = sortField === field;
  return (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none"
      onClick={() => onSortChange(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (
          <span className="text-indigo-600">
            {sortOrder === "asc" ? "\u2191" : "\u2193"}
          </span>
        )}
      </span>
    </th>
  );
}

export default function SequenceTable({
  leads,
  selected,
  onToggleSelect,
  onToggleAll,
  onLeadClick,
  sortField,
  sortOrder,
  onSortChange,
  onAction,
}) {
  const [confirmExclude, setConfirmExclude] = useState(null);

  const allSelected =
    leads.length > 0 && leads.every((l) => selected.has(l.id));

  const handleRowAction = (e, leadId, action) => {
    e.stopPropagation();
    if (action === "exclude") {
      setConfirmExclude(leadId);
    } else {
      onAction(leadId, action);
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleAll}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <SortHeader
                  label="Nom"
                  field="created_at"
                  sortField={sortField}
                  sortOrder={sortOrder}
                  onSortChange={onSortChange}
                />
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Entreprise
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tier
                </th>
                <SortHeader
                  label="Score ICP"
                  field="icp_score"
                  sortField={sortField}
                  sortOrder={sortOrder}
                  onSortChange={onSortChange}
                />
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Etape
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {leads.map((lead) => {
                const isSelected = selected.has(lead.id);
                const isPaused = lead.metadata?.is_paused;
                const displayName =
                  lead.full_name ||
                  [lead.first_name, lead.last_name]
                    .filter(Boolean)
                    .join(" ") ||
                  "Inconnu";

                return (
                  <tr
                    key={lead.id}
                    onClick={() => onLeadClick(lead.id)}
                    className={`cursor-pointer hover:bg-gray-50 transition-colors ${
                      isSelected ? "bg-indigo-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          onToggleSelect(lead.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {displayName}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {lead.company_name || "-"}
                    </td>
                    <td className="px-4 py-3">
                      <TierBadge tier={lead.tier} />
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-800">
                      {lead.icp_score ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <StepIndicator lead={lead} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={lead.status}
                        isPaused={isPaused}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isPaused ? (
                          <button
                            onClick={(e) =>
                              handleRowAction(e, lead.id, "resume")
                            }
                            className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded hover:bg-green-200"
                            title="Reprendre"
                          >
                            Reprendre
                          </button>
                        ) : (
                          <button
                            onClick={(e) =>
                              handleRowAction(e, lead.id, "pause")
                            }
                            className="px-2 py-1 text-xs font-medium text-yellow-700 bg-yellow-100 rounded hover:bg-yellow-200"
                            title="Mettre en pause"
                          >
                            Pause
                          </button>
                        )}
                        <button
                          onClick={(e) =>
                            handleRowAction(e, lead.id, "exclude")
                          }
                          className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded hover:bg-red-200"
                          title="Exclure"
                        >
                          Exclure
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmExclude !== null}
        title="Exclure ce lead ?"
        message="Cette action est irreversible. Le lead sera exclu et ses donnees anonymisees (RGPD)."
        confirmLabel="Exclure"
        danger
        onConfirm={() => {
          onAction(confirmExclude, "exclude");
          setConfirmExclude(null);
        }}
        onCancel={() => setConfirmExclude(null)}
      />
    </>
  );
}
