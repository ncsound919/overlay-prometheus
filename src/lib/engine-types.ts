// ─── Shared API contract for the Autonomous Discovery & Breakthrough Engine ───
// These types define the exact payload shapes exchanged between the backend
// engine (src/lib/engine/*) and the frontend dashboard.

// ─── Engine config (persisted as JSON string on EngineState.config) ─────────

/** One standing release valve. Tier 2 (mid-risk) reuses the same shape. */
export interface AutoTriageTier {
  /** Master switch for this tier. */
  enabled: boolean
  /** Upper bound of the tier's risk band (inclusive). */
  maxRisk: number
  /** Minimum pending age in minutes. */
  afterMinutes: number
}

/** Standing operator policy that releases stale low/med-risk reviews automatically. */
export interface AutoTriagePolicy {
  /** Master switch — policy runs inside every governance layer pass when true. */
  enabled: boolean
  /** Only reviews with riskScore ≤ maxRisk are eligible (clamped 0.35–0.6: below the
   *  auto-pass threshold so it only ever touches rows a human would have seen). */
  maxRisk: number
  /** Minimum pending age in minutes before a row is eligible (clamped 1–120). */
  afterMinutes: number
  /**
   * Tier 2 · mid-risk valve (optional in persisted JSON; parsed with defaults).
   * Releases the band strictly ABOVE tier 1: maxRisk < risk ≤ midRisk.maxRisk
   * after midRisk.afterMinutes. Clamped 0.4–0.6 ceiling / 15–240m age so the
   * HIGH tier (≥ 0.6) always keeps its human.
   */
  midRisk: AutoTriageTier
}

export interface EngineConfig {
  tickIntervalMs: number
  llmDiscovery: boolean
  aggression: number
  autoTriage: AutoTriagePolicy
}

/** Config patch — autoTriage merges field-by-field (partial policy, not replace). */
export interface EngineConfigPatch extends Partial<Omit<EngineConfig, 'autoTriage'>> {
  autoTriage?: Partial<AutoTriagePolicy>
}

// ─── Layers ──────────────────────────────────────────────────────────────────

export const LAYER_KEYS = [
  'input',
  'preprocess',
  'analysis',
  'discovery',
  'breakthrough',
  'optimization',
  'governance',
  'output',
] as const

export type LayerKey = (typeof LAYER_KEYS)[number]
export type LayerState = 'active' | 'idle' | 'blocked'

export interface LayerStatus {
  layer: number
  key: LayerKey
  name: string
  purpose: string
  state: LayerState
  load: number
  metrics: Record<string, number>
}

// ─── Streams (Layer 1) ───────────────────────────────────────────────────────

export interface StreamDTO {
  id: string
  name: string
  category: string
  status: string
  itemsIngested: number
  velocity: number
  health: number
  signalCount: number
}

// ─── Signals (Layer 1/2) ─────────────────────────────────────────────────────

export interface SignalFeatures {
  entropy: number
  periodicity: number
  gradient: number
  dimensionality: number
}

export interface SignalDTO {
  id: string
  streamName: string
  category: string
  title: string
  content: string
  anomalyScore: number
  noveltyScore: number
  features: Record<string, number>
  cycle: number
  createdAt: string
}

// ─── Hypotheses (Layer 4) ────────────────────────────────────────────────────

export interface Counterfactual {
  question: string
  result: string
  supports: boolean
}

export interface ValidationStats {
  /** Real fetched signals assessed as context for this hypothesis. */
  simulations: number
  /** Signals whose keywords overlap the hypothesis (context, not confirmation). */
  passed: number
  /** Signals with no keyword overlap. */
  failed: number
  /**
   * No statistical test is performed by this engine, so this is null rather
   * than a fabricated p-value. Evidence assessment is contextual only.
   */
  pValue: number | null
  /** No effect size is estimated; null rather than a fabricated value. */
  effectSize: number | null
}

export interface HypothesisDTO {
  id: string
  title: string
  summary: string
  domains: string[]
  novelty: number
  impact: number
  confidence: number
  status: string
  counterfactuals: Counterfactual[]
  validation: ValidationStats
  /** Titles of the Layer-2 signals that fed this hypothesis (top-4 discovery context). */
  sourceSignals: string[]
  generator: string
  cycle: number
  createdAt: string
}

// ─── Breakthroughs (Layer 5) ─────────────────────────────────────────────────

export type SolutionType = 'molecule' | 'engineering' | 'financial' | 'protocol' | 'model'

export interface Synthesis {
  components: string[]
  mechanism: string
  feasibility: number
  expectedGain: string
  timeHorizon: string
}

export interface BreakthroughDTO {
  id: string
  hypothesisId: string
  title: string
  solutionType: string
  summary: string
  synthesis: Synthesis
  impactRank: number
  riskScore: number
  status: string
  cycle: number
  createdAt: string
}

// ─── Governance (Layer 7) ────────────────────────────────────────────────────

export interface GovernanceDTO {
  id: string
  targetType: string
  targetId: string
  targetTitle: string
  riskScore: number
  ethicalFlags: string[]
  validationStatus: string
  humanReview: boolean
  reviewDecision: string | null
  notes: string
  cycle: number
  createdAt: string
}

// ─── Cross-domain correlations (Layer 3) ─────────────────────────────────────

export interface CorrelationDTO {
  id: string
  sourceDomain: string
  targetDomain: string
  strength: number
  mechanism: string
}

// ─── Insight reports (Layer 8) ───────────────────────────────────────────────

export interface ReportDTO {
  id: string
  title: string
  reportType: string
  content: string
  cycle: number
  createdAt: string
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface SignalsPerCyclePoint {
  cycle: number
  signals: number
  anomalies: number
}

export interface DomainDistributionPoint {
  domain: string
  count: number
}

export interface NoveltyImpactPoint {
  id: string
  title: string
  novelty: number
  impact: number
  status: string
}

export interface LayerThroughputPoint {
  layer: number
  value: number
}

export interface OptimizationTrendPoint {
  cycle: number
  successRate: number
  avgNovelty: number
}

export interface AnalyticsDTO {
  signalsPerCycle: SignalsPerCyclePoint[]
  domainDistribution: DomainDistributionPoint[]
  noveltyImpact: NoveltyImpactPoint[]
  layerThroughput: LayerThroughputPoint[]
  optimizationTrend: OptimizationTrendPoint[]
}

// ─── Top-level payloads ──────────────────────────────────────────────────────

export interface EngineDTO {
  status: 'running' | 'paused'
  cycles: number
  startedAt: string
  lastTickAt: string
  uptimeSeconds: number
  config: EngineConfig
  layers: LayerStatus[]
}

export interface EngineStateResponse {
  engine: EngineDTO
  streams: StreamDTO[]
  signals: SignalDTO[]
  hypotheses: HypothesisDTO[]
  breakthroughs: BreakthroughDTO[]
  governance: GovernanceDTO[]
  correlations: CorrelationDTO[]
  reports: ReportDTO[]
  analytics: AnalyticsDTO
}

// ─── Control API ─────────────────────────────────────────────────────────────

export type ControlAction = 'start' | 'pause' | 'tick' | 'reset' | 'config'

export interface ControlRequest {
  action: ControlAction
  config?: EngineConfigPatch
}

export interface ControlResponse {
  ok: true
  status: string
  cycles: number
  config: EngineConfig
}

// ─── Governance review API ───────────────────────────────────────────────────

export type GovernanceDecision = 'approved' | 'rejected'

export interface GovernanceDecisionRequest {
  decision: GovernanceDecision
}

export interface GovernanceDecisionResponse {
  ok: true
}

// ─── Breakthrough action API ─────────────────────────────────────────────────

export type BreakthroughAction = 'deploy' | 'block'

export interface BreakthroughActionRequest {
  action: BreakthroughAction
}

export interface BreakthroughActionResponse {
  ok: true
}
