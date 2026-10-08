'use client';

/**
 * Operator signal injection — feed a high-signal observation straight into
 * Layer 1 (POST /api/signals). Injected signals are scored with an anomaly
 * floor of 0.60 and written promoted=true, so they are guaranteed to enter
 * the next Discovery cycle.
 */

import { useState } from 'react';
import { Activity, Loader2, Repeat2, Scale, Syringe, Waypoints } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useInjectSignal } from '@/hooks/use-engine';
import type { DomainStream } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

// Mirrors the server-side validation bounds (POST /api/signals).
const TITLE_MIN = 8;
const TITLE_MAX = 140;
const CONTENT_MIN = 20;
const CONTENT_MAX = 1200;

/**
 * Quick-fill scaffolds for common operator observations. Applying a preset
 * overwrites title + content (stream and operator are preserved) — everything
 * stays fully editable afterwards. Content deliberately names the three things
 * Discovery scores best: what was measured, how it deviates, replication context.
 */
const PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  icon: typeof Activity;
  title: string;
  content: string;
}> = [
  {
    id: 'drift',
    label: 'anomaly drift',
    icon: Activity,
    title: 'Unexplained 4.2σ drift in sensor array NW-12',
    content:
      'Continuous monitoring of array NW-12 shows a monotonic baseline drift of 4.2σ over 72h, ' +
      'incompatible with thermal cycling (temperature held at ±0.1K). Calibration reference unchanged; ' +
      'adjacent arrays stable. Drift persists after power cycle. Requesting anomaly scoring against historical array behavior.',
  },
  {
    id: 'replication',
    label: 'replication failure',
    icon: Repeat2,
    title: 'Independent replication fails to reproduce reported effect',
    content:
      'Three independent replications of the reported coupling effect under matched conditions (same protocol, ' +
      'same tolerance window) produced null results within 95% confidence bounds. Original authors contacted, ' +
      'raw data re-analyzed — discrepancy concentrated in the baseline-subtraction step. Flagging for cross-domain validation.',
  },
  {
    id: 'cross-domain',
    label: 'cross-domain link',
    icon: Waypoints,
    title: 'Shared rate-limiting constant across two unrelated systems',
    content:
      'Time-series analysis suggests the same rate-limiting kinetic constant governs both the degradation ' +
      'trajectory in system A and the oscillation period in system B — fields with no known shared mechanism. ' +
      'Fit residuals are white noise; cross-correlation peaks at zero lag. Submitting for multi-domain correlation detection.',
  },
  {
    id: 'boundary',
    label: 'boundary violation',
    icon: Scale,
    title: 'Measured response exceeds the accepted theoretical bound by 11%',
    content:
      'Direct measurement under standard conditions exceeds the accepted theoretical ceiling by 11% ± 3%. ' +
      'Instrument error budget accounts for at most 2%. Result replicated 5/5 times on two independent ' +
      'instruments. If confirmed, the bound itself requires revision — flagging as potential blind-spot candidate.',
  },
];

interface FormErrors {
  stream?: string;
  title?: string;
  content?: string;
  form?: string;
}

function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span
      className={cn(
        'font-mono text-[10px] tabular-nums',
        over ? 'text-rose-400' : 'text-zinc-500',
      )}
    >
      {value.length}/{max}
    </span>
  );
}

export function InjectSignalDialog({
  open,
  onOpenChange,
  streams,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  streams: DomainStream[];
}) {
  const { toast } = useToast();
  const inject = useInjectSignal();
  const [streamId, setStreamId] = useState(streams[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [operator, setOperator] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null);

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setTitle(preset.title);
    setContent(preset.content);
    setAppliedPreset(preset.id);
    setErrors({});
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (!streamId) next.stream = 'Select a target stream.';
    const t = title.trim();
    if (t.length < TITLE_MIN || t.length > TITLE_MAX) {
      next.title = `Title must be ${TITLE_MIN}–${TITLE_MAX} characters (currently ${t.length}).`;
    }
    const c = content.trim();
    if (c.length < CONTENT_MIN || c.length > CONTENT_MAX) {
      next.content = `Content must be ${CONTENT_MIN}–${CONTENT_MAX} characters (currently ${c.length}).`;
    }
    return next;
  };

  const reset = () => {
    setTitle('');
    setContent('');
    setOperator('');
    setErrors({});
    setAppliedPreset(null);
  };

  const submit = () => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    inject.mutate(
      {
        streamId,
        title: title.trim(),
        content: content.trim(),
        operator: operator.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          toast({
            title: 'Signal injected into L1',
            description: `anomaly ${res.signal.anomalyScore.toFixed(2)} — it will reach Discovery next cycle.`,
          });
          onOpenChange(false);
          reset();
        },
        onError: (err) => {
          setErrors({ form: err.message });
          toast({ title: 'Injection failed', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mc-scroll max-h-[85dvh] gap-4 overflow-y-auto border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-lg">
        <DialogHeader className="gap-2 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            <Syringe className="size-4 text-emerald-400" aria-hidden />
            Inject Signal
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-zinc-400">
            Feed a high-signal observation into Layer 1. Operator signals are scored like engine
            input with an anomaly floor of 0.60 and are guaranteed to reach Discovery next cycle.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Template presets — quick-fill scaffolds */}
          <div className="flex flex-col gap-1.5" role="group" aria-label="Observation templates">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider text-zinc-400">Template</span>
              <span className="font-mono text-[10px] text-zinc-600">fills title + observation · fully editable</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => {
                const active = appliedPreset === preset.id;
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => applyPreset(preset)}
                    title={preset.title}
                    className={cn(
                      'flex h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-[10px] uppercase tracking-wider transition-colors max-sm:h-9',
                      active
                        ? 'border-emerald-500/50 bg-emerald-500/[0.08] text-emerald-300'
                        : 'border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:border-violet-500/40 hover:text-violet-300',
                    )}
                  >
                    <Icon className={cn('size-3', active ? 'text-emerald-400' : 'text-zinc-500')} aria-hidden />
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target stream */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="inject-stream" className="text-[11px] uppercase tracking-wider text-zinc-400">
                Target stream
              </Label>
            </div>
            <Select value={streamId} onValueChange={setStreamId}>
              <SelectTrigger
                id="inject-stream"
                aria-label="Target stream for the injected signal"
                className={cn(
                  'w-full border-zinc-700 bg-zinc-950/60 text-zinc-100 max-sm:h-11',
                  'data-[placeholder]:text-zinc-500 aria-invalid:border-rose-500/60',
                )}
              >
                <SelectValue placeholder="Select target stream…" />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                {streams.map((stream) => (
                  <SelectItem
                    key={stream.id}
                    value={stream.id}
                    className="text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100 data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100"
                  >
                    <span className="font-mono text-[11px] uppercase text-zinc-500">{stream.category}</span>
                    <span className="truncate">{stream.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.stream ? <p className="text-[11px] text-rose-400">{errors.stream}</p> : null}
          </div>

          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="inject-title" className="text-[11px] uppercase tracking-wider text-zinc-400">
                Title
              </Label>
              <CharCount value={title} max={TITLE_MAX} />
            </div>
            <Input
              id="inject-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Unexplained 4.2σ drift in sensor array NW-12"
              aria-invalid={!!errors.title}
              maxLength={TITLE_MAX + 20}
              className="border-zinc-700 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-600 max-sm:h-11 aria-invalid:border-rose-500/60"
            />
            {errors.title ? <p className="text-[11px] text-rose-400">{errors.title}</p> : null}
          </div>

          {/* Content */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="inject-content" className="text-[11px] uppercase tracking-wider text-zinc-400">
                Observation
              </Label>
              <CharCount value={content} max={CONTENT_MAX} />
            </div>
            <Textarea
              id="inject-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Describe the raw observation: what was measured, how it deviates from expectation, and any replication or instrument context…"
              aria-invalid={!!errors.content}
              rows={6}
              maxLength={CONTENT_MAX + 40}
              className="border-zinc-700 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-600 aria-invalid:border-rose-500/60"
            />
            {errors.content ? <p className="text-[11px] text-rose-400">{errors.content}</p> : null}
          </div>

          {/* Operator */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="inject-operator" className="text-[11px] uppercase tracking-wider text-zinc-400">
                Operator
              </Label>
              <span className="font-mono text-[10px] text-zinc-600">optional</span>
            </div>
            <Input
              id="inject-operator"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              placeholder="anonymous"
              maxLength={64}
              className="border-zinc-700 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-600 max-sm:h-11"
            />
          </div>

          {errors.form ? (
            <p role="alert" className="rounded-md border border-rose-900/60 bg-rose-950/30 px-2.5 py-1.5 text-[11px] text-rose-300">
              {errors.form}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={inject.isPending}
            className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 max-sm:h-11"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={inject.isPending}
            aria-label="Inject signal into Layer 1"
            className="gap-1.5 bg-emerald-600/90 text-white hover:bg-emerald-600 max-sm:h-11"
          >
            {inject.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Syringe className="size-4" aria-hidden />
            )}
            Inject Signal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
