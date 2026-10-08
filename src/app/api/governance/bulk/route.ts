import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const DECISIONS: readonly string[] = ['approved', 'rejected']
/** Hard cap on explicit id selection — keeps a single request bounded. */
const IDS_CAP = 100
/** Max length for the optional operator annotation. */
const NOTE_CAP = 240

/**
 * POST /api/governance/bulk
 * Two mutually-compatible body shapes:
 *   { decision, ids: string[], note?: string }  — operator ticked specific rows
 *                                                 (selection wins, cap 100 ids)
 *   { decision, maxRisk?: number }              — legacy "all pending ≤ maxRisk"
 *                                                 (default maxRisk = 1)
 * Each check is transitioned exactly like the single-review route:
 * approved → related breakthrough 'deployed', rejected → 'blocked'.
 * Explicit-id calls append a `BULK ▸` operator marker so the UI can
 * distinguish deliberate selections from threshold sweeps.
 */
export async function POST(request: Request) {
  try {
    const rawBody: unknown = await request.json().catch(() => null)
    if (typeof rawBody !== 'object' || rawBody === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const body = rawBody as { decision?: unknown; maxRisk?: unknown; ids?: unknown; note?: unknown }
    if (typeof body.decision !== 'string' || !DECISIONS.includes(body.decision)) {
      return NextResponse.json(
        { error: "Invalid decision — expected 'approved' or 'rejected'" },
        { status: 400 },
      )
    }
    const decision = body.decision

    // ── Resolve the selection: explicit ids (capped) or a risk threshold ──
    let ids: string[] | null = null
    if (body.ids !== undefined) {
      if (!Array.isArray(body.ids) || body.ids.some((v) => typeof v !== 'string')) {
        return NextResponse.json(
          { error: 'Invalid ids — expected an array of strings' },
          { status: 400 },
        )
      }
      const unique = [...new Set(body.ids as string[])]
      if (unique.length === 0) {
        return NextResponse.json({ error: 'ids must not be empty' }, { status: 400 })
      }
      if (unique.length > IDS_CAP) {
        return NextResponse.json(
          { error: `Too many ids — ${unique.length} given, cap is ${IDS_CAP}` },
          { status: 400 },
        )
      }
      ids = unique
    }

    let maxRisk = 1
    if (body.maxRisk !== undefined) {
      if (typeof body.maxRisk !== 'number' || !Number.isFinite(body.maxRisk)) {
        return NextResponse.json(
          { error: 'Invalid maxRisk — expected a finite number' },
          { status: 400 },
        )
      }
      maxRisk = Math.min(1, Math.max(0, body.maxRisk))
    }

    let operatorNote = ''
    if (body.note !== undefined) {
      if (typeof body.note !== 'string') {
        return NextResponse.json({ error: 'Invalid note — expected a string' }, { status: 400 })
      }
      operatorNote = body.note.trim().slice(0, NOTE_CAP)
    }

    const pending = ids
      ? await db.governanceCheck.findMany({
          where: {
            id: { in: ids },
            humanReview: true,
            reviewDecision: null,
          },
        })
      : await db.governanceCheck.findMany({
          where: {
            humanReview: true,
            reviewDecision: null,
            riskScore: { lte: maxRisk },
          },
          take: 200,
        })

    // Preserve the caller's order when ids were given (oldest-first in the UI).
    if (ids) {
      const order = new Map(ids.map((id, i) => [id, i]))
      pending.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    }

    let updated = 0
    // SQLite via Prisma: sequential updates are safe and atomic per-write.
    for (const check of pending) {
      const stampedNote =
        ids && operatorNote
          ? `BULK ▸ operator selection — ${operatorNote}`.slice(0, 400)
          : check.notes
      await db.governanceCheck.update({
        where: { id: check.id },
        data: {
          reviewDecision: decision,
          validationStatus: decision,
          humanReview: false,
          ...(stampedNote !== check.notes ? { notes: stampedNote } : {}),
        },
      })
      if (check.targetType === 'breakthrough') {
        const breakthrough = await db.breakthrough.findUnique({
          where: { id: check.targetId },
          select: { id: true },
        })
        if (breakthrough) {
          await db.breakthrough.update({
            where: { id: breakthrough.id },
            data: { status: decision === 'approved' ? 'deployed' : 'blocked' },
          })
        }
      }
      updated++
    }

    return NextResponse.json({ ok: true, updated })
  } catch (error) {
    console.error('[api/governance/bulk] bulk decision failed:', error)
    return NextResponse.json({ error: 'Bulk governance review failed' }, { status: 500 })
  }
}
