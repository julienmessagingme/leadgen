import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useEnrichMutation, useToPipelineMutation, useToEmailMutation } from "../../hooks/useColdOutbound";

function BucketColumn({ bucket, onRename, onRemove }) {
  var [isEditing, setIsEditing] = useState(false);
  var [editName, setEditName] = useState(bucket.name);

  var { setNodeRef, isOver } = useDroppable({ id: bucket.id });

  var items = bucket.items || [];
  var unenriched = items.filter(function (p) { return !p.enriched; });
  var enrichedNotAdded = items.filter(function (p) { return p.enriched && !p.added_to_pipeline; });

  // Group items by source search for mutations
  var searchGroups = {};
  items.forEach(function (item) {
    var sid = item._sourceSearchId;
    if (!sid) return;
    if (!searchGroups[sid]) searchGroups[sid] = [];
    searchGroups[sid].push(item);
  });

  var handleSaveName = function () {
    setIsEditing(false);
    if (editName.trim() && editName.trim() !== bucket.name) {
      onRename(bucket.id, editName.trim());
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-48 rounded-lg border-2 transition-all duration-150 ${
        isOver ? "border-indigo-400 bg-indigo-50/50 scale-[1.02] shadow-lg" : "border-gray-200 bg-gray-50"
      }`}
    >
      {/* Header */}
      <div className="px-2 py-2 border-b border-gray-200 bg-white rounded-t-lg">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={function (e) { setEditName(e.target.value); }}
            onBlur={handleSaveName}
            onKeyDown={function (e) { if (e.key === "Enter") handleSaveName(); }}
            autoFocus
            className="w-full text-xs font-semibold text-gray-800 border border-indigo-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        ) : (
          <div
            className="flex items-center justify-between cursor-pointer"
            onDoubleClick={function () { setIsEditing(true); setEditName(bucket.name); }}
          >
            <span className="text-xs font-semibold text-gray-800 truncate">{bucket.name}</span>
            <span className="text-xs text-gray-400 ml-1">({items.length})</span>
          </div>
        )}
      </div>

      {/* Cards area */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5 min-h-[200px] max-h-[calc(100vh-22rem)]">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center border-2 border-dashed border-gray-300 rounded-md p-3">
            <span className="text-xs text-gray-400 text-center">Glisser des profils ici</span>
          </div>
        ) : (
          items.map(function (p, i) {
            return (
              <div key={p.linkedin_url || i} className="bg-white rounded-md p-2 shadow-sm border border-gray-100 group">
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-900 truncate">
                      {p.first_name} {p.last_name}
                    </div>
                    <div className="text-[10px] text-gray-500 truncate">{p.headline || "--"}</div>
                    {p.company && <div className="text-[10px] text-gray-400 truncate">{p.company}</div>}
                    {p.enriched && (
                      <span className="inline-block mt-0.5 px-1 py-0 text-[9px] font-medium rounded bg-green-100 text-green-700">enrichi</span>
                    )}
                    {p.added_to_pipeline && (
                      <span className="inline-block mt-0.5 ml-0.5 px-1 py-0 text-[9px] font-medium rounded bg-indigo-100 text-indigo-700">pipeline</span>
                    )}
                  </div>
                  <button
                    onClick={function () { onRemove(p.linkedin_url, bucket.id); }}
                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-xs leading-none"
                    title="Retirer du bucket"
                  >
                    x
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Action buttons — disabled for now since items come from multiple searches */}
      {items.length > 0 && (unenriched.length > 0 || enrichedNotAdded.length > 0) && (
        <div className="px-1.5 py-1.5 border-t border-gray-200 bg-white rounded-b-lg">
          <BucketActions
            items={items}
            searchGroups={searchGroups}
            unenriched={unenriched}
            enrichedNotAdded={enrichedNotAdded}
          />
        </div>
      )}
    </div>
  );
}

function BucketActions({ items, searchGroups, unenriched, enrichedNotAdded }) {
  // For mutations, we need to call per-search group since each mutation is scoped to a searchId
  // Use the first search group for simplicity (most common case: all items from same search)
  var searchIds = Object.keys(searchGroups);
  var primarySearchId = searchIds[0] || null;

  var enrichMutation = useEnrichMutation(primarySearchId);
  var pipelineMutation = useToPipelineMutation(primarySearchId);
  var emailMutation = useToEmailMutation(primarySearchId);

  var handleEnrich = async function () {
    for (var sid of searchIds) {
      var indexes = searchGroups[sid]
        .filter(function (p) { return !p.enriched; })
        .map(function (p) { return p._sourceIndex; });
      if (indexes.length > 0) {
        try { await enrichMutation.mutateAsync(indexes); } catch (_e) {}
      }
    }
  };

  var handlePipeline = async function () {
    for (var sid of searchIds) {
      var indexes = searchGroups[sid]
        .filter(function (p) { return p.enriched && !p.added_to_pipeline; })
        .map(function (p) { return p._sourceIndex; });
      if (indexes.length > 0) {
        try { await pipelineMutation.mutateAsync(indexes); } catch (_e) {}
      }
    }
  };

  var handleEmail = async function () {
    for (var sid of searchIds) {
      var indexes = searchGroups[sid]
        .filter(function (p) { return p.enriched && !p.added_to_pipeline; })
        .map(function (p) { return p._sourceIndex; });
      if (indexes.length > 0) {
        try { await emailMutation.mutateAsync(indexes); } catch (_e) {}
      }
    }
  };

  return (
    <div className="space-y-1">
      {unenriched.length > 0 && (
        <button
          onClick={handleEnrich}
          disabled={enrichMutation.isPending}
          className="w-full px-2 py-1 text-[10px] font-medium rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {enrichMutation.isPending ? "..." : "Enrichir (" + unenriched.length + ")"}
        </button>
      )}
      {enrichedNotAdded.length > 0 && (
        <>
          <button
            onClick={handlePipeline}
            disabled={pipelineMutation.isPending}
            className="w-full px-2 py-1 text-[10px] font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {pipelineMutation.isPending ? "..." : "Pipeline (" + enrichedNotAdded.length + ")"}
          </button>
          <button
            onClick={handleEmail}
            disabled={emailMutation.isPending}
            className="w-full px-2 py-1 text-[10px] font-medium rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {emailMutation.isPending ? "..." : "Email (" + enrichedNotAdded.length + ")"}
          </button>
        </>
      )}
    </div>
  );
}

export default function ColdBuckets({ buckets, onRenameBucket, onRemoveFromBucket }) {
  return (
    <div className="flex gap-2 h-full">
      {buckets.map(function (bucket) {
        return (
          <BucketColumn
            key={bucket.id}
            bucket={bucket}
            onRename={onRenameBucket}
            onRemove={onRemoveFromBucket}
          />
        );
      })}
    </div>
  );
}
