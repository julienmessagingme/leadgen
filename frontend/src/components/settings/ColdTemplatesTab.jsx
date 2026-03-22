import { useState, useEffect } from "react";
import { useConfig, useUpdateConfig } from "../../hooks/useSettings";

const EMPTY_TEMPLATE = { name: "", prompt: "", value_proposition: "" };

export default function ColdTemplatesTab() {
  const { data, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();

  const [templates, setTemplates] = useState([]);
  const [saved, setSaved] = useState(false);

  const configs = data?.settings ?? [];

  useEffect(() => {
    if (configs.length > 0) {
      const found = configs.find((c) => c.key === "cold_templates");
      if (found?.value) {
        try {
          const parsed = JSON.parse(found.value);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setTemplates(parsed);
            return;
          }
        } catch {
          // ignore parse error
        }
      }
      // Default: empty array (no templates configured yet)
      setTemplates([]);
    }
  }, [configs]);

  const addTemplate = () => {
    setTemplates([...templates, { ...EMPTY_TEMPLATE }]);
  };

  const removeTemplate = (index) => {
    setTemplates(templates.filter((_, i) => i !== index));
  };

  const updateField = (index, field, value) => {
    const updated = templates.map((t, i) =>
      i === index ? { ...t, [field]: value } : t
    );
    setTemplates(updated);
  };

  const handleSave = async () => {
    try {
      await updateConfig.mutateAsync({
        key: "cold_templates",
        value: JSON.stringify(templates),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // handled by React Query
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-48 bg-gray-200 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-2">
        Templates Cold Outbound
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Configurez les templates utilises par l'IA pour generer les messages
        destines aux leads cold. Chaque template contient des instructions et une
        proposition de valeur.
      </p>

      <div className="space-y-4">
        {templates.map((tpl, idx) => (
          <div key={idx} className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <input
                type="text"
                value={tpl.name}
                onChange={(e) => updateField(idx, "name", e.target.value)}
                placeholder="Nom du template (ex: SaaS, Retail, Finance...)"
                className="text-sm font-semibold text-gray-700 border-gray-300 rounded px-2 py-1 flex-1 mr-3"
              />
              <button
                onClick={() => removeTemplate(idx)}
                className="text-sm text-red-500 hover:text-red-700 font-medium"
              >
                Supprimer
              </button>
            </div>

            <label className="block text-xs font-medium text-gray-500 mb-1">
              Instructions / Prompt
            </label>
            <textarea
              value={tpl.prompt}
              onChange={(e) => updateField(idx, "prompt", e.target.value)}
              className="w-full rounded border-gray-300 text-sm resize-y mb-3"
              style={{ minHeight: "100px" }}
              placeholder="Instructions pour l'IA (ton, regles, format)..."
            />

            <label className="block text-xs font-medium text-gray-500 mb-1">
              Proposition de valeur
            </label>
            <textarea
              value={tpl.value_proposition}
              onChange={(e) =>
                updateField(idx, "value_proposition", e.target.value)
              }
              className="w-full rounded border-gray-300 text-sm resize-y"
              style={{ minHeight: "60px" }}
              placeholder="Proposition de valeur a mettre en avant pour ce type de prospect..."
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={addTemplate}
          className="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50"
        >
          + Ajouter un template
        </button>

        <button
          onClick={handleSave}
          disabled={updateConfig.isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          Enregistrer
        </button>

        {saved && (
          <span className="text-sm text-green-600 font-medium">
            Enregistre !
          </span>
        )}
      </div>
    </div>
  );
}
