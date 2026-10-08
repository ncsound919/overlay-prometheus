import { NextResponse } from 'next/server'
import { ensureEngine, getState } from '@/lib/engine/core'

export const dynamic = 'force-dynamic'

/**
 * GET /api/engine/state
 * Full dashboard payload. Calls ensureEngine(), and — when the engine is
 * running and tickIntervalMs has elapsed since the last tick — awaits one
 * mutex-protected runTick() BEFORE assembling the payload, so the engine
 * keeps cycling as the dashboard polls.
 */
export async function GET() {
  try {
    await ensureEngine()
    const payload = await getState()
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[api/engine/state] failed to assemble engine state:', error)
    return NextResponse.json({ error: 'Failed to load engine state' }, { status: 500 })
  }
}
