import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

// ── Cold Search History ──

export function useColdSearches() {
  return useQuery({
    queryKey: ["cold-searches"],
    queryFn: () => api.get("/cold-outbound/searches"),
  });
}

// ── Single Cold Search (with results) ──

export function useColdSearch(searchId) {
  return useQuery({
    queryKey: ["cold-search", searchId],
    queryFn: () => api.get(`/cold-outbound/searches/${searchId}`),
    enabled: !!searchId,
  });
}

// ── Launch a new search ──

export function useColdSearchMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params) => api.post("/cold-outbound/search", params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cold-searches"] });
    },
  });
}

// ── Enrich selected profiles ──

export function useEnrichMutation(searchId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile_indexes) =>
      api.post(`/cold-outbound/searches/${searchId}/enrich`, { profile_indexes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cold-search", searchId] });
      qc.invalidateQueries({ queryKey: ["cold-searches"] });
    },
  });
}

// ── Send to classic pipeline ──

export function useToPipelineMutation(searchId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile_indexes) =>
      api.post(`/cold-outbound/searches/${searchId}/to-pipeline`, { profile_indexes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cold-search", searchId] });
    },
  });
}

// ── Send to email direct ──

export function useToEmailMutation(searchId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ profile_indexes, scenario_index }) =>
      api.post(`/cold-outbound/searches/${searchId}/to-email`, { profile_indexes, scenario_index }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cold-search", searchId] });
    },
  });
}

// ── Load cold email scenarios ──

export function useColdScenarios() {
  return useQuery({
    queryKey: ["cold-scenarios"],
    queryFn: () => api.get("/cold-outbound/scenarios"),
    staleTime: 60000,
  });
}

// ── Find similar companies from a profile's company ──

export function useSimilarCompaniesMutation(searchId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile_index) =>
      api.post(`/cold-outbound/searches/${searchId}/similar-companies`, { profile_index }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cold-search", searchId] });
    },
  });
}
