import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/governance/backlog
 *
 * Real queue telemetry for Layer 7 — the engine-state payload caps its
 * pending slice (GOV_PENDING_CAP = 120) so operators currently see a
 * misleading ceiling. This endpoint counts the WHOLE table:
 *   pendingTotal — every humanReview=true ∧ reviewDecision=null row
 *   bands        — risk histogram mirroring the UI tier chips
 *                  (LOW ≤ 0.35 · MED ≤ 0.6 · HIGH ≤ 0.8 · CRIT > 0.8)
 *   breaching    — pending rows older than the 10 min SLA breach mark
 *   oldestAgeMin — age of the oldest pending review, in minutes
 *
 * Five indexed-enough counts on SQLite; budget < 50 ms.
 */
export async function GET() {
  try {
    const now = Date.now()
    const base = { humanReview: true, reviewDecision: null }

    const [pendingTotal, low, mid, high, crit, breaching, oldest] = await Promise.all([
      db.governanceCheck.count({ where: base }),
      db.governanceCheck.count({ where: { ...base, riskScore: { lte: 0.35 } } }),
      db.governanceCheck.count({ where: { ...base, riskScore: { gt: 0.35, lte: 0.6 } } }),
      db.governanceCheck.count({ where: { ...base, riskScore: { gt: 0.6, lte: 0.8 } } }),
      db.governanceCheck.count({ where: { ...base, riskScore: { gt: 0.8 } } }),
      db.governanceCheck.count({
        where: { ...base, createdAt: { lt: new Date(now - 10 * 60_000) } },
      }),
      db.governanceCheck.findFirst({
        where: base,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ])

    const oldestAgeMin = oldest
      ? Math.max(0, Math.round((now - oldest.createdAt.getTime()) / 60_000))
      : 0

    return NextResponse.json(
      { pendingTotal, bands: { low, mid, high, crit }, breaching, oldestAgeMin },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[api/governance/backlog] failed:', error)
    return NextResponse.json({ error: 'Backlog telemetry unavailable' }, { status: 500 })
  }
}
