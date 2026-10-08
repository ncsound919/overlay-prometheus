import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  ensureEngine,
  mergeConfig,
  parseConfig,
  resetEngine,
  runTickSerialized,
} from '@/lib/engine/core'
import type { ControlAction, ControlRequest, ControlResponse } from '@/lib/engine-types'

export const dynamic = 'force-dynamic'

const ACTIONS: readonly ControlAction[] = ['start', 'pause', 'tick', 'reset', 'config']

/**
 * POST /api/engine/control
 * body: { action: 'start' | 'pause' | 'tick' | 'reset' | 'config', config?: Partial<EngineConfig> }
 *
 * 'config' applies a config patch without touching run state (safe while paused).
 */
export async function POST(request: Request) {
  try {
    const rawBody: unknown = await request.json().catch(() => null)
    if (typeof rawBody !== 'object' || rawBody === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const body = rawBody as ControlRequest
    const action = body.action
    if (typeof action !== 'string' || !ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action — expected one of: ${ACTIONS.join(', ')}` },
        { status: 400 },
      )
    }

    await ensureEngine()
    if (body.config !== undefined && typeof body.config === 'object' && body.config !== null) {
      await mergeConfig(body.config)
    }

    switch (action) {
      case 'start':
        await db.engineState.update({ where: { id: 'singleton' }, data: { status: 'running' } })
        break
      case 'pause':
        await db.engineState.update({ where: { id: 'singleton' }, data: { status: 'paused' } })
        break
      case 'tick':
        // Force one full pipeline cycle, even while paused.
        await runTickSerialized()
        break
      case 'reset':
        await resetEngine()
        break
    }

    const state = await ensureEngine()
    const response: ControlResponse = {
      ok: true,
      status: state.status,
      cycles: state.cycles,
      config: parseConfig(state.config),
    }
    return NextResponse.json(response)
  } catch (error) {
    console.error('[api/engine/control] control action failed:', error)
    return NextResponse.json({ error: 'Engine control action failed' }, { status: 500 })
  }
}
