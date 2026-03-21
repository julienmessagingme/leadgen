const TIER_COLORS = {
  hot: "bg-red-100 text-red-700",
  warm: "bg-orange-100 text-orange-700",
  cold: "bg-blue-100 text-blue-700",
};

export default function TierBadge({ tier }) {
  const colors = TIER_COLORS[tier] || "bg-gray-100 text-gray-700";

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium uppercase ${colors}`}
    >
      {tier || "N/A"}
    </span>
  );
}
