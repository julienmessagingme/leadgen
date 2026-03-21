import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Fetch paginated, filtered leads list.
 * @param {Object} filters - { status, tier, source, search, sort, order, limit, offset, paused }
 */
export function useLeads(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  const path = qs ? `/leads?${qs}` : "/leads";

  return useQuery({
    queryKey: ["leads", filters],
    queryFn: () => api.get(path),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Fetch a single lead by ID.
 * @param {number|string} id
 */
export function useLead(id) {
  return useQuery({
    queryKey: ["lead", id],
    queryFn: () => api.get(`/leads/${id}`),
    enabled: !!id,
  });
}

/**
 * Mutation: perform action on a single lead (pause/resume/exclude).
 */
export function useLeadAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }) => api.patch(`/leads/${id}/action`, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["lead"] });
    },
  });
}

/**
 * Mutation: perform bulk action on multiple leads.
 */
export function useBulkAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, action }) => api.post("/leads/bulk-action", { ids, action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
