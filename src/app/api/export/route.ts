import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createZip } from '@/lib/zip'

export const dynamic = 'force-dynamic'

const TYPES = ['hypotheses', 'breakthroughs', 'signals', 'snapshot'] as const
const FORMATS = ['json', 'csv', 'zip'] as const

type ExportType = (typeof TYPES)[number]
type ExportFormat = (typeof FORMATS)[number]

const LIMIT = 500
const TEXT_MAX = 300

/** Defensive JSON parse for the stringified JSON columns (SQLite convention). */
function parseJsonLoose<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Truncate long free-text fields for CSV readability. */
function truncate(text: string, max = TEXT_MAX): string {
  const s = typeof text === 'string' ? text : String(text ?? '')
  return s.length > max ? `${s.slice(0, max - 3)}...` : s
}

/** Escape a single CSV cell — quoted, inner quotes doubled. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

function toCsv(rows: unknown[][], header: string[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

interface ValidationStats {
  simulations: number
  passed: number
  failed: number
  pValue: number
  effectSize: number
}

interface Counterfactual {
  question: string
  result: string
  supports: boolean
}

interface Synthesis {
  components: string[]
  mechanism: string
  feasibility: number
  expectedGain: string
  timeHorizon: string
}

const DEFAULT_VALIDATION: ValidationStats = {
  simulations: 0,
  passed: 0,
  failed: 0,
  pValue: 0,
  effectSize: 0,
}

const DEFAULT_SYNTHESIS: Synthesis = {
  components: [],
  mechanism: '',
  feasibility: 0,
  expectedGain: '',
  timeHorizon: '',
}

// ─── Full-snapshot ZIP export (type=snapshot&format=zip) ────────────────────

/** Per-entity row caps for the snapshot bundle (newest-first where ordered). */
const SNAPSHOT_LIMITS = {
  signals: 1000,
  hypotheses: 2000,
  breakthroughs: 1000,
  governance: 1000,
  links: 500,
  metrics: 1000,
  reports: 200,
} as const

interface SnapshotFile {
  name: string
  data: string
}

/** Uniform re-importable envelope: pretty-printed, 2-space, UTF-8. */
function snapshotJson(entity: string, rows: unknown[]): SnapshotFile {
  return { name: entity, data: JSON.stringify({ entity: entity.replace(/^\d+-/, '').replace(/\.json$/, ''), count: rows.length, rows }, null, 2) }
}

async function buildSnapshotFiles(): Promise<{ files: SnapshotFile[]; cycle: number }> {
  const engineRow = await db.engineState.findUnique({ where: { id: 'singleton' } })
  const engineConfig = parseJsonLoose<Record<string, unknown>>(engineRow?.config ?? '{}', {})
  const cycle = engineRow?.cycles ?? 0

  const [streams, signals, hypotheses, breakthroughs, governance, links, metrics, reports] =
    await Promise.all([
      db.domainStream.findMany({ orderBy: { createdAt: 'asc' } }),
      db.rawSignal.findMany({
        orderBy: { createdAt: 'desc' },
        take: SNAPSHOT_LIMITS.signals,
        include: { stream: { select: { name: true } } },
      }),
      db.hypothesis.findMany({ orderBy: { createdAt: 'desc' }, take: SNAPSHOT_LIMITS.hypotheses }),
      db.breakthrough.findMany({ orderBy: { createdAt: 'desc' }, take: SNAPSHOT_LIMITS.breakthroughs }),
      db.governanceCheck.findMany({ orderBy: { createdAt: 'desc' }, take: SNAPSHOT_LIMITS.governance }),
      db.crossDomainLink.findMany({ orderBy: { createdAt: 'desc' }, take: SNAPSHOT_LIMITS.links }),
      db.layerMetric.findMany({ orderBy: { createdAt: 'desc' }, take: SNAPSHOT_LIMITS.metrics }),
      db.insightReport.findMany({ orderBy: { createdAt: 'desc' }, take: SNAPSHOT_LIMITS.reports }),
    ])

  const signalRows = signals.map((s) => ({
    id: s.id,
    cycle: s.cycle,
    stream: s.stream.name,
    category: s.category,
    title: s.title,
    content: s.content,
    features: parseJsonLoose<Record<string, number>>(s.features, {}),
    anomalyScore: s.anomalyScore,
    noveltyScore: s.noveltyScore,
    promoted: s.promoted,
    createdAt: s.createdAt.toISOString(),
  }))

  const hypothesisRows = hypotheses.map((h) => ({
    id: h.id,
    cycle: h.cycle,
    status: h.status,
    generator: h.generator,
    domains: parseJsonLoose<string[]>(h.domains, []),
    title: h.title,
    summary: h.summary,
    novelty: h.novelty,
    impact: h.impact,
    confidence: h.confidence,
    validation: parseJsonLoose<Partial<ValidationStats>>(h.validation, {}) || {},
    counterfactuals: parseJsonLoose<Counterfactual[]>(h.counterfactuals, []),
    sourceSignals: parseJsonLoose<string[]>(h.sourceSignals, []),
    createdAt: h.createdAt.toISOString(),
  }))

  const breakthroughRows = breakthroughs.map((b) => ({
    id: b.id,
    hypothesisId: b.hypothesisId,
    cycle: b.cycle,
    status: b.status,
    solutionType: b.solutionType,
    title: b.title,
    summary: b.summary,
    synthesis: parseJsonLoose<Partial<Synthesis>>(b.synthesis, {}) || {},
    impactRank: b.impactRank,
    riskScore: b.riskScore,
    createdAt: b.createdAt.toISOString(),
  }))

  const governanceRows = governance.map((g) => ({
    id: g.id,
    cycle: g.cycle,
    targetType: g.targetType,
    targetId: g.targetId,
    targetTitle: g.targetTitle,
    riskScore: g.riskScore,
    ethicalFlags: parseJsonLoose<string[]>(g.ethicalFlags, []),
    validationStatus: g.validationStatus,
    humanReview: g.humanReview,
    reviewDecision: g.reviewDecision,
    notes: g.notes,
    createdAt: g.createdAt.toISOString(),
  }))

  const linkRows = links.map((l) => ({
    id: l.id,
    cycle: l.cycle,
    sourceDomain: l.sourceDomain,
    targetDomain: l.targetDomain,
    strength: l.strength,
    mechanism: l.mechanism,
    createdAt: l.createdAt.toISOString(),
  }))

  const metricRows = metrics.map((m) => ({
    id: m.id,
    layer: m.layer,
    key: m.key,
    value: m.value,
    cycle: m.cycle,
    createdAt: m.createdAt.toISOString(),
  }))

  const reportRows = reports.map((r) => ({
    id: r.id,
    cycle: r.cycle,
    reportType: r.reportType,
    title: r.title,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
  }))

  const manifest = [
    'PROMETHEUS snapshot — re-importable JSON arrays',
    '==================================================',
    '',
    `generatedAt  : ${new Date().toISOString()}`,
    `engine cycles: ${cycle}`,
    `engine status: ${engineRow?.status ?? 'unknown'}`,
    `engine config: ${JSON.stringify(engineConfig)}`,
    '',
    'CONTENTS (row counts — every 0N-*.json is {entity, count, rows};',
    'rows are the re-importable JSON arrays, newest-first unless noted)',
    '----------------------------------------------------------------',
    `02-engine.json         engine state singleton + parsed config   1 row`,
    `03-streams.json        Layer 1 domain streams (chronological)   ${streams.length} rows`,
    `04-signals.json        Layer 1/2 raw signals (latest ${SNAPSHOT_LIMITS.signals})     ${signalRows.length} rows`,
    `05-hypotheses.json     Layer 4 hypotheses (latest ${SNAPSHOT_LIMITS.hypotheses})    ${hypothesisRows.length} rows`,
    `06-breakthroughs.json  Layer 5 breakthroughs (latest ${SNAPSHOT_LIMITS.breakthroughs})   ${breakthroughRows.length} rows`,
    `07-governance.json     Layer 7 governance checks (latest ${SNAPSHOT_LIMITS.governance}) ${governanceRows.length} rows`,
    `08-links.json          Layer 3 cross-domain links (latest ${SNAPSHOT_LIMITS.links})   ${linkRows.length} rows`,
    `09-metrics.json        Layer 6 layer metrics (latest ${SNAPSHOT_LIMITS.metrics})    ${metricRows.length} rows`,
    `10-reports.json        Layer 8 insight reports (latest ${SNAPSHOT_LIMITS.reports})     ${reportRows.length} rows`,
    '',
    'COLUMN DICTIONARY NOTE',
    '----------------------',
    'Every JSON-typed column (config, features, domains, validation,',
    'counterfactuals, sourceSignals, synthesis, ethicalFlags) is stored in',
    'SQLite as stringified JSON and has been PARSED back into native JSON in',
    'this snapshot — objects and arrays import as-is, no re-parsing needed.',
    '',
    'Layer map: L1 input universe · L2 preprocessing · L3 cross-domain',
    'analysis · L4 discovery · L5 breakthrough synthesis · L6 self-',
    'optimization · L7 governance · L8 insight output.',
    '',
  ].join('\n')

  const files: SnapshotFile[] = [
    { name: '01-manifest.txt', data: manifest },
    {
      name: '02-engine.json',
      data: JSON.stringify(
        {
          entity: 'engine',
          count: 1,
          rows: [
            {
              id: engineRow?.id ?? 'singleton',
              status: engineRow?.status ?? 'unknown',
              cycles: cycle,
              startedAt: engineRow?.startedAt.toISOString() ?? null,
              lastTickAt: engineRow?.lastTickAt.toISOString() ?? null,
              config: engineConfig,
            },
          ],
        },
        null,
        2,
      ),
    },
    snapshotJson('03-streams.json', streams.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      status: s.status,
      itemsIngested: s.itemsIngested,
      velocity: s.velocity,
      health: s.health,
      createdAt: s.createdAt.toISOString(),
    }))),
    snapshotJson('04-signals.json', signalRows),
    snapshotJson('05-hypotheses.json', hypothesisRows),
    snapshotJson('06-breakthroughs.json', breakthroughRows),
    snapshotJson('07-governance.json', governanceRows),
    snapshotJson('08-links.json', linkRows),
    snapshotJson('09-metrics.json', metricRows),
    snapshotJson('10-reports.json', reportRows),
  ]

  return { files, cycle }
}

/**
 * GET /api/export?type=hypotheses|breakthroughs|signals&format=json|csv
 * Downloads the newest 500 rows of one entity as a JSON document or CSV file.
 * GET /api/export?type=snapshot&format=zip — full-snapshot ZIP bundle
 * (manifest + engine + streams + signals + hypotheses + breakthroughs +
 * governance + links + metrics + reports as re-importable JSON arrays).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') ?? ''
    const format = searchParams.get('format') ?? ''

    if (!(TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        { error: `Invalid type — expected one of: ${TYPES.join(', ')}` },
        { status: 400 },
      )
    }
    if (!(FORMATS as readonly string[]).includes(format)) {
      return NextResponse.json(
        { error: `Invalid format — expected one of: ${FORMATS.join(', ')}` },
        { status: 400 },
      )
    }

    const exportType = type as ExportType
    const exportFormat = format as ExportFormat

    // Full-snapshot bundle — ZIP only, everything else is a 400.
    if (exportType === 'snapshot') {
      if (exportFormat !== 'zip') {
        return NextResponse.json(
          { error: 'Snapshot export requires format=zip (use type=snapshot&format=zip).' },
          { status: 400 },
        )
      }
      const { files, cycle } = await buildSnapshotFiles()
      const zip = createZip(
        files.map((f) => ({ name: f.name, data: f.data, mtime: new Date() })),
      )
      const filename = `prometheus-snapshot-cycle-${String(cycle).padStart(3, '0')}.zip`
      return new NextResponse(new Uint8Array(zip), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    if (exportFormat === 'zip') {
      return NextResponse.json(
        { error: 'format=zip is only supported for type=snapshot.' },
        { status: 400 },
      )
    }

    let body: string
    let rows: Array<Record<string, unknown>> = []

    if (exportType === 'hypotheses') {
      const found = await db.hypothesis.findMany({
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
      })
      rows = found.map((h) => ({
        id: h.id,
        cycle: h.cycle,
        status: h.status,
        generator: h.generator,
        domains: parseJsonLoose<string[]>(h.domains, []),
        title: h.title,
        summary: h.summary,
        novelty: h.novelty,
        impact: h.impact,
        confidence: h.confidence,
        validation: parseJsonLoose<Partial<ValidationStats>>(h.validation, {}) || {},
        counterfactuals: parseJsonLoose<Counterfactual[]>(h.counterfactuals, []),
        createdAt: h.createdAt.toISOString(),
      }))
      if (exportFormat === 'csv') {
        const csvRows = rows.map((h) => {
          const v = { ...DEFAULT_VALIDATION, ...(h.validation as Partial<ValidationStats>) }
          return [
            h.id,
            h.cycle,
            h.status,
            h.generator,
            (h.domains as string[]).join(';'),
            truncate(h.title as string),
            truncate(h.summary as string),
            h.novelty,
            h.impact,
            h.confidence,
            v.simulations,
            v.passed,
            v.failed,
            v.pValue,
            v.effectSize,
            h.createdAt,
          ]
        })
        body = toCsv(csvRows, [
          'id',
          'cycle',
          'status',
          'generator',
          'domains',
          'title',
          'summary',
          'novelty',
          'impact',
          'confidence',
          'simulations',
          'passed',
          'failed',
          'pValue',
          'effectSize',
          'createdAt',
        ])
      } else {
        body = JSON.stringify({ entity: exportType, count: rows.length, rows }, null, 2)
      }
    } else if (exportType === 'breakthroughs') {
      const found = await db.breakthrough.findMany({
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
      })
      rows = found.map((b) => {
        const synthesis = {
          ...DEFAULT_SYNTHESIS,
          ...(parseJsonLoose<Partial<Synthesis>>(b.synthesis, {}) || {}),
        }
        return {
          id: b.id,
          cycle: b.cycle,
          status: b.status,
          solutionType: b.solutionType,
          title: b.title,
          summary: b.summary,
          impactRank: b.impactRank,
          riskScore: b.riskScore,
          components: synthesis.components,
          mechanism: synthesis.mechanism,
          feasibility: synthesis.feasibility,
          expectedGain: synthesis.expectedGain,
          timeHorizon: synthesis.timeHorizon,
          createdAt: b.createdAt.toISOString(),
        }
      })
      if (exportFormat === 'csv') {
        const csvRows = rows.map((b) => [
          b.id,
          b.cycle,
          b.status,
          b.solutionType,
          truncate(b.title as string),
          truncate(b.summary as string),
          b.impactRank,
          b.riskScore,
          b.feasibility,
          b.expectedGain,
          b.timeHorizon,
          b.createdAt,
        ])
        body = toCsv(csvRows, [
          'id',
          'cycle',
          'status',
          'solutionType',
          'title',
          'summary',
          'impactRank',
          'riskScore',
          'feasibility',
          'expectedGain',
          'timeHorizon',
          'createdAt',
        ])
      } else {
        body = JSON.stringify({ entity: exportType, count: rows.length, rows }, null, 2)
      }
    } else {
      const found = await db.rawSignal.findMany({
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
        include: { stream: { select: { name: true } } },
      })
      rows = found.map((s) => ({
        id: s.id,
        cycle: s.cycle,
        stream: s.stream.name,
        category: s.category,
        title: s.title,
        content: s.content,
        anomalyScore: s.anomalyScore,
        noveltyScore: s.noveltyScore,
        features: parseJsonLoose<Record<string, number>>(s.features, {}),
        promoted: s.promoted,
        createdAt: s.createdAt.toISOString(),
      }))
      if (exportFormat === 'csv') {
        const csvRows = rows.map((s) => [
          s.id,
          s.cycle,
          s.stream,
          s.category,
          truncate(s.title as string),
          truncate(s.content as string),
          s.anomalyScore,
          s.noveltyScore,
          s.promoted,
          s.createdAt,
        ])
        body = toCsv(csvRows, [
          'id',
          'cycle',
          'stream',
          'category',
          'title',
          'content',
          'anomalyScore',
          'noveltyScore',
          'promoted',
          'createdAt',
        ])
      } else {
        body = JSON.stringify({ entity: exportType, count: rows.length, rows }, null, 2)
      }
    }

    // Rows are queried newest-first, so the first row carries the latest cycle —
    // stamp the filename with the engine cycle when available, else the date.
    const latestCycle = rows.length > 0 ? Number(rows[0].cycle) || 0 : 0
    const stamp =
      latestCycle > 0
        ? `cycle-${String(latestCycle).padStart(3, '0')}`
        : new Date().toISOString().slice(0, 10)
    const filename = `prometheus-${exportType}-${stamp}.${exportFormat}`

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type':
          exportFormat === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[api/export] export failed:', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
