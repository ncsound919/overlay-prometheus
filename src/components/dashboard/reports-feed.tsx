'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, FileText, Siren, Telescope, Repeat, Search, SearchX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ExportIconButton, Panel, timeAgo } from '@/components/dashboard/shared';
import { ReportDialog, reportBadgeClass } from '@/components/dashboard/report-dialog';
import type { InsightReport } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';
import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

const SNAPSHOT_URL = '/api/export?type=snapshot&format=zip';

function reportIcon(type: string): ComponentType<LucideProps> {
  switch (type) {
    case 'alert':
      return Siren;
    case 'deep-dive':
      return Telescope;
    default:
      return Repeat;
  }
}

function reportLabel(type: string): string {
  switch (type) {
    case 'alert':
      return 'alert';
    case 'deep-dive':
      return 'deep-dive';
    default:
      return type || 'cycle-summary';
  }
}

// ─── Filter toolbar — type chips + text search ───────────────────────────

type ReportFilter = 'all' | 'alert' | 'deep-dive' | 'cycle-summary';

const FILTERS: Array<{ value: ReportFilter; label: string; activeClass: string }> = [
  { value: 'all', label: 'all', activeClass: 'border-zinc-500 bg-zinc-800 text-zinc-100' },
  { value: 'alert', label: 'alert', activeClass: 'border-rose-500/50 bg-rose-500/10 text-rose-300' },
  { value: 'deep-dive', label: 'deep-dive', activeClass: 'border-violet-500/50 bg-violet-500/10 text-violet-300' },
  { value: 'cycle-summary', label: 'cycle', activeClass: 'border-teal-500/50 bg-teal-500/10 text-teal-300' },
];

function ReportFilterBar({
  filter,
  onFilter,
  query,
  onQuery,
}: {
  filter: ReportFilter;
  onFilter: (f: ReportFilter) => void;
  query: string;
  onQuery: (q: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Filter reports by type" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => onFilter(f.value)}
              aria-pressed={active}
              className={cn(
                'rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors duration-200 outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60 max-sm:min-h-11 max-sm:px-3',
                active
                  ? f.activeClass
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300',
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <div className="relative ml-auto min-w-0 flex-1 sm:max-w-56">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search reports…"
          aria-label="Search reports by title or content"
          className="h-9 max-sm:h-11 w-full rounded-md border border-zinc-800 bg-zinc-900/70 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none transition-colors focus:border-zinc-600"
        />
      </div>
    </div>
  );
}

export function ReportsFeed({ reports }: { reports: InsightReport[] }) {
  // Controlled detail dialog: the selected report object is kept as-is (snapshot
  // semantics — polling refreshes the list underneath, not the open dialog).
  const [selected, setSelected] = useState<InsightReport | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      if (filter !== 'all' && reportLabel(r.reportType) !== filter) return false;
      if (q && !(`${r.title}
${r.content}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [reports, filter, query]);

  const openReport = (report: InsightReport) => {
    setSelected(report);
    setDialogOpen(true);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, report: InsightReport) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openReport(report);
    }
  };

  return (
    <Panel
      title="Insight Reports"
      icon={FileText}
      ariaLabel="Insight reports feed"
      actions={
        <>
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {filtered.length}/{reports.length} report{reports.length === 1 ? '' : 's'}
          </span>
          <ExportIconButton href={SNAPSHOT_URL} label="Download full snapshot" />
        </>
      }
      bodyClassName="p-4 pt-3"
    >
      {/* Type filter chips + text search */}
      {reports.length > 0 ? (
        <div className="pb-3">
          <ReportFilterBar
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
          />
        </div>
      ) : null}

      {reports.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No reports published yet"
          hint="Layer 8 publishes cycle summaries, alerts and deep-dives as the engine runs."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No reports match the current filter"
          hint={query ? `Nothing matches “${query}” — try clearing the search or switching the type chip.` : 'Try another type chip.'}
        />
      ) : (
        <div className="mc-scroll max-h-[42rem] overflow-y-auto pr-1">
          <ul className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {filtered.map((report) => {
                const Icon = reportIcon(report.reportType);
                const pulse = report.reportType === 'alert';
                return (
                  <motion.li
                    key={report.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.28 }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open report ${report.title}`}
                    onClick={() => openReport(report)}
                    onKeyDown={(event) => onRowKeyDown(event, report)}
                    className={cn(
                      'group cursor-pointer rounded-xl border bg-zinc-900/70 p-4 transition-colors duration-300 outline-none hover:border-zinc-700 focus-visible:ring-1 focus-visible:ring-emerald-500/60',
                      pulse
                        ? 'border-rose-500/40 shadow-[0_0_20px_-8px_rgba(244,63,94,0.45)]'
                        : 'border-zinc-800',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-md border',
                            pulse
                              ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                              : 'border-zinc-700 bg-zinc-800 text-zinc-400',
                          )}
                        >
                          <Icon className={cn('size-3.5', pulse && 'animate-pulse')} aria-hidden />
                        </span>
                        <h3 className="min-w-0 truncate text-sm font-semibold text-zinc-100">
                          {report.title}
                        </h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge
                          variant="outline"
                          className={cn(
                            'px-1.5 py-0 font-mono text-[10px] uppercase tracking-wider',
                            reportBadgeClass(report.reportType),
                          )}
                        >
                          {reportLabel(report.reportType)}
                        </Badge>
                        <ChevronRight
                          className="size-4 text-zinc-500 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                          aria-hidden
                        />
                      </div>
                    </div>
                    <p className="mt-2.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
                      {report.content}
                    </p>
                    <p className="mt-2.5 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                      CYC {String(report.cycle).padStart(3, '0')} ·{' '}
                      <time dateTime={report.createdAt}>{timeAgo(report.createdAt)}</time>
                    </p>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>
      )}

      <ReportDialog
        report={selected}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setSelected(null);
        }}
      />
    </Panel>
  );
}
