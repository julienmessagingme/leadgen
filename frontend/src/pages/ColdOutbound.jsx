import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import NavBar from "../components/shared/NavBar";
import ColdSearchForm from "../components/cold/ColdSearchForm";
import ColdSearchResults from "../components/cold/ColdSearchResults";
import ColdSearchHistory from "../components/cold/ColdSearchHistory";
import ColdBuckets from "../components/cold/ColdBuckets";
import { useColdSearch } from "../hooks/useColdOutbound";

var DEFAULT_BUCKETS = [
  { id: "bucket-1", name: "Bucket 1", profileIndexes: [] },
  { id: "bucket-2", name: "Bucket 2", profileIndexes: [] },
  { id: "bucket-3", name: "Bucket 3", profileIndexes: [] },
];

export default function ColdOutbound() {
  var [activeSearch, setActiveSearch] = useState(null);
  var [prefillFilters, setPrefillFilters] = useState(null);
  var [viewSearchId, setViewSearchId] = useState(null);
  var [buckets, setBuckets] = useState(DEFAULT_BUCKETS.map(function (b) { return { ...b, profileIndexes: [] }; }));
  var [activeDrag, setActiveDrag] = useState(null);
  var formRef = useRef(null);

  // Load a past search by ID
  var { data: loadedSearch } = useColdSearch(viewSearchId);
  var displaySearch = activeSearch || loadedSearch || null;

  // Clear buckets when search changes
  useEffect(function () {
    setBuckets(function (prev) {
      return prev.map(function (b) { return { ...b, profileIndexes: [] }; });
    });
  }, [displaySearch?.id]);

  // Compute bucketed indexes set
  var bucketedIndexes = useMemo(function () {
    var s = new Set();
    buckets.forEach(function (b) { b.profileIndexes.forEach(function (idx) { s.add(idx); }); });
    return s;
  }, [buckets]);

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
    setPrefillFilters({ ...filters });
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

  var handleBucketResultsUpdate = useCallback(function (updatedResults) {
    if (activeSearch) {
      setActiveSearch(function (prev) { return { ...prev, results: updatedResults }; });
    }
  }, [activeSearch]);

  var handleDropIntoBucket = useCallback(function (profileIndex, targetBucketId) {
    setBuckets(function (prev) {
      return prev.map(function (b) {
        // Remove from any bucket first
        var filtered = b.profileIndexes.filter(function (idx) { return idx !== profileIndex; });
        // Add to target
        if (b.id === targetBucketId) {
          if (!filtered.includes(profileIndex)) {
            filtered.push(profileIndex);
          }
        }
        return { ...b, profileIndexes: filtered };
      });
    });
  }, []);

  var handleRenameBucket = useCallback(function (bucketId, newName) {
    setBuckets(function (prev) {
      return prev.map(function (b) {
        return b.id === bucketId ? { ...b, name: newName } : b;
      });
    });
  }, []);

  var handleRemoveFromBucket = useCallback(function (profileIndex, bucketId) {
    setBuckets(function (prev) {
      return prev.map(function (b) {
        if (b.id !== bucketId) return b;
        return { ...b, profileIndexes: b.profileIndexes.filter(function (idx) { return idx !== profileIndex; }) };
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
    var profileIndex = event.active.data.current?.index;
    if (profileIndex !== undefined && typeof targetId === "string" && targetId.startsWith("bucket-")) {
      handleDropIntoBucket(profileIndex, targetId);
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
              <div className="w-[540px] flex-shrink-0">
                <div className="sticky top-4">
                  <ColdBuckets
                    buckets={buckets}
                    results={displaySearch.results}
                    searchId={displaySearch.id}
                    onRenameBucket={handleRenameBucket}
                    onRemoveFromBucket={handleRemoveFromBucket}
                    onUpdate={handleBucketResultsUpdate}
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
