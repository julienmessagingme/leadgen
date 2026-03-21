import { useState } from "react";
import NavBar from "../components/shared/NavBar";
import FilterBar from "../components/shared/FilterBar";
import LeadDrawer from "../components/shared/LeadDrawer";
import ConfirmDialog from "../components/shared/ConfirmDialog";
import KanbanBoard from "../components/pipeline/KanbanBoard";
import ListView from "../components/pipeline/ListView";
import ProfileSection from "../components/lead-detail/ProfileSection";
import ScoringSection from "../components/lead-detail/ScoringSection";
import SignalSection from "../components/lead-detail/SignalSection";
import TimelineSection from "../components/lead-detail/TimelineSection";
import ActionButtons from "../components/lead-detail/ActionButtons";
import { useLeads, useLead, useLeadAction } from "../hooks/useLeads";

const VIEW_TABS = [
  { id: "kanban", label: "Kanban" },
  { id: "list", label: "Liste" },
];

export default function Pipeline() {
  // View toggle state
  const [view, setView] = useState("kanban");

  // Filter state (no status filter -- kanban columns express status visually)
  const [filters, setFilters] = useState({ tier: "", source: "", search: "" });

  // Drawer state
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Data fetching -- single request, group client-side for kanban
  const { data, isLoading, isError, refetch } = useLeads(filters);
  const leads = data?.leads ?? [];

  // Detail data for drawer
  const { data: leadDetail } = useLead(selectedLeadId);
  const lead = leadDetail || null;

  // Action mutation
  const leadAction = useLeadAction();

  // Handle lead card/row click
  const handleLeadClick = (id) => setSelectedLeadId(id);

  // Handle drawer close
  const handleCloseDrawer = () => {
    setSelectedLeadId(null);
    setConfirmOpen(false);
  };

  // Handle lead actions from drawer
  const handleAction = (action) => {
    if (action === "exclude") {
      setConfirmOpen(true);
      return;
    }
    // pause/resume are instant
    leadAction.mutate(
      { id: selectedLeadId, action },
      { onSuccess: () => action === "exclude" && handleCloseDrawer() }
    );
  };

  // Confirm exclude
  const handleConfirmExclude = () => {
    leadAction.mutate(
      { id: selectedLeadId, action: "exclude" },
      { onSuccess: handleCloseDrawer }
    );
    setConfirmOpen(false);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header with view toggle */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-800">Pipeline</h1>

          {/* Tab-style view toggle */}
          <div className="inline-flex rounded-lg bg-gray-200 p-1">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === tab.id
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4">
          <FilterBar
            filters={filters}
            onChange={setFilters}
            showStatus={false}
          />
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <div className="text-center py-20">
            <p className="text-red-600 mb-2">Erreur de chargement des leads</p>
            <button
              onClick={() => refetch()}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Reessayer
            </button>
          </div>
        )}

        {/* Content */}
        {!isLoading && !isError && (
          <>
            {leads.length === 0 ? (
              <p className="text-center text-gray-400 py-20">
                Aucun lead trouve
              </p>
            ) : view === "kanban" ? (
              <KanbanBoard leads={leads} onLeadClick={handleLeadClick} />
            ) : (
              <ListView leads={leads} onLeadClick={handleLeadClick} />
            )}
          </>
        )}
      </div>

      {/* Lead detail drawer */}
      <LeadDrawer
        isOpen={selectedLeadId != null}
        onClose={handleCloseDrawer}
      >
        {lead ? (
          <>
            <ProfileSection lead={lead} />
            <ScoringSection lead={lead} />
            <SignalSection lead={lead} />
            <TimelineSection lead={lead} />
            <ActionButtons
              lead={lead}
              onAction={handleAction}
              isLoading={leadAction.isPending}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        )}
      </LeadDrawer>

      {/* Confirm dialog for exclude */}
      <ConfirmDialog
        isOpen={confirmOpen}
        onConfirm={handleConfirmExclude}
        onCancel={() => setConfirmOpen(false)}
        title="Exclure ce lead ?"
        message="Cette action est irreversible. Le lead sera marque comme exclu (RGPD) et son email sera ajoute a la liste de suppression."
        confirmLabel="Exclure"
        danger
      />
    </div>
  );
}
