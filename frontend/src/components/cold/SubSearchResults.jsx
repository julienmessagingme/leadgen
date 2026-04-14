import { useState } from "react";
import DOMPurify from "dompurify";
import { useDraggable } from "@dnd-kit/core";
import { api } from "../../api/client";

var MAX_DEPTH = 3;

function DraggableSubProfile({ searchId, idx, profile, children, className, onClick }) {
  var { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: "sub-" + searchId + "-" + idx,
    data: { index: idx, profile: profile, searchId: searchId },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={className}
      style={{ opacity: isDragging ? 0.35 : 1, cursor: "grab" }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

function priseBadge(score) {
  if (score === null || score === undefined) return <span className="text-[10px] text-gray-300">--</span>;
  var colors;
  if (score >= 70) colors = "bg-green-100 text-green-700";
  else if (score >= 40) colors = "bg-yellow-100 text-yellow-700";
  else colors = "bg-gray-100 text-gray-500";
  return (
    <span className={"inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded " + colors}>
      {score}
    </span>
  );
}

/**
 * Recursive sub-search results component.
 * Shows profiles from a company sub-search with expand/enrich/similar/pipeline — same as main results.
 * Recurses up to MAX_DEPTH levels.
 */
export default function SubSearchResults({ searchData, depth, jobTitle }) {
  var [expandedIdx, setExpandedIdx] = useState(null);
  var [actionPending, setActionPending] = useState({});
  var [results, setResults] = useState(searchData.results || []);
  var [subSearches, setSubSearches] = useState({}); // { [idx]: { [companyName]: { loading, search, error } } }

  var searchId = searchData.id;

  var updateResults = function (newResults) {
    setResults(newResults);
  };

  var handleEnrich = async function (idx) {
    setActionPending(function (prev) { return { ...prev, [idx]: "enriching" }; });
    try {
      var resp = await api.post("/cold-outbound/searches/" + searchId + "/enrich", { profile_indexes: [idx] });
      if (resp.results) updateResults(resp.results);
    } catch (_e) {}
    setActionPending(function (prev) { var n = { ...prev }; delete n[idx]; return n; });
  };

  var handlePipeline = async function (idx) {
    setActionPending(function (prev) { return { ...prev, [idx]: "pipeline" }; });
    try {
      var resp = await api.post("/cold-outbound/searches/" + searchId + "/to-pipeline", { profile_indexes: [idx] });
      if (resp.results) updateResults(resp.results);
    } catch (_e) {}
    setActionPending(function (prev) { var n = { ...prev }; delete n[idx]; return n; });
  };

  var handleEmail = async function (idx) {
    setActionPending(function (prev) { return { ...prev, [idx]: "email" }; });
    try {
      var resp = await api.post("/cold-outbound/searches/" + searchId + "/to-email", { profile_indexes: [idx] });
      if (resp.results) updateResults(resp.results);
    } catch (_e) {}
    setActionPending(function (prev) { var n = { ...prev }; delete n[idx]; return n; });
  };

  var handleSimilar = async function (idx) {
    setActionPending(function (prev) { return { ...prev, [idx]: "similar" }; });
    try {
      var resp = await api.post("/cold-outbound/searches/" + searchId + "/similar-companies", { profile_index: idx });
      if (resp.results) updateResults(resp.results);
      setExpandedIdx(idx);
    } catch (_e) {}
    setActionPending(function (prev) { var n = { ...prev }; delete n[idx]; return n; });
  };

  var handleSubSearch = async function (parentIdx, companyName) {
    setSubSearches(function (prev) {
      return { ...prev, [parentIdx]: { ...(prev[parentIdx] || {}), [companyName]: { loading: true, search: null, error: null } } };
    });
    try {
      var result = await api.post("/cold-outbound/search", {
        company: companyName,
        job_title: jobTitle || "",
        max_leads: 10,
      });
      setSubSearches(function (prev) {
        return { ...prev, [parentIdx]: { ...(prev[parentIdx] || {}), [companyName]: { loading: false, search: result, error: null } } };
      });
    } catch (err) {
      setSubSearches(function (prev) {
        return { ...prev, [parentIdx]: { ...(prev[parentIdx] || {}), [companyName]: { loading: false, search: null, error: err.message } } };
      });
    }
  };

  if (!results || results.length === 0) {
    return <div className="px-2 py-1.5 bg-gray-50 text-xs text-gray-400 italic">Aucun resultat</div>;
  }

  var depthColors = ["teal", "cyan", "sky"];
  var borderColor = "border-" + (depthColors[depth - 1] || "gray") + "-100";

  return (
    <div className={"border-t " + borderColor + " bg-" + (depthColors[depth - 1] || "gray") + "-50/20"}>
      {results.map(function (sr, sri) {
        var isExpanded = expandedIdx === sri;
        var pending = actionPending[sri];
        return (
          <div key={sri} className={"border-b " + borderColor}>
            {/* Profile row — draggable to buckets */}
            <DraggableSubProfile
              searchId={searchId}
              idx={sri}
              profile={sr}
              className="flex items-center gap-2 px-3 py-2 hover:bg-white/50 cursor-pointer"
              onClick={function () { setExpandedIdx(isExpanded ? null : sri); }}
            >
              <svg
                className={"w-3 h-3 text-gray-400 transition-transform flex-shrink-0 " + (isExpanded ? "rotate-90" : "")}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-900">{sr.first_name} {sr.last_name}</span>
                  {sr.linkedin_url && (
                    <a href={sr.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-[10px]" onClick={function (e) { e.stopPropagation(); }}>LinkedIn</a>
                  )}
                  {priseBadge(sr.prise_score)}
                  {sr.added_to_pipeline && <span className="text-[10px] text-green-600 font-medium">Ajoute</span>}
                </div>
                <div className="text-[11px] text-gray-500">{sr.headline || "--"}</div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0" onClick={function (e) { e.stopPropagation(); }}>
                {!sr.enriched && (
                  <button onClick={function () { handleEnrich(sri); }} disabled={!!pending} className="px-2 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-600 hover:bg-amber-100 disabled:opacity-50">
                    {pending === "enriching" ? "..." : "Enrichir"}
                  </button>
                )}
                {!sr.added_to_pipeline && (
                  <>
                    <button onClick={function () { handlePipeline(sri); }} disabled={!!pending} className="px-2 py-0.5 text-[10px] font-medium rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50">
                      {pending === "pipeline" ? "..." : "Pipeline"}
                    </button>
                    <button onClick={function () { handleEmail(sri); }} disabled={!!pending} className="px-2 py-0.5 text-[10px] font-medium rounded bg-purple-50 text-purple-600 hover:bg-purple-100 disabled:opacity-50">
                      {pending === "email" ? "..." : "Email"}
                    </button>
                  </>
                )}
                {sr.enriched && depth < MAX_DEPTH && (
                  <button
                    onClick={function () { handleSimilar(sri); }}
                    disabled={!!pending || (sr.enrichment_data?.similar_companies?.length > 0)}
                    className="px-2 py-0.5 text-[10px] font-medium rounded bg-teal-50 text-teal-600 hover:bg-teal-100 disabled:opacity-30"
                  >
                    {pending === "similar" ? "..." : sr.enrichment_data?.similar_companies?.length > 0 ? "Similaires ✓" : "Similaires"}
                  </button>
                )}
              </div>
            </DraggableSubProfile>

            {/* Expanded detail */}
            {isExpanded && sr.enriched && sr.enrichment_data && (
              <div className="px-6 py-3 bg-white/60">
                <div className="space-y-2 text-xs">
                  {sr.enrichment_data.summary && (
                    <div><span className="font-medium text-gray-700">Bio:</span> <span className="text-gray-600">{sr.enrichment_data.summary}</span></div>
                  )}
                  {sr.enrichment_data.company_description && (
                    <div><span className="font-medium text-gray-700">Entreprise:</span> <span className="text-gray-600">{sr.enrichment_data.company_description}</span></div>
                  )}
                  {sr.enrichment_data.posts && sr.enrichment_data.posts.length > 0 && (
                    <div>
                      <span className="font-medium text-gray-700">Posts recents:</span>
                      {sr.enrichment_data.posts.map(function (post, pi) {
                        return <div key={pi} className="text-gray-600 text-[11px] bg-gray-50 rounded p-1.5 mt-1">{post.text || "(vide)"}</div>;
                      })}
                    </div>
                  )}
                  {sr.prise_reasoning && (
                    <div><span className="font-medium text-gray-700">Prise ({sr.prise_score}/100):</span> <span className="text-gray-600 italic">{sr.prise_reasoning}</span></div>
                  )}

                  {/* Similar companies — recursive */}
                  {sr.enrichment_data.similar_companies && sr.enrichment_data.similar_companies.length > 0 && (
                    <div className="mt-2">
                      <span className="font-medium text-teal-700">Entreprises similaires ({sr.enrichment_data.similar_companies.length}):</span>
                      <div className="mt-1 space-y-1.5">
                        {sr.enrichment_data.similar_companies.map(function (c, ci) {
                          var sub = subSearches[sri] && subSearches[sri][c.name];
                          return (
                            <div key={ci} className="border border-teal-100 rounded-lg overflow-hidden">
                              <div className="flex items-center gap-2 p-2 bg-white">
                                {c.logoUrl && <img src={c.logoUrl} alt="" className="w-6 h-6 rounded flex-shrink-0" />}
                                <div className="min-w-0 flex-1 relative group/sc">
                                  <div className="text-[11px] font-medium text-gray-900 cursor-default">{c.name}</div>
                                  <div className="text-[10px] text-gray-400">{c.industry || ""}</div>
                                  <div className="absolute z-50 left-0 top-full mt-1 w-56 bg-white rounded-lg shadow-xl border border-gray-200 p-2 hidden group-hover/sc:block">
                                    <div className="text-[11px] font-semibold text-gray-900">{c.name}</div>
                                    {c.industry && <div className="text-[10px] text-gray-500">Secteur : {c.industry}</div>}
                                    {c.followerCount > 0 && <div className="text-[10px] text-gray-500">{c.followerCount.toLocaleString()} followers</div>}
                                    {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline" onClick={function (e) { e.stopPropagation(); }}>LinkedIn</a>}
                                  </div>
                                </div>
                                {depth < MAX_DEPTH && (!sub || (!sub.loading && !sub.search)) ? (
                                  <button
                                    onClick={function (e) { e.stopPropagation(); handleSubSearch(sri, c.name); }}
                                    disabled={sub && sub.loading}
                                    className="px-2 py-0.5 text-[10px] font-medium rounded bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50 flex-shrink-0"
                                  >
                                    {sub && sub.loading ? "..." : "Rechercher"}
                                  </button>
                                ) : sub && sub.search ? (
                                  <span className="text-[10px] text-teal-600 font-medium flex-shrink-0">{(sub.search.results || []).length} res.</span>
                                ) : null}
                              </div>
                              {sub && sub.error && <div className="px-2 py-1 bg-red-50 text-[10px] text-red-600">{sub.error}</div>}
                              {/* Recursive sub-search results */}
                              {sub && sub.search && (sub.search.results || []).length > 0 && (
                                <SubSearchResults searchData={sub.search} depth={depth + 1} jobTitle={jobTitle} />
                              )}
                              {sub && sub.search && (sub.search.results || []).length === 0 && (
                                <div className="px-2 py-1 bg-gray-50 text-[10px] text-gray-400 italic">Aucun resultat</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
