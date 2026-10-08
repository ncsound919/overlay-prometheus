'use client';

/**
 * Report detail dialog — full-text viewer for Layer 8 insight reports.
 * Terminal-style paint: mono transcript on zinc-950 with ALL-CAPS section
 * headers tinted emerald and alert/warning lines tinted rose. Snapshot
 * semantics: the selected report object is passed in and re-rendered as-is.
 */

import { useMemo } from 'react';
import { Copy, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { timeAgo } from '@/components/dashboard/shared';
import type { InsightReport } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

/** Mirrors reports-feed.tsx badge mapping: alert=rose / deep-dive=violet / else zinc. */
export function reportBadgeClass(type: string): string {
  switch (type) {
    case 'alert':
      return 'border-rose-500/50 bg-rose-500/10 text-rose-300';
    case 'deep-dive':
      return 'border-violet-500/40 bg-violet-500/10 text-violet-300';
    default:
      return 'border-zinc-700 bg-zinc-800/60 text-zinc-400';
  }
}

function reportLabel(type: string): string {
  if (type === 'alert' || type === 'deep-dive') return type;
  return type || 'cycle-summary';
}

/** ALL-CAPS section headers → emerald; ⚠/ALERT lines → rose; body → zinc. */
function lineClass(line: string): string {
  if (line.startsWith('⚠') || line.includes('ALERT')) return 'text-rose-300';
  if (/^[A-Z][A-Z0-9 _\-:]{2,40}$/.test(line.trim())) return 'text-emerald-300';
  return 'text-zinc-300';
}

// ─── Extracted telemetry — regex digest of the report prose ─────────────────

interface MetricChip {
  key: string;
  label: string;
  value: string;
  tone: 'emerald' | 'rose' | 'amber' | 'teal' | 'violet' | 'zinc';
}

const CHIP_TONE: Record<MetricChip['tone'], string> = {
  emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  rose: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  teal: 'border-teal-500/40 bg-teal-500/10 text-teal-300',
  violet: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  zinc: 'border-zinc-700 bg-zinc-800/60 text-zinc-300',
};

/**
 * Pulls machine-readable numbers out of the Layer-8 prose (impact ranks,
 * risk scores, p-values, health/velocity, percentage deltas, entity counts)
 * so the operator reads the headline figures without parsing sentences.
 * Regex-only by design — no engine contract change, silently degrades to
 * zero chips for freeform text.
 */
function extractMetrics(content: string): MetricChip[] {
  const chips: MetricChip[] = [];
  const add = (label: string, value: string, tone: MetricChip['tone']) => {
    const key = `${label}:${value}`;
    if (chips.length < 8 && !chips.some((c) => c.key === key)) chips.push({ key, label, value, tone });
  };

  const impact = content.match(/impactRank\s+([0-9]*\.?[0-9]+)/i);
  if (impact) add('impact', impact[1], 'emerald');
  const risk = content.match(/riskScore\s+([0-9]*\.?[0-9]+)/i);
  if (risk) add('risk', risk[1], 'rose');
  const pVal = content.match(/p=([0-9]*\.?[0-9]+)/i);
  if (pVal) add('p-value', pVal[1], 'violet');
  const health = content.match(/health\s+([0-9]*\.?[0-9]+)/i);
  if (health) add('health', health[1], 'teal');
  const velocity = content.match(/velocity\s+([0-9]*\.?[0-9]+)/i);
  if (velocity) add('velocity', velocity[1], 'teal');
  const success = content.match(/success rate of\s+([0-9]+)%/i);
  if (success) add('success', `${success[1]}%`, 'emerald');
  const delta = content.match(/([−-]?[0-9]+(?:\.[0-9]+)?)%/);
  if (delta) add('Δ', `${delta[1]}%`, 'amber');
  const signals = content.match(/(\d+)\s+signals?/i);
  if (signals) add('signals', signals[1], 'zinc');
  const hyps = content.match(/(\d+)\s+hypothes(?:is|es)/i);
  if (hyps) add('hyps', hyps[1], 'zinc');
  const bts = content.match(/(\d+)\s+synthesized breakthroughs?/i);
  if (bts) add('bt', bts[1], 'zinc');
  const flagged = content.match(/flagged\s+(\d+)/i);
  if (flagged) add('flagged', flagged[1], 'amber');
  const cleared = content.match(/cleared\s+(\d+)/i);
  if (cleared) add('cleared', cleared[1], 'emerald');

  return chips;
}

function TelemetryDigest({ content }: { content: string }) {
  const chips = useMemo(() => extractMetrics(content), [content]);
  if (chips.length === 0) return null;
  return (
    <div aria-label="Extracted telemetry from the report text">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">
        Extracted telemetry
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span
            key={c.key}
            className={cn(
              'inline-flex items-baseline gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
              CHIP_TONE[c.tone],
            )}
          >
            <span className="text-zinc-500">{c.label}</span>
            <span className="font-medium tabular-nums">{c.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ReportDialog({
  report,
  open,
  onOpenChange,
}: {
  report: InsightReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const lines = useMemo(() => (report ? report.content.split('\n') : []), [report]);

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.content);
      toast({ title: 'Report copied', description: report.title });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Clipboard is unavailable in this browser context.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {report ? (
        <DialogContent className="mc-scroll max-h-[85dvh] gap-4 overflow-y-auto border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-xl">
          <DialogHeader className="gap-2 text-left">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn(
                  'px-1.5 py-0 font-mono text-[10px] uppercase tracking-wider',
                  reportBadgeClass(report.reportType),
                )}
              >
                {reportLabel(report.reportType)}
              </Badge>
              <span className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300">
                CYC {String(report.cycle).padStart(3, '0')}
              </span>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                <time dateTime={report.createdAt}>{timeAgo(report.createdAt)}</time>
              </span>
            </div>
            <DialogTitle className="pr-6 text-base font-semibold leading-snug text-zinc-100">
              {report.title}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-zinc-400">
              Full transcript of the Layer 8 {reportLabel(report.reportType)} report — published{' '}
              {timeAgo(report.createdAt)}.
            </DialogDescription>
          </DialogHeader>

          {/* Regex-digested headline figures from the report prose */}
          <TelemetryDigest content={report.content} />

          {/* Terminal-style viewer */}
          <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/90">
            <div className="flex items-center gap-1.5 border-b border-zinc-800/80 px-3 py-2">
              <span className="size-2.5 rounded-full bg-zinc-700" aria-hidden />
              <span className="size-2.5 rounded-full bg-zinc-700" aria-hidden />
              <span className="size-2.5 rounded-full bg-zinc-700" aria-hidden />
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                REPORT VIEWER · CYCLE {String(report.cycle).padStart(3, '0')}
              </span>
            </div>
            <div className="mc-scroll max-h-[55vh] overflow-y-auto p-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                {lines.map((line, i) => (
                  <span key={i} className={cn('block', lineClass(line))}>
                    {line === '' ? ' ' : line}
                  </span>
                ))}
              </pre>
            </div>
          </div>

          {/* Footer row: copy action + kernel caption */}
          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800/80 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copy()}
              className="max-sm:h-11 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Copy className="size-4" aria-hidden />
              Copy
            </Button>
            <p className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              <FileText className="mr-1 inline size-3" aria-hidden />
              PROMETHEUS Kernel · Insight Report
            </p>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
