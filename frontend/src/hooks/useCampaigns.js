import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

// ── Active (draft) campaigns — always 3 ──

export function useActiveCampaigns() {
  return useQuery({
    queryKey: ["campaigns", "active"],
    queryFn: () => api.get("/campaigns/active"),
    staleTime: 5_000,
  });
}

// ── Validated campaigns (for /messages-draft tab) ──

export function useValidatedCampaigns() {
  return useQuery({
    queryKey: ["campaigns", "validated"],
    queryFn: () => api.get("/campaigns/validated"),
    staleTime: 10_000,
  });
}

export function useCampaignDetail(campaignId) {
  return useQuery({
    queryKey: ["campaigns", campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}`),
    enabled: campaignId != null,
    staleTime: 5_000,
  });
}

// ── Mutations ──

export function useAddToCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, payload }) =>
      api.post(`/campaigns/${campaignId}/add-lead`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", "active"] });
    },
  });
}

export function useRemoveFromCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, linkedin_url }) =>
      api.del(`/campaigns/${campaignId}/leads`, { linkedin_url }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", "active"] });
    },
  });
}

export function useRenameCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, name }) =>
      api.post(`/campaigns/${campaignId}/rename`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", "active"] });
    },
  });
}

export function useValidateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, case_study_id, scenario_index }) =>
      api.post(`/campaigns/${campaignId}/validate`, { case_study_id, scenario_index }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", "active"] });
      qc.invalidateQueries({ queryKey: ["campaigns", "validated"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

// ── Case studies (for the validate dropdown) ──

export function useCaseStudies() {
  return useQuery({
    queryKey: ["case-studies"],
    queryFn: () => api.get("/settings/case-studies"),
    staleTime: 60_000,
  });
}
