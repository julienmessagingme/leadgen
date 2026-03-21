export default function SignalSection({ lead }) {
  const hasSignal = lead.signal_type || lead.signal_category || lead.signal_source || lead.signal_date;

  if (!hasSignal) return null;

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Signal
      </h3>

      <div className="space-y-1.5 text-sm">
        {lead.signal_type && (
          <p className="text-gray-700">
            <span className="font-medium text-gray-500">Type :</span>{" "}
            {lead.signal_type}
          </p>
        )}
        {lead.signal_category && (
          <p className="text-gray-700">
            <span className="font-medium text-gray-500">Categorie :</span>{" "}
            {lead.signal_category}
          </p>
        )}
        {lead.signal_source && (
          <p className="text-gray-700">
            <span className="font-medium text-gray-500">Source :</span>{" "}
            {lead.signal_source}
          </p>
        )}
        {lead.signal_date && (
          <p className="text-gray-700">
            <span className="font-medium text-gray-500">Date :</span>{" "}
            {new Date(lead.signal_date).toLocaleDateString("fr-FR")}
          </p>
        )}
      </div>
    </div>
  );
}
