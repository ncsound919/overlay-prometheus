'use client';

/**
 * Domain correlation network — pure SVG, no chart deps.
 * Nodes = unique domains (capped at 10 by total edge weight) laid out
 * deterministically on a circle; edges = weighted correlation links with an
 * animated dash flow on the three strongest pairs.
 */

import { useMemo } from 'react';
import { Network } from 'lucide-react';
import { EmptyState, Panel } from '@/components/dashboard/shared';

const VIEW = 400;
const CENTER = 200;
const RADIUS = 130;
const MAX_NODES = 10;
const VIOLET = '#8b5cf6';
const TEAL = '#14b8a6';

/** Aggregate edge strength → emerald stroke scale for node rings. */
function nodeStroke(aggregate: number): string {
  if (aggregate >= 0.75) return '#6ee7b7'; // emerald-300
  if (aggregate >= 0.45) return '#10b981'; // emerald-500
  return '#047857'; // emerald-700
}

export function CorrelationGraph({ correlations }: { correlations: { id: string; sourceDomain: string; targetDomain: string; strength: number; mechanism: string }[] }) {
  const graph = useMemo(() => {
    // Total edge weight per domain → pick the top nodes deterministically.
    const weights = new Map<string, number>();
    for (const c of correlations) {
      weights.set(c.sourceDomain, (weights.get(c.sourceDomain) ?? 0) + c.strength);
      weights.set(c.targetDomain, (weights.get(c.targetDomain) ?? 0) + c.strength);
    }
    const domains = Array.from(weights.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_NODES);
    const kept = new Set(domains.map(([d]) => d));

    const nodes = domains.map(([domain, weight], i) => {
      const angle = (i / domains.length) * Math.PI * 2 - Math.PI / 2;
      const incident = correlations.filter(
        (c) => c.sourceDomain === domain || c.targetDomain === domain,
      );
      const aggregate = incident.length > 0
        ? incident.reduce((acc, c) => Math.max(acc, c.strength), 0)
        : 0.4;
      return {
        domain,
        weight,
        aggregate,
        x: CENTER + RADIUS * Math.cos(angle),
        y: CENTER + RADIUS * Math.sin(angle),
      };
    });

    const edges = correlations
      .filter((c) => kept.has(c.sourceDomain) && kept.has(c.targetDomain))
      .slice()
      .sort((a, b) => b.strength - a.strength);

    return { nodes, edges };
  }, [correlations]);

  const position = (domain: string) =>
    graph.nodes.find((n) => n.domain === domain) ?? { x: CENTER, y: CENTER };

  const topStrengths = graph.edges.slice(0, 3).map((e) => e.strength);

  return (
    <Panel
      title="Domain Correlation Graph"
      icon={Network}
      ariaLabel="Domain correlation graph"
      bodyClassName="p-4 pt-3"
    >
      <style>{`
        @keyframes mc-edge-flow {
          0% { stroke-dashoffset: 24; stroke: ${VIOLET}; }
          50% { stroke: ${TEAL}; }
          100% { stroke-dashoffset: 0; stroke: ${VIOLET}; }
        }
        .mc-edge-flow { animation: mc-edge-flow 1.6s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .mc-edge-flow { animation: none; }
        }
      `}</style>

      {graph.nodes.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No correlations found"
          hint="Layer 3 links domains once enough signals accumulate."
        />
      ) : (
        <>
          <svg
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            role="img"
            aria-label={`Network graph of ${graph.nodes.length} domains connected by ${graph.edges.length} correlations`}
            className="h-auto w-full"
          >
            {/* Edges (rendered first so nodes sit on top) */}
            {graph.edges.map((e) => {
              const from = position(e.sourceDomain);
              const to = position(e.targetDomain);
              const isTop = topStrengths.includes(e.strength);
              return (
                <line
                  key={e.id}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={VIOLET}
                  strokeWidth={1 + e.strength * 4}
                  strokeOpacity={0.15 + e.strength * 0.5}
                  strokeLinecap="round"
                  strokeDasharray={isTop ? '6 6' : undefined}
                  className={isTop ? 'mc-edge-flow' : undefined}
                >
                  <title>{`${e.sourceDomain} ↔ ${e.targetDomain} · ${e.strength.toFixed(2)} · ${e.mechanism}`}</title>
                </line>
              );
            })}

            {/* Center hub */}
            <circle cx={CENTER} cy={CENTER} r={3} fill="#3f3f46" aria-hidden />

            {/* Nodes */}
            {graph.nodes.map((n) => (
              <g key={n.domain}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={16}
                  fill="#18181b"
                  stroke={nodeStroke(n.aggregate)}
                  strokeWidth={1.5}
                  className="cursor-help"
                >
                  <title>{`${n.domain} · aggregate strength ${n.aggregate.toFixed(2)} · total edge weight ${n.weight.toFixed(2)}`}</title>
                </circle>
                <text
                  x={n.x}
                  y={n.y + 29}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#a1a1aa"
                  fontFamily="var(--font-geist-mono), monospace"
                  aria-hidden
                >
                  {n.domain}
                </text>
              </g>
            ))}
          </svg>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <svg width="22" height="8" aria-hidden>
                <line x1="1" y1="4" x2="21" y2="4" stroke={VIOLET} strokeWidth="3.5" strokeOpacity="0.7" strokeLinecap="round" />
              </svg>
              edge width = correlation strength
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="22" height="8" aria-hidden>
                <line x1="1" y1="4" x2="21" y2="4" stroke={TEAL} strokeWidth="2.5" strokeDasharray="4 4" strokeLinecap="round" />
              </svg>
              animated = top-3 links
            </span>
            <span className="ml-auto normal-case tracking-normal text-zinc-600">
              {graph.nodes.length} domains · {graph.edges.length} links
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}
