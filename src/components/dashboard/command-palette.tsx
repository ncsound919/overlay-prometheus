'use client';

/**
 * ⌘K command palette — navigation, engine control, data export and config presets.
 * Composes the shadcn cmdk primitives; owns its own control mutation so it can be
 * rendered anywhere inside the dashboard (state flows in via props only).
 */

import { useEffect, useState } from 'react';
import {
  Archive,
  FileJson,
  FileSpreadsheet,
  FlaskConical,
  Gauge,
  Layers3,
  LineChart,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  TableProperties,
  Telescope,
  Trophy,
  Zap,
  ZapOff,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { useToast } from '@/hooks/use-toast';
import { useEngineControl } from '@/hooks/use-engine';
import type {
  ControlAction,
  ControlResponse,
  EngineConfigPatch,
  EngineInfo,
} from '@/lib/dashboard-types';
import { exportUrl, type ExportEntity, type ExportFormat } from '@/components/dashboard/shared';
import { cn } from '@/lib/utils';

export type DashboardTab = 'discovery' | 'breakthroughs' | 'governance' | 'analytics' | 'reports' | 'layers';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engine: EngineInfo;
  onNavigate: (tab: DashboardTab) => void;
}

const NAV_ITEMS: Array<{ tab: DashboardTab; label: string; icon: ComponentType<LucideProps>; iconClass: string }> = [
  { tab: 'discovery', label: 'Discovery Lab', icon: FlaskConical, iconClass: 'text-violet-400' },
  { tab: 'breakthroughs', label: 'Breakthrough Board', icon: Trophy, iconClass: 'text-emerald-400' },
  { tab: 'governance', label: 'Governance', icon: TableProperties, iconClass: 'text-amber-400' },
  { tab: 'layers', label: 'Layer Workspaces', icon: Layers3, iconClass: 'text-teal-400' },
  { tab: 'analytics', label: 'Analytics', icon: LineChart, iconClass: 'text-teal-400' },
  { tab: 'reports', label: 'Insight Reports', icon: Telescope, iconClass: 'text-rose-400' },
];

const AGGRESSION_PRESETS: Array<{ value: number; label: string }> = [
  { value: 0.5, label: '0.50 — balanced' },
  { value: 0.7, label: '0.70 — standard' },
  { value: 0.9, label: '0.90 — maximal' },
];

/** Module-scope so the download is never mistaken for a render-phase side effect. */
function triggerBrowserDownload(url: string) {
  window.location.href = url;
}

export function CommandPalette({ open, onOpenChange, engine, onNavigate }: CommandPaletteProps) {
  const { toast } = useToast();
  const control = useEngineControl();
  const [confirmReset, setConfirmReset] = useState(false);
  const running = engine.status === 'running';

  // ⌘K / Ctrl+K toggles the palette from anywhere on the page.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  /** Mirrors the header's control pattern: mutate + toast + cache invalidation (in the hook). */
  const runControl = (action: ControlAction, describe: (res: ControlResponse) => string) => {
    control.mutate(
      { action },
      {
        onSuccess: (res) => toast({ title: 'Control command sent', description: describe(res) }),
        onError: (err) =>
          toast({ title: 'Control command failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  // Config is persisted by re-asserting the current run state with a config patch.
  const applyConfig = (patch: EngineConfigPatch, description: string) => {
    control.mutate(
      { action: running ? 'start' : 'pause', config: patch },
      {
        onSuccess: () => toast({ title: 'Configuration saved', description }),
        onError: (err) =>
          toast({ title: 'Configuration failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  const download = (entity: ExportEntity, format: ExportFormat, entityLabel: string) => {
    triggerBrowserDownload(exportUrl(entity, format));
    toast({
      title: 'Export started',
      description: `${entityLabel} (${format.toUpperCase()}) — download should begin shortly.`,
    });
  };

  const closeAnd = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  const exportItems: Array<{ entity: ExportEntity; format: ExportFormat; label: string }> = [
    { entity: 'hypotheses', format: 'json', label: 'Export Hypotheses JSON' },
    { entity: 'hypotheses', format: 'csv', label: 'Export Hypotheses CSV' },
    { entity: 'breakthroughs', format: 'json', label: 'Export Breakthroughs JSON' },
    { entity: 'breakthroughs', format: 'csv', label: 'Export Breakthroughs CSV' },
    { entity: 'signals', format: 'json', label: 'Export Signals JSON' },
  ];

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="PROMETHEUS Command Palette"
        description="Navigate workspaces, control the engine, export data or apply config presets."
        className={cn(
          'w-[calc(100%-2rem)] max-w-lg gap-0 border-zinc-800 bg-zinc-900 p-0 text-zinc-100',
          '[&_[data-slot=command]]:bg-zinc-900 [&_[data-slot=command]]:text-zinc-100',
          '[&_[data-slot=command-input-wrapper]]:border-zinc-800',
          '[&_[cmdk-group-heading]]:text-zinc-500',
        )}
      >
        <CommandInput
          placeholder="Type a command or search…"
          className="text-zinc-100 placeholder:text-zinc-600"
        />
        <CommandList className="mc-scroll py-1">
          <CommandEmpty className="text-zinc-500">No matching commands.</CommandEmpty>

          <CommandGroup heading="Navigate">
            {NAV_ITEMS.map((item) => (
              <CommandItem
                key={item.tab}
                value={`${item.label} navigate ${item.tab}`}
                onSelect={closeAnd(() => onNavigate(item.tab))}
                className="gap-2.5 text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-100"
              >
                <item.icon className={cn('size-4', item.iconClass)} aria-hidden />
                {item.label}
                <CommandShortcut className="text-[10px] uppercase tracking-wider text-zinc-600">
                  workspace
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Engine">
            <CommandItem
              value="Run Cycle Now tick"
              disabled={control.isPending}
              onSelect={closeAnd(() =>
                runControl('tick', (res) => `Manual cycle #${res.cycles} executed.`),
              )}
              className="gap-2.5 text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-100"
            >
              <SkipForward className="size-4 text-zinc-400" aria-hidden />
              Run Cycle Now
            </CommandItem>
            <CommandItem
              value={running ? 'Pause Engine' : 'Resume Engine'}
              disabled={control.isPending}
              onSelect={closeAnd(() =>
                runControl(running ? 'pause' : 'start', () =>
                  running ? 'Engine paused — state preserved.' : 'Engine resumed — inference stack online.',
                ),
              )}
              className="gap-2.5 text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-100"
            >
              {running ? (
                <Pause className="size-4 text-amber-400" aria-hidden />
              ) : (
                <Play className="size-4 text-emerald-400" aria-hidden />
              )}
              {running ? 'Pause Engine' : 'Resume Engine'}
              <CommandShortcut className="text-[10px] uppercase tracking-wider text-zinc-600">
                {running ? 'running' : 'paused'}
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              value="Reset Engine wipe all data"
              disabled={control.isPending}
              onSelect={closeAnd(() => setConfirmReset(true))}
              className="gap-2.5 text-rose-400 data-[selected=true]:bg-rose-950/50 data-[selected=true]:text-rose-300"
            >
              <RotateCcw className="size-4" aria-hidden />
              Reset Engine…
              <CommandShortcut className="text-[10px] uppercase tracking-wider text-rose-500/70">
                destructive
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading="Data">
            <CommandItem
              value="Export Full Snapshot ZIP archive bundle"
              onSelect={
                closeAnd(() => {
                  triggerBrowserDownload('/api/export?type=snapshot&format=zip');
                  toast({
                    title: 'Export started',
                    description: 'Full snapshot (ZIP) — download should begin shortly.',
                  });
                })
              }
              className="gap-2.5 text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-100"
            >
              <Archive className="size-4 text-teal-400" aria-hidden />
              Export Full Snapshot (ZIP)
              <CommandShortcut className="text-[10px] uppercase tracking-wider text-zinc-600">
                all layers
              </CommandShortcut>
            </CommandItem>
            {exportItems.map((item) => (
              <CommandItem
                key={item.label}
                value={item.label}
                onSelect={closeAnd(() => download(item.entity, item.format, item.label.replace(/^Export /, '')))}
                className="gap-2.5 text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-100"
              >
                {item.format === 'json' ? (
                  <FileJson className="size-4 text-teal-400" aria-hidden />
                ) : (
                  <FileSpreadsheet className="size-4 text-teal-400" aria-hidden />
                )}
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Config">
            <CommandItem
              value="Toggle LLM Discovery"
              disabled={control.isPending}
              onSelect={closeAnd(() =>
                applyConfig(
                  { llmDiscovery: !engine.config.llmDiscovery },
                  `LLM discovery ${engine.config.llmDiscovery ? 'disabled — template generator takes over' : 'enabled — LLM routes hypothesis generation'}.`,
                ),
              )}
              className="gap-2.5 text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-100"
            >
              {engine.config.llmDiscovery ? (
                <ZapOff className="size-4 text-violet-400" aria-hidden />
              ) : (
                <Sparkles className="size-4 text-violet-400" aria-hidden />
              )}
              Toggle LLM Discovery
              <CommandShortcut className="text-[10px] uppercase tracking-wider text-zinc-600">
                {engine.config.llmDiscovery ? 'on → off' : 'off → on'}
              </CommandShortcut>
            </CommandItem>
            {AGGRESSION_PRESETS.map((preset) => {
              const active = Math.abs(engine.config.aggression - preset.value) < 0.026;
              return (
                <CommandItem
                  key={preset.value}
                  value={`Set Aggression ${preset.label}`}
                  disabled={control.isPending}
                  onSelect={closeAnd(() =>
                    applyConfig({ aggression: preset.value }, `Aggression set to ${preset.value.toFixed(2)}.`),
                  )}
                  className="gap-2.5 text-zinc-300 data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-100"
                >
                  <Gauge className="size-4 text-amber-400" aria-hidden />
                  Set Aggression {preset.label}
                  {active ? <Zap className="ml-auto size-3.5 text-emerald-400" aria-hidden /> : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>

        {/* Engine status footer */}
        <div className="flex items-center gap-3 border-t border-zinc-800/80 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                'inline-flex size-1.5 rounded-full',
                running ? 'bg-emerald-500' : 'bg-amber-500',
              )}
              aria-hidden
            />
            {running ? 'running' : 'paused'}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">cyc {String(engine.cycles).padStart(3, '0')}</span>
          <span aria-hidden>·</span>
          <span>llm {engine.config.llmDiscovery ? 'on' : 'off'}</span>
          <span className="ml-auto text-zinc-600">esc to close</span>
        </div>
      </CommandDialog>

      {/* Reset confirmation — destructive, opens after the palette closes */}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Reset the engine?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              All signals, hypotheses, breakthroughs and governance records will be erased and the
              cycle counter restarts at 000. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-600/90"
              onClick={() => {
                setConfirmReset(false);
                runControl('reset', () => 'Engine reset — clean slate initialized.');
              }}
            >
              Reset engine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
