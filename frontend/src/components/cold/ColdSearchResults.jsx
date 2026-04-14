import { useState, useCallback, Fragment } from "react";
import DOMPurify from "dompurify";
import { useDraggable } from "@dnd-kit/core";
import { useEnrichMutation, useToPipelineMutation, useToEmailMutation, useSimilarCompaniesMutation } from "../../hooks/useColdOutbound";

function DraggableRow({ idx, profile, children, className, onClick }) {
  var { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: "profile-" + idx,
    data: { index: idx, profile: profile },
  });
  return (
    <tr
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={className}
      style={{ opacity: isDragging ? 0.35 : 1, cursor: "grab" }}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

function priseBadge(score) {
  if (score === null || score === undefined) return <span className="text-xs text-gray-300">--</span>;
  let colors;
  if (score >= 70) colors = "bg-green-100 text-green-700";
  else if (score >= 40) colors = "bg-yellow-100 text-yellow-700";
  else colors = "bg-gray-100 text-gray-500";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-mono font-semibold rounded ${colors}`}>
      {score}
    </span>
  );
}

export default function ColdSearchResults({ search, onUpdate, bucketedIndexes, onSearchCompany }) {
  const [selected, setSelected] = useState(new Set());
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [actionPending, setActionPending] = useState({}); // { idx: "pipeline"|"email"|"enriching" }

  const searchId = search?.id;
  const results = search?.results || [];

  const enrichMutation = useEnrichMutation(searchId);
  const pipelineMutation = useToPipelineMutation(searchId);
  const emailMutation = useToEmailMutation(searchId);
  const similarMutation = useSimilarCompaniesMutation(searchId);

  const handleEnrichOne = async (idx) => {
    setActionPending((prev) => ({ ...prev, [idx]: "enriching" }));
    try {
      const resp = await enrichMutation.mutateAsync([idx]);
      if (onUpdate && resp.results) onUpdate({ ...search, results: resp.results });
    } catch (_err) {}
    setActionPending((prev) => { const n = { ...prev }; delete n[idx]; return n; });
  };

  const handleSimilarCompanies = async (idx) => {
    setActionPending((prev) => ({ ...prev, [idx]: "similar" }));
    try {
      const resp = await similarMutation.mutateAsync(idx);
      if (onUpdate && resp.results) onUpdate({ ...search, results: resp.results });
      setExpandedIdx(idx); // Auto-expand to show results
    } catch (_err) {}
    setActionPending((prev) => { const n = { ...prev }; delete n[idx]; return n; });
  };

  const handleToggleSelect = useCallback((idx) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === results.length ? new Set() : new Set(results.map((_, i) => i))
    );
  }, [results]);

  const handleEnrichSelected = async () => {
    const indexes = [...selected].filter((i) => !results[i]?.enriched);
    if (indexes.length === 0) return;
    try {
      const resp = await enrichMutation.mutateAsync(indexes);
      if (onUpdate && resp.results) onUpdate({ ...search, results: resp.results });
    } catch (_err) {}
  };

  const handleToPipeline = async (idx) => {
    setActionPending((prev) => ({ ...prev, [idx]: "pipeline" }));
    try {
      const resp = await pipelineMutation.mutateAsync([idx]);
      if (onUpdate && resp.results) onUpdate({ ...search, results: resp.results });
    } catch (_err) {}
    setActionPending((prev) => { const n = { ...prev }; delete n[idx]; return n; });
  };

  const handleToEmail = async (idx) => {
    setActionPending((prev) => ({ ...prev, [idx]: "email" }));
    try {
      const resp = await emailMutation.mutateAsync([idx]);
      if (onUpdate && resp.results) onUpdate({ ...search, results: resp.results });
    } catch (_err) {}
    setActionPending((prev) => { const n = { ...prev }; delete n[idx]; return n; });
  };

  const handleBulkToPipeline = async () => {
    const indexes = [...selected].filter((i) => results[i]?.enriched && !results[i]?.added_to_pipeline);
    if (indexes.length === 0) return;
    try {
      const resp = await pipelineMutation.mutateAsync(indexes);
      if (onUpdate && resp.results) onUpdate({ ...search, results: resp.results });
      setSelected(new Set());
    } catch (_err) {}
  };

  if (results.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
        Aucun resultat pour cette recherche.
      </div>
    );
  }

  const selectedCount = selected.size;
  const selectedUnenriched = [...selected].filter((i) => !results[i]?.enriched).length;
  const selectedEnrichedNotAdded = [...selected].filter((i) => results[i]?.enriched && !results[i]?.added_to_pipeline).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800">
          Resultats ({results.length} profils)
        </h2>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400" /> HubSpot
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400 ml-2" /> Deja pipeline
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={results.length > 0 && selected.size === results.length}
                  onChange={handleToggleAll}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Titre</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entreprise</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lieu</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Badges</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Prise</th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {results.map((r, idx) => {
              const isExpanded = expandedIdx === idx;
              const pending = actionPending[idx];
              return (
                <Fragment key={idx}>
                  <DraggableRow
                    idx={idx}
                    profile={r}
                    className={`${r.added_to_pipeline ? "bg-green-50/40" : ""} ${
                      selected.has(idx) ? "bg-indigo-50/30" : ""
                    } ${bucketedIndexes && bucketedIndexes.has(idx) ? "bg-teal-50/40" : ""} hover:bg-gray-50`}
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(idx)}
                        onChange={() => handleToggleSelect(idx)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        {r.first_name} {r.last_name}
                      </div>
                      {r.linkedin_url && (
                        <a
                          href={r.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          LinkedIn
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 max-w-md">{r.headline || "--"}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{r.company || "--"}</td>
                    <td className="px-3 py-3 text-sm text-gray-500">{r.location || "--"}</td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {r.hubspot_found && (
                          <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded bg-orange-100 text-orange-700" title={r.hubspot_owner || ""}>
                            HS
                          </span>
                        )}
                        {r.already_in_pipeline && (
                          <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700">
                            Pipeline
                          </span>
                        )}
                        {r.email_status === "found" && (
                          <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700">
                            Email
                          </span>
                        )}
                        {r.email_status === "not_found" && (
                          <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-500">
                            No email
                          </span>
                        )}
                        {bucketedIndexes && bucketedIndexes.has(idx) && (
                          <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded bg-teal-100 text-teal-700">
                            Bucket
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">{priseBadge(r.prise_score)}</td>
                    <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {!r.enriched && (
                          <button
                            onClick={() => handleEnrichOne(idx)}
                            disabled={pending}
                            className="px-2 py-1 text-xs font-medium rounded bg-amber-50 text-amber-600 hover:bg-amber-100 disabled:opacity-50"
                          >
                            {pending === "enriching" ? "..." : "Enrichir"}
                          </button>
                        )}
                        {r.added_to_pipeline ? (
                          <span className="text-xs text-green-600 font-medium">Ajoute</span>
                        ) : (
                          <>
                            <button
                              onClick={() => handleToPipeline(idx)}
                              disabled={!r.enriched || pending}
                              className="px-2 py-1 text-xs font-medium rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              {pending === "pipeline" ? "..." : "Pipeline"}
                            </button>
                            <button
                              onClick={() => handleToEmail(idx)}
                              disabled={!r.enriched || pending}
                              className="px-2 py-1 text-xs font-medium rounded bg-purple-50 text-purple-600 hover:bg-purple-100 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              {pending === "email" ? "..." : "Email"}
                            </button>
                          </>
                        )}
                        {r.enriched && (
                          <button
                            onClick={() => handleSimilarCompanies(idx)}
                            disabled={pending || (r.enrichment_data?.similar_companies?.length > 0)}
                            className="px-2 py-1 text-xs font-medium rounded bg-teal-50 text-teal-600 hover:bg-teal-100 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Trouver des entreprises similaires"
                          >
                            {pending === "similar" ? "..." : r.enrichment_data?.similar_companies?.length > 0 ? "Similaires ✓" : "Similaires"}
                          </button>
                        )}
                      </div>
                    </td>
                  </DraggableRow>

                  {/* Expanded enrichment detail */}
                  {isExpanded && r.enriched && r.enrichment_data && (
                    <tr>
                      <td colSpan={8} className="px-6 py-4 bg-gray-50/50">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          {r.enrichment_data.summary && (
                            <div>
                              <span className="font-medium text-gray-700">Bio:</span>
                              <p className="text-gray-600 mt-1">{r.enrichment_data.summary}</p>
                            </div>
                          )}
                          {r.enrichment_data.company_description && (
                            <div>
                              <span className="font-medium text-gray-700">Entreprise:</span>
                              <p className="text-gray-600 mt-1">{r.enrichment_data.company_description}</p>
                            </div>
                          )}
                          {r.enrichment_data.posts && r.enrichment_data.posts.length > 0 && (
                            <div className="md:col-span-2">
                              <span className="font-medium text-gray-700">Posts recents:</span>
                              <ul className="mt-1 space-y-1">
                                {r.enrichment_data.posts.map((post, pi) => (
                                  <li key={pi} className="text-gray-600 text-xs bg-white rounded p-2 border border-gray-100">
                                    {post.text || "(vide)"}
                                    {post.date && <span className="text-gray-400 ml-2">{post.date}</span>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {r.prise_reasoning && (
                            <div className="md:col-span-2">
                              <span className="font-medium text-gray-700">Raisonnement prise ({r.prise_score}/100):</span>
                              <p className="text-gray-600 mt-1 italic">{r.prise_reasoning}</p>
                            </div>
                          )}
                          {r.email_draft && (
                            <div className="md:col-span-2 bg-purple-50 rounded p-3">
                              <span className="font-medium text-purple-700">Draft email:</span>
                              <p className="text-purple-900 font-medium mt-1">Objet: {r.email_draft.subject}</p>
                              <div className="text-purple-800 mt-1 text-xs" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(r.email_draft.body) }} />
                            </div>
                          )}
                          {r.enrichment_data.similar_companies && r.enrichment_data.similar_companies.length > 0 && (
                            <div className="md:col-span-2">
                              <span className="font-medium text-teal-700">Entreprises similaires ({r.enrichment_data.similar_companies.length}):</span>
                              <div className="mt-2 grid grid-cols-2 lg:grid-cols-3 gap-2">
                                {r.enrichment_data.similar_companies.map((c, ci) => (
                                  <button
                                    key={ci}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (onSearchCompany) onSearchCompany(c.name);
                                    }}
                                    className="flex items-center gap-2 p-2 bg-white rounded-md border border-teal-100 hover:border-teal-300 hover:bg-teal-50 transition-colors text-left group"
                                  >
                                    {c.logoUrl && (
                                      <img src={c.logoUrl} alt="" className="w-8 h-8 rounded flex-shrink-0" />
                                    )}
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-gray-900 truncate group-hover:text-teal-700">{c.name}</div>
                                      <div className="text-[10px] text-gray-400 truncate">{c.industry || "--"}</div>
                                      {c.followerCount > 0 && (
                                        <div className="text-[10px] text-gray-400">{c.followerCount.toLocaleString()} followers</div>
                                      )}
                                    </div>
                                  </button>
                                ))}
                              </div>
                              <p className="text-[10px] text-gray-400 mt-1">Cliquez sur une entreprise pour lancer une recherche dessus</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg px-6 py-3 flex items-center justify-between z-50">
          <span className="text-sm text-gray-700 font-medium">
            {selectedCount} profil(s) selectionne(s)
          </span>
          <div className="flex items-center gap-3">
            {selectedUnenriched > 0 && (
              <button
                onClick={handleEnrichSelected}
                disabled={enrichMutation.isPending}
                className="px-4 py-2 text-sm font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 flex items-center gap-2"
              >
                {enrichMutation.isPending && (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Enrichir ({selectedUnenriched})
              </button>
            )}
            {selectedEnrichedNotAdded > 0 && (
              <button
                onClick={handleBulkToPipeline}
                disabled={pipelineMutation.isPending}
                className="px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Pipeline ({selectedEnrichedNotAdded})
              </button>
            )}
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              Deselectionner
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
