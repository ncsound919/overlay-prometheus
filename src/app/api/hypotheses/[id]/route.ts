import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  buildBreakthroughSummary,
  buildSynthesis,
  clamp01,
  deriveSolutionType,
  round3,
} from '@/lib/engine/content'

export const dynamic = 'force-dynamic'

const ACTIONS: readonly string[] = ['promote', 'veto']

// Statuses from which a human operator may force-promote a hypothesis.
const PROMOTABLE = new Set(['generated', 'testing', 'validated'])
const MANUAL_GOVERNANCE_NOTE = 'Manual promotion by human operator — expedited review'

function parseDomains(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

/**
 * POST /api/hypotheses/[id]
 * body: { action: 'promote' | 'veto' }
 *
 * Human intelligence override for Layer 4:
 * - promote: force a hypothesis to 'promoted' and synthesize a Breakthrough
 *   exactly like the engine's Layer 5 does (same content mapping), plus a
 *   pending GovernanceCheck for expedited human review.
 * - veto: mark the hypothesis 'rejected', refusing when it already produced
 *   a promoted/deployed breakthrough.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const rawBody: unknown = await request.json().catch(() => null)
    if (typeof rawBody !== 'object' || rawBody === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const action = (rawBody as { action?: unknown }).action
    if (typeof action !== 'string' || !ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: "Invalid action — expected 'promote' or 'veto'" },
        { status: 400 },
      )
    }

    const hypothesis = await db.hypothesis.findUnique({ where: { id } })
    if (!hypothesis) {
      return NextResponse.json({ error: 'Hypothesis not found' }, { status: 404 })
    }

    if (action === 'promote') {
      if (hypothesis.status === 'rejected') {
        return NextResponse.json(
          { error: 'Cannot promote a refuted hypothesis' },
          { status: 409 },
        )
      }
      if (hypothesis.status === 'promoted') {
        return NextResponse.json(
          { error: 'Hypothesis is already promoted to a breakthrough' },
          { status: 409 },
        )
      }
      if (!PROMOTABLE.has(hypothesis.status)) {
        return NextResponse.json(
          { error: `Hypothesis status '${hypothesis.status}' cannot be promoted` },
          { status: 409 },
        )
      }

      const domains = parseDomains(hypothesis.domains)
      const solutionType = deriveSolutionType(domains)
      const synthesis = buildSynthesis(solutionType, domains)
      const impactRank = round3(
        clamp01(hypothesis.impact) * 0.7 + clamp01(hypothesis.novelty) * 0.3,
      )
      const riskScore = 0.2 // human-endorsed artifact

      const engineState = await db.engineState.findUnique({ where: { id: 'singleton' } })
      const cycle = engineState?.cycles ?? hypothesis.cycle

      const breakthrough = await db.breakthrough.create({
        data: {
          hypothesisId: hypothesis.id,
          title: hypothesis.title.slice(0, 300),
          solutionType,
          summary: buildBreakthroughSummary(solutionType, synthesis),
          synthesis: JSON.stringify(synthesis),
          impactRank,
          riskScore,
          status: 'synthesized',
          cycle,
        },
      })

      await db.hypothesis.update({
        where: { id: hypothesis.id },
        data: { status: 'promoted' },
      })

      await db.governanceCheck.create({
        data: {
          targetType: 'breakthrough',
          targetId: breakthrough.id,
          targetTitle: breakthrough.title,
          riskScore,
          ethicalFlags: JSON.stringify([]),
          validationStatus: 'pending',
          humanReview: true,
          notes: MANUAL_GOVERNANCE_NOTE,
          cycle,
        },
      })

      return NextResponse.json({ ok: true, breakthroughId: breakthrough.id })
    }

    // action === 'veto'
    if (hypothesis.status === 'promoted') {
      return NextResponse.json(
        { error: 'Hypothesis already produced a breakthrough and cannot be vetoed' },
        { status: 409 },
      )
    }
    const deployedChild = await db.breakthrough.findFirst({
      where: { hypothesisId: hypothesis.id, status: 'deployed' },
      select: { id: true },
    })
    if (deployedChild) {
      return NextResponse.json(
        { error: 'Breakthrough already deployed — veto refused' },
        { status: 409 },
      )
    }

    await db.hypothesis.update({
      where: { id: hypothesis.id },
      data: { status: 'rejected' },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/hypotheses] override failed:', error)
    return NextResponse.json({ error: 'Hypothesis override failed' }, { status: 500 })
  }
}
