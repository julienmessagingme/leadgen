import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * List all cold outreach runs (newest first).
 */
export function useColdRuns() {
  return useQuery({
    queryKey: ["cold-runs"],
    queryFn: () => api.get("/cold-outreach/runs"),
    staleTime: 30_000,
  });
}

/**
 * Load a single run with its leads.
 */
export function useColdRun(runId) {
  return useQuery({
    queryKey: ["cold-run", runId],
    queryFn: () => api.get(`/cold-outreach/runs/${runId}`),
    enabled: runId != null,
    staleTime: 10_000,
  });
}

/**
 * Generate a cold email draft for a lead. Flips the lead to email_pending so
 * it shows up in the existing /messages-draft email tab for approval.
 */
export function useGenerateColdEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadId) => api.post(`/cold-outreach/leads/${leadId}/generate-email`),
    onSuccess: (_data, leadId) => {
      // Refresh any currently-loaded run so the UI reflects the new status.
      qc.invalidateQueries({ queryKey: ["cold-run"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
