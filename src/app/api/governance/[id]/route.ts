import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const DECISIONS: readonly string[] = ['approved', 'rejected']

/**
 * POST /api/governance/[id]
 * body: { decision: 'approved' | 'rejected' }
 * Records the human review decision; if the target is a breakthrough it is
 * transitioned to 'deployed' (approved) or 'blocked' (rejected).
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
    const decision = (rawBody as { decision?: unknown }).decision
    if (typeof decision !== 'string' || !DECISIONS.includes(decision)) {
      return NextResponse.json(
        { error: "Invalid decision — expected 'approved' or 'rejected'" },
        { status: 400 },
      )
    }

    const check = await db.governanceCheck.findUnique({ where: { id } })
    if (!check) {
      return NextResponse.json({ error: 'Governance check not found' }, { status: 404 })
    }

    await db.governanceCheck.update({
      where: { id },
      data: {
        reviewDecision: decision,
        validationStatus: decision,
        humanReview: false,
      },
    })

    if (check.targetType === 'breakthrough') {
      const breakthrough = await db.breakthrough.findUnique({ where: { id: check.targetId } })
      if (breakthrough) {
        await db.breakthrough.update({
          where: { id: breakthrough.id },
          data: { status: decision === 'approved' ? 'deployed' : 'blocked' },
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/governance] review decision failed:', error)
    return NextResponse.json({ error: 'Governance review failed' }, { status: 500 })
  }
}
