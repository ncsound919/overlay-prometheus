import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const ACTIONS: readonly string[] = ['deploy', 'block']

/**
 * POST /api/breakthroughs/[id]
 * body: { action: 'deploy' | 'block' }
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
        { error: "Invalid action — expected 'deploy' or 'block'" },
        { status: 400 },
      )
    }

    const breakthrough = await db.breakthrough.findUnique({ where: { id } })
    if (!breakthrough) {
      return NextResponse.json({ error: 'Breakthrough not found' }, { status: 404 })
    }

    await db.breakthrough.update({
      where: { id },
      data: { status: action === 'deploy' ? 'deployed' : 'blocked' },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/breakthroughs] action failed:', error)
    return NextResponse.json({ error: 'Breakthrough action failed' }, { status: 500 })
  }
}
