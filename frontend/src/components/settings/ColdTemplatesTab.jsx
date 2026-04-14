import { useState, useEffect } from "react";
import { useConfig, useUpdateConfig } from "../../hooks/useSettings";

var EMPTY_SCENARIO = {
  name: "",
  target_profile: "",
  pain_point: "",
  value_prop: "",
  social_proof: "",
  matching_keywords: "",
};

export default function ColdTemplatesTab() {
  var { data, isLoading } = useConfig();
  var updateConfig = useUpdateConfig();

  var [scenarios, setScenarios] = useState([]);
  var [saved, setSaved] = useState(false);

  var configs = data?.settings ?? [];

  useEffect(function () {
    if (configs.length > 0) {
      var found = configs.find(function (c) { return c.key === "cold_scenarios"; });
      if (found?.value) {
        try {
          var parsed = JSON.parse(found.value);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setScenarios(parsed);
            return;
          }
        } catch (_e) {}
      }
      setScenarios([]);
    }
  }, [configs]);

  var addScenario = function () {
    setScenarios([...scenarios, { ...EMPTY_SCENARIO }]);
  };

  var removeScenario = function (index) {
    setScenarios(scenarios.filter(function (_, i) { return i !== index; }));
  };

  var updateField = function (index, field, value) {
    setScenarios(scenarios.map(function (s, i) {
      return i === index ? { ...s, [field]: value } : s;
    }));
  };

  var handleSave = async function () {
    try {
      await updateConfig.mutateAsync({
        key: "cold_scenarios",
        value: JSON.stringify(scenarios),
      });
      setSaved(true);
      setTimeout(function () { setSaved(false); }, 2000);
    } catch (_e) {}
  };

  if (isLoading) {
    return <div className="h-48 bg-gray-200 rounded animate-pulse" />;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-2">
        Scenarios Cold Email
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Chaque scenario definit un angle d'approche pour un type de prospect. Sonnet utilise le scenario qui matche le mieux (par mots-cles) pour structurer le mail cold.
      </p>

      <div className="space-y-4">
        {scenarios.map(function (sc, idx) {
          return (
            <div key={idx} className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <input
                  type="text"
                  value={sc.name}
                  onChange={function (e) { updateField(idx, "name", e.target.value); }}
                  placeholder="Nom du scenario (ex: Courtier assurance, Retail luxe...)"
                  className="text-sm font-semibold text-gray-700 border-gray-300 rounded px-2 py-1 flex-1 mr-3"
                />
                <button
                  onClick={function () { removeScenario(idx); }}
                  className="text-sm text-red-500 hover:text-red-700 font-medium"
                >
                  Supprimer
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Profil cible</label>
                  <input
                    type="text"
                    value={sc.target_profile}
                    onChange={function (e) { updateField(idx, "target_profile", e.target.value); }}
                    placeholder="ex: Directeur d'agence de courtage en assurance"
                    className="w-full rounded border-gray-300 text-sm px-2 py-1.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Mots-cles de matching (separes par virgule)</label>
                  <input
                    type="text"
                    value={sc.matching_keywords}
                    onChange={function (e) { updateField(idx, "matching_keywords", e.target.value); }}
                    placeholder="ex: courtier, assurance, broker, insurance, prevoyance"
                    className="w-full rounded border-gray-300 text-sm px-2 py-1.5"
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Pain point a adresser</label>
                <textarea
                  value={sc.pain_point}
                  onChange={function (e) { updateField(idx, "pain_point", e.target.value); }}
                  className="w-full rounded border-gray-300 text-sm resize-y"
                  style={{ minHeight: "60px" }}
                  placeholder="ex: Les courtiers perdent des leads par manque de reactivite. Le prospect qui demande un devis attend une reponse rapide, sinon il va voir ailleurs."
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Proposition de valeur</label>
                <textarea
                  value={sc.value_prop}
                  onChange={function (e) { updateField(idx, "value_prop", e.target.value); }}
                  className="w-full rounded border-gray-300 text-sm resize-y"
                  style={{ minHeight: "60px" }}
                  placeholder="ex: Le conversationnel WhatsApp permet de repondre en moins de 5 min, qualifier le besoin et pousser un devis — tout ca automatise."
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Preuve sociale</label>
                <textarea
                  value={sc.social_proof}
                  onChange={function (e) { updateField(idx, "social_proof", e.target.value); }}
                  className="w-full rounded border-gray-300 text-sm resize-y"
                  style={{ minHeight: "40px" }}
                  placeholder="ex: On travaille deja avec plusieurs courtiers sur ce type de dispositif."
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={addScenario}
          className="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50"
        >
          + Ajouter un scenario
        </button>
        <button
          onClick={handleSave}
          disabled={updateConfig.isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          Enregistrer
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">Enregistre !</span>}
      </div>
    </div>
  );
}
