import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

// ── ICP Rules ──

export function useIcpRules() {
  return useQuery({
    queryKey: ["icp-rules"],
    queryFn: () => api.get("/settings/icp-rules"),
  });
}

export function useCreateIcpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post("/settings/icp-rules", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["icp-rules"] }),
  });
}

export function useUpdateIcpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/settings/icp-rules/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["icp-rules"] }),
  });
}

export function useDeleteIcpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/settings/icp-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["icp-rules"] }),
  });
}

// ── Suppression ──

export function useSuppression() {
  return useQuery({
    queryKey: ["suppression"],
    queryFn: () => api.get("/settings/suppression"),
  });
}

export function useAddSuppression() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post("/settings/suppression", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppression"] }),
  });
}

export function useDeleteSuppression() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hash) => api.delete(`/settings/suppression/${hash}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppression"] }),
  });
}

// ── Config ──

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => api.get("/settings/config"),
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }) => api.patch(`/settings/config/${key}`, { value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }),
  });
}

// ── Watchlist ──

export function useWatchlist() {
  return useQuery({
    queryKey: ["watchlist"],
    queryFn: () => api.get("/settings/watchlist"),
  });
}

export function useCreateWatchlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post("/settings/watchlist", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      qc.invalidateQueries({ queryKey: ["watchlist-stats"] });
    },
  });
}

export function useUpdateWatchlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/settings/watchlist/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      qc.invalidateQueries({ queryKey: ["watchlist-stats"] });
    },
  });
}

export function useDeleteWatchlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/settings/watchlist/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      qc.invalidateQueries({ queryKey: ["watchlist-stats"] });
    },
  });
}

// ── BeReach Credits ──

export function useBeReachCredits() {
  return useQuery({
    queryKey: ["bereach-credits"],
    queryFn: () => api.get("/settings/bereach-credits"),
    refetchInterval: 60000, // refresh every minute
  });
}

export function useWatchlistStats() {
  return useQuery({
    queryKey: ["watchlist-stats"],
    queryFn: () => api.get("/settings/watchlist-stats"),
  });
}

// ── Case Studies ──

export function useCaseStudies() {
  return useQuery({
    queryKey: ["case-studies"],
    queryFn: () => api.get("/settings/case-studies"),
  });
}

export function useCreateCaseStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post("/settings/case-studies", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case-studies"] }),
  });
}

export function useUpdateCaseStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/settings/case-studies/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case-studies"] }),
  });
}

export function useDeleteCaseStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/settings/case-studies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case-studies"] }),
  });
}

// ── Cron Schedule ──

export function useCronSchedule() {
  return useQuery({
    queryKey: ["cron"],
    queryFn: () => api.get("/settings/cron"),
  });
}

// ── CSV Export ──

export function useExportLeads() {
  return async (params = {}) => {
    const token = localStorage.getItem("token");
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        qs.set(key, String(value));
      }
    }
    const url = `/api/leads/export${qs.toString() ? `?${qs}` : ""}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error("Export failed");

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  };
}
