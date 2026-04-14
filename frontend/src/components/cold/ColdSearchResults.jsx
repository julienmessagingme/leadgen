import { useState, Fragment } from "react";
import DOMPurify from "dompurify";
import { useDraggable } from "@dnd-kit/core";
import { api } from "../../api/client";
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
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [actionPending, setActionPending] = useState({}); // { idx: "pipeline"|"email"|"enriching" }
  const [subSearches, setSubSearches] = useState({}); // { [parentIdx]: { [companyName]: { loading, search, error } } }

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

  const handleSubSearch = async (parentIdx, companyName) => {
    setSubSearches((prev) => ({
      ...prev,
      [parentIdx]: {
        ...(prev[parentIdx] || {}),
        [companyName]: { loading: true, search: null, error: null },
      },
    }));
    try {
      var jobTitle = search.filters?.job_title || "";
      var result = await api.post("/cold-outbound/search", {
        company: companyName,
        job_title: jobTitle,
        max_leads: 10,
      });
      setSubSearches((prev) => ({
        ...prev,
        [parentIdx]: {
          ...(prev[parentIdx] || {}),
          [companyName]: { loading: false, search: result, error: null },
        },
      }));
    } catch (err) {
      setSubSearches((prev) => ({
        ...prev,
        [parentIdx]: {
          ...(prev[parentIdx] || {}),
          [companyName]: { loading: false, search: null, error: err.message },
        },
      }));
    }
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

  if (results.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
        Aucun resultat pour cette recherche.
      </div>
    );
  }

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
              <th className="px-3 py-3 w-8"></th>
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
                    className={`${r.added_to_pipeline ? "bg-green-50/40" : ""} ${bucketedIndexes && bucketedIndexes.has(idx) ? "bg-teal-50/40" : ""} hover:bg-gray-50 cursor-pointer`}
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  >
                    <td className="px-3 py-3 w-8 text-center">
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform inline-block ${isExpanded ? "rotate-90" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
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
                              <div className="mt-2 space-y-2">
                                {r.enrichment_data.similar_companies.map((c, ci) => {
                                  var sub = subSearches[idx] && subSearches[idx][c.name];
                                  return (
                                    <div key={ci} className="border border-teal-100 rounded-lg overflow-hidden">
                                      {/* Company header */}
                                      <div className="flex items-center gap-2 p-2 bg-white">
                                        {c.logoUrl && (
                                          <img src={c.logoUrl} alt="" className="w-7 h-7 rounded flex-shrink-0" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                          <div className="text-xs font-medium text-gray-900">{c.name}</div>
                                          <div className="text-[10px] text-gray-400">{c.industry || "--"}{c.followerCount > 0 ? " · " + c.followerCount.toLocaleString() + " followers" : ""}</div>
                                        </div>
                                        {!sub || (!sub.loading && !sub.search) ? (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleSubSearch(idx, c.name); }}
                                            disabled={sub && sub.loading}
                                            className="px-2.5 py-1 text-[10px] font-medium rounded bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50 flex-shrink-0"
                                          >
                                            {sub && sub.loading ? "..." : "Rechercher"}
                                          </button>
                                        ) : sub && sub.search ? (
                                          <span className="text-[10px] text-teal-600 font-medium flex-shrink-0">{(sub.search.results || []).length} resultats</span>
                                        ) : null}
                                      </div>

                                      {/* Sub-search error */}
                                      {sub && sub.error && (
                                        <div className="px-2 py-1 bg-red-50 text-xs text-red-600">{sub.error}</div>
                                      )}

                                      {/* Sub-search results */}
                                      {sub && sub.search && sub.search.results && sub.search.results.length > 0 && (
                                        <div className="border-t border-teal-100 bg-teal-50/30">
                                          <table className="min-w-full">
                                            <tbody className="divide-y divide-teal-100">
                                              {sub.search.results.map((sr, sri) => {
                                                var updateSubResults = function (newResults) {
                                                  setSubSearches(function (prev) {
                                                    return {
                                                      ...prev,
                                                      [idx]: {
                                                        ...(prev[idx] || {}),
                                                        [c.name]: { ...sub, search: { ...sub.search, results: newResults } },
                                                      },
                                                    };
                                                  });
                                                };
                                                return (
                                                <tr key={sri} className="hover:bg-teal-50">
                                                  <td className="px-3 py-1.5 text-xs font-medium text-gray-900 w-36">
                                                    {sr.first_name} {sr.last_name}
                                                    {sr.linkedin_url && (
                                                      <a href={sr.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline ml-1 text-[10px]">LinkedIn</a>
                                                    )}
                                                  </td>
                                                  <td className="px-3 py-1.5 text-[11px] text-gray-600">{sr.headline || "--"}</td>
                                                  <td className="px-3 py-1.5 text-center">
                                                    {sr.enriched ? priseBadge(sr.prise_score) : <span className="text-[10px] text-gray-300">--</span>}
                                                  </td>
                                                  <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center justify-center gap-1">
                                                      {!sr.enriched && (
                                                        <button
                                                          onClick={() => {
                                                            api.post("/cold-outbound/searches/" + sub.search.id + "/enrich", { profile_indexes: [sri] })
                                                              .then((resp) => { if (resp.results) updateSubResults(resp.results); })
                                                              .catch(() => {});
                                                          }}
                                                          className="px-2 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-600 hover:bg-amber-100"
                                                        >
                                                          Enrichir
                                                        </button>
                                                      )}
                                                      {sr.added_to_pipeline ? (
                                                        <span className="text-[10px] text-green-600">Ajoute</span>
                                                      ) : (
                                                        <button
                                                          onClick={() => {
                                                            api.post("/cold-outbound/searches/" + sub.search.id + "/to-pipeline", { profile_indexes: [sri] })
                                                              .then((resp) => { if (resp.results) updateSubResults(resp.results); })
                                                              .catch(() => {});
                                                          }}
                                                          disabled={!sr.enriched}
                                                          className="px-2 py-0.5 text-[10px] font-medium rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-30"
                                                        >
                                                          Pipeline
                                                        </button>
                                                      )}
                                                    </div>
                                                  </td>
                                                </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                      {sub && sub.search && (sub.search.results || []).length === 0 && (
                                        <div className="px-2 py-1.5 bg-gray-50 text-xs text-gray-400 italic">Aucun resultat pour cette entreprise</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
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

    </div>
  );
}
