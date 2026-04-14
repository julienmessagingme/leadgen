import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import NavBar from "../components/shared/NavBar";
import ColdSearchForm from "../components/cold/ColdSearchForm";
import ColdSearchResults from "../components/cold/ColdSearchResults";
import ColdSearchHistory from "../components/cold/ColdSearchHistory";
import ColdBuckets from "../components/cold/ColdBuckets";
import { useColdSearch } from "../hooks/useColdOutbound";

var DEFAULT_BUCKETS = [
  { id: "bucket-1", name: "Bucket 1", items: [] },
  { id: "bucket-2", name: "Bucket 2", items: [] },
  { id: "bucket-3", name: "Bucket 3", items: [] },
];

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
  var [buckets, setBuckets] = useState(function () { return loadSessionState("cold_buckets", DEFAULT_BUCKETS.map(function (b) { return { ...b, items: [] }; })); });
  var [activeDrag, setActiveDrag] = useState(null);
  var formRef = useRef(null);

  // Persist all state to sessionStorage via useEffect
  var setActiveSearch = function (val) { setActiveSearchRaw(val); };
  var setViewSearchId = function (val) { setViewSearchIdRaw(val); };

  useEffect(function () {
    try { sessionStorage.setItem("cold_activeSearch", JSON.stringify(activeSearch)); } catch (_e) {}
  }, [activeSearch]);
  useEffect(function () {
    try { sessionStorage.setItem("cold_viewSearchId", JSON.stringify(viewSearchId)); } catch (_e) {}
  }, [viewSearchId]);
  useEffect(function () {
    try { sessionStorage.setItem("cold_buckets", JSON.stringify(buckets)); } catch (_e) {}
  }, [buckets]);

  // Load a past search by ID
  var { data: loadedSearch } = useColdSearch(viewSearchId);
  var displaySearch = activeSearch || loadedSearch || null;

  // Compute bucketed keys set (linkedin_url as unique key across searches)
  var bucketedKeys = useMemo(function () {
    var s = new Set();
    buckets.forEach(function (b) {
      b.items.forEach(function (item) { if (item.linkedin_url) s.add(item.linkedin_url); });
    });
    return s;
  }, [buckets]);

  // Compute bucketed indexes for CURRENT search only (for table badges)
  var bucketedIndexes = useMemo(function () {
    if (!displaySearch || !displaySearch.results) return new Set();
    var s = new Set();
    displaySearch.results.forEach(function (r, idx) {
      if (r.linkedin_url && bucketedKeys.has(r.linkedin_url)) s.add(idx);
    });
    return s;
  }, [bucketedKeys, displaySearch]);

  // DnD sensors
  var pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  var keyboardSensor = useSensor(KeyboardSensor);
  var sensors = useSensors(pointerSensor, keyboardSensor);

  // Handlers
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

  var handleDropIntoBucket = useCallback(function (dragData, targetBucketId) {
    // dragData comes from useDraggable data: { index, profile, searchId }
    var profile = dragData.profile;
    if (!profile || !profile.linkedin_url) return;
    var item = {
      ...profile,
      _sourceSearchId: dragData.searchId || (displaySearch && displaySearch.id) || null,
      _sourceIndex: dragData.index,
    };

    setBuckets(function (prev) {
      return prev.map(function (b) {
        var filtered = b.items.filter(function (it) { return it.linkedin_url !== profile.linkedin_url; });
        if (b.id === targetBucketId) {
          filtered.push(item);
        }
        return { ...b, items: filtered };
      });
    });
  }, [displaySearch]);

  var handleRenameBucket = useCallback(function (bucketId, newName) {
    setBuckets(function (prev) {
      return prev.map(function (b) {
        return b.id === bucketId ? { ...b, name: newName } : b;
      });
    });
  }, []);

  var handleRemoveFromBucket = useCallback(function (linkedinUrl, bucketId) {
    setBuckets(function (prev) {
      return prev.map(function (b) {
        if (b.id !== bucketId) return b;
        return { ...b, items: b.items.filter(function (it) { return it.linkedin_url !== linkedinUrl; }) };
      });
    });
  }, []);

  // DnD callbacks
  var handleDragStart = function (event) {
    var data = event.active.data.current;
    if (data) setActiveDrag(data);
  };

  var handleDragEnd = function (event) {
    setActiveDrag(null);
    if (!event.over) return;
    var targetId = event.over.id;
    var dragData = event.active.data.current;
    if (dragData && typeof targetId === "string" && targetId.startsWith("bucket-")) {
      handleDropIntoBucket(dragData, targetId);
    }
  };

  var handleDragCancel = function () {
    setActiveDrag(null);
  };

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

        {/* Search form */}
        <div ref={formRef} className="mb-6 max-w-7xl">
          <ColdSearchForm
            prefill={prefillFilters}
            onSearchComplete={handleSearchComplete}
          />
        </div>

        {/* Results + Buckets with DnD */}
        {displaySearch && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="flex gap-4 mb-6">
              {/* Results table */}
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

              {/* Bucket columns */}
              <div className="w-[580px] flex-shrink-0">
                <div className="sticky top-4">
                  <ColdBuckets
                    buckets={buckets}
                    onRenameBucket={handleRenameBucket}
                    onRemoveFromBucket={handleRemoveFromBucket}
                  />
                </div>
              </div>
            </div>

            {/* Drag overlay — floating card during drag */}
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

        {/* History */}
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
