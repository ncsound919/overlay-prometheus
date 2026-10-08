'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Command,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  SkipForward,
  Sparkles,
  ZapOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useEngineControl } from '@/hooks/use-engine';
import { useFeedStore } from '@/lib/feed-store';
import type { ControlAction, EngineConfigPatch, EngineInfo } from '@/lib/dashboard-types';
import { TickNumber, formatUptime } from '@/components/dashboard/shared';
import { AutoTriageControls } from '@/components/dashboard/auto-triage-control';
import { cn } from '@/lib/utils';

function HeaderStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5">
      <span className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 md:inline">
        {label}
      </span>
      <span className="font-mono text-xs font-medium tabular-nums text-zinc-200">{children}</span>
    </div>
  );
}

const FEED_META = {
  live: {
    label: 'LIVE',
    dot: 'bg-emerald-400 animate-pulse',
    cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    tip: 'WebSocket telemetry connected — state is pushed the instant it changes; HTTP polling idles at 20s.',
  },
  connecting: {
    label: 'SYNC',
    dot: 'bg-amber-400 animate-pulse',
    cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    tip: 'Establishing the live telemetry feed…',
  },
  polling: {
    label: 'POLL',
    dot: 'bg-zinc-400',
    cls: 'border-zinc-700 bg-zinc-900 text-zinc-400',
    tip: 'Live feed offline — falling back to 4s HTTP polling.',
  },
} as const;

/** LIVE / SYNC / POLL telemetry indicator (WebSocket feed status). */
function FeedIndicator() {
  const status = useFeedStore((s) => s.status);
  const pushCount = useFeedStore((s) => s.pushCount);
  const meta = FEED_META[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={`Telemetry feed: ${meta.label}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider',
            meta.cls,
          )}
        >
          <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
          {meta.label}
          <span className="text-[9px] tabular-nums opacity-60">{pushCount}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200">
        {meta.tip}
      </TooltipContent>
    </Tooltip>
  );
}

/** Ticks locally between 4s polls. Remounted (via key) whenever the server reports a new uptime. */
function UptimeTicker({ seconds }: { seconds: number }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setOffset((o) => o + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="tabular-nums">{formatUptime(seconds + offset)}</span>;
}

interface ConfigControlsProps {
  config: EngineInfo['config'];
  saving: boolean;
  onSave: (patch: EngineConfigPatch) => void;
}

/**
 * Lives inside the (lazily mounted) Popover, so its draft state is re-initialized
 * from the latest server config on every open — no prop-sync effects needed.
 */
function ConfigControls({ config, saving, onSave }: ConfigControlsProps) {
  const [aggression, setAggression] = useState(config.aggression);
  const [llmDiscovery, setLlmDiscovery] = useState(config.llmDiscovery);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="llm-discovery" className="text-xs font-medium text-zinc-300">
            LLM Discovery
          </label>
          <Switch
            id="llm-discovery"
            checked={llmDiscovery}
            disabled={saving}
            onCheckedChange={(checked) => {
              setLlmDiscovery(checked);
              onSave({ llmDiscovery: checked });
            }}
            className="data-[state=checked]:bg-violet-500"
          />
        </div>
        <p className="text-[11px] leading-snug text-zinc-500">
          Route hypothesis generation through the LLM instead of templates.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label htmlFor="aggression" className="text-xs font-medium text-zinc-300">
            Aggression
          </label>
          <span className="font-mono text-xs tabular-nums text-violet-300">{aggression.toFixed(2)}</span>
        </div>
        <Slider
          id="aggression"
          min={0}
          max={1}
          step={0.05}
          value={[aggression]}
          disabled={saving}
          onValueChange={(vals) => setAggression(vals[0] ?? 0)}
          onValueCommit={(vals) => onSave({ aggression: vals[0] ?? 0 })}
          aria-label="Aggression level"
          className="[&_[data-slot=slider-range]]:bg-violet-500 [&_[data-slot=slider-thumb]]:border-violet-500"
        />
        <p className="text-[11px] leading-snug text-zinc-500">
          Higher values push riskier, higher-novelty exploration.
        </p>
      </div>
      <Separator className="bg-zinc-800" />
      <AutoTriageControls policy={config.autoTriage} saving={saving} onSave={onSave} />
    </div>
  );
}

export function DashboardHeader({
  engine,
  onOpenCommandPalette,
}: {
  engine: EngineInfo;
  onOpenCommandPalette?: () => void;
}) {
  const { toast } = useToast();
  const control = useEngineControl();
  const running = engine.status === 'running';
  const pendingAction = control.isPending ? control.variables?.action : undefined;

  const runAction = (action: ControlAction) => {
    control.mutate(
      { action },
      {
        onSuccess: (res) => {
          const messages: Record<ControlAction, string> = {
            start: 'Engine resumed — inference stack online.',
            pause: 'Engine paused — state preserved.',
            tick: `Manual cycle #${res.cycles} executed.`,
            reset: 'Engine reset — clean slate initialized.',
            config: 'Configuration applied.',
          };
          toast({ title: 'Control command sent', description: messages[action] });
        },
        onError: (err) =>
          toast({ title: 'Control command failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  // Config patches use the state-neutral 'config' action — run state is untouched.
  const saveConfig = (patch: EngineConfigPatch) => {
    control.mutate(
      { action: 'config', config: patch },
      {
        onSuccess: () => toast({ title: 'Configuration saved', description: 'Engine parameters updated.' }),
        onError: (err) =>
          toast({ title: 'Configuration failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/75 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative inline-flex size-2.5 shrink-0">
            <span
              className={cn(
                'absolute inline-flex size-full animate-ping rounded-full opacity-60',
                running ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
            <span
              className={cn(
                'relative inline-flex size-2.5 rounded-full',
                running ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
          </span>
          <h1 className="truncate font-mono text-sm font-bold tracking-[0.18em] text-zinc-100">
            PROMETHEUS
            <span className="ml-2 hidden font-normal tracking-normal text-zinc-500 sm:inline">
              {'//'} Autonomous Discovery Engine
            </span>
          </h1>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {/* Live stats */}
          <FeedIndicator />
          <HeaderStat label="CYCLE">
            <TickNumber value={engine.cycles} format={(n) => String(n).padStart(3, '0')} />
          </HeaderStat>
          <HeaderStat label="UPTIME">
            <span className="inline-flex items-center gap-1">
              <Activity className="size-3 text-zinc-500" aria-hidden />
              <UptimeTicker key={engine.uptimeSeconds} seconds={engine.uptimeSeconds} />
            </span>
          </HeaderStat>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  'gap-1 border px-2 py-1 font-mono text-[10px] uppercase tracking-wider',
                  engine.config.llmDiscovery
                    ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-500',
                )}
              >
                {engine.config.llmDiscovery ? (
                  <Sparkles className="size-3" aria-hidden />
                ) : (
                  <ZapOff className="size-3" aria-hidden />
                )}
                LLM {engine.config.llmDiscovery ? 'on' : 'off'}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200">
              Discovery layer uses LLM cross-domain reasoning
              {engine.config.llmDiscovery ? '' : ' — currently off, templates in use'}.
            </TooltipContent>
          </Tooltip>

          {/* Command palette */}
          {onOpenCommandPalette ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenCommandPalette}
              aria-label="Open command palette"
              className="h-9 gap-2 px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 max-sm:size-11 max-sm:px-0"
            >
              <Command className="size-4" aria-hidden />
              <kbd className="hidden font-mono text-[10px] tracking-widest text-zinc-500 sm:inline">
                ⌘K
              </kbd>
            </Button>
          ) : null}

          <Separator orientation="vertical" className="mx-1 hidden h-6 md:block" />

          {/* Config popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Engine configuration"
                className="size-9 max-sm:size-11 text-zinc-400 hover:text-zinc-200"
              >
                <Settings2 className="size-4" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] border-zinc-800 bg-zinc-900 text-zinc-100">
              <ConfigControls config={engine.config} saving={control.isPending} onSave={saveConfig} />
            </PopoverContent>
          </Popover>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAction(running ? 'pause' : 'start')}
              disabled={control.isPending}
              aria-label={running ? 'Pause engine' : 'Resume engine'}
              className={cn(
                'max-sm:h-11',
                running
                  ? 'border-amber-600/50 text-amber-400 hover:bg-amber-950/30 hover:text-amber-300'
                  : 'border-emerald-600/50 text-emerald-400 hover:bg-emerald-950/30 hover:text-emerald-300',
              )}
            >
              {pendingAction === 'pause' || pendingAction === 'start' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : running ? (
                <Pause className="size-4" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              <span className="hidden sm:inline">{running ? 'Pause' : 'Resume'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAction('tick')}
              disabled={control.isPending}
              aria-label="Run one engine cycle now"
              className="max-sm:h-11 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              {pendingAction === 'tick' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <SkipForward className="size-4" aria-hidden />
              )}
              <span className="hidden sm:inline">Run Cycle</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAction('reset')}
              disabled={control.isPending}
              aria-label="Reset engine"
              className="max-sm:h-11 border-rose-900/60 text-rose-400 hover:bg-rose-950/30 hover:text-rose-300"
            >
              {pendingAction === 'reset' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="size-4" aria-hidden />
              )}
              <span className="hidden sm:inline">Reset</span>
            </Button>
          </div>
        </div>
      </div>
      {/* Next-tick progress — restarts on every new cycle (key), freezes while paused */}
      <div className="h-0.5 w-full overflow-hidden bg-zinc-900" aria-hidden>
        {running ? (
          <div
            key={engine.cycles}
            className="mc-tick-progress h-full bg-gradient-to-r from-emerald-600 to-emerald-400"
            style={{ '--mc-tick-ms': `${engine.config.tickIntervalMs}ms` } as React.CSSProperties}
          />
        ) : (
          <div className="h-full w-0 bg-amber-500/60" />
        )}
      </div>
      {/* Running pulse line */}
      <motion.div
        className={cn(
          'h-px w-full bg-gradient-to-r from-transparent to-transparent',
          running ? 'via-emerald-500/60' : 'via-zinc-700',
        )}
        animate={running ? { opacity: [0.35, 1, 0.35] } : { opacity: 0.4 }}
        transition={
          running ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }
        }
      />
    </header>
  );
}
