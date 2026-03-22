import { useState, useEffect, useCallback } from "react";
import NavBar from "../components/shared/NavBar";
import FilterBar from "../components/shared/FilterBar";
import LeadDrawer from "../components/shared/LeadDrawer";
import ConfirmDialog from "../components/shared/ConfirmDialog";
import SequenceTable from "../components/sequences/SequenceTable";
import BulkActionBar from "../components/sequences/BulkActionBar";
import ProfileSection from "../components/lead-detail/ProfileSection";
import ScoringSection from "../components/lead-detail/ScoringSection";
import SignalSection from "../components/lead-detail/SignalSection";
import TimelineSection from "../components/lead-detail/TimelineSection";
import ActionButtons from "../components/lead-detail/ActionButtons";
import { useLeads, useLead, useLeadAction, useBulkAction } from "../hooks/useLeads";
import { useExportLeads } from "../hooks/useSettings";

export default function Sequences() {
  const [filters, setFilters] = useState({ status: "", tier: "", source: "", search: "" });
  const [sort, setSort] = useState({ field: "icp_score", order: "desc" });
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [confirmExclude, setConfirmExclude] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportLeads = useExportLeads();

  const { data, isLoading, isError, refetch } = useLeads({
    ...filters,
    sort: sort.field,
    order: sort.order,
  });
  const { data: leadDetail } = useLead(selectedLeadId);
  const leadAction = useLeadAction();
  const bulkAction = useBulkAction();

  const leads = data?.leads ?? [];
  const lead = leadDetail || null;

  // Clear selection when filters change (Pitfall 7)
  useEffect(() => {
    setSelected(new Set());
  }, [filters]);

  const handleToggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === leads.length ? new Set() : new Set(leads.map((l) => l.id))
    );
  }, [leads]);

  const handleSortChange = (field) => {
    setSort((prev) =>
      prev.field === field
        ? { field, order: prev.order === "desc" ? "asc" : "desc" }
        : { field, order: "desc" }
    );
  };

  // Individual action from table row
  const handleRowAction = (leadId, action) => {
    leadAction.mutate({ id: leadId, action });
  };

  // Drawer action
  const handleDrawerAction = (action) => {
    if (action === "exclude") {
      setConfirmExclude(true);
    } else {
      leadAction.mutate({ id: selectedLeadId, action });
    }
  };

  const handleConfirmExclude = () => {
    leadAction.mutate({ id: selectedLeadId, action: "exclude" });
    setConfirmExclude(false);
    setSelectedLeadId(null);
  };

  // Export handler
  const handleExport = async () => {
    setExporting(true);
    try {
      await exportLeads({
        ...filters,
        sort: sort.field,
        order: sort.order,
        ...(dateFrom ? { date_from: dateFrom } : {}),
        ...(dateTo ? { date_to: dateTo } : {}),
      });
    } catch {
      // silent fail
    } finally {
      setExporting(false);
    }
  };

  // Bulk actions
  const handleBulkAction = (action) => {
    bulkAction.mutate(
      { ids: [...selected], action },
      { onSuccess: () => setSelected(new Set()) }
    );
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Sequences</h1>
          <span className="text-sm text-gray-500">
            Tri: {sort.field === "icp_score" ? "Score ICP" : sort.field}{" "}
            {sort.order === "desc" ? "\u2193" : "\u2191"}
          </span>
        </div>

        {/* Filters */}
        <div className="mb-4">
          <FilterBar filters={filters} onChange={setFilters} showStatus={true} />
        </div>

        {/* Export */}
        <div className="mb-4 flex items-end gap-3 bg-white rounded-lg shadow px-4 py-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date debut</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border-gray-300 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date fin</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border-gray-300 text-sm" />
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {exporting ? "Export..." : "Exporter CSV"}
          </button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        )}

        {/* Error */}
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
                Aucun lead en sequence d'outreach
              </p>
            ) : (
              <SequenceTable
                leads={leads}
                selected={selected}
                onToggleSelect={handleToggleSelect}
                onToggleAll={handleToggleAll}
                onLeadClick={(id) => setSelectedLeadId(id)}
                sortField={sort.field}
                sortOrder={sort.order}
                onSortChange={handleSortChange}
                onAction={handleRowAction}
              />
            )}
          </>
        )}
      </div>

      {/* Bulk action bar */}
      <BulkActionBar
        count={selected.size}
        onAction={handleBulkAction}
        onClear={() => setSelected(new Set())}
      />

      {/* Lead detail drawer */}
      <LeadDrawer isOpen={!!selectedLeadId} onClose={() => setSelectedLeadId(null)}>
        {lead ? (
          <>
            <ProfileSection lead={lead} />
            <ScoringSection lead={lead} />
            <SignalSection lead={lead} />
            <TimelineSection lead={lead} />
            <ActionButtons
              lead={lead}
              onAction={handleDrawerAction}
              isLoading={leadAction.isPending}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        )}
      </LeadDrawer>

      {/* Exclude confirmation */}
      <ConfirmDialog
        isOpen={confirmExclude}
        title="Exclure ce lead ?"
        message="Cette action est irreversible. Le lead sera exclu et ses donnees anonymisees (RGPD)."
        confirmLabel="Exclure"
        danger
        onConfirm={handleConfirmExclude}
        onCancel={() => setConfirmExclude(false)}
      />
    </div>
  );
}
