'use client';

/**
 * Shared mission-control primitives: panels, meters, chips, states, formatters.
 * Design system: dark zinc base · accents emerald/amber/rose/violet/teal ONLY (no blue/indigo).
 */

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Download, RefreshCw, type LucideProps } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ─── Formatters ──────────────────────────────────────────────────────────────

export function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Renders 0..1 scores as a percentage string; passes through larger numbers. */
export function fmtScore(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return n <= 1 ? `${(n * 100).toFixed(digits)}%` : n.toFixed(digits);
}

export function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** camelCase / snake_case metric key → readable label. */
export function labelKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalize 0..1 or 0..100 style metrics to a 0..100 scale. */
export function toPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n));
}

// ─── Scrollbar / global micro-styles (rendered once) ─────────────────────────

export function MissionControlStyles() {
  return (
    <style>{`
      .mc-scroll { scrollbar-width: thin; scrollbar-color: #3f3f46 transparent; }
      .mc-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
      .mc-scroll::-webkit-scrollbar-track { background: transparent; }
      .mc-scroll::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 9999px; }
      .mc-scroll::-webkit-scrollbar-thumb:hover { background: #52525b; }
      .mc-grid-bg {
        background-image:
          radial-gradient(ellipse 70% 45% at 50% -5%, rgba(16,185,129,0.07), transparent),
          radial-gradient(ellipse 55% 40% at 85% 105%, rgba(139,92,246,0.06), transparent),
          radial-gradient(ellipse 40% 35% at 5% 80%, rgba(20,184,166,0.04), transparent),
          linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px);
        background-size: 100% 100%, 100% 100%, 100% 100%, 56px 56px, 56px 56px;
      }
      /* Header next-tick progress — width driven by --mc-tick-ms, remount per cycle via key */
      @keyframes mc-tick-fill { from { width: 0%; } to { width: 100%; } }
      .mc-tick-progress { animation: mc-tick-fill var(--mc-tick-ms, 6000ms) linear forwards; }
      /* Terminal block cursor (event log last line) */
      @keyframes mc-cursor-blink { 0%, 45% { opacity: 1; } 50%, 95% { opacity: 0; } 100% { opacity: 1; } }
      .mc-cursor-blink { animation: mc-cursor-blink 1.1s steps(1, end) infinite; }
      /* Footer status LED strip — stagger via inline animation-delay */
      @keyframes mc-led-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.15; } }
      .mc-led { animation: mc-led-blink 1.8s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        .mc-tick-progress { animation: none; width: 100%; }
        .mc-cursor-blink { animation: none; opacity: 0.9; }
        .mc-led { animation: none; opacity: 0.75; }
      }
    `}</style>
  );
}

// ─── Animated number ticker (cheap rAF tween) ────────────────────────────────

export function TickNumber({
  value,
  className,
  format = (n) => fmtNum(n),
}: {
  value: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    const duration = 550;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value]);

  return <span className={className}>{format(display)}</span>;
}

// ─── Panel shell ─────────────────────────────────────────────────────────────

export function Panel({
  title,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
  ariaLabel,
}: {
  title: string;
  icon?: ComponentType<LucideProps>;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  ariaLabel?: string;
}) {
  return (
    <section
      aria-label={ariaLabel ?? title}
      className={cn(
        'relative flex min-w-0 flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-sm transition-colors duration-300 hover:border-zinc-700',
        className,
      )}
    >
      {/* Sci-fi corner accents (pure decoration) */}
      <span aria-hidden className="pointer-events-none absolute -left-px -top-px z-10 size-3 rounded-tl-xl border-l border-t border-zinc-600" />
      <span aria-hidden className="pointer-events-none absolute -bottom-px -right-px z-10 size-3 rounded-br-xl border-b border-r border-zinc-600" />
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-zinc-800/80 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon className="size-4 shrink-0 text-zinc-500" aria-hidden /> : null}
          <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            {title}
          </h2>
        </div>
        {/* Wrap-allowed on narrow screens: long action clusters drop to their
            own header line and reflow internally instead of stretching the
            panel (mobile overflow fix). min-w-0 beats shrink-0 here — shrink-0
            pins the box at max-content width, which IS the overflow. */}
        {actions ? <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">{actions}</div> : null}
      </header>
      <div className={cn('min-w-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

// ─── Meter (accent-controlled progress bar) ──────────────────────────────────

export type MeterTone = 'emerald' | 'amber' | 'rose' | 'violet' | 'teal' | 'zinc';

const METER_FILL: Record<MeterTone, string> = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
  teal: 'bg-teal-500',
  zinc: 'bg-zinc-500',
};

export function Meter({
  value,
  tone = 'emerald',
  className,
  height = 'h-1.5',
}: {
  value: number;
  tone?: MeterTone;
  className?: string;
  height?: string;
}) {
  const pct = toPct(value);
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('w-full overflow-hidden rounded-full bg-zinc-800', height, className)}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-700 ease-out', METER_FILL[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function meterToneForScore(n: number): MeterTone {
  const pct = toPct(n);
  if (pct >= 70) return 'emerald';
  if (pct >= 40) return 'amber';
  return 'rose';
}

// ─── Status dot ──────────────────────────────────────────────────────────────

export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: MeterTone;
  pulse?: boolean;
  className?: string;
}) {
  const color = METER_FILL[tone];
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {pulse ? (
        <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', color)} />
      ) : null}
      <span className={cn('relative inline-flex size-2 rounded-full', color)} />
    </span>
  );
}

// ─── Stat chip (monospace metric) ────────────────────────────────────────────

export function StatChip({
  label,
  value,
  tone = 'zinc',
  className,
}: {
  label: string;
  value: string;
  tone?: MeterTone;
  className?: string;
}) {
  const toneText: Record<MeterTone, string> = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    rose: 'text-rose-400',
    violet: 'text-violet-400',
    teal: 'text-teal-400',
    zinc: 'text-zinc-300',
  };
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-baseline gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[11px] leading-none',
        className,
      )}
    >
      <span className="truncate uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={cn('font-medium tabular-nums', toneText[tone])}>{value}</span>
    </span>
  );
}

// ─── Empty / error / loading states ──────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 px-6 py-8 text-center">
      <Icon className="size-6 text-zinc-600" aria-hidden />
      <p className="text-sm font-medium text-zinc-400">{title}</p>
      {hint ? <p className="max-w-xs text-xs text-zinc-600">{hint}</p> : null}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-900/60 bg-rose-950/20 px-6 py-10 text-center"
    >
      <AlertTriangle className="size-6 text-rose-400" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-rose-300">Telemetry link lost</p>
        <p className="mt-1 text-xs text-rose-400/80">{message}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="min-h-11 border-rose-900/60 text-rose-300 hover:bg-rose-950/40 hover:text-rose-200"
      >
        <RefreshCw className="size-4" aria-hidden />
        Retry connection
      </Button>
    </div>
  );
}

export function SkeletonPanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4',
        className,
      )}
      aria-hidden
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-busy="true" aria-label="Loading dashboard">
      <div className="flex flex-col gap-4 lg:col-span-3">
        <SkeletonPanel className="min-h-[22rem]" />
        <SkeletonPanel className="min-h-[20rem]" />
      </div>
      <div className="flex flex-col gap-3 lg:col-span-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-4 lg:col-span-3">
        <SkeletonPanel className="min-h-[16rem]" />
        <SkeletonPanel className="min-h-[16rem]" />
      </div>
    </div>
  );
}

// ─── Data export helpers (GET /api/export) ───────────────────────────────────

export type ExportEntity = 'hypotheses' | 'breakthroughs' | 'signals';
export type ExportFormat = 'json' | 'csv';

export function exportUrl(entity: ExportEntity, format: ExportFormat): string {
  return `/api/export?type=${entity}&format=${format}`;
}

/** Compact ghost icon-button that downloads an entity snapshot from /api/export. */
export function ExportIconButton({
  entity,
  format,
  href,
  label,
}: {
  /** Entity + format → standard /api/export URL (ignored when href is set). */
  entity?: ExportEntity;
  format?: ExportFormat;
  /** Explicit download URL — overrides entity/format (e.g. full-snapshot ZIP). */
  href?: string;
  label: string;
}) {
  const { toast } = useToast();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={() => {
            window.location.href = href ?? exportUrl(entity ?? 'hypotheses', format ?? 'json');
            toast({ title: 'Export started', description: `${label} — download should begin shortly.` });
          }}
          className="size-8 max-sm:size-11 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <Download className="size-3.5" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Micro animation helpers ─────────────────────────────────────────────────

export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: 'easeOut' as const },
};

export function HoverGlow({
  children,
  className,
  glow = 'hover:shadow-[0_0_20px_-6px_rgba(16,185,129,0.25)]',
}: {
  children: ReactNode;
  className?: string;
  glow?: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'transition-[border-color,box-shadow] duration-300 hover:border-zinc-600',
        glow,
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
