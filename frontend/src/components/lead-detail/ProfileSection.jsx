export default function ProfileSection({ lead }) {
  const displayName =
    lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Inconnu";

  return (
    <div className="mb-6">
      <h2 className="text-xl font-bold text-gray-900">{displayName}</h2>
      {lead.headline && (
        <p className="text-sm text-gray-500 mt-0.5">{lead.headline}</p>
      )}

      <div className="mt-3 space-y-1.5">
        {lead.company_name && (
          <p className="text-sm text-gray-700">
            <span className="font-medium text-gray-500">Entreprise :</span>{" "}
            {lead.company_name}
          </p>
        )}
        {lead.sector && (
          <p className="text-sm text-gray-700">
            <span className="font-medium text-gray-500">Secteur :</span>{" "}
            {lead.sector}
          </p>
        )}
        {lead.location && (
          <p className="text-sm text-gray-700">
            <span className="font-medium text-gray-500">Localisation :</span>{" "}
            {lead.location}
          </p>
        )}
        {lead.linkedin_url && (
          <p className="text-sm">
            <a
              href={lead.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:text-indigo-800 underline"
            >
              Voir le profil LinkedIn
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
