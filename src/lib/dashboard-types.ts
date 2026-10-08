/**
 * PROMETHEUS // Autonomous Discovery Engine — dashboard API contract types.
 * Mirrors GET /api/engine/state and the control/governance/breakthrough POST endpoints.
 * Backend (task 2-a) builds responses with EXACTLY this shape.
 */

// ─── Engine core ─────────────────────────────────────────────────────────────

export type EngineStatus = 'running' | 'paused';
export type LayerState = 'active' | 'idle' | 'blocked';

/** One standing release valve. Tier 2 (mid-risk) reuses the same shape. */
export interface AutoTriageTier {
  enabled: boolean;
  /** Only reviews with riskScore ≤ maxRisk are eligible for this tier. */
  maxRisk: number;
  /** Minimum pending age in minutes. */
  afterMinutes: number;
}

export interface AutoTriagePolicy {
  enabled: boolean;
  /** Only reviews with riskScore ≤ maxRisk are eligible (0.35–0.6). */
  maxRisk: number;
  /** Minimum pending age in minutes (1–120). */
  afterMinutes: number;
  /**
   * Tier 2 · mid-risk valve (optional, parsed with defaults when absent).
   * Releases the stuck band ABOVE the tier-1 ceiling: policy.maxRisk < risk
   * ≤ midRisk.maxRisk once aged past midRisk.afterMinutes. Capped below the
   * HIGH tier — HIGH rows always keep their human.
   */
  midRisk: AutoTriageTier;
}

export interface EngineConfig {
  tickIntervalMs: number;
  llmDiscovery: boolean;
  aggression: number;
  autoTriage: AutoTriagePolicy;
}

/** Partial config accepted by POST /api/engine/control. */
export interface EngineConfigPatch {
  tickIntervalMs?: number;
  llmDiscovery?: boolean;
  aggression?: number;
  autoTriage?: Partial<AutoTriagePolicy>;
}

export interface EngineLayer {
  layer: number;
  key: string;
  name: string;
  purpose: string;
  state: LayerState;
  load: number;
  metrics: Record<string, number>;
}

export interface EngineInfo {
  status: EngineStatus;
  cycles: number;
  startedAt: string;
  lastTickAt: string;
  uptimeSeconds: number;
  config: EngineConfig;
  layers: EngineLayer[];
}

// ─── Layer 1 · Input Universe ────────────────────────────────────────────────

export interface DomainStream {
  id: string;
  name: string;
  category: string;
  status: string;
  itemsIngested: number;
  velocity: number;
  health: number;
  signalCount: number;
}

export interface Signal {
  id: string;
  streamName: string;
  category: string;
  title: string;
  content: string;
  anomalyScore: number;
  noveltyScore: number;
  features: Record<string, number>;
  cycle: number;
  createdAt: string;
  /**
   * Optional display hint for the signal origin. The engine state payload does
   * NOT populate it — operator badges are derived client-side from
   * `features.sourceOp === 1` (number-encoded marker written by POST
   * /api/signals; see the OPERATOR-SOURCE CONVENTION comment there).
   */
  source?: 'operator' | 'engine';
}

// ─── Layer 4 · Discovery ─────────────────────────────────────────────────────

export type HypothesisStatus = 'generated' | 'testing' | 'validated' | 'rejected' | 'promoted';

export interface Counterfactual {
  question: string;
  result: string;
  supports: boolean;
}

export interface HypothesisValidation {
  simulations: number;
  passed: number;
  failed: number;
  pValue: number | null;
  effectSize: number | null;
}

export interface Hypothesis {
  id: string;
  title: string;
  summary: string;
  domains: string[];
  novelty: number;
  impact: number;
  confidence: number;
  status: HypothesisStatus | string;
  counterfactuals: Counterfactual[];
  validation: HypothesisValidation;
  /** Titles of the Layer-2 signals cited by the discovery layer as this hypothesis's evidence base. */
  sourceSignals: string[];
  generator: string;
  cycle: number;
  createdAt: string;
}

// ─── Layer 5 · Breakthrough Synthesis ────────────────────────────────────────

export type SolutionType = 'molecule' | 'engineering' | 'financial' | 'protocol' | 'model';

export interface Synthesis {
  components: string[];
  mechanism: string;
  feasibility: number;
  expectedGain: string;
  timeHorizon: string;
}

export interface Breakthrough {
  id: string;
  hypothesisId: string;
  title: string;
  solutionType: SolutionType | string;
  summary: string;
  synthesis: Synthesis;
  impactRank: number;
  riskScore: number;
  status: string;
  cycle: number;
  createdAt: string;
}

// ─── Layer 7 · Governance ────────────────────────────────────────────────────

export type GovernanceDecision = 'approved' | 'rejected';

export interface GovernanceCheck {
  id: string;
  targetType: string;
  targetId: string;
  targetTitle: string;
  riskScore: number;
  ethicalFlags: string[];
  validationStatus: string;
  humanReview: boolean;
  reviewDecision: GovernanceDecision | string | null;
  notes: string;
  cycle: number;
  createdAt: string;
}

// ─── Layer 3 · Cross-domain correlations ─────────────────────────────────────

export interface Correlation {
  id: string;
  sourceDomain: string;
  targetDomain: string;
  strength: number;
  mechanism: string;
}

// ─── Layer 8 · Insight Output ────────────────────────────────────────────────

export type ReportType = 'alert' | 'deep-dive' | 'cycle-summary';

export interface InsightReport {
  id: string;
  title: string;
  reportType: ReportType | string;
  content: string;
  cycle: number;
  createdAt: string;
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface SignalsPerCyclePoint {
  cycle: number;
  signals: number;
  anomalies: number;
}

export interface DomainDistributionPoint {
  domain: string;
  count: number;
}

export interface NoveltyImpactPoint {
  id: string;
  title: string;
  novelty: number;
  impact: number;
  status: string;
}

export interface LayerThroughputPoint {
  layer: number;
  value: number;
}

export interface OptimizationTrendPoint {
  cycle: number;
  successRate: number;
  avgNovelty: number;
}

export interface Analytics {
  signalsPerCycle: SignalsPerCyclePoint[];
  domainDistribution: DomainDistributionPoint[];
  noveltyImpact: NoveltyImpactPoint[];
  layerThroughput: LayerThroughputPoint[];
  optimizationTrend: OptimizationTrendPoint[];
}

// ─── Full GET /api/engine/state payload ──────────────────────────────────────

export interface EngineStatePayload {
  engine: EngineInfo;
  streams: DomainStream[];
  signals: Signal[];
  hypotheses: Hypothesis[];
  breakthroughs: Breakthrough[];
  governance: GovernanceCheck[];
  correlations: Correlation[];
  reports: InsightReport[];
  analytics: Analytics;
}

// ─── Control / action responses ──────────────────────────────────────────────

export type ControlAction = 'start' | 'pause' | 'tick' | 'reset' | 'config';

export interface ControlResponse {
  ok: boolean;
  status: EngineStatus;
  cycles: number;
  config: EngineConfig;
}

export interface MutationOkResponse {
  ok: boolean;
}
