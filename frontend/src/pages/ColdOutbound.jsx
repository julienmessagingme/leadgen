import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import NavBar from "../components/shared/NavBar";
import ColdSearchForm from "../components/cold/ColdSearchForm";
import ColdSearchHistory from "../components/cold/ColdSearchHistory";

export default function ColdOutbound() {
  const [prefillFilters, setPrefillFilters] = useState(null);
  const formRef = useRef(null);
  const queryClient = useQueryClient();

  const handleRelaunch = (filters) => {
    setPrefillFilters({ ...filters });
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSearchCreated = () => {
    queryClient.invalidateQueries({ queryKey: ["cold-searches"] });
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">Cold Outbound</h1>
          <p className="text-sm text-gray-500 mt-1">
            Recherche directe de leads via Sales Navigator
          </p>
        </div>

        {/* Search form */}
        <div ref={formRef} className="mb-6">
          <ColdSearchForm
            prefill={prefillFilters}
            onSearchCreated={handleSearchCreated}
          />
        </div>

        {/* Search history */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            Historique des recherches
          </h2>
          <ColdSearchHistory onRelaunch={handleRelaunch} />
        </div>
      </div>
    </div>
  );
}
