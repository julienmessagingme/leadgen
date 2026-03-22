import { useState, useEffect } from "react";
import { useConfig, useUpdateConfig } from "../../hooks/useSettings";

export default function LimitsTab() {
  const { data, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();

  const [inviteLimit, setInviteLimit] = useState("");
  const [leadLimit, setLeadLimit] = useState("");
  const [saved, setSaved] = useState(false);

  const configs = data ?? [];

  // Pre-fill from config data
  useEffect(() => {
    if (configs.length > 0) {
      const invite = configs.find((c) => c.key === "daily_invitation_limit");
      const lead = configs.find((c) => c.key === "daily_lead_limit");
      if (invite) setInviteLimit(invite.value ?? "");
      if (lead) setLeadLimit(lead.value ?? "");
    }
  }, [configs]);

  const handleSave = async () => {
    try {
      await updateConfig.mutateAsync({ key: "daily_invitation_limit", value: Number(inviteLimit) });
      await updateConfig.mutateAsync({ key: "daily_lead_limit", value: Number(leadLimit) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // mutation error handled by React Query
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-gray-200 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Limites</h2>

      <div className="bg-white rounded-lg shadow p-6 max-w-lg space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Limite d'invitations LinkedIn par jour
          </label>
          <input
            type="number"
            min={0}
            value={inviteLimit}
            onChange={(e) => setInviteLimit(e.target.value)}
            className="w-full rounded border-gray-300 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Limite de leads par batch
          </label>
          <input
            type="number"
            min={0}
            value={leadLimit}
            onChange={(e) => setLeadLimit(e.target.value)}
            className="w-full rounded border-gray-300 text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={updateConfig.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            Enregistrer
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">Enregistre !</span>
          )}
        </div>

        <p className="text-xs text-gray-400">
          Les modifications prennent effet au prochain run de la tache concernee
        </p>
      </div>
    </div>
  );
}
