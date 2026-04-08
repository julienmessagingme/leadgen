import { useState } from "react";
import NavBar from "../components/shared/NavBar";
import IcpRulesTab from "../components/settings/IcpRulesTab";
import SuppressionTab from "../components/settings/SuppressionTab";
import LimitsTab from "../components/settings/LimitsTab";
import WatchlistTab from "../components/settings/WatchlistTab";
import SourcePerformanceTab from "../components/settings/SourcePerformanceTab";
import TemplatesTab from "../components/settings/TemplatesTab";
import ColdTemplatesTab from "../components/settings/ColdTemplatesTab";
import CaseStudiesTab from "../components/settings/CaseStudiesTab";
import CronTab from "../components/settings/CronTab";

const TABS = [
  { key: "icp", label: "Scoring ICP" },
  { key: "suppression", label: "Suppression RGPD" },
  { key: "limits", label: "Limites" },
  { key: "watchlist", label: "Sources & Mots-cles" },
  { key: "performance", label: "Performance sources" },
  { key: "templates", label: "Templates" },
  { key: "cold_templates", label: "Templates Cold" },
  { key: "case_studies", label: "Cas clients" },
  { key: "cron", label: "Planning Cron" },
];

const TAB_COMPONENTS = {
  icp: IcpRulesTab,
  suppression: SuppressionTab,
  limits: LimitsTab,
  watchlist: WatchlistTab,
  performance: SourcePerformanceTab,
  templates: TemplatesTab,
  cold_templates: ColdTemplatesTab,
  case_studies: CaseStudiesTab,
  cron: CronTab,
};

export default function Settings() {
  const [tab, setTab] = useState("icp");
  const ActiveTab = TAB_COMPONENTS[tab];

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Parametres</h1>

        {/* Tab navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-0 -mb-px">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.key
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Active tab content */}
        <ActiveTab />
      </div>
    </div>
  );
}
