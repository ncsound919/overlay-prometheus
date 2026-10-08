'use client';

import { useCallback, useState } from 'react';
import { FlaskConical, Layers3, LineChart, TableProperties, Telescope, Trophy } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEngineState } from '@/hooks/use-engine';
import { useEscalations } from '@/hooks/use-escalations';
import { readPrometheusPrefs, usePreferences } from '@/hooks/use-preferences';
import { LiveFeedBridge } from '@/components/dashboard/live-feed-bridge';
import { DashboardHeader } from '@/components/dashboard/header';
import { CommandPalette, type DashboardTab } from '@/components/dashboard/command-palette';
import { EventLog } from '@/components/dashboard/event-log';
import { InputUniverse } from '@/components/dashboard/input-universe';
import { SignalTicker } from '@/components/dashboard/signal-ticker';
import { LayerStack } from '@/components/dashboard/layer-stack';
import { BreakthroughAlerts } from '@/components/dashboard/breakthrough-alerts';
import { GovernanceQueue } from '@/components/dashboard/governance-queue';
import { DiscoveryLab } from '@/components/dashboard/discovery-lab';
import { BreakthroughBoard } from '@/components/dashboard/breakthrough-board';
import { GovernancePanel } from '@/components/dashboard/governance-panel';
import { AnalyticsPanel } from '@/components/dashboard/analytics-panel';
import { ReportsFeed } from '@/components/dashboard/reports-feed';
import { LayerWorkspace } from '@/components/dashboard/layer-workspace';
import { DashboardFooter } from '@/components/dashboard/footer';
import {
  DashboardSkeleton,
  ErrorPanel,
  MissionControlStyles,
} from '@/components/dashboard/shared';

const EMPTY_ANALYTICS = {
  signalsPerCycle: [],
  domainDistribution: [],
  noveltyImpact: [],
  layerThroughput: [],
  optimizationTrend: [],
};

function isDashboardTab(value: string | undefined): value is DashboardTab {
  return (
    value === 'discovery' ||
    value === 'breakthroughs' ||
    value === 'governance' ||
    value === 'analytics' ||
    value === 'reports' ||
    value === 'layers'
  );
}

export function Dashboard() {
  const { data, isLoading, isError, error, refetch } = useEngineState();
  const [, setPrefs] = usePreferences();
  // Restore last workspace from localStorage on first mount (lazy initializer).
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    const persisted = readPrometheusPrefs().tab;
    return isDashboardTab(persisted) ? persisted : 'discovery';
  });
  // Ticker stream filter (shared by Input Universe rows + Signal Ticker chip).
  const [tickerCategory, setTickerCategory] = useState<string | null>(
    () => readPrometheusPrefs().tickerCategory ?? null,
  );
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Live telemetry (WebSocket) — writes pushes into the query cache.
  // Mounted unconditionally so the feed is up even during loading/error.
  // Escalation watchdog — SLA-breach + new-breakthrough toasts.
  useEscalations(data);

  // Every tab change (tabs row + command palette) is persisted.
  const changeTab = useCallback(
    (tab: DashboardTab) => {
      setActiveTab(tab);
      setPrefs({ tab });
    },
    [setPrefs],
  );

  const toggleTickerFilter = useCallback(
    (category: string) => {
      const next = tickerCategory === category ? null : category;
      setTickerCategory(next);
      setPrefs({ tickerCategory: next });
    },
    [tickerCategory, setPrefs],
  );

  const clearTickerFilter = useCallback(() => {
    setTickerCategory(null);
    setPrefs({ tickerCategory: null });
  }, [setPrefs]);

  return (
    <div className="mc-grid-bg flex min-h-screen flex-col bg-zinc-950 text-zinc-100 selection:bg-emerald-500/30">
      <MissionControlStyles />
      <LiveFeedBridge />

      {isLoading ? (
        <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col justify-center gap-4 px-4 py-8 sm:px-6">
          <div className="mb-2 h-12" aria-hidden />
          <DashboardSkeleton />
        </main>
      ) : isError || !data ? (
        <main className="mx-auto flex w-full max-w-[1600px] flex-1 items-center justify-center px-4 py-8 sm:px-6">
          <div className="w-full max-w-md">
            <ErrorPanel
              message={error?.message ?? 'The engine state endpoint did not return a payload.'}
              onRetry={() => void refetch()}
            />
          </div>
        </main>
      ) : (
        <>
          <DashboardHeader engine={data.engine} onOpenCommandPalette={() => setPaletteOpen(true)} />

          <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 sm:px-6 sm:py-5">
            {/* Mission grid */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* LEFT — Input Universe */}
              <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
                <InputUniverse
                  streams={data.streams}
                  filterCategory={
                    tickerCategory && data.streams.some((s) => s.category === tickerCategory)
                      ? tickerCategory
                      : null
                  }
                  onToggleFilter={toggleTickerFilter}
                />
                <SignalTicker
                  signals={data.signals}
                  filterCategory={
                    tickerCategory && data.streams.some((s) => s.category === tickerCategory)
                      ? tickerCategory
                      : null
                  }
                  onClearFilter={clearTickerFilter}
                />
              </div>

              {/* CENTER — 8-layer inference stack */}
              <div className="flex min-w-0 flex-col gap-4 lg:col-span-6">
                <LayerStack engine={data.engine} data={data} />
              </div>

              {/* RIGHT — alerts + governance */}
              <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
                <BreakthroughAlerts breakthroughs={data.breakthroughs} />
                <GovernanceQueue governance={data.governance} />
              </div>
            </div>

            {/* Workspaces */}
            <Tabs
              value={activeTab}
              onValueChange={(value) => changeTab(value as DashboardTab)}
              className="mt-4 gap-4"
            >
              <div className="max-w-full overflow-x-auto pb-0.5 mc-scroll">
                <TabsList className="h-auto max-sm:h-auto max-sm:w-full max-sm:flex-wrap border border-zinc-800 bg-zinc-900/70 sm:h-9">
                  <TabsTrigger
                    value="discovery"
                    className="gap-1.5 px-3 text-xs text-zinc-500 data-[state=active]:text-zinc-100 max-sm:min-w-28"
                  >
                    <FlaskConical className="size-4 text-violet-400" aria-hidden />
                    Discovery Lab
                  </TabsTrigger>
                  <TabsTrigger
                    value="breakthroughs"
                    className="gap-1.5 px-3 text-xs text-zinc-500 data-[state=active]:text-zinc-100 max-sm:min-w-28"
                  >
                    <Trophy className="size-4 text-emerald-400" aria-hidden />
                    Breakthrough Board
                  </TabsTrigger>
                  <TabsTrigger
                    value="governance"
                    className="gap-1.5 px-3 text-xs text-zinc-500 data-[state=active]:text-zinc-100 max-sm:min-w-28"
                  >
                    <TableProperties className="size-4 text-amber-400" aria-hidden />
                    Governance
                  </TabsTrigger>
                  <TabsTrigger
                    value="layers"
                    className="gap-1.5 px-3 text-xs text-zinc-500 data-[state=active]:text-zinc-100 max-sm:min-w-28"
                  >
                    <Layers3 className="size-4 text-teal-400" aria-hidden />
                    Layers
                  </TabsTrigger>
                  <TabsTrigger
                    value="analytics"
                    className="gap-1.5 px-3 text-xs text-zinc-500 data-[state=active]:text-zinc-100 max-sm:min-w-28"
                  >
                    <LineChart className="size-4 text-teal-400" aria-hidden />
                    Analytics
                  </TabsTrigger>
                  <TabsTrigger
                    value="reports"
                    className="gap-1.5 px-3 text-xs text-zinc-500 data-[state=active]:text-zinc-100 max-sm:min-w-28"
                  >
                    <Telescope className="size-4 text-rose-400" aria-hidden />
                    Insight Reports
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="discovery" className="outline-none">
                <DiscoveryLab
                  hypotheses={data.hypotheses}
                  signals={data.signals}
                  breakthroughs={data.breakthroughs}
                />
              </TabsContent>
              <TabsContent value="breakthroughs" className="outline-none">
                <BreakthroughBoard breakthroughs={data.breakthroughs} />
              </TabsContent>
              <TabsContent value="governance" className="outline-none">
                <GovernancePanel governance={data.governance} policy={data.engine.config.autoTriage} />
              </TabsContent>
              <TabsContent value="analytics" className="outline-none">
                <AnalyticsPanel analytics={data.analytics ?? EMPTY_ANALYTICS} correlations={data.correlations} />
              </TabsContent>
              <TabsContent value="reports" className="outline-none">
                <ReportsFeed reports={data.reports} />
              </TabsContent>
              <TabsContent value="layers" className="outline-none">
                <LayerWorkspace engine={data.engine} data={data} />
              </TabsContent>
            </Tabs>

            {/* SYSTEM EVENT STREAM — rolling terminal log (full width, below workspaces) */}
            <div className="mt-4">
              <EventLog data={data} />
            </div>
          </main>

          <DashboardFooter
            signals={data.signals}
            streams={data.streams}
            hypotheses={data.hypotheses}
            breakthroughs={data.breakthroughs}
            governance={data.governance}
            running={data.engine.status === 'running'}
            policy={data.engine.config.autoTriage}
          />

          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            engine={data.engine}
            onNavigate={changeTab}
          />
        </>
      )}
    </div>
  );
}
