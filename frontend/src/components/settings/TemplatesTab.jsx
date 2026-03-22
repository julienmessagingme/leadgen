import { useState, useEffect } from "react";
import { useConfig, useUpdateConfig } from "../../hooks/useSettings";

const TEMPLATE_KEYS = [
  { key: "template_invitation", label: "Invitation LinkedIn" },
  { key: "template_followup", label: "Suivi LinkedIn" },
  { key: "template_email", label: "Email J+7" },
  { key: "template_whatsapp", label: "WhatsApp J+14" },
];

export default function TemplatesTab() {
  const { data, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();

  const [values, setValues] = useState({});
  const [savedKey, setSavedKey] = useState(null);

  const configs = data?.settings ?? [];

  useEffect(() => {
    if (configs.length > 0) {
      const v = {};
      for (const tk of TEMPLATE_KEYS) {
        const found = configs.find((c) => c.key === tk.key);
        v[tk.key] = found?.value ?? "";
      }
      setValues(v);
    }
  }, [configs]);

  const handleSave = async (key) => {
    try {
      await updateConfig.mutateAsync({ key, value: values[key] });
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 2000);
    } catch {
      // handled by React Query
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-40 bg-gray-200 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-2">Templates de messages</h2>
      <p className="text-sm text-gray-500 mb-4">
        Ces instructions sont utilisees par l'IA pour generer les messages personnalises. Modifiez le ton, les regles ou le contexte selon vos besoins.
      </p>

      <div className="space-y-4">
        {TEMPLATE_KEYS.map((tk) => (
          <div key={tk.key} className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">{tk.label}</h3>
              <div className="flex items-center gap-2">
                {savedKey === tk.key && (
                  <span className="text-sm text-green-600 font-medium">Enregistre !</span>
                )}
                <button
                  onClick={() => handleSave(tk.key)}
                  disabled={updateConfig.isPending}
                  className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Enregistrer
                </button>
              </div>
            </div>
            <textarea
              value={values[tk.key] || ""}
              onChange={(e) => setValues({ ...values, [tk.key]: e.target.value })}
              className="w-full rounded border-gray-300 text-sm resize-y"
              style={{ minHeight: "100px" }}
              placeholder={`Instructions pour ${tk.label}...`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
