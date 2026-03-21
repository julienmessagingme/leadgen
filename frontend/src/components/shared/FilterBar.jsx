import { useDeferredValue, useState, useEffect } from "react";

const TIER_OPTIONS = [
  { value: "", label: "Tous tiers" },
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
];

const SOURCE_OPTIONS = [
  { value: "", label: "Toutes sources" },
  { value: "concurrent", label: "Concurrent" },
  { value: "influenceur", label: "Influenceur" },
  { value: "sujet", label: "Sujet" },
  { value: "job", label: "Job" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Tous statuts" },
  { value: "new,enriched,scored", label: "Nouveau" },
  { value: "prospected,invitation_sent", label: "Prospecte" },
  { value: "connected,messaged", label: "Connecte" },
  { value: "email_sent", label: "Email" },
  { value: "whatsapp_sent", label: "WhatsApp" },
  { value: "replied,meeting_booked", label: "Gagne" },
  { value: "disqualified", label: "Exclu" },
];

const selectClass =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none";

export default function FilterBar({ filters, onChange, showStatus = true }) {
  const [searchInput, setSearchInput] = useState(filters.search || "");
  const deferredSearch = useDeferredValue(searchInput);

  useEffect(() => {
    if (deferredSearch !== (filters.search || "")) {
      onChange({ ...filters, search: deferredSearch || undefined });
    }
  }, [deferredSearch]);

  const handleChange = (field, value) => {
    onChange({ ...filters, [field]: value || undefined });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={filters.tier || ""}
        onChange={(e) => handleChange("tier", e.target.value)}
        className={selectClass}
      >
        {TIER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={filters.source || ""}
        onChange={(e) => handleChange("source", e.target.value)}
        className={selectClass}
      >
        {SOURCE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {showStatus && (
        <select
          value={filters.status || ""}
          onChange={(e) => handleChange("status", e.target.value)}
          className={selectClass}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Rechercher par nom ou entreprise..."
        className="min-w-64 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
      />
    </div>
  );
}
