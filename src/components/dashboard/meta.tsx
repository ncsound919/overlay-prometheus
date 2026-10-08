import {
  Brain,
  ClipboardList,
  Cog,
  FlaskConical,
  Sparkles,
  TrendingUp,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';

/**
 * Shared visual metadata maps: solution-type iconography and status accent classes.
 * STRICT accent palette: emerald / amber / rose / violet / teal / zinc only — no blue, no indigo.
 */

export const SOLUTION_META: Record<string, { icon: ComponentType<LucideProps>; label: string }> = {
  molecule: { icon: FlaskConical, label: 'Molecule' },
  engineering: { icon: Cog, label: 'Engineering' },
  financial: { icon: TrendingUp, label: 'Financial' },
  protocol: { icon: ClipboardList, label: 'Protocol' },
  model: { icon: Brain, label: 'Model' },
};

export function solutionMeta(type: string): { icon: ComponentType<LucideProps>; label: string } {
  return SOLUTION_META[type] ?? { icon: Sparkles, label: type || 'Synthesis' };
}

/** Hypothesis status → badge classes. generated=violet, testing=amber, validated=emerald, rejected=rose, promoted=teal. */
export const HYPOTHESIS_STATUS_CLASSES: Record<string, string> = {
  generated: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  testing: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  validated: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  rejected: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  promoted: 'border-teal-500/40 bg-teal-500/10 text-teal-300',
};

export function hypothesisStatusClass(status: string): string {
  return HYPOTHESIS_STATUS_CLASSES[status] ?? 'border-zinc-700 bg-zinc-800/60 text-zinc-400';
}

/** Scatter/chart point color per hypothesis status. */
export const STATUS_CHART_COLOR: Record<string, string> = {
  generated: '#8b5cf6',
  testing: '#f59e0b',
  validated: '#10b981',
  rejected: '#f43f5e',
  promoted: '#14b8a6',
};

export function statusChartColor(status: string): string {
  return STATUS_CHART_COLOR[status] ?? '#a1a1aa';
}

/** Governance / breakthrough risk badge — rose gradient for high risk. */
export function riskBadgeClass(risk: number): string {
  const pct = risk <= 1 ? risk * 100 : risk;
  if (pct >= 70) return 'border-rose-500/50 bg-gradient-to-r from-rose-600/30 to-rose-500/10 text-rose-300';
  if (pct >= 40) return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
}

/** Stream / generic status dot tone. */
export function statusTone(status: string): 'emerald' | 'amber' | 'rose' | 'zinc' {
  switch (status) {
    case 'active':
    case 'running':
    case 'validated':
    case 'approved':
    case 'passed':
    case 'deployed':
      return 'emerald';
    case 'throttled':
    case 'paused':
    case 'testing':
    case 'pending':
    case 'synthesized':
      return 'amber';
    case 'offline':
    case 'blocked':
    case 'rejected':
    case 'flagged':
      return 'rose';
    default:
      return 'zinc';
  }
}
