import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import NavBar from "../components/shared/NavBar";
import FunnelCard from "../components/dashboard/FunnelCard";
import ActivityCard from "../components/dashboard/ActivityCard";
import LinkedInGauge from "../components/dashboard/LinkedInGauge";
import BeReachCreditsGauge from "../components/dashboard/BeReachCreditsGauge";
import CronMonitor from "../components/dashboard/CronMonitor";
import SourceChart from "../components/dashboard/SourceChart";
import ScoreChart from "../components/dashboard/ScoreChart";
import TrendChart from "../components/dashboard/TrendChart";

function LoadingCard() {
  return (
    <div className="bg-white rounded-xl shadow-md p-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
      <div className="h-32 bg-gray-100 rounded" />
    </div>
  );
}

function ErrorCard({ message, onRetry }) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6 border border-red-200">
      <p className="text-red-600 text-sm mb-2">Erreur de chargement</p>
      <p className="text-gray-500 text-xs mb-3">{message}</p>
      <button
        onClick={onRetry}
        className="text-xs text-white bg-indigo-600 px-3 py-1.5 rounded-md hover:bg-indigo-700"
      >
        Reessayer
      </button>
    </div>
  );
}

export default function Home() {

  const stats = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: () => api.get("/dashboard/stats"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const charts = useQuery({
    queryKey: ["dashboard", "charts"],
    queryFn: () => api.get("/dashboard/charts"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const cron = useQuery({
    queryKey: ["dashboard", "cron"],
    queryFn: () => api.get("/dashboard/cron"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="min-h-screen bg-gray-100">
      <NavBar />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Row 1: Funnel + Activity + LinkedIn */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {stats.isLoading && <LoadingCard />}
            {stats.isError && <ErrorCard message={stats.error.message} onRetry={stats.refetch} />}
            {stats.isSuccess && <FunnelCard data={stats.data} />}
          </div>
          <div className="space-y-6">
            {stats.isLoading && <><LoadingCard /><LoadingCard /></>}
            {stats.isError && <ErrorCard message={stats.error.message} onRetry={stats.refetch} />}
            {stats.isSuccess && (
              <>
                <ActivityCard data={stats.data.activity} />
                <LinkedInGauge data={stats.data.linkedin} />
                <BeReachCreditsGauge />
              </>
            )}
          </div>
        </div>

        {/* Row 2: Cron monitor */}
        {cron.isLoading && <LoadingCard />}
        {cron.isError && <ErrorCard message={cron.error.message} onRetry={cron.refetch} />}
        {cron.isSuccess && <CronMonitor data={cron.data} />}

        {/* Row 3: Charts */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {charts.isLoading && <><LoadingCard /><LoadingCard /><LoadingCard /></>}
          {charts.isError && <ErrorCard message={charts.error.message} onRetry={charts.refetch} />}
          {charts.isSuccess && (
            <>
              <SourceChart data={charts.data.sources} />
              <ScoreChart data={charts.data.scores} />
              <TrendChart data={charts.data.trend} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
