import { useState, useRef } from "react";
import NavBar from "../components/shared/NavBar";
import ColdSearchForm from "../components/cold/ColdSearchForm";
import ColdSearchResults from "../components/cold/ColdSearchResults";
import ColdSearchHistory from "../components/cold/ColdSearchHistory";
import { useColdSearch } from "../hooks/useColdOutbound";

export default function ColdOutbound() {
  const [activeSearch, setActiveSearch] = useState(null);
  const [prefillFilters, setPrefillFilters] = useState(null);
  const [viewSearchId, setViewSearchId] = useState(null);
  const formRef = useRef(null);

  // Load a past search by ID when "Voir" is clicked in history
  const { data: loadedSearch } = useColdSearch(viewSearchId);

  // Determine which search to display
  const displaySearch = activeSearch || loadedSearch || null;

  const handleSearchComplete = (searchData) => {
    setActiveSearch(searchData);
    setViewSearchId(null);
  };

  const handleRelaunch = (filters) => {
    setPrefillFilters({ ...filters });
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleViewResults = (searchId) => {
    setActiveSearch(null);
    setViewSearchId(searchId);
  };

  const handleResultsUpdate = (updatedSearch) => {
    if (activeSearch && activeSearch.id === updatedSearch.id) {
      setActiveSearch(updatedSearch);
    }
    // For loaded searches, react-query will refetch via invalidation
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">Cold Outbound</h1>
          <p className="text-sm text-gray-500 mt-1">
            Recherche directe de leads via LinkedIn — enrichissement selectif et double voie (pipeline ou email direct)
          </p>
        </div>

        {/* Search form */}
        <div ref={formRef} className="mb-6">
          <ColdSearchForm
            prefill={prefillFilters}
            onSearchComplete={handleSearchComplete}
          />
        </div>

        {/* Results */}
        {displaySearch && (
          <div className="mb-6">
            <ColdSearchResults
              search={displaySearch}
              onUpdate={handleResultsUpdate}
            />
          </div>
        )}

        {/* History */}
        <div className="mt-6">
          <ColdSearchHistory
            onRelaunch={handleRelaunch}
            onViewResults={handleViewResults}
          />
        </div>
      </div>
    </div>
  );
}
