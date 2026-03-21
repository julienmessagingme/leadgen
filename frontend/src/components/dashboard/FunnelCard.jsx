import { FunnelChart, Funnel, Cell, Tooltip, ResponsiveContainer } from "recharts";

const COLORS = ["#4f46e5", "#8b5cf6", "#a855f7", "#d946ef", "#f472b6"];

export default function FunnelCard({ data }) {
  if (!data) return null;

  const { funnel, conversions } = data;
  const chartData = [
    { name: "New", value: funnel.new },
    { name: "Invited", value: funnel.invited },
    { name: "Connected", value: funnel.connected },
    { name: "Email", value: funnel.email },
    { name: "WhatsApp", value: funnel.whatsapp },
  ];

  const convLabels = [
    { label: "Invited", pct: conversions.invited_pct },
    { label: "Connected", pct: conversions.connected_pct },
    { label: "Email", pct: conversions.email_pct },
    { label: "WhatsApp", pct: conversions.whatsapp_pct },
  ];

  return (
    <div className="bg-white rounded-xl shadow-md p-5">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Funnel de conversion
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <FunnelChart>
          <Tooltip
            formatter={(value, name) => [`${value} leads`, name]}
            contentStyle={{ borderRadius: "8px", fontSize: "13px" }}
          />
          <Funnel dataKey="value" data={chartData} isAnimationActive>
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i]} />
            ))}
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
      <div className="flex justify-center gap-3 mt-3 flex-wrap">
        {convLabels.map((c) => (
          <span
            key={c.label}
            className="inline-flex items-center gap-1 text-xs font-medium bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full"
          >
            {c.label}: {c.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}
