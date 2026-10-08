import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CATEGORIES, clamp01, isCategory, round3 } from '@/lib/engine/content'

export const dynamic = 'force-dynamic'

// ─── Validation bounds ───────────────────────────────────────────────────────

const TITLE_MIN = 8
const TITLE_MAX = 140
const CONTENT_MIN = 20
const CONTENT_MAX = 1200
const OPERATOR_MAX = 64

// Operator signals are deliberate high-signal inputs: the raw score is FLOORED
// at 0.6 (engine draws are mostly < 0.72) and CAPPED at 0.95.
const ANOMALY_FLOOR = 0.6
const ANOMALY_CAP = 0.95
const NOVELTY_FLOOR = 0.55
const NOVELTY_CAP = 0.95

// ─── Operator feature extraction (mirrors engine Layer 2 semantics) ─────────
// content.ts's drawFeatures/drawAnomalyScore are module-private random draws;
// the operator path needs deterministic-ish scoring, so these are local pure
// equivalents driven by an FNV-1a hash of the observation text. The output
// shapes match Layer 2 exactly: {entropy, periodicity, gradient, dimensionality}
// with entropy/gradient positively correlated to anomaly and periodicity
// negatively correlated (see drawFeatures in src/lib/engine/content.ts).

function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic pseudo-random unit interval derived from a hash + salt. */
function unit(hash: number, salt: number): number {
  const x = Math.imul(hash ^ salt, 0x9e3779b1) >>> 0
  return (x % 100_000) / 100_000
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * Raw signal richness of the observation text — the deterministic stand-in for
 * the engine's random anomaly draw. Blends lexical diversity, numeric density
 * and observation length (all correlates of "anomalous" content in the engine's
 * synthetic streams). Returns ~0.3 (sparse) .. ~1.0 (rich).
 */
function rawContentScore(text: string): number {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const uniqueRatio = tokens.length > 0 ? new Set(tokens).size / tokens.length : 0
  const numericHits = (text.match(/\d/g) ?? []).length
  const numericDensity = Math.min(1, numericHits / 24)
  const lengthDensity = Math.min(1, tokens.length / 120)
  return 0.3 + uniqueRatio * 0.3 + numericDensity * 0.22 + lengthDensity * 0.18
}

/**
 * OPERATOR-SOURCE CONVENTION (see also src/lib/dashboard-types.ts Signal):
 * RawSignal has no attribution column (schema changes are out of scope), and
 * GET /api/engine/state maps features through a numbers-only parser, so the
 * operator marker is encoded as `features.sourceOp = 1` inside the features
 * JSON. The dashboard badge condition is `signal.features.sourceOp === 1`.
 * `sourceOp` is written LAST so the ticker's first-3 feature readout keeps
 * showing entropy/periodicity/gradient.
 */
const SOURCE_OP_MARKER = 1

/**
 * POST /api/signals — operator signal injection (Layer 1).
 * body: { streamId?: string, category?: string, title: string, content: string, operator?: string }
 *
 * Either streamId (must exist) or category (one of the 10 engine categories,
 * resolved to the first active DomainStream row) is required.
 *
 * DISCOVERY GUARANTEE: Layer 4 (runDiscoveryLayer in src/lib/engine/core.ts)
 * builds its LLM/template context from recent signals with
 * `OR: [{ promoted: true }, { anomalyScore: { gte: 0.75 } }]` and
 * `cycle >= currentCycle - 1`, ordered by anomalyScore DESC, take 8 (and
 * sourceSignals = the top 4 of that list). The operator floor (0.6) is below
 * the 0.75 engine threshold, so injected signals are always written with
 * `promoted: true` — that guarantees a slot in the candidate pool. To also
 * survive the take-8 slice under heavy engine traffic (each 6s tick promotes
 * up to three ≥0.8 draws), rich observations are mapped near the 0.95 cap so
 * they rank at the top of the hot list and get cited by name.
 */
export async function POST(request: Request) {
  try {
    const rawBody: unknown = await request.json().catch(() => null)
    if (typeof rawBody !== 'object' || rawBody === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const body = rawBody as {
      streamId?: unknown
      category?: unknown
      title?: unknown
      content?: unknown
      operator?: unknown
    }

    if (typeof body.title !== 'string') {
      return NextResponse.json({ error: 'Invalid title — expected a string' }, { status: 400 })
    }
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'Invalid content — expected a string' }, { status: 400 })
    }

    const title = body.title.trim()
    const content = body.content.trim()
    if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
      return NextResponse.json(
        { error: `Invalid title — expected ${TITLE_MIN}..${TITLE_MAX} characters, got ${title.length}` },
        { status: 400 },
      )
    }
    if (content.length < CONTENT_MIN || content.length > CONTENT_MAX) {
      return NextResponse.json(
        { error: `Invalid content — expected ${CONTENT_MIN}..${CONTENT_MAX} characters, got ${content.length}` },
        { status: 400 },
      )
    }

    // operator is accepted for attribution but NOT persisted — RawSignal has no
    // attribution column and prisma changes are out of scope for this task.
    const operator =
      typeof body.operator === 'string' && body.operator.trim().length > 0
        ? body.operator.trim().slice(0, OPERATOR_MAX)
        : 'anonymous'

    if (body.streamId !== undefined && typeof body.streamId !== 'string') {
      return NextResponse.json({ error: 'Invalid streamId — expected a string' }, { status: 400 })
    }
    if (body.category !== undefined && typeof body.category !== 'string') {
      return NextResponse.json(
        { error: `Invalid category — expected one of: ${CATEGORIES.join(', ')}` },
        { status: 400 },
      )
    }
    if (body.streamId === undefined && body.category === undefined) {
      return NextResponse.json(
        { error: 'Provide either streamId or category' },
        { status: 400 },
      )
    }

    // Resolve the target stream: explicit streamId wins, otherwise the first
    // active stream of the given engine category.
    let stream: { id: string; name: string; category: string; velocity: number } | null = null
    if (typeof body.streamId === 'string') {
      stream = await db.domainStream.findUnique({ where: { id: body.streamId } })
      if (!stream) {
        return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
      }
    } else if (typeof body.category === 'string') {
      if (!isCategory(body.category)) {
        return NextResponse.json(
          { error: `Invalid category — expected one of: ${CATEGORIES.join(', ')}` },
          { status: 400 },
        )
      }
      stream = await db.domainStream.findFirst({
        where: { category: body.category, status: 'active' },
        orderBy: { createdAt: 'asc' },
      })
      if (!stream) {
        return NextResponse.json(
          { error: `No active stream for category '${body.category}'` },
          { status: 404 },
        )
      }
    }
    if (!stream) {
      return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
    }

    // Feature + score extraction (Layer 2 semantics, deterministic).
    // Score mapping: sparse/repetitive content bottoms out at the 0.6 floor;
    // rich deliberate observations saturate at the 0.95 cap — engine draws in
    // the 2-cycle hot window regularly reach 0.99, and Layer 4 records only
    // the TOP-4 ranked titles into hypothesis sourceSignals, so ranking at the
    // cap is what makes an operator input actually get cited by name.
    const hash = hashString(`${title}\n${content}`)
    const richness = clamp((rawContentScore(content) - 0.3) / 0.55, 0, 1)
    const anomalyScore = round3(clamp(0.6 + richness * 0.37, ANOMALY_FLOOR, ANOMALY_CAP))
    const noveltyScore = round3(clamp(0.55 + richness * 0.32 + unit(hash, 2) * 0.08, NOVELTY_FLOOR, NOVELTY_CAP))
    const features = {
      entropy: round3(clamp01(0.25 + anomalyScore * 0.55 + (unit(hash, 3) * 0.24 - 0.12))),
      periodicity: round3(clamp01(0.05 + unit(hash, 4) * 0.55 - anomalyScore * 0.25)),
      gradient: round3(clamp01(0.1 + anomalyScore * 0.7 + (unit(hash, 5) * 0.2 - 0.1))),
      dimensionality: 2 + Math.floor(unit(hash, 6) * 16), // 2..17, like randInt(2, 17)
      sourceOp: SOURCE_OP_MARKER,
    }

    const engineState = await db.engineState.findUnique({
      where: { id: 'singleton' },
      select: { cycles: true },
    })
    const cycle = engineState?.cycles ?? 0

    const signal = await db.rawSignal.create({
      data: {
        streamId: stream.id,
        category: stream.category,
        title,
        content,
        features: JSON.stringify(features),
        anomalyScore,
        noveltyScore,
        cycle,
        promoted: true, // guaranteed entry into the next Layer 4 discovery context
      },
    })

    // Layer 1 stream bookkeeping — mirrors the engine's EWMA velocity update
    // with a single-item batch (count/4 pressure); best-effort.
    await db.domainStream.update({
      where: { id: stream.id },
      data: {
        itemsIngested: { increment: 1 },
        velocity: round3(clamp01(stream.velocity * 0.6 + (1 / 4) * 0.4)),
      },
    })

    return NextResponse.json({
      ok: true,
      signal: {
        id: signal.id,
        title: signal.title,
        anomalyScore: round3(signal.anomalyScore),
        noveltyScore: round3(signal.noveltyScore),
        promoted: signal.promoted,
        streamName: stream.name,
        cycle: signal.cycle,
      },
    })
  } catch (error) {
    console.error('[api/signals] operator injection failed:', error)
    return NextResponse.json({ error: 'Signal injection failed' }, { status: 500 })
  }
}
