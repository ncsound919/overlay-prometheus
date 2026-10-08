// ─── Engine core: 8-layer discovery pipeline ─────────────────────────────────
// runTick()  — one full pipeline cycle through all 8 layers.
// getState() — ensureEngine + due-tick (mutex-protected) + full dashboard payload.
//
// Concurrency: a module-level promise mutex (anchored on globalThis so every
// route bundle shares it) guarantees ticks never overlap.

import { db } from '@/lib/db'
import {
  buildAlertReport,
  buildBlindSpotReport,
  buildBreakthroughSummary,
  buildCycleSummary,
  buildGovernanceContent,
  buildSynthesis,
  chance,
  clamp01,
  deriveSolutionType,
  generateTemplateHypotheses,
  isCategory,
  mechanismBetween,
  randInt,
  round2,
  round3,
} from '@/lib/engine/content'
import { generateHypothesesWithLlm } from '@/lib/engine/llm'
import { connectorFor, tokenize, type RawSignalDraft } from '@/lib/engine/connectors'
import type {
  AnalyticsDTO,
  AutoTriagePolicy,
  AutoTriageTier,
  BreakthroughDTO,
  CorrelationDTO,
  Counterfactual,
  EngineConfig,
  EngineConfigPatch,
  EngineStateResponse,
  GovernanceDTO,
  HypothesisDTO,
  LayerKey,
  LayerStatus,
  ReportDTO,
  SignalDTO,
  StreamDTO,
  Synthesis,
  ValidationStats,
} from '@/lib/engine-types'

// ─── Static engine definition ────────────────────────────────────────────────

const ENGINE_ID = 'singleton'

const LAYER_DEFS: ReadonlyArray<{
  layer: number
  key: LayerKey
  name: string
  purpose: string
}> = [
  { layer: 1, key: 'input', name: 'Input Universe', purpose: "Expand the system's vision beyond human bandwidth" },
  { layer: 2, key: 'preprocess', name: 'Preprocessing', purpose: 'Convert raw noise into scored, structured features' },
  { layer: 3, key: 'analysis', name: 'Multi-Domain Analysis', purpose: 'Detect correlations that span scientific disciplines' },
  { layer: 4, key: 'discovery', name: 'Discovery', purpose: 'Generate and stress-test hypotheses at machine scale' },
  { layer: 5, key: 'breakthrough', name: 'Breakthrough Synthesis', purpose: 'Fuse validated knowledge into deployable solutions' },
  { layer: 6, key: 'optimization', name: 'Autonomous Optimization', purpose: "Measure, learn, and patch the engine's own blind spots" },
  { layer: 7, key: 'governance', name: 'Governance', purpose: 'Enforce safety, ethics, and human oversight' },
  { layer: 8, key: 'output', name: 'Insight Output', purpose: 'Publish decision-grade insight to humans' },
]

const LAYER_METRIC_KEYS: Record<LayerKey, readonly string[]> = {
  input: ['ingested', 'streams', 'anomalies'],
  preprocess: ['promoted', 'avgAnomaly', 'avgNovelty'],
  analysis: ['crossLinks', 'velocity', 'acceleration'],
  discovery: ['generated', 'validated'],
  breakthrough: ['synthesized'],
  optimization: ['successRate', 'avgNovelty', 'blindSpotScore'],
  governance: ['checked', 'passed', 'flagged', 'autoTriaged', 'autoTriagedMid'],
  output: ['reportsPublished', 'alerts'],
}

const LAYER_LOAD: Record<LayerKey, { key: string; max: number }> = {
  input: { key: 'ingested', max: 40 },
  preprocess: { key: 'avgAnomaly', max: 1 },
  analysis: { key: 'crossLinks', max: 4 },
  discovery: { key: 'generated', max: 3 },
  breakthrough: { key: 'synthesized', max: 3 },
  optimization: { key: 'successRate', max: 1 },
  governance: { key: 'checked', max: 3 },
  output: { key: 'reportsPublished', max: 3 },
}

const SEED_STREAMS: ReadonlyArray<{ name: string; category: string }> = [
  { name: 'arXiv Preprints', category: 'papers' },
  { name: 'USPTO Patent Feed', category: 'patents' },
  { name: 'ClinicalTrials.gov', category: 'clinical' },
  { name: 'Global Market Ticks', category: 'markets' },
  { name: 'Genomics Repositories', category: 'biology' },
  { name: 'Particle Collider Telemetry', category: 'physics' },
  { name: 'ChemSynth Reaction Libraries', category: 'chemistry' },
  { name: 'Macro-Economic Indicators', category: 'economics' },
  { name: 'IoT Sensor Grids', category: 'sensors' },
  { name: 'Agent-Based Simulation Clusters', category: 'simulation' },
]

const PRUNE_TARGETS = {
  rawSignal: 400,
  crossDomainLink: 120,
  layerMetric: 800,
  insightReport: 60,
  // R6-b: cap applies to DECIDED governance rows only — pending human reviews
  // are never pruned (see pruneGovernance).
  governanceCheck: 80,
} as const

// Governance payload window (R6-b/R6-c): every undecided human-review row is
// pinned into the payload; decided rows fill the remaining slots up to the
// 50-row total. Pending backlog grows ~6/min against a 10-min SLA, so the cap
// must exceed ~60 for breach semantics to ever surface (40 rotated breaches out
// at ~7min age); 120 gives headroom. When pendings ≥ GOV_TOTAL_CAP the decided
// fill is legitimately 0 and the window is all-pending (total = pendings count).
// R8: the newest auto-triaged releases are ALSO pinned (GOV_TRIAGE_PIN) so the
// standing policy stays auditable in the UI/event log at any backlog depth.
// Display order and DTO shape are unchanged.
const GOV_PENDING_CAP = 120
const GOV_TOTAL_CAP = 50
const GOV_TRIAGE_PIN = 3
/** Notes-prefix marker written by the tick-time auto-triage pass (also used as the
 *  payload-pin filter and the UI's AUTO-tag detector — keep all three in sync). */
const GOV_TRIAGE_NOTE_PREFIX = 'AUTO-TRIAGE'
/** Tier 2 (mid-risk valve) marker — starts with the tier-1 prefix so existing
 *  `startsWith(AUTO-TRIAGE)` detectors still match; the UI reads the suffix
 *  to render the distinct AUTO·MID tag. */
const GOV_TRIAGE_MID_NOTE_PREFIX = 'AUTO-TRIAGE·MID'

const ANOMALY_THRESHOLD = 0.75

// ─── Tick result ─────────────────────────────────────────────────────────────

export interface TickResult {
  cycle: number
  signals: number
  anomalies: number
  promoted: number
  crossLinks: number
  hypotheses: number
  validated: number
  rejected: number
  breakthroughs: number
  governed: number
  flagged: number
  autoTriaged: number
  autoTriagedMid: number
  reports: number
  llmUsed: boolean
  durationMs: number
}

// ─── Global tick mutex (survives per-route bundling) ─────────────────────────

interface TickMutex {
  promise: Promise<TickResult> | null
}

const globalForEngine = globalThis as unknown as { __discoveryEngineTickMutex?: TickMutex }
const tickMutex: TickMutex = globalForEngine.__discoveryEngineTickMutex ?? { promise: null }
globalForEngine.__discoveryEngineTickMutex = tickMutex

/** Runs one tick; if a tick is already in flight, callers await that same promise. */
export async function runTickSerialized(): Promise<TickResult> {
  if (tickMutex.promise) return tickMutex.promise
  const p = runTick().finally(() => {
    tickMutex.promise = null
  })
  tickMutex.promise = p
  return p
}

// ─── Config handling ─────────────────────────────────────────────────────────

// Auto-triage clamps: floor 0.35 = the auto-pass threshold (policy only touches
// rows that DID require human review), ceiling 0.6 = the HIGH-risk tier start
// (HIGH rows always keep their human). Age 1–120min keeps the policy from
// instant-releasing fresh rows (defeats the review) or hoarding them forever.
const AUTO_TRIAGE_RISK_MIN = 0.35
const AUTO_TRIAGE_RISK_MAX = 0.6
const AUTO_TRIAGE_AGE_MIN = 1
const AUTO_TRIAGE_AGE_MAX = 120
// Tier 2 (mid-risk valve) clamps: the band is strictly ABOVE tier 1's ceiling
// at query time (risk > policy.maxRisk ∧ risk ≤ midRisk.maxRisk), so its own
// ceiling floor is 0.4 and its age floor starts at 15m — this valve is meant
// for aged debt, not fresh rows. Age ceiling 240m keeps it semantically
// distinct from "the human will get to it".
const MID_RISK_MIN = 0.4
const MID_RISK_MAX = 0.6
const MID_AGE_MIN = 15
const MID_AGE_MAX = 240

function parseMidRisk(raw: unknown, tier1MaxRisk: number): AutoTriageTier {
  const tier: AutoTriageTier = { enabled: false, maxRisk: 0.6, afterMinutes: 60 }
  if (typeof raw !== 'object' || raw === null) return tier
  const rec = raw as Record<string, unknown>
  if (typeof rec.enabled === 'boolean') tier.enabled = rec.enabled
  if (typeof rec.maxRisk === 'number' && Number.isFinite(rec.maxRisk)) {
    tier.maxRisk = Math.min(MID_RISK_MAX, Math.max(MID_RISK_MIN, rec.maxRisk))
  }
  if (typeof rec.afterMinutes === 'number' && Number.isFinite(rec.afterMinutes)) {
    tier.afterMinutes = Math.min(MID_AGE_MAX, Math.max(MID_AGE_MIN, Math.round(rec.afterMinutes)))
  }
  // Band coherence: an upper bound below tier 1's ceiling yields an empty band
  // — clamp up so the UI never shows a misleading negative range.
  if (tier.maxRisk < tier1MaxRisk) tier.maxRisk = Math.min(MID_RISK_MAX, tier1MaxRisk)
  return tier
}

function parseAutoTriage(raw: unknown): AutoTriagePolicy {
  const policy: AutoTriagePolicy = {
    enabled: false,
    maxRisk: 0.45,
    afterMinutes: 15,
    midRisk: { enabled: false, maxRisk: 0.6, afterMinutes: 60 },
  }
  if (typeof raw !== 'object' || raw === null) return policy
  const rec = raw as Record<string, unknown>
  if (typeof rec.enabled === 'boolean') policy.enabled = rec.enabled
  if (typeof rec.maxRisk === 'number' && Number.isFinite(rec.maxRisk)) {
    policy.maxRisk = Math.min(AUTO_TRIAGE_RISK_MAX, Math.max(AUTO_TRIAGE_RISK_MIN, rec.maxRisk))
  }
  if (typeof rec.afterMinutes === 'number' && Number.isFinite(rec.afterMinutes)) {
    policy.afterMinutes = Math.min(AUTO_TRIAGE_AGE_MAX, Math.max(AUTO_TRIAGE_AGE_MIN, Math.round(rec.afterMinutes)))
  }
  policy.midRisk = parseMidRisk(rec.midRisk, policy.maxRisk)
  return policy
}

export function parseConfig(raw: string | null | undefined): EngineConfig {
  const config: EngineConfig = {
    tickIntervalMs: 6000,
    llmDiscovery: true,
    aggression: 0.7,
    autoTriage: {
      enabled: false,
      maxRisk: 0.45,
      afterMinutes: 15,
      midRisk: { enabled: false, maxRisk: 0.6, afterMinutes: 60 },
    },
  }
  if (!raw) return config
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return config
    const rec = parsed as Record<string, unknown>
    if (typeof rec.tickIntervalMs === 'number' && Number.isFinite(rec.tickIntervalMs)) {
      config.tickIntervalMs = Math.min(120_000, Math.max(2_000, Math.round(rec.tickIntervalMs)))
    }
    if (typeof rec.llmDiscovery === 'boolean') config.llmDiscovery = rec.llmDiscovery
    if (typeof rec.aggression === 'number' && Number.isFinite(rec.aggression)) {
      config.aggression = Math.min(1, Math.max(0, rec.aggression))
    }
    config.autoTriage = parseAutoTriage(rec.autoTriage)
    return config
  } catch {
    return config
  }
}

function sanitizeConfigPatch(patch: EngineConfigPatch): EngineConfigPatch {
  const out: EngineConfigPatch = {}
  if (typeof patch.tickIntervalMs === 'number' && Number.isFinite(patch.tickIntervalMs)) {
    out.tickIntervalMs = Math.min(120_000, Math.max(2_000, Math.round(patch.tickIntervalMs)))
  }
  if (typeof patch.llmDiscovery === 'boolean') out.llmDiscovery = patch.llmDiscovery
  if (typeof patch.aggression === 'number' && Number.isFinite(patch.aggression)) {
    out.aggression = Math.min(1, Math.max(0, patch.aggression))
  }
  if (typeof patch.autoTriage === 'object' && patch.autoTriage !== null) {
    // Field-by-field merge happens in mergeConfig; here we only sanitize.
    const p = parseAutoTriage({ ...patch.autoTriage })
    const partial: Partial<AutoTriagePolicy> = {}
    if (typeof patch.autoTriage.enabled === 'boolean') partial.enabled = p.enabled
    if (typeof patch.autoTriage.maxRisk === 'number' && Number.isFinite(patch.autoTriage.maxRisk)) {
      partial.maxRisk = p.maxRisk
    }
    if (typeof patch.autoTriage.afterMinutes === 'number' && Number.isFinite(patch.autoTriage.afterMinutes)) {
      partial.afterMinutes = p.afterMinutes
    }
    if (typeof patch.autoTriage.midRisk === 'object' && patch.autoTriage.midRisk !== null) {
      partial.midRisk = p.midRisk
    }
    out.autoTriage = partial
  }
  return out
}

export async function mergeConfig(patch: EngineConfigPatch): Promise<EngineConfig> {
  const state = await ensureEngine()
  const current = parseConfig(state.config)
  const sanitized = sanitizeConfigPatch(patch)
  const { autoTriage: autoTriagePatch, ...rest } = sanitized
  const next: EngineConfig = {
    ...current,
    ...rest,
    autoTriage: { ...current.autoTriage, ...(autoTriagePatch ?? {}) },
  }
  await db.engineState.update({ where: { id: ENGINE_ID }, data: { config: JSON.stringify(next) } })
  return next
}

// ─── Singleton + seeding ─────────────────────────────────────────────────────

export async function ensureEngine() {
  const state = await db.engineState.upsert({
    where: { id: ENGINE_ID },
    update: {},
    create: { id: ENGINE_ID, status: 'running' },
  })

  const streamCount = await db.domainStream.count()
  if (streamCount === 0) {
    await db.domainStream.createMany({
      data: SEED_STREAMS.map((s) => ({ name: s.name, category: s.category, status: 'active' })),
    })
  }

  return state
}

/** Deletes every engine data row (keeps the singleton EngineState) and re-seeds. */
export async function resetEngine(): Promise<void> {
  // RawSignal must be cleared before DomainStream (foreign key).
  await db.rawSignal.deleteMany()
  await db.crossDomainLink.deleteMany()
  await db.layerMetric.deleteMany()
  await db.insightReport.deleteMany()
  await db.governanceCheck.deleteMany()
  await db.hypothesis.deleteMany()
  await db.breakthrough.deleteMany()
  await db.domainStream.deleteMany()
  await db.engineState.update({
    where: { id: ENGINE_ID },
    data: { cycles: 0, lastTickAt: new Date(0) },
  })
  await ensureEngine()
}

// ─── JSON parse helpers (typed, defensive) ───────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function parseNumberRecord(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function parseCounterfactuals(raw: string | null | undefined): Counterfactual[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: Counterfactual[] = []
    for (const item of parsed) {
      if (!isRecord(item)) continue
      if (typeof item.question !== 'string' || typeof item.result !== 'string') continue
      out.push({
        question: item.question,
        result: item.result,
        supports: item.supports === true,
      })
    }
    return out
  } catch {
    return []
  }
}

function parseValidation(raw: string | null | undefined): ValidationStats {
  const empty: ValidationStats = { simulations: 0, passed: 0, failed: 0, pValue: null, effectSize: null }
  if (!raw) return empty
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return empty
    return {
      simulations: Math.max(0, Math.round(numOr(parsed.simulations, 0))),
      passed: Math.max(0, Math.round(numOr(parsed.passed, 0))),
      failed: Math.max(0, Math.round(numOr(parsed.failed, 0))),
      // No statistical test is run: only accept a numeric p-value if one was
      // genuinely recorded, otherwise null. Never coerce to a default.
      pValue: typeof parsed.pValue === 'number' ? clamp01(parsed.pValue) : null,
      effectSize: typeof parsed.effectSize === 'number' ? parsed.effectSize : null,
    }
  } catch {
    return empty
  }
}

function parseSynthesis(raw: string | null | undefined): Synthesis {
  const fallback: Synthesis = {
    components: [],
    mechanism: '',
    feasibility: 0,
    expectedGain: '',
    timeHorizon: '',
  }
  if (!raw) return fallback
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return fallback
    return {
      components: Array.isArray(parsed.components)
        ? parsed.components.filter((v): v is string => typeof v === 'string')
        : [],
      mechanism: typeof parsed.mechanism === 'string' ? parsed.mechanism : '',
      feasibility: clamp01(numOr(parsed.feasibility, 0)),
      expectedGain: typeof parsed.expectedGain === 'string' ? parsed.expectedGain : '',
      timeHorizon: typeof parsed.timeHorizon === 'string' ? parsed.timeHorizon : '',
    }
  } catch {
    return fallback
  }
}

// ─── Layer 1 + 2: ingest & score ─────────────────────────────────────────────

interface IngestSummary {
  ingested: number
  streams: number
  anomalies: number
  promoted: number
  avgAnomaly: number
  avgNovelty: number
  /** Real per-category counts of the signals ingested this cycle. */
  categoryCounts: Record<string, number>
}

async function runInputLayers(cycle: number): Promise<IngestSummary> {
  const streams = await db.domainStream.findMany({ where: { status: 'active' } })

  // Known titles for lexical novelty: what the engine has already ingested.
  const recent = await db.rawSignal.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { title: true },
  })
  const knownTitles: string[] = recent.map((r) => r.title)

  const signals: Array<{
    streamId: string
    category: string
    title: string
    content: string
    features: string
    anomalyScore: number
    noveltyScore: number
    cycle: number
    promoted: boolean
  }> = []
  const perStreamCounts: Array<{ id: string; count: number; velocity: number; health: number }> = []

  for (const stream of streams) {
    const connector = connectorFor(stream.category)
    let drafts: RawSignalDraft[] = []
    if (connector) {
      try {
        drafts = await connector.fetch(randInt(2, 6), { knownTitles })
      } catch (err) {
        // Fail closed: a connector error means this stream ingests nothing this
        // cycle. Synthetic filler is never substituted for a failed fetch.
        console.error(
          `[input] connector "${stream.category}" failed:`,
          err instanceof Error ? err.message : err,
        )
        drafts = []
      }
    }

    for (const d of drafts) {
      signals.push({
        streamId: stream.id,
        category: stream.category,
        title: d.title,
        content: d.content,
        features: JSON.stringify(d.features),
        anomalyScore: d.anomalyScore,
        noveltyScore: d.noveltyScore,
        cycle,
        promoted: false,
      })
      knownTitles.push(d.title)
    }

    const count = drafts.length
    // Layer 1 stream bookkeeping: velocity is an EWMA of batch pressure.
    perStreamCounts.push({
      id: stream.id,
      count,
      velocity: round3(clamp01(stream.velocity * 0.6 + (count / 6) * 0.4)),
      // Health reflects real ingestion. A stream with no live connector cannot
      // claim health from data it never received, so it is capped below full.
      health: connector
        ? round3(clamp01(stream.health * 0.7 + (count > 0 ? 1 : 0) * 0.3))
        : round3(Math.min(stream.health, 0.5)),
    })
  }

  // Layer 2: promote the top anomalies (cap 3/cycle; always promote at least one).
  const order = signals
    .map((s, i) => ({ i, score: s.anomalyScore }))
    .sort((a, b) => b.score - a.score)
  let promotedCount = 0
  for (const { i, score } of order) {
    if (promotedCount >= 3 || score < 0.8) break
    signals[i].promoted = true
    promotedCount++
  }
  if (promotedCount === 0 && order.length > 0) {
    signals[order[0].i].promoted = true
    promotedCount = 1
  }

  if (signals.length > 0) await db.rawSignal.createMany({ data: signals })
  for (const s of perStreamCounts) {
    await db.domainStream.update({
      where: { id: s.id },
      data: {
        itemsIngested: { increment: s.count },
        velocity: s.velocity,
        health: s.health,
      },
    })
  }

  const anomalyScores = signals.map((s) => s.anomalyScore)
  const noveltyScores = signals.map((s) => s.noveltyScore)
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

  const categoryCounts: Record<string, number> = {}
  for (const s of signals) categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1

  return {
    ingested: signals.length,
    streams: streams.length,
    anomalies: anomalyScores.filter((v) => v >= ANOMALY_THRESHOLD).length,
    promoted: promotedCount,
    avgAnomaly: round3(avg(anomalyScores)),
    avgNovelty: round3(avg(noveltyScores)),
    categoryCounts,
  }
}

// ─── Layer 4: discovery ──────────────────────────────────────────────────────

interface CandidateHypothesis {
  title: string
  summary: string
  domains: string[]
  novelty: number
  impact: number
  confidence: number
  counterfactuals: Counterfactual[]
}

interface DiscoveredHypothesis {
  id: string
  data: CandidateHypothesis
  validation: ValidationStats
  status: 'testing' | 'validated' | 'rejected'
}

/**
 * Real, inspectable evidence assessment — NOT statistical validation.
 *
 * This engine generates a hypothesis FROM a set of fetched signals, so keyword
 * overlap between the hypothesis and those signals is contextual, not
 * confirmation. We therefore record honest counts (how many real signals were
 * considered and how many share informative terms) and set `pValue`/`effectSize`
 * to null: no test is run, so no p-value is reported. The hypothesis status
 * stays `testing`; a hypothesis only becomes `validated` through a real,
 * external test, which this engine does not perform.
 */
function assessEvidence(
  h: CandidateHypothesis,
  sourceSignalTitles: string[],
): { validation: ValidationStats; status: 'testing' | 'validated' | 'rejected' } {
  const hypTokens = new Set(tokenize(`${h.title} ${h.summary}`))
  let supporting = 0
  for (const title of sourceSignalTitles) {
    const shared = tokenize(title).filter((t) => hypTokens.has(t)).length
    if (shared >= 2) supporting++
  }
  const considered = sourceSignalTitles.length
  return {
    validation: {
      simulations: considered,
      passed: supporting,
      failed: Math.max(0, considered - supporting),
      pValue: null,
      effectSize: null,
    },
    status: 'testing',
  }
}

async function runDiscoveryLayer(
  cycle: number,
  llmDiscovery: boolean,
): Promise<{ hypotheses: DiscoveredHypothesis[]; llmUsed: boolean }> {
  const hot = await db.rawSignal.findMany({
    where: {
      cycle: { gte: cycle - 1 },
      OR: [{ promoted: true }, { anomalyScore: { gte: ANOMALY_THRESHOLD } }],
    },
    orderBy: { anomalyScore: 'desc' },
    take: 8,
  })

  let candidates: CandidateHypothesis[] = []
  let llmUsed = false

  if (llmDiscovery && hot.length > 0) {
    const llm = await generateHypothesesWithLlm(hot.map((s) => s.title))
    if (llm && llm.length > 0) {
      candidates = llm
      llmUsed = true
    }
  }
  if (candidates.length === 0) {
    const categories = hot.map((s) => s.category)
    candidates = generateTemplateHypotheses(categories, randInt(2, 3))
  }

  const sourceSignals = hot.slice(0, 4).map((s) => s.title)

  const created = await Promise.all(
    candidates.map(async (c) => {
      const row = await db.hypothesis.create({
        data: {
          title: c.title.slice(0, 300),
          summary: c.summary.slice(0, 2000),
          domains: JSON.stringify(c.domains),
          novelty: c.novelty,
          impact: c.impact,
          confidence: c.confidence,
          status: 'testing',
          counterfactuals: JSON.stringify(c.counterfactuals),
          sourceSignals: JSON.stringify(sourceSignals),
          generator: llmUsed ? 'llm' : 'template',
          cycle,
        },
      })
      return row
    }),
  )

  const hypotheses: DiscoveredHypothesis[] = []
  for (let i = 0; i < created.length; i++) {
    const { validation, status } = assessEvidence(candidates[i], sourceSignals)
    await db.hypothesis.update({ where: { id: created[i].id }, data: { status, validation: JSON.stringify(validation) } })
    hypotheses.push({ id: created[i].id, data: candidates[i], validation, status })
  }

  return { hypotheses, llmUsed }
}

// ─── Pruning (best-effort, never blocks a tick) ──────────────────────────────

async function pruneTable(
  findRecent: (take: number, skip: number) => Promise<Array<{ createdAt: Date }>>,
  deleteOlderThan: (createdAt: Date) => Promise<unknown>,
  keep: number,
): Promise<void> {
  try {
    const rows = await findRecent(1, keep - 1)
    if (rows.length === 0) return
    await deleteOlderThan(rows[0].createdAt)
  } catch (error) {
    console.error('[engine/core] prune failed:', error)
  }
}

async function pruneAll(): Promise<void> {
  await pruneTable(
    (take, skip) => db.rawSignal.findMany({ orderBy: { createdAt: 'desc' }, take, skip, select: { createdAt: true } }),
    (createdAt) => db.rawSignal.deleteMany({ where: { createdAt: { lt: createdAt } } }),
    PRUNE_TARGETS.rawSignal,
  )
  await pruneTable(
    (take, skip) => db.crossDomainLink.findMany({ orderBy: { createdAt: 'desc' }, take, skip, select: { createdAt: true } }),
    (createdAt) => db.crossDomainLink.deleteMany({ where: { createdAt: { lt: createdAt } } }),
    PRUNE_TARGETS.crossDomainLink,
  )
  await pruneTable(
    (take, skip) => db.layerMetric.findMany({ orderBy: { createdAt: 'desc' }, take, skip, select: { createdAt: true } }),
    (createdAt) => db.layerMetric.deleteMany({ where: { createdAt: { lt: createdAt } } }),
    PRUNE_TARGETS.layerMetric,
  )
  await pruneTable(
    (take, skip) => db.insightReport.findMany({ orderBy: { createdAt: 'desc' }, take, skip, select: { createdAt: true } }),
    (createdAt) => db.insightReport.deleteMany({ where: { createdAt: { lt: createdAt } } }),
    PRUNE_TARGETS.insightReport,
  )
  await pruneGovernance()
}

/**
 * Governance prune (R6-b) — pending human reviews are NEVER deleted. A
 * undecided humanReview row must stay in the DB until a human decides;
 * pruning it silently killed SLA timers, breach event lines, escalation
 * toasts and the footer pending count. The PRUNE_TARGETS.governanceCheck cap
 * therefore applies to decided rows only: keep the newest 80 decided rows,
 * delete older decided rows (pending rows sharing that age window survive —
 * the delete is filtered to decided rows too).
 */
async function pruneGovernance(): Promise<void> {
  try {
    const decided = { OR: [{ reviewDecision: { not: null } }, { humanReview: false }] }
    const rows = await db.governanceCheck.findMany({
      where: decided,
      orderBy: { createdAt: 'desc' },
      skip: PRUNE_TARGETS.governanceCheck - 1,
      take: 1,
      select: { createdAt: true },
    })
    if (rows.length === 0) return
    await db.governanceCheck.deleteMany({
      where: { createdAt: { lt: rows[0].createdAt }, ...decided },
    })
  } catch (error) {
    console.error('[engine/core] governance prune failed:', error)
  }
}

// ─── runTick: the full 8-layer pipeline ──────────────────────────────────────

async function runTick(): Promise<TickResult> {
  const startedAt = Date.now()
  const state = await ensureEngine()
  const config = parseConfig(state.config)
  const cycle = state.cycles + 1

  // ── Layer 1 + 2: INPUT UNIVERSE + PREPROCESSING ──
  const ingest = await runInputLayers(cycle)
  const metricWrites: Array<{ layer: number; key: string; value: number }> = [
    { layer: 1, key: 'ingested', value: ingest.ingested },
    { layer: 1, key: 'streams', value: ingest.streams },
    { layer: 1, key: 'anomalies', value: ingest.anomalies },
    { layer: 2, key: 'promoted', value: ingest.promoted },
    { layer: 2, key: 'avgAnomaly', value: ingest.avgAnomaly },
    { layer: 2, key: 'avgNovelty', value: ingest.avgNovelty },
  ]

  // ── Layer 3: MULTI-DOMAIN ANALYSIS ──
  // Links are derived from real co-occurrence of categories among this cycle's
  // ingested signals. No random pairing and no random strength.
  const categories = Object.keys(ingest.categoryCounts).filter(isCategory)
  let linkCount = 0
  for (let i = 0; i < categories.length; i++) {
    for (let j = i + 1; j < categories.length; j++) {
      const source = categories[i]
      const target = categories[j]
      const coOccurrence = Math.min(ingest.categoryCounts[source], ingest.categoryCounts[target])
      const strength = round3(clamp01(coOccurrence / Math.max(1, ingest.ingested)))
      await db.crossDomainLink.create({
        data: {
          sourceDomain: source,
          targetDomain: target,
          strength,
          mechanism: mechanismBetween(source, target),
          cycle,
        },
      })
      linkCount++
    }
  }
  // Velocity is the real linked-share of this cycle's signals; acceleration is
  // the change against the previous cycle's recorded velocity (0 if none yet).
  const velocity = round3(clamp01(linkCount / Math.max(1, ingest.ingested)))
  const priorVelocityRow = await db.layerMetric.findFirst({
    where: { layer: 3, key: 'velocity' },
    orderBy: { createdAt: 'desc' },
    select: { value: true },
  })
  const priorVelocity = priorVelocityRow?.value ?? 0
  const acceleration = round3(velocity - priorVelocity)
  metricWrites.push(
    { layer: 3, key: 'crossLinks', value: linkCount },
    { layer: 3, key: 'velocity', value: velocity },
    { layer: 3, key: 'acceleration', value: acceleration },
  )

  // ── Layer 4: DISCOVERY (LLM-enhanced, template fallback) ──
  // Status stays `testing`: this engine assesses context, it does not validate.
  const { hypotheses, llmUsed } = await runDiscoveryLayer(cycle, config.llmDiscovery)
  const validated = hypotheses.filter((h) => h.status === 'validated')
  metricWrites.push(
    { layer: 4, key: 'generated', value: hypotheses.length },
    { layer: 4, key: 'validated', value: validated.length },
  )

  // ── Layer 5: BREAKTHROUGH SYNTHESIS ──
  const newBreakthroughs: Array<{
    id: string
    title: string
    solutionType: string
    impactRank: number
    gov: ReturnType<typeof buildGovernanceContent>
  }> = []
  for (const h of validated) {
    if (h.data.impact < 0.6) continue
    const solutionType = deriveSolutionType(h.data.domains)
    const synthesis = buildSynthesis(solutionType, h.data.domains)
    const impactRank = round3(h.data.impact * 0.7 + h.data.novelty * 0.3)
    const gov = buildGovernanceContent(solutionType, h.data.domains)
    const breakthrough = await db.breakthrough.create({
      data: {
        hypothesisId: h.id,
        title: h.data.title.slice(0, 300),
        solutionType,
        summary: buildBreakthroughSummary(solutionType, synthesis),
        synthesis: JSON.stringify(synthesis),
        impactRank,
        riskScore: gov.riskScore,
        status: 'synthesized',
        cycle,
      },
    })
    newBreakthroughs.push({
      id: breakthrough.id,
      title: breakthrough.title,
      solutionType,
      impactRank,
      gov,
    })
    await db.hypothesis.update({ where: { id: h.id }, data: { status: 'promoted' } })
  }
  metricWrites.push({ layer: 5, key: 'synthesized', value: newBreakthroughs.length })

  // ── Layer 6: AUTONOMOUS OPTIMIZATION ──
  const successRate = hypotheses.length > 0 ? round3(validated.length / hypotheses.length) : 0
  // Real blind-spot proxy: the share of possible cross-domain pairs that did not
  // link this cycle. 1.0 when there is not enough real variation to link.
  const pairTotal = categories.length >= 2 ? (categories.length * (categories.length - 1)) / 2 : 0
  const blindSpotScore = pairTotal > 0 ? round3(clamp01(1 - linkCount / pairTotal)) : 1
  metricWrites.push(
    { layer: 6, key: 'successRate', value: successRate },
    { layer: 6, key: 'avgNovelty', value: ingest.avgNovelty },
    { layer: 6, key: 'blindSpotScore', value: blindSpotScore },
  )

  // ── Layer 7: GOVERNANCE ──
  let governed = 0
  let flagged = 0
  for (const bt of newBreakthroughs) {
    const passed = bt.gov.riskScore < 0.35
    await db.governanceCheck.create({
      data: {
        targetType: 'breakthrough',
        targetId: bt.id,
        targetTitle: bt.title,
        riskScore: bt.gov.riskScore,
        ethicalFlags: JSON.stringify(bt.gov.ethicalFlags),
        validationStatus: passed ? 'passed' : 'flagged',
        humanReview: !passed,
        notes: bt.gov.notes,
        cycle,
      },
    })
    if (passed) {
      governed++
      await db.breakthrough.update({ where: { id: bt.id }, data: { status: 'governed' } })
    } else {
      flagged++
    }
  }
  metricWrites.push(
    { layer: 7, key: 'checked', value: newBreakthroughs.length },
    { layer: 7, key: 'passed', value: governed },
    { layer: 7, key: 'flagged', value: flagged },
  )

  // ── Layer 7 · STANDING AUTO-TRIAGE POLICY ──
  // Operator-configured release valve: pending human reviews older than
  // afterMinutes with riskScore ≤ maxRisk are approved automatically
  // (target breakthrough → deployed, mirroring the single-review route).
  // Notes carry an AUTO-TRIAGE marker so the UI can tag the decision origin.
  let autoTriaged = 0
  if (config.autoTriage.enabled) {
    const policy = config.autoTriage
    const cutoff = new Date(Date.now() - policy.afterMinutes * 60_000)
    const stale = await db.governanceCheck.findMany({
      where: {
        humanReview: true,
        reviewDecision: null,
        riskScore: { lte: policy.maxRisk },
        createdAt: { lte: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: 60,
      select: { id: true, targetType: true, targetId: true, notes: true },
    })
    for (const check of stale) {
      await db.governanceCheck.update({
        where: { id: check.id },
        data: {
          reviewDecision: 'approved',
          validationStatus: 'approved',
          humanReview: false,
          notes: `${GOV_TRIAGE_NOTE_PREFIX} ▸ risk ≤ ${policy.maxRisk.toFixed(2)} ∧ age ≥ ${policy.afterMinutes}m — released by standing policy. ${check.notes ?? ''}`.trim(),
        },
      })
      if (check.targetType === 'breakthrough') {
        // updateMany (not update): never throws if the target was pruned mid-flight.
        await db.breakthrough.updateMany({
          where: { id: check.targetId },
          data: { status: 'deployed' },
        })
      }
      autoTriaged++
    }
    if (autoTriaged > 0) {
      metricWrites.push({ layer: 7, key: 'autoTriaged', value: autoTriaged })
    }
  }

  // ── Layer 7 · TIER 2 · MID-RISK STANDING VALVE (optional) ──
  // Second release valve for the band the tier-1 policy can never reach:
  // policy.maxRisk < riskScore ≤ midRisk.maxRisk, aged past midRisk.afterMinutes.
  // This is the band that otherwise accumulates forever (R10 finding: ~250 rows
  // stuck at 0.45 < risk ≤ 0.6). Still capped below the HIGH tier — HIGH rows
  // always keep their human. Notes carry AUTO-TRIAGE·MID (startsWith the tier-1
  // prefix so payload-pin + tag detectors keep working).
  let autoTriagedMid = 0
  if (config.autoTriage.enabled && config.autoTriage.midRisk.enabled) {
    const mid = config.autoTriage.midRisk
    const cutoffMid = new Date(Date.now() - mid.afterMinutes * 60_000)
    const staleMid = await db.governanceCheck.findMany({
      where: {
        humanReview: true,
        reviewDecision: null,
        riskScore: { gt: config.autoTriage.maxRisk, lte: mid.maxRisk },
        createdAt: { lte: cutoffMid },
      },
      orderBy: { createdAt: 'asc' },
      take: 40,
      select: { id: true, targetType: true, targetId: true, notes: true },
    })
    for (const check of staleMid) {
      await db.governanceCheck.update({
        where: { id: check.id },
        data: {
          reviewDecision: 'approved',
          validationStatus: 'approved',
          humanReview: false,
          notes: `${GOV_TRIAGE_MID_NOTE_PREFIX} ▸ ${config.autoTriage.maxRisk.toFixed(2)} < risk ≤ ${mid.maxRisk.toFixed(2)} ∧ age ≥ ${mid.afterMinutes}m — released by standing mid-risk policy. ${check.notes ?? ''}`.trim(),
        },
      })
      if (check.targetType === 'breakthrough') {
        await db.breakthrough.updateMany({
          where: { id: check.targetId },
          data: { status: 'deployed' },
        })
      }
      autoTriagedMid++
    }
    if (autoTriagedMid > 0) {
      metricWrites.push({ layer: 7, key: 'autoTriagedMid', value: autoTriagedMid })
    }
  }

  // ── Layer 8: INSIGHT OUTPUT ──
  // cycle-summary every cycle + alerts (impactRank > 0.8) + blind-spot deep-dive (10%)
  const reports: Array<{ title: string; reportType: string; content: string }> = [
    {
      title: `Cycle ${cycle} Summary`,
      reportType: 'cycle-summary',
      content: buildCycleSummary({
        cycle,
        signals: ingest.ingested,
        anomalies: ingest.anomalies,
        hypotheses: hypotheses.length,
        validated: validated.length,
        breakthroughs: newBreakthroughs.length,
        governed,
        flagged,
      }),
    },
  ]
  for (const bt of newBreakthroughs) {
    if (bt.impactRank > 0.8) {
      const alert = buildAlertReport({
        title: bt.title,
        impactRank: bt.impactRank,
        solutionType: bt.solutionType,
        riskScore: bt.gov.riskScore,
        status: bt.gov.riskScore < 0.35 ? 'passed' : 'flagged',
      })
      reports.push({ ...alert, reportType: 'alert' })
    }
  }
  if (chance(0.1)) {
    const weakest = await db.domainStream.findFirst({ orderBy: { health: 'asc' } })
    if (weakest) {
      const deepDive = buildBlindSpotReport({
        cycle,
        streamName: weakest.name,
        health: weakest.health,
        velocity: weakest.velocity,
        successRate,
      })
      reports.push({ ...deepDive, reportType: 'deep-dive' })
    }
  }

  const persistedReports = await Promise.all(
    reports.map((r) =>
      db.insightReport.create({
        data: { title: r.title, reportType: r.reportType, content: r.content, cycle },
      }),
    ),
  )
  const alertCount = persistedReports.filter((r) => r.reportType === 'alert').length
  metricWrites.push(
    { layer: 8, key: 'reportsPublished', value: persistedReports.length },
    { layer: 8, key: 'alerts', value: alertCount },
  )

  // Persist all layer metrics.
  await db.layerMetric.createMany({ data: metricWrites.map((m) => ({ ...m, cycle })) })

  // Close the cycle.
  await db.engineState.update({
    where: { id: ENGINE_ID },
    data: { cycles: cycle, lastTickAt: new Date() },
  })

  // Prune (best-effort) to keep the SQLite file small.
  await pruneAll()

  const result: TickResult = {
    cycle,
    signals: ingest.ingested,
    anomalies: ingest.anomalies,
    promoted: ingest.promoted,
    crossLinks: linkCount,
    hypotheses: hypotheses.length,
    validated: validated.length,
    rejected: hypotheses.length - validated.length,
    breakthroughs: newBreakthroughs.length,
    governed,
    flagged,
    autoTriaged,
    autoTriagedMid,
    reports: persistedReports.length,
    llmUsed,
    durationMs: Date.now() - startedAt,
  }
  console.log(
    `[engine/core] cycle ${cycle} done in ${result.durationMs}ms — signals=${result.signals} ` +
      `hypotheses=${result.hypotheses} (validated=${result.validated}) breakthroughs=${result.breakthroughs} ` +
      `llm=${result.llmUsed ? 'on' : 'off'}`,
  )
  return result
}

// ─── getState: dashboard payload assembly ────────────────────────────────────

interface LayerMetricBundle {
  metrics: Record<string, number>
  hasActivity: boolean
}

function buildLayers(
  engineStatus: string,
  latestCycle: number,
  byLayer: Map<number, Record<string, number>>,
): LayerStatus[] {
  return LAYER_DEFS.map((def) => {
    const metrics: Record<string, number> = {}
    for (const key of LAYER_METRIC_KEYS[def.key]) {
      metrics[key] = round2(byLayer.get(def.layer)?.[key] ?? 0)
    }
    const hasActivity = byLayer.has(def.layer) && latestCycle > 0
    const loadCfg = LAYER_LOAD[def.key]
    const load = clamp01((byLayer.get(def.layer)?.[loadCfg.key] ?? 0) / loadCfg.max)
    const state: LayerStatus['state'] =
      engineStatus !== 'running' ? 'blocked' : hasActivity ? 'active' : 'idle'
    return {
      layer: def.layer,
      key: def.key,
      name: def.name,
      purpose: def.purpose,
      state,
      load: round2(load),
      metrics,
    }
  })
}

async function buildAnalytics(): Promise<AnalyticsDTO> {
  const [perCycleAll, perCycleAnom, byCategory] = await Promise.all([
    db.rawSignal.groupBy({ by: ['cycle'], _count: { _all: true } }),
    db.rawSignal.groupBy({ by: ['cycle'], _count: { _all: true }, where: { anomalyScore: { gte: ANOMALY_THRESHOLD } } }),
    db.rawSignal.groupBy({ by: ['category'], _count: { _all: true } }),
  ])

  const anomalyByCycle = new Map<number, number>()
  for (const row of perCycleAnom) anomalyByCycle.set(row.cycle, row._count._all)
  const signalsPerCycle = perCycleAll
    .map((row) => ({
      cycle: row.cycle,
      signals: row._count._all,
      anomalies: anomalyByCycle.get(row.cycle) ?? 0,
    }))
    .sort((a, b) => a.cycle - b.cycle)
    .slice(-30)

  const domainDistribution = byCategory
    .map((row) => ({ domain: row.category, count: row._count._all }))
    .sort((a, b) => b.count - a.count)

  const hypForScatter = await db.hypothesis.findMany({
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { id: true, title: true, novelty: true, impact: true, status: true },
  })

  const latestPerLayer = await Promise.all(
    [1, 2, 3, 4, 5, 6, 7, 8].map((layer) =>
      db.layerMetric.findFirst({
        where: { layer },
        orderBy: [{ cycle: 'desc' }, { createdAt: 'desc' }],
        select: { value: true },
      }),
    ),
  )
  const layerThroughput = [1, 2, 3, 4, 5, 6, 7, 8].map((layer, i) => ({
    layer,
    value: round2(latestPerLayer[i]?.value ?? 0),
  }))

  const optimizationRows = await db.layerMetric.findMany({
    where: { layer: 6 },
    orderBy: { cycle: 'asc' },
    select: { cycle: true, key: true, value: true },
  })
  const optimizationByCycle = new Map<number, { successRate: number; avgNovelty: number }>()
  for (const row of optimizationRows) {
    const entry = optimizationByCycle.get(row.cycle) ?? { successRate: 0, avgNovelty: 0 }
    if (row.key === 'successRate') entry.successRate = round2(row.value)
    if (row.key === 'avgNovelty') entry.avgNovelty = round2(row.value)
    optimizationByCycle.set(row.cycle, entry)
  }
  const optimizationTrend = [...optimizationByCycle.entries()]
    .map(([cycle, v]) => ({ cycle, ...v }))
    .sort((a, b) => a.cycle - b.cycle)
    .slice(-30)

  return {
    signalsPerCycle,
    domainDistribution,
    noveltyImpact: hypForScatter.map((h) => ({
      id: h.id,
      title: h.title,
      novelty: round2(h.novelty),
      impact: round2(h.impact),
      status: h.status,
    })),
    layerThroughput,
    optimizationTrend,
  }
}

export async function getState(): Promise<EngineStateResponse> {
  // ensureEngine + auto-tick when due (the dashboard polls this every ~4s).
  // The tick is fired in the BACKGROUND (not awaited): LLM discovery cycles can
  // take ~10s, and blocking the response on them would make the UI sluggish.
  // The dashboard picks up the results on its next poll a few seconds later.
  const initial = await ensureEngine()
  const cfg = parseConfig(initial.config)
  const due =
    initial.status === 'running' && Date.now() - initial.lastTickAt.getTime() >= cfg.tickIntervalMs
  if (due && !tickMutex.promise) {
    void runTickSerialized().catch((err) => console.error('[engine] background tick failed:', err))
  }

  const state = await ensureEngine()
  const config = parseConfig(state.config)
  const engineStatus: 'running' | 'paused' = state.status === 'paused' ? 'paused' : 'running'

  const [streamRows, signalRows, hypothesisRows, breakthroughRows, pendingGovernanceRows, decidedGovernanceRows, triageGovernanceRows, linkRows, reportRows] =
    await Promise.all([
      db.domainStream.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { signals: true } } } }),
      // 72 ≈ 2.5 cycles of ingest — keeps source-signal lineage matches and
      // OPERATOR badges visible long enough to be inspected in the UI.
      db.rawSignal.findMany({ orderBy: { createdAt: 'desc' }, take: 72, include: { stream: { select: { name: true } } } }),
      db.hypothesis.findMany({ orderBy: { createdAt: 'desc' }, take: 24 }),
      db.breakthrough.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
      // R6-b — PINNED: all undecided human-review rows, regardless of age.
      // A naive latest-N window scrolls them out within minutes under high
      // breakthrough throughput, so SLA timers/breach events never fire.
      db.governanceCheck.findMany({
        where: { humanReview: true, reviewDecision: null },
        orderBy: { createdAt: 'desc' },
        take: GOV_PENDING_CAP,
      }),
      // Decided rows (auto-pass humanReview=false OR reviewDecision set) fill
      // the remaining window slots, newest first.
      db.governanceCheck.findMany({
        where: { OR: [{ reviewDecision: { not: null } }, { humanReview: false }] },
        orderBy: { createdAt: 'desc' },
        take: GOV_TOTAL_CAP,
      }),
      // R8 — newest auto-triaged releases are ALSO pinned: with 120 pendings
      // crowding the window, decided rows (incl. policy releases) would never
      // surface and the operator could not audit what the policy just did.
      db.governanceCheck.findMany({
        where: { notes: { startsWith: GOV_TRIAGE_NOTE_PREFIX } },
        orderBy: { createdAt: 'desc' },
        take: GOV_TRIAGE_PIN,
      }),
      db.crossDomainLink.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      db.insightReport.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ])

  // Merge the governance window: all pinned pendings first, then the newest
  // auto-triaged releases (ALWAYS pinned, up to GOV_TRIAGE_PIN — they audit the
  // standing policy even when pendings crowd out the decided fill), then decided
  // rows fill the remaining GOV_TOTAL_CAP slots. Dedupe by id (defensive — the
  // triage query overlaps the decided query) and keep display order createdAt desc.
  const seenGovIds = new Set<string>()
  const governanceRows = [
    ...pendingGovernanceRows,
    ...triageGovernanceRows,
    ...decidedGovernanceRows.slice(0, Math.max(0, GOV_TOTAL_CAP - pendingGovernanceRows.length)),
  ]
    .filter((row) => {
      if (seenGovIds.has(row.id)) return false
      seenGovIds.add(row.id)
      return true
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  const streams: StreamDTO[] = streamRows.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    status: s.status,
    itemsIngested: s.itemsIngested,
    velocity: round2(s.velocity),
    health: round2(s.health),
    signalCount: s._count.signals,
  }))

  const signals: SignalDTO[] = signalRows.map((s) => ({
    id: s.id,
    streamName: s.stream.name,
    category: s.category,
    title: s.title,
    content: s.content,
    anomalyScore: round3(s.anomalyScore),
    noveltyScore: round3(s.noveltyScore),
    features: parseNumberRecord(s.features),
    cycle: s.cycle,
    createdAt: s.createdAt.toISOString(),
  }))

  const hypotheses: HypothesisDTO[] = hypothesisRows.map((h) => ({
    id: h.id,
    title: h.title,
    summary: h.summary,
    domains: parseStringArray(h.domains),
    novelty: round3(h.novelty),
    impact: round3(h.impact),
    confidence: round3(h.confidence),
    status: h.status,
    counterfactuals: parseCounterfactuals(h.counterfactuals),
    validation: parseValidation(h.validation),
    sourceSignals: parseStringArray(h.sourceSignals),
    generator: h.generator,
    cycle: h.cycle,
    createdAt: h.createdAt.toISOString(),
  }))

  const breakthroughs: BreakthroughDTO[] = breakthroughRows.map((b) => ({
    id: b.id,
    hypothesisId: b.hypothesisId,
    title: b.title,
    solutionType: b.solutionType,
    summary: b.summary,
    synthesis: parseSynthesis(b.synthesis),
    impactRank: round3(b.impactRank),
    riskScore: round3(b.riskScore),
    status: b.status,
    cycle: b.cycle,
    createdAt: b.createdAt.toISOString(),
  }))

  // governanceRows: pinned pendings + decided fill, merged above (R6-b).
  const governance: GovernanceDTO[] = governanceRows.map((g) => ({
    id: g.id,
    targetType: g.targetType,
    targetId: g.targetId,
    targetTitle: g.targetTitle,
    riskScore: round3(g.riskScore),
    ethicalFlags: parseStringArray(g.ethicalFlags),
    validationStatus: g.validationStatus,
    humanReview: g.humanReview,
    reviewDecision: g.reviewDecision,
    notes: g.notes,
    cycle: g.cycle,
    createdAt: g.createdAt.toISOString(),
  }))

  const correlations: CorrelationDTO[] = linkRows.map((l) => ({
    id: l.id,
    sourceDomain: l.sourceDomain,
    targetDomain: l.targetDomain,
    strength: round3(l.strength),
    mechanism: l.mechanism,
  }))

  const reports: ReportDTO[] = reportRows.map((r) => ({
    id: r.id,
    title: r.title,
    reportType: r.reportType,
    content: r.content,
    cycle: r.cycle,
    createdAt: r.createdAt.toISOString(),
  }))

  // Layer state assembly from the latest cycle's LayerMetric rows.
  const latestMetric = await db.layerMetric.findFirst({ orderBy: { cycle: 'desc' }, select: { cycle: true } })
  const latestCycle = latestMetric?.cycle ?? 0
  const latestMetrics = latestCycle > 0 ? await db.layerMetric.findMany({ where: { cycle: latestCycle } }) : []
  const byLayer = new Map<number, Record<string, number>>()
  for (const m of latestMetrics) {
    const bucket = byLayer.get(m.layer) ?? {}
    bucket[m.key] = m.value
    byLayer.set(m.layer, bucket)
  }
  const layers = buildLayers(engineStatus, latestCycle, byLayer)

  const analytics = await buildAnalytics()

  return {
    engine: {
      status: engineStatus,
      cycles: state.cycles,
      startedAt: state.startedAt.toISOString(),
      lastTickAt: state.lastTickAt.toISOString(),
      uptimeSeconds: Math.max(0, Math.round((Date.now() - state.startedAt.getTime()) / 1000)),
      config,
      layers,
    },
    streams,
    signals,
    hypotheses,
    breakthroughs,
    governance,
    correlations,
    reports,
    analytics,
  }
}
