'use client';

/**
 * AUTO-TRIAGE POLICY CONTROLS — shared editor for the standing Layer-7 policy.
 * Rendered inside lazily-mounted Popovers (governance panel + header config),
 * so local draft state re-initializes from the server config on every open.
 * The engine applies the policy inside every governance pass while enabled:
 * pending reviews with riskScore ≤ maxRisk older than afterMinutes are approved
 * automatically (breakthrough → deployed) and their notes carry an
 * `AUTO-TRIAGE ▸ …` marker so decisions stay auditable in the UI.
 *
 * Tier 2 · mid-risk valve (violet): releases the stuck band ABOVE the tier-1
 * ceiling (policy.maxRisk < risk ≤ midRisk.maxRisk) once aged past
 * midRisk.afterMinutes. The band the tier-1 valve can never drain (R10 finding:
 * ~250 rows parked at 0.45 < risk ≤ 0.6 forever). HIGH rows always keep their human.
 */

import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { AutoTriagePolicy, AutoTriageTier } from '@/lib/dashboard-types';

export interface AutoTriageControlsProps {
  policy: AutoTriagePolicy;
  saving: boolean;
  onSave: (patch: { autoTriage: Partial<AutoTriagePolicy> }) => void;
  /** Optional live eligibility stats for tier 1 (governance panel passes these). */
  eligible?: number;
  eligibleAged?: number;
  /** Optional live eligibility stats for the tier-2 mid band. */
  midEligible?: number;
  midEligibleAged?: number;
}

export function AutoTriageControls({
  policy,
  saving,
  onSave,
  eligible,
  eligibleAged,
  midEligible,
  midEligibleAged,
}: AutoTriageControlsProps) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [maxRisk, setMaxRisk] = useState(policy.maxRisk);
  const [afterMinutes, setAfterMinutes] = useState(policy.afterMinutes);
  const [mid, setMid] = useState<AutoTriageTier>(policy.midRisk);

  const saveMid = (next: AutoTriageTier) => {
    setMid(next);
    onSave({ autoTriage: { ...policy, midRisk: next } });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label htmlFor="auto-triage" className="text-xs font-medium text-zinc-300">
          Auto-triage standing policy
        </label>
        <Switch
          id="auto-triage"
          checked={enabled}
          disabled={saving}
          onCheckedChange={(checked) => {
            setEnabled(checked);
            onSave({ autoTriage: { ...policy, enabled: checked } });
          }}
          className="data-[state=checked]:bg-amber-500"
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-500">
        Pending reviews below the risk ceiling are approved automatically once they age past the
        threshold. Decisions are tagged <span className="font-mono text-amber-400">AUTO-TRIAGE</span> in
        the review notes; HIGH-risk (≥ 0.6) reviews always keep their human.
      </p>

      <div
        className={cn(
          'flex flex-col gap-3 rounded-lg border px-3 py-3 transition-opacity',
          enabled ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-zinc-800 bg-zinc-950/40 opacity-60',
        )}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-400">
              Tier 1 · low-risk <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">auto ≤ ceiling</span>
            </span>
            <span className="font-mono text-xs tabular-nums text-amber-300">≤ {maxRisk.toFixed(2)}</span>
          </div>
          <Slider
            min={0.35}
            max={0.6}
            step={0.05}
            value={[maxRisk]}
            disabled={saving || !enabled}
            onValueChange={(vals) => setMaxRisk(vals[0] ?? 0.45)}
            onValueCommit={(vals) => {
              const next = vals[0] ?? 0.45;
              setMaxRisk(next);
              onSave({ autoTriage: { ...policy, maxRisk: next } });
            }}
            aria-label="Auto-triage tier 1 risk ceiling"
            className="[&_[data-slot=slider-range]]:bg-amber-500 [&_[data-slot=slider-thumb]]:border-amber-500"
          />
          <div className="flex justify-between font-mono text-[9px] text-zinc-600" aria-hidden>
            <span>0.35 floor</span>
            <span>0.60 = HIGH tier</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-400">Age threshold</span>
            <span className="font-mono text-xs tabular-nums text-amber-300">≥ {afterMinutes}m</span>
          </div>
          <Slider
            min={1}
            max={120}
            step={1}
            value={[afterMinutes]}
            disabled={saving || !enabled}
            onValueChange={(vals) => setAfterMinutes(vals[0] ?? 15)}
            onValueCommit={(vals) => {
              const next = Math.round(vals[0] ?? 15);
              setAfterMinutes(next);
              onSave({ autoTriage: { ...policy, afterMinutes: next } });
            }}
            aria-label="Auto-triage tier 1 age threshold in minutes"
            className="[&_[data-slot=slider-range]]:bg-amber-500 [&_[data-slot=slider-thumb]]:border-amber-500"
          />
          <div className="flex justify-between font-mono text-[9px] text-zinc-600" aria-hidden>
            <span>1m</span>
            <span>120m</span>
          </div>
        </div>

        {typeof eligible === 'number' ? (
          <p className="font-mono text-[10px] tabular-nums text-zinc-500" role="status">
            {(eligibleAged ?? 0) > 0
              ? `${eligibleAged} of ${eligible} eligible pending review${eligible === 1 ? '' : 's'} past the age threshold now`
              : `0 of ${eligible} eligible past the age threshold yet`}
            {enabled ? '' : ' — policy currently OFF'}
          </p>
        ) : null}
      </div>

      {/* ── Tier 2 · mid-risk valve (violet) ── */}
      <div className="flex items-center justify-between">
        <label htmlFor="auto-triage-mid" className="text-xs font-medium text-zinc-300">
          Tier 2 · mid-risk valve
        </label>
        <Switch
          id="auto-triage-mid"
          checked={mid.enabled}
          disabled={saving || !enabled}
          onCheckedChange={(checked) => saveMid({ ...mid, enabled: checked })}
          className="data-[state=checked]:bg-violet-500"
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-500">
        Second valve for the band the tier-1 ceiling can never reach — releases reviews with
        risk <span className="font-mono text-zinc-300">&gt; {maxRisk.toFixed(2)}</span> and ≤ the mid
        ceiling after a longer wait. Tagged{' '}
        <span className="font-mono text-violet-400">AUTO-TRIAGE·MID</span>. Still below HIGH.
      </p>

      <div
        className={cn(
          'flex flex-col gap-3 rounded-lg border px-3 py-3 transition-opacity',
          enabled && mid.enabled
            ? 'border-violet-500/30 bg-violet-500/[0.05]'
            : 'border-zinc-800 bg-zinc-950/40 opacity-60',
        )}
        aria-hidden={false}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-400">
              Mid ceiling <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">band &gt; {maxRisk.toFixed(2)}</span>
            </span>
            <span className="font-mono text-xs tabular-nums text-violet-300">≤ {mid.maxRisk.toFixed(2)}</span>
          </div>
          <Slider
            min={0.4}
            max={0.6}
            step={0.05}
            value={[mid.maxRisk]}
            disabled={saving || !enabled || !mid.enabled}
            onValueChange={(vals) => setMid((m) => ({ ...m, maxRisk: vals[0] ?? 0.6 }))}
            onValueCommit={(vals) => {
              const next = vals[0] ?? 0.6;
              saveMid({ ...mid, maxRisk: next });
            }}
            aria-label="Mid-risk valve ceiling"
            className="[&_[data-slot=slider-range]]:bg-violet-500 [&_[data-slot=slider-thumb]]:border-violet-500"
          />
          <div className="flex justify-between font-mono text-[9px] text-zinc-600" aria-hidden>
            <span>0.40</span>
            <span>0.60 = HIGH tier</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-400">Age threshold</span>
            <span className="font-mono text-xs tabular-nums text-violet-300">≥ {mid.afterMinutes}m</span>
          </div>
          <Slider
            min={15}
            max={240}
            step={15}
            value={[mid.afterMinutes]}
            disabled={saving || !enabled || !mid.enabled}
            onValueChange={(vals) => setMid((m) => ({ ...m, afterMinutes: Math.round(vals[0] ?? 60) }))}
            onValueCommit={(vals) => {
              const next = Math.round(vals[0] ?? 60);
              saveMid({ ...mid, afterMinutes: next });
            }}
            aria-label="Mid-risk valve age threshold in minutes"
            className="[&_[data-slot=slider-range]]:bg-violet-500 [&_[data-slot=slider-thumb]]:border-violet-500"
          />
          <div className="flex justify-between font-mono text-[9px] text-zinc-600" aria-hidden>
            <span>15m</span>
            <span>240m</span>
          </div>
        </div>

        {typeof midEligible === 'number' ? (
          <p className="font-mono text-[10px] tabular-nums text-zinc-500" role="status">
            {(midEligibleAged ?? 0) > 0
              ? `${midEligibleAged} of ${midEligible} mid-band review${midEligible === 1 ? '' : 's'} past the age threshold now`
              : `0 of ${midEligible} mid-band reviews past the age threshold yet`}
            {enabled && mid.enabled ? '' : ' — valve currently OFF'}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Compact header chip summarizing both policy tiers — opens the editor popover. */
export function AutoTriageSummary({ policy }: { policy: AutoTriagePolicy }) {
  const midOn = policy.enabled && policy.midRisk.enabled;
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
      <span
        className={cn('size-1.5 rounded-full', policy.enabled ? 'bg-amber-400 mc-led' : 'bg-zinc-600')}
        aria-hidden
      />
      <span className={policy.enabled ? 'text-amber-400' : 'text-zinc-500'}>
        {policy.enabled ? `auto ≤${policy.maxRisk.toFixed(2)} ≥${policy.afterMinutes}m` : 'auto off'}
      </span>
      {midOn ? (
        <span className="text-violet-400" title={`Mid-risk valve: releases ${policy.maxRisk.toFixed(2)} < risk ≤ ${policy.midRisk.maxRisk.toFixed(2)} after ${policy.midRisk.afterMinutes}m`}>
          +mid ≤{policy.midRisk.maxRisk.toFixed(2)}
        </span>
      ) : null}
    </span>
  );
}
