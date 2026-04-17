import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import NavBar from "../components/shared/NavBar";
import ColdSearchForm from "../components/cold/ColdSearchForm";
import ColdSearchResults from "../components/cold/ColdSearchResults";
import ColdSearchHistory from "../components/cold/ColdSearchHistory";
import Campaigns from "../components/cold/Campaigns";
import { useColdSearch } from "../hooks/useColdOutbound";
import { useActiveCampaigns, useAddToCampaign } from "../hooks/useCampaigns";

function loadSessionState(key, fallback) {
  try {
    var stored = sessionStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch (_e) {}
  return fallback;
}

export default function ColdOutbound() {
  var [activeSearch, setActiveSearchRaw] = useState(function () { return loadSessionState("cold_activeSearch", null); });
  var [prefillFilters, setPrefillFilters] = useState(null);
  var [viewSearchId, setViewSearchIdRaw] = useState(function () { return loadSessionState("cold_viewSearchId", null); });
  var [activeDrag, setActiveDrag] = useState(null);
  var formRef = useRef(null);

  var { data: campaignsData } = useActiveCampaigns();
  var campaigns = (campaignsData && campaignsData.campaigns) || [];
  var addToCampaign = useAddToCampaign();

  var setActiveSearch = function (val) { setActiveSearchRaw(val); };
  var setViewSearchId = function (val) { setViewSearchIdRaw(val); };

  useEffect(function () {
    try { sessionStorage.setItem("cold_activeSearch", JSON.stringify(activeSearch)); } catch (_e) {}
  }, [activeSearch]);
  useEffect(function () {
    try { sessionStorage.setItem("cold_viewSearchId", JSON.stringify(viewSearchId)); } catch (_e) {}
  }, [viewSearchId]);

  var { data: loadedSearch } = useColdSearch(viewSearchId);
  var displaySearch = activeSearch || loadedSearch || null;

  // linkedin_urls already in any draft campaign, for table badges
  var bucketedKeys = useMemo(function () {
    var s = new Set();
    campaigns.forEach(function (c) {
      (c.items || []).forEach(function (it) { if (it.linkedin_url) s.add(it.linkedin_url); });
    });
    return s;
  }, [campaigns]);

  var bucketedIndexes = useMemo(function () {
    if (!displaySearch || !displaySearch.results) return new Set();
    var s = new Set();
    displaySearch.results.forEach(function (r, idx) {
      if (r.linkedin_url && bucketedKeys.has(r.linkedin_url)) s.add(idx);
    });
    return s;
  }, [bucketedKeys, displaySearch]);

  var pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  var keyboardSensor = useSensor(KeyboardSensor);
  var sensors = useSensors(pointerSensor, keyboardSensor);

  var handleSearchComplete = function (searchData) {
    setActiveSearch(searchData);
    setViewSearchId(null);
  };

  var handleRelaunch = function (filters) {
    setPrefillFilters({ ...filters, _ts: Date.now() });
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  var handleViewResults = function (searchId) {
    setActiveSearch(null);
    setViewSearchId(searchId);
  };

  var handleResultsUpdate = useCallback(function (updatedSearch) {
    if (activeSearch && activeSearch.id === updatedSearch.id) {
      setActiveSearch(updatedSearch);
    }
  }, [activeSearch]);

  var handleDragStart = function (event) {
    var data = event.active.data.current;
    if (data) setActiveDrag(data);
  };

  var handleDragEnd = function (event) {
    setActiveDrag(null);
    if (!event.over) return;
    var targetId = event.over.id;
    var dragData = event.active.data.current;
    if (!dragData || typeof targetId !== "string" || !targetId.startsWith("campaign-")) return;

    var campaignId = Number.parseInt(targetId.replace("campaign-", ""), 10);
    if (!Number.isInteger(campaignId)) return;

    var profile = dragData.profile;
    if (!profile || !profile.linkedin_url) return;

    addToCampaign.mutate({
      campaignId: campaignId,
      payload: {
        cold_search_id: dragData.searchId || (displaySearch && displaySearch.id) || null,
        source_profile_index: dragData.index,
        linkedin_url: profile.linkedin_url,
        profile_snapshot: profile,
      },
    });
  };

  var handleDragCancel = function () { setActiveDrag(null); };

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />

      <div className={`mx-auto px-4 py-6 ${displaySearch ? "max-w-full px-6" : "max-w-7xl"}`}>
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">Cold Outbound</h1>
          <p className="text-sm text-gray-500 mt-1">
            Recherche directe de leads via LinkedIn — enrichissement selectif et double voie (pipeline ou email direct)
          </p>
        </div>

        <div ref={formRef} className="mb-6 max-w-7xl">
          <ColdSearchForm
            prefill={prefillFilters}
            onSearchComplete={handleSearchComplete}
          />
        </div>

        {displaySearch && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="flex gap-4 mb-6">
              <div className="flex-1 min-w-0">
                <ColdSearchResults
                  search={displaySearch}
                  onUpdate={handleResultsUpdate}
                  bucketedIndexes={bucketedIndexes}
                  onSearchCompany={function (companyName) {
                    setPrefillFilters({ company: companyName, job_title: displaySearch.filters?.job_title || "" });
                    formRef.current?.scrollIntoView({ behavior: "smooth" });
                  }}
                />
              </div>

              <div className="w-[420px] flex-shrink-0">
                <div className="sticky top-4 h-[calc(100vh-6rem)]">
                  <Campaigns />
                </div>
              </div>
            </div>

            <DragOverlay>
              {activeDrag ? (
                <div className="bg-white rounded-lg shadow-lg border border-indigo-200 px-3 py-2 w-56 opacity-90">
                  <div className="text-sm font-medium text-gray-900">
                    {activeDrag.profile?.first_name} {activeDrag.profile?.last_name}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {activeDrag.profile?.headline || "--"}
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        <div className="mt-6 max-w-7xl">
          <ColdSearchHistory
            onRelaunch={handleRelaunch}
            onViewResults={handleViewResults}
          />
        </div>
      </div>
    </div>
  );
}
