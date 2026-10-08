// ─── Engine content pools ────────────────────────────────────────────────────
// Rich, category-specific generators for scientific signals, hypotheses,
// cross-domain mechanisms, breakthrough synthesis and governance content.
// Everything is parameterized with randomized slots so content never repeats
// verbatim between cycles.

import type {
  Counterfactual,
  SignalFeatures,
  SolutionType,
  Synthesis,
} from '@/lib/engine-types'

// ─── Small random helpers ────────────────────────────────────────────────────

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1))
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function chance(p: number): boolean {
  return Math.random() < p
}

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.min(1, Math.max(0, v))
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

// ─── Categories ──────────────────────────────────────────────────────────────

export const CATEGORIES = [
  'papers',
  'patents',
  'clinical',
  'markets',
  'biology',
  'physics',
  'chemistry',
  'economics',
  'sensors',
  'simulation',
] as const

export type Category = (typeof CATEGORIES)[number]

export function isCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v)
}

// ─── Signal generation (Layer 1 + feature scoring Layer 2) ───────────────────

export interface GeneratedSignal {
  title: string
  content: string
  features: SignalFeatures
  anomalyScore: number
  noveltyScore: number
  promoted: boolean
}

// Heavy-tail anomaly distribution: ~15% of signals exceed 0.75.
function drawAnomalyScore(): number {
  return chance(0.85) ? clamp01(Math.random() * 0.72) : clamp01(0.75 + Math.random() * 0.25)
}

function drawFeatures(anomaly: number): SignalFeatures {
  return {
    // entropy/gradient correlate positively with anomaly
    entropy: round3(clamp01(0.25 + anomaly * 0.55 + rand(-0.12, 0.12))),
    periodicity: round3(clamp01(rand(0.05, 0.6) - anomaly * 0.25)),
    gradient: round3(clamp01(0.1 + anomaly * 0.7 + rand(-0.1, 0.1))),
    dimensionality: randInt(2, 17),
  }
}

function drawNoveltyScore(anomaly: number): number {
  return round3(clamp01(0.15 + Math.random() * 0.55 + anomaly * 0.3))
}

const MATERIALS = [
  'twisted bilayer graphene',
  'trilayer WTe₂',
  'kagome superlattice AV₃Sb₅',
  'cuprate thin film Bi-2212',
  'moiré TaSe₂',
  'hybrid perovskite lattice',
  'topological insulator Bi₂Se₃',
  'nickelate superconductor La₃Ni₂O₇',
] as const

const METHODS = [
  'physics-informed neural operator',
  'causal deconvolution pipeline',
  'Bayesian experimental design',
  'self-supervised spectroscopy',
  'diffusion-transformer surrogate',
  'quantum approximate diagonalization',
] as const

const MECHANISM_DEVICES = [
  'electrostatic actuator array',
  'phase-change memory cell',
  'microfluidic droplet router',
  'solid-state LiDAR pixel',
  'tunable metamaterial antenna',
  'piezoelectric energy harvester',
] as const

const APPLICATIONS = [
  'autonomous navigation',
  'continuous biomanufacturing',
  'grid-scale storage',
  'satellite thermal regulation',
  'closed-loop drug delivery',
  'subsea pipeline inspection',
] as const

const DRUGS = [
  'compound ATR-441',
  'monoclonal antibody VXN-208',
  'small-molecule inhibitor KRAS-G12C-9b',
  'bispecific engager T-cell-7',
  'antisense oligo AKCE-22',
] as const

const BIOMARKERS = [
  'IL-6 trajectory',
  'ctDNA fraction',
  'phosphorylated pERK drift',
  'gut-microbiome entropy index',
  'neurofilament light chain',
] as const

const PATHWAYS = ['JAK-STAT', 'Wnt/β-catenin', 'complement cascade', 'autophagy', 'Hippo-YAP'] as const

const SECTORS = [
  'semicap',
  'agri-futures',
  'long-duration credit',
  'emerging-market FX',
  'nuclear-utility equities',
  'shipping derivatives',
] as const

const TICKERS = ['QNTX', 'VLRM', 'OSCR', 'HXMT', 'TRDN', 'ZYNE', 'ARGX'] as const

const ORFS = ['ORF-17', 'ORF-42', 'ORF-88', 'ORF-133'] as const
const GENES = ['KLF-4', 'ATP5MC1', 'lncRNA HIX-9', 'PRDM-16', 'SIRP-α'] as const
const PROCESSES = [
  'chromatin remodeling',
  'mitochondrial fission',
  'axonal guidance',
  'quorum sensing',
  'autophagic flux',
] as const
const CELLTYPES = [
  'astrocyte-like progenitors',
  'enteroendocrine cells',
  'dendritic mimics',
  'myo-fibroblasts',
] as const
const ENZYMES = [
  'halogenase',
  'transposase',
  'lanthipeptide synthetase',
  'oxygen-tolerant hydrogenase',
] as const

const DETECTORS = [
  'LHCb forward region',
  'CMS endcap',
  'IceCube strings 41–58',
  'muon g-2 storage ring',
  'JET divertor',
  'LIGO Hanford interferometer',
] as const
const CHANNELS = ['dilepton', 'missing-energy', 'rare-kaon', 'gluon-fusion', 'flavor-violating'] as const

const METALS = ['Pd', 'Ni', 'Cu', 'Fe', 'Ir', 'Ru'] as const
const LIGANDS = ['NHC-L7', 'bipyridyl-B3', 'salen analog S2', 'phosphine-P9'] as const
const REACTIONS = [
  'enantioselective C–H activation',
  'atmospheric CO₂ reduction',
  'aza-Cope rearrangement',
  'electrochemical nitrogen fixation',
  'ring-opening polymerization',
] as const
const INTERMEDIATES = ['σ-alkyl', 'ketenylidene', 'radical cation', 'metallacyclobutane'] as const

const INDICATORS = [
  'pass-through elasticity',
  'Beveridge slope',
  'Phillips-curve slope',
  'term premium',
  'wealth-effect coefficient',
] as const
const REGIONS = [
  'euro-area periphery',
  'Gulf states',
  'Mekong basin economies',
  'US interior metros',
  'Andean trade bloc',
] as const

const SENSOR_SITES = ['node cluster NW-12', 'corridor E-07', 'basin C-44', 'array segment S-91'] as const
const SENSOR_MODALITIES = [
  'thermal drift',
  'strain anomaly',
  'acoustic signature',
  'vibration spectrum shift',
  'CO₂ flux inversion',
] as const

const SIM_BEHAVIORS = [
  'emergent coordination',
  'speciation events',
  'cartel formation',
  'migration waves',
  'norm collapse',
] as const
const SIM_PARAMS = ['agent density', 'signal latency', 'mutation rate', 'reward dispersion'] as const

type SignalTemplate = () => { title: string; content: string }

const SIGNAL_TEMPLATES: Record<Category, readonly SignalTemplate[]> = {
  papers: [
    () => {
      const mat = pick(MATERIALS)
      return {
        title: `Anomalous superconductivity onset in ${mat} near ${rand(1.2, 94).toFixed(1)} K`,
        content: `Preprint reports a ${rand(8, 40).toFixed(0)}% resistive drop deviating ${rand(2.2, 6.1).toFixed(1)}σ from BCS expectations. Replication attempts in ${randInt(2, 7)} labs are pending; raw traces show ${pick(['hysteresis', 'telegraph noise', 'metastable plateaus'])} above the transition.`,
      }
    },
    () => {
      const mat = pick(MATERIALS)
      return {
        title: `Topological phase switching in ${mat} under ${rand(0.4, 14).toFixed(1)} T pulsed fields`,
        content: `Authors observe Berry-curvature inversion signatures persisting ${rand(0.2, 9).toFixed(1)} ns after field quench. The reported channel selectivity (≥${rand(71, 96).toFixed(0)}%) contradicts two prior null results.`,
      }
    },
    () => ({
      title: `Scaling-law violation in ${pick(['phonon drag', 'exciton diffusion', 'spin-lattice relaxation'])} across ${randInt(3, 9)} regimes`,
      content: `Fitted exponents drift monotonically from ${rand(0.31, 0.55).toFixed(2)} to ${rand(0.61, 0.88).toFixed(2)} with sample age. Supplementary data hint at ${pick(['ultralow-frequency modes', 'interface disorder coupling', 'nonergodic basins'])} as driver.`,
    }),
    () => ({
      title: `Room-temperature coherence signatures in ${pick(MATERIALS)} via ${pick(METHODS)}`,
      content: `Coherence lifetime estimates reach ${rand(11, 340).toFixed(0)} ps at 298 K — ${rand(2, 12).toFixed(0)}× prior ceiling. Independent calorimetry is consistent, though the ${pick(['pump polarization dependence', 'thickness scaling', 'isotope response'])} remains unexplained.`,
    }),
    () => ({
      title: `Unexpected symmetry breaking in ${pick(MATERIALS)} lattices at ${rand(0.4, 3.8).toFixed(1)}% strain`,
      content: `X-ray nanodiffraction reveals a ${pick(['chiral', 'nematic', 'stripe'])} order parameter emerging below ${rand(20, 120).toFixed(0)} K. Group-theoretic analysis permits the phase only if a ${pick(['hidden quadrupole', 'orbital current loop', 'edge mode condensate'])} exists.`,
    }),
  ],
  patents: [
    () => ({
      title: `Adaptive ${pick(MECHANISM_DEVICES)} for ${pick(APPLICATIONS)}`,
      content: `Filing claims a self-tuning controller achieving ${rand(12, 60).toFixed(0)}% latency reduction versus fixed-baseline designs. Examiner objections cite ${randInt(1, 4)} prior-art combinations; inventors added a ${pick(['drift-compensating', 'fail-safe bypass', 'energy-harvesting'])} sub-circuit.`,
    }),
    () => ({
      title: `Self-calibrating ${pick(MECHANISM_DEVICES)} with ${rand(3, 30).toFixed(0)}% drift compensation`,
      content: `Embedded reference loop corrects gain wander every ${rand(40, 900).toFixed(0)} ms without external calibration. Test data report MTTF improvements of ${rand(1.4, 4.2).toFixed(1)}× in ${pick(['high-humidity', 'high-vibration', 'radiation-dense'])} environments.`,
    }),
    () => ({
      title: `Method for ${pick(APPLICATIONS)} using closed-loop ${pick(MECHANISM_DEVICES)} feedback`,
      content: `Method claims describe a ${randInt(2, 5)}-stage pipeline with ${pick(['federated', 'on-sensor', 'event-triggered'])} inference. Benchmark annexes show throughput of ${randInt(4, 90)}k decisions/h at ${rand(94, 99.9).toFixed(1)}% precision.`,
    }),
  ],
  clinical: [
    () => ({
      title: `Phase ${pick(['Ib', 'II', 'IIa'])} trial: ${pick(DRUGS)} shows ${pick(['durable response', 'progression-free survival gain', 'rapid biomarker normalization'])} in n=${randInt(38, 260)} cohort`,
      content: `Primary endpoint met with hazard ratio ${rand(0.52, 0.81).toFixed(2)} (p=${rand(0.001, 0.04).toFixed(3)}). Grade ≥3 events at ${rand(4, 19).toFixed(1)}%; independent monitor flagged ${pick(['hepatic', 'hematologic', 'cardiac'])} signals in one arm.`,
    }),
    () => ({
      title: `Biomarker ${pick(BIOMARKERS)} predicts ${pick(DRUGS)} response with AUC ${rand(0.71, 0.94).toFixed(2)}`,
      content: `Predictive model validated on ${randInt(120, 900)} archived samples across ${randInt(2, 6)} sites. Decision-curve analysis favors biomarker-guided enrollment, but calibration drifts beyond ${randInt(3, 12)} months.`,
    }),
    () => ({
      title: `Adverse-event clustering in ${pick(['high-dose', 'escalation', 'maintenance'])} arm implicates off-target ${pick(PATHWAYS)} activity`,
      content: `Cluster of ${randInt(4, 17)} events shares a temporal signature ${randInt(5, 30)} days post-infusion. Transcriptomic reanalysis of stored biopsies shows ${pick(['complement deposition', 'T-cell skewing', 'endothelial activation'])}; dosing hold enacted.`,
    }),
  ],
  markets: [
    () => ({
      title: `Unusual options flow in ${pick(SECTORS)}: $${randInt(20, 890)}M notional at ${rand(2.4, 7.5).toFixed(1)}σ`,
      content: `Sweep pattern concentrated in ${randInt(2, 9)} strikes expiring within ${randInt(4, 45)} days. Implied-vol surface skew flipped sign intraday; flow footprint matches ${pick(['a single node', 'two correlated desks', 'an algorithmic suite'])}.`,
    }),
    () => {
      const a = pick(SECTORS)
      let b = pick(SECTORS)
      let guard = 0
      while (b === a && guard++ < 8) b = pick(SECTORS)
      return {
        title: `Cross-asset correlation breakdown: ${a} vs ${b} regime flip`,
        content: `Rolling 60-day correlation collapsed from ${rand(0.5, 0.85).toFixed(2)} to ${rand(-0.4, 0.05).toFixed(2)} in ${randInt(2, 9)} sessions. Eigenvalue decomposition of the covariance matrix shows a new dominant factor absorbing ${rand(22, 61).toFixed(0)}% of variance.`,
      }
    },
    () => ({
      title: `Dark-pool print anomaly in ${pick(TICKERS)} — ${rand(6, 34).toFixed(0)}% of ADV in ${randInt(3, 40)} min`,
      content: `Prints clustered at ${randInt(2, 8)} price levels with ${pick(['minimal price impact', 'persistent post-print drift', 'immediate mean reversion'])}. A related entity filed a ${pick(['13D amendment', 'convertible issuance', 'shelf registration'])} ${randInt(1, 6)} days later.`,
    }),
  ],
  biology: [
    () => ({
      title: `${pick(ORFS)} expression correlates with unexpected methylation shift on chr${randInt(1, 22)}`,
      content: `Bulk and single-cell datasets agree on a ${rand(0.3, 0.8).toFixed(2)} Spearman correlation under ${pick(['hypoxia', 'serum deprivation', 'heat shock'])}. The methylated block spans ${randInt(2, 40)} CpG sites near a ${pick(['CpG island shore', 'enhancer hub', 'lamin-associated domain'])}.`,
    }),
    () => ({
      title: `CRISPRi screen names ${pick(GENES)} as switch regulator of ${pick(PROCESSES)}`,
      content: `Pooled screen (${randInt(2, 9)}×10⁴ guides) yields a ${rand(1.9, 6.2).toFixed(1)}-fold enrichment at FDR ${rand(0.01, 0.09).toFixed(2)}. Rescue experiments restore the phenotype in ${rand(60, 95).toFixed(0)}% of clones, implicating a ${pick(['dose-sensitive', 'context-dependent', 'bimodal'])} regime.`,
    }),
    () => ({
      title: `Metagenomic assembly uncovers ${pick(['Crenarchaeota clade', 'Cyanobacteria clade', 'uncultured Myxococcales'])} carrying novel ${pick(ENZYMES)} family`,
      content: `Contigs recovered from ${pick(['abyssal sediments', 'karst aquifers', 'permafrost cores'])} encode ${randInt(2, 11)} divergent homologs. Structural prediction places the active site ${rand(20, 60).toFixed(0)} Å from any known fold; one variant is thermostable to ${randInt(70, 110)} °C.`,
    }),
    () => ({
      title: `Single-cell atlas: ${pick(CELLTYPES)} transdifferentiate under ${pick(['brief Wnt pulse', 'pulsed shear stress', 'interleukin cocktail'])}`,
      content: `Pseudotime reconstruction shows a ${pick(['two-step', 'continuous', 'bifurcating'])} trajectory with ${rand(18, 70).toFixed(0)}% conversion efficiency. scATAC peaks implicate ${pick(GENES)} binding ${randInt(2, 20)} h before fate commitment.`,
    }),
  ],
  physics: [
    () => ({
      title: `${pick(DETECTORS)}: ${randInt(4, 90)}-event excess at ${rand(60, 9000).toFixed(0)} GeV in ${pick(CHANNELS)} channel`,
      content: `Local significance ${rand(2.4, 4.7).toFixed(1)}σ (global ${rand(1.1, 3.2).toFixed(1)}σ after look-elsewhere). Background model verified with ${randInt(2, 8)} control regions; the ${pick(['angular distribution', 'timing spectrum', 'charge asymmetry'])} fits neither SM nor the leading BSM benchmark.`,
    }),
    () => ({
      title: `Muon precession residual persists at ${rand(1.8, 4.9).toFixed(1)}σ in run ${randInt(2021, 2025)}`,
      content: `Lattice-QCD-combined theory still disagrees with the measured anomalous moment by ${rand(1.2, 5.1).toFixed(1)}×10⁻⁹. A ${pick(['light-scalar', 'vacuum-polarization', 'new-lepton-family'])} explanation remains compatible with constraints at ${rand(60, 95).toFixed(0)}% CL.`,
    }),
    () => ({
      title: `Plasma confinement beats Lawson margin by ${rand(5, 40).toFixed(0)}% in ${pick(['H-mode', 'advanced tokamak', 'stellarator mirrored'])} mode`,
      content: `Sustained pulse of ${rand(2, 41).toFixed(1)} s with Q≈${rand(0.4, 1.4).toFixed(2)}. Edge-localized modes suppressed via ${pick(['resonant magnetic perturbation', 'pellet pacing', 'grazing-angle injection'])}; impurity accumulation remains the limiter.`,
    }),
    () => ({
      title: `${pick(DETECTORS)} strain glitch train matches pre-merger template ${pick(['GW-190814-like', 'GW-200115-like', 'numerical-relativity surrogate NR-7'])}`,
      content: `Matched-filter SNR ${rand(8.4, 21).toFixed(1)} across ${randInt(2, 14)} glasts over ${randInt(2, 30)} min. Post-merger echo candidates at ${rand(1.9, 3.6).toFixed(1)}σ motivate a targeted re-analysis.`,
    }),
  ],
  chemistry: [
    () => ({
      title: `${pick(METALS)}–${pick(LIGANDS)} catalyst reaches ${rand(82, 99).toFixed(1)}% enantioselectivity in ${pick(REACTIONS)}`,
      content: `Turnover number ${randInt(400, 24000)} at ${rand(0.1, 2).toFixed(1)} mol% loading. Mechanistic probes indicate a ${pick(INTERMEDIATES)} intermediate; catalyst decomposes via ${pick(['bimetallic aggregation', 'ligand oxidation', 'reductive elimination'])} after ${randInt(3, 40)} h.`,
    }),
    () => ({
      title: `Room-temperature ${pick(REACTIONS)} via ${pick(INTERMEDIATES)} intermediate confirmed`,
      content: `Operando IR captures the intermediate at ${randInt(1600, 2100)} cm⁻¹ within ${rand(10, 90).toFixed(0)} s of the potential step. DFT barrier ${rand(12, 22).toFixed(1)} kcal/mol matches the kinetic isotope effect ${rand(1.8, 4.2).toFixed(1)}.`,
    }),
    () => ({
      title: `Self-assembling ${pick(['peptoid', 'bottlebrush polymer', 'supramolecular ribbon'])} switches conductance at ${rand(0.2, 3.4).toFixed(1)} V`,
      content: `On/off ratio ${randInt(30, 4000)} sustained over ${randInt(100, 5000)} cycles. AFM shows ${pick(['filament bundling', 'monolayer reordering', 'pore hydration'])} at the switching threshold; switching survives ${randInt(10, 90)} hydration cycles.`,
    }),
  ],
  economics: [
    () => ({
      title: `${pick(INDICATORS)} in ${pick(SECTORS)} inverts at ${rand(1.1, 4.8).toFixed(2)} threshold`,
      content: `Panel of ${randInt(12, 60)} economies over ${randInt(10, 30)} years shows a smooth sign flip rather than a structural break. A ${pick(['threshold-VAR', 'regime-switching DSGE', 'sign-restricted SVAR'])} reproduces the inversion when ${pick(['credit spreads', 'energy intensity', 'demographic drift'])} exceeds the threshold.`,
    }),
    () => ({
      title: `Labor productivity divergence across ${pick(REGIONS)} widens to ${rand(4, 28).toFixed(1)}%`,
      content: `Divergence accelerated after ${randInt(2016, 2023)}; ${pick(['frontier-firm absorption', 'remote-work sorting', 'capital-embodied AI adoption'])} explains ${rand(20, 70).toFixed(0)}% in shift-share accounting. Wage response is asymmetric across skill deciles.`,
    }),
    () => ({
      title: `Yield-curve regime shift flagged by ${pick(['deep-state-space model', 'rough-volatility filter', 'entropy-based classifier'])} at ${rand(72, 97).toFixed(0)}% posterior`,
      content: `Transition probability rose ${rand(2, 9).toFixed(1)}× over ${randInt(3, 15)} sessions. Simulated policy paths put the ${pick(['inversion depth', 're-steepening slope', 'level shift'])} at ±${rand(18, 90).toFixed(0)} bp depending on ${pick(['issuance mix', 'reserve drift', 'term-premium anchoring'])}.`,
    }),
  ],
  sensors: [
    () => ({
      title: `IoT grid ${pick(SENSOR_SITES)} reports correlated ${pick(SENSOR_MODALITIES)} across ${randInt(3, 60)} nodes`,
      content: `Cross-node coherence peaks at ${rand(0.55, 0.95).toFixed(2)} with lag ${randInt(1, 400)} ms. No maintenance event maps to the window; the anomaly propagates along ${pick(['power feeders', 'water mains', 'utility risers'])} topology.`,
    }),
    () => ({
      title: `Acoustic signature at ${pick(SENSOR_SITES)} matches pre-failure mode ${pick(['M-2 bearing wear', 'M-9 cavitation', 'M-14 insulation partial discharge'])}`,
      content: `Spectral ratio ${rand(1.4, 6).toFixed(1)} dB above fleet baseline for ${randInt(4, 60)} h. RUL model assigns ${rand(55, 96).toFixed(0)}% probability of failure inside ${randInt(7, 120)} days; inspection dispatch queued.`,
    }),
    () => ({
      title: `Distributed strain mesh detects micro-seismic precursor at ${rand(0.4, 18).toFixed(1)} km depth`,
      content: `Event swarm of ${randInt(5, 90)} micro-events with b-value dropping to ${rand(0.6, 1.0).toFixed(2)}. Creep-meter co-location confirms ${rand(0.2, 4).toFixed(1)} mm/day acceleration; alert level raised to ${pick(['amber', 'orange', 'yellow'])}.`,
    }),
  ],
  simulation: [
    () => ({
      title: `Agent-based run #${randInt(10000, 99999)}: ${pick(SIM_BEHAVIORS)} emerges at ${pick(SIM_PARAMS)} = ${rand(0.05, 0.9).toFixed(2)}`,
      content: `Phase boundary reproduced in ${randInt(60, 96).toFixed(0)}% of ${randInt(200, 900)} seeds. Order parameter jumps ${rand(1.8, 9).toFixed(1)}× within ${randInt(2, 40)} ticks; hysteresis loop suggests a ${pick(['first-order', 'critical', 'absorbing'])} transition.`,
    }),
    () => ({
      title: `Multi-agent phase transition in ${pick(SIM_BEHAVIORS)} as ${pick(SIM_PARAMS)} crosses ${rand(0.1, 0.85).toFixed(2)}`,
      content: `Finite-size scaling gives exponent ν≈${rand(0.6, 1.8).toFixed(2)}. Counterintuitively, added noise ${pick(['sharpens', 'erases', 'delays'])} the transition, consistent with ${pick(['noise-induced ordering', 'resonant activation', 'chaotic itinerancy'])}.`,
    }),
    () => ({
      title: `Digital-twin divergence from physical twin grows ${rand(0.1, 3.2).toFixed(2)}%/day`,
      content: `Divergence localized to the ${pick(['supply-layer', 'transport-layer', 'policy-layer'])} sub-model. Assimilating ${pick(['sparse telemetry', 'event logs', 'human annotations'])} cuts divergence ${rand(20, 80).toFixed(0)}%; residual bias appears adversarial rather than stochastic.`,
    }),
  ],
}

export function generateSignal(category: string): GeneratedSignal {
  const templates = SIGNAL_TEMPLATES[category as Category] ?? SIGNAL_TEMPLATES.papers
  const { title, content } = pick(templates)()
  const anomalyScore = round3(drawAnomalyScore())
  return {
    title,
    content,
    features: drawFeatures(anomalyScore),
    anomalyScore,
    noveltyScore: drawNoveltyScore(anomalyScore),
    promoted: false,
  }
}

export function generateSignals(category: string, count: number): GeneratedSignal[] {
  const out: GeneratedSignal[] = []
  for (let i = 0; i < count; i++) out.push(generateSignal(category))
  return out
}

// ─── Phenomena pools (used for hypotheses + cross-domain links) ──────────────

export const PHENOMENA: Record<Category, readonly string[]> = {
  papers: ['twisted-lattice coherence', 'topological phase switching', 'scaling-law violation', 'anomalous symmetry breaking'],
  patents: ['self-calibrating actuation', 'closed-loop microfluidic routing', 'metamaterial tunability', 'drift-compensating feedback'],
  clinical: ['biomarker-predicted response', 'adverse-event clustering', 'dose-titration drift', 'ctDNA inflection points'],
  markets: ['dark-pool liquidity prints', 'options-flow sigma bursts', 'correlation regime flips', 'post-print drift windows'],
  biology: ['methylation drift', 'ORF expression bursts', 'transdifferentiation cascades', 'quorum-sensing crosstalk'],
  physics: ['GeV event excesses', 'muon precession residuals', 'confinement margin overshoot', 'strain glitch trains'],
  chemistry: ['enantioselectivity spikes', 'room-temperature activation pathways', 'conductance switching thresholds', 'operando intermediate lifetimes'],
  economics: ['elasticity inversions', 'productivity divergence', 'regime-shift posteriors', 'term-premium dislocations'],
  sensors: ['correlated thermal drift', 'pre-failure acoustic modes', 'micro-seismic precursors', 'topology-following anomalies'],
  simulation: ['emergent coordination transitions', 'norm collapse cascades', 'digital-twin divergence', 'noise-induced ordering'],
}

const CROSS_MECHANISMS = [
  'shared stochastic resonance',
  'topological defect mediation',
  'a rate-limiting kinetic bottleneck',
  'bidirectional information transfer',
  'nonlinear feedback entrainment',
  'scale-invariant fluctuation coupling',
  'common latent-variable leakage',
  'phase-locking across noisy channels',
  'gradient-driven transport coupling',
  'convergent evolutionary pressure',
] as const

export function mechanismBetween(sourceDomain: string, targetDomain: string): string {
  const a = pick(PHENOMENA[sourceDomain as Category] ?? PHENOMENA.papers)
  const b = pick(PHENOMENA[targetDomain as Category] ?? PHENOMENA.papers)
  const mech = pick(CROSS_MECHANISMS)
  return `${a} modulates ${b} through ${mech}`
}

// ─── Template hypothesis generator (LLM fallback, Layer 4) ───────────────────

export interface TemplateHypothesis {
  title: string
  summary: string
  domains: string[]
  novelty: number
  impact: number
  confidence: number
  counterfactuals: Counterfactual[]
}

const HYP_TITLE_TEMPLATES = [
  (a: string, b: string, mech: string) => `${cap(a)} entrains ${b} through ${mech}`,
  (a: string, b: string) => `${cap(a)} predicts ${b} transitions with a ${randInt(1, 5)}-cycle lag`,
  (a: string, b: string, mech: string) => `${cap(a)} and ${b} share a ${mech} basis`,
  (a: string, b: string) => `Bidirectional coupling between ${a} and ${b} under high-entropy regimes`,
  (a: string, b: string, mech: string) => `${cap(a)} suppresses the ${b} noise floor via ${mech}`,
] as const

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function buildCounterfactuals(a: string, b: string): Counterfactual[] {
  const cfs: Counterfactual[] = [
    {
      question: `Does the effect persist when ${a} variance is ablated?`,
      result: `Simulated ablation reduces coupling strength by ${rand(30, 80).toFixed(0)}% (n=${randInt(200, 900)} runs).`,
      supports: true,
    },
    {
      question: `Is the correlation an artifact of sampling density?`,
      result: `Bootstrap resampling at ${randInt(2, 9)}× density preserves the link (p=${rand(0.002, 0.04).toFixed(3)}).`,
      supports: true,
    },
  ]
  if (chance(0.35)) {
    cfs.push({
      question: `Would a shuffled null model of ${b} streams reproduce the pattern?`,
      result: `Shuffled nulls reproduce the pattern in ${rand(6, 22).toFixed(0)}% of seeds — coupling likely spurious.`,
      supports: false,
    })
  } else {
    cfs.push({
      question: `Would a shuffled null model of ${b} streams reproduce the pattern?`,
      result: `Null model fails to reproduce the pattern in ${randInt(180, 480)}/${randInt(480, 500)} seeds.`,
      supports: true,
    })
  }
  return cfs
}

function twoDistinctDomains(available: string[]): [Category, Category] {
  const pool = available.filter(isCategory)
  const a = pool.length > 0 ? pick(pool) : pick(CATEGORIES)
  let b = pick(CATEGORIES)
  let guard = 0
  while (b === a && guard++ < 10) b = pick(CATEGORIES)
  return [a, b]
}

export function generateTemplateHypotheses(
  signalCategories: string[],
  count: number,
): TemplateHypothesis[] {
  const out: TemplateHypothesis[] = []
  for (let i = 0; i < count; i++) {
    const [a, b] = twoDistinctDomains(signalCategories)
    const phenA = pick(PHENOMENA[a])
    const phenB = pick(PHENOMENA[b])
    const mech = pick(CROSS_MECHANISMS)
    const title = pick(HYP_TITLE_TEMPLATES)(phenA, phenB, mech)
    const r = rand(0.42, 0.93)
    out.push({
      title,
      summary: `Concurrent ${a} and ${b} signals show a ${r.toFixed(2)} rank correlation peaking at a ${randInt(1, 5)}-cycle lag. We hypothesize ${mech} couples ${phenA} to ${phenB}; falsification under counterfactual ablation would flag the link as spurious.`,
      domains: [a, b],
      novelty: round3(rand(0.35, 0.97)),
      impact: round3(rand(0.3, 0.95)),
      confidence: round3(rand(0.3, 0.9)),
      counterfactuals: buildCounterfactuals(phenA, phenB),
    })
  }
  return out
}

// ─── Breakthrough synthesis (Layer 5) ────────────────────────────────────────

const SOLUTION_TYPE_BY_DOMAIN: Partial<Record<Category, SolutionType>> = {
  biology: 'molecule',
  chemistry: 'molecule',
  markets: 'financial',
  economics: 'financial',
  physics: 'engineering',
  sensors: 'engineering',
  patents: 'engineering',
  clinical: 'protocol',
  simulation: 'protocol',
  papers: 'model',
}

export function deriveSolutionType(domains: string[]): SolutionType {
  for (const d of domains) {
    const t = SOLUTION_TYPE_BY_DOMAIN[d as Category]
    if (t) return t
  }
  return 'model'
}

const COMPONENTS: Record<SolutionType, readonly string[]> = {
  molecule: [
    'stabilized peptide analog library',
    'metal–organic framework scaffold',
    'guide-RNA multiplex cassette',
    'allosteric small-molecule modulator',
    'enzyme-mimetic organocatalyst',
  ],
  financial: [
    'volatility-suppression hedge basket',
    'cross-venue liquidity rebalancer',
    'regime-switching allocation overlay',
    'drawdown-aware execution scheduler',
    'synthetic exposure ladder',
  ],
  engineering: [
    'resonant damping lattice',
    'edge telemetry mesh with drift correction',
    'self-calibrating actuator retrofit',
    'fault-tolerant control loop',
    'adaptive thermal bus',
  ],
  protocol: [
    'adaptive enrollment protocol',
    'biomarker-stratified dosing schedule',
    'human-in-the-loop review workflow',
    'cross-site data harmonization pipeline',
    'safety signal escalation ladder',
  ],
  model: [
    'transformer surrogate simulator',
    'Bayesian hierarchical estimator',
    'graph-neural cross-domain matcher',
    'counterfactual ablation harness',
    'uncertainty-aware ensemble router',
  ],
}

const EXPECTED_GAIN: Record<SolutionType, readonly string[]> = {
  molecule: [`+${randInt(15, 70)}% target affinity`, `${randInt(2, 9)}× selectivity improvement`, `−${randInt(20, 60)}% off-target binding`],
  financial: [`+${randInt(20, 140)} bps risk-adjusted alpha`, `−${randInt(15, 55)}% drawdown`, `+${randInt(8, 30)}% Sharpe ratio`],
  engineering: [`+${randInt(10, 45)}% throughput`, `−${randInt(20, 70)}% failure rate`, `${randInt(2, 6)}× maintenance interval`],
  protocol: [`−${randInt(15, 50)}% adverse events`, `+${randInt(10, 40)}% enrollment velocity`, `−${randInt(10, 35)}% time-to-decision`],
  model: [`${randInt(2, 11)}× faster inference`, `+${randInt(4, 18)} pts predictive accuracy`, `−${randInt(20, 65)}% labeling cost`],
}

const TIME_HORIZONS = ['2–4 weeks', '1–2 quarters', '6–12 months', '18–36 months'] as const

export function buildSynthesis(solutionType: SolutionType, domains: string[]): Synthesis {
  const phenom = domains.map((d) => pick(PHENOMENA[d as Category] ?? PHENOMENA.papers))
  const mech = pick(CROSS_MECHANISMS)
  const compCount = randInt(2, 3)
  const components: string[] = []
  let guard = 0
  while (components.length < compCount && guard++ < 20) {
    const c = pick(COMPONENTS[solutionType])
    if (!components.includes(c)) components.push(c)
  }
  return {
    components,
    mechanism: `${cap(phenom[0] ?? 'cross-domain coupling')} is stabilized by ${mech}, propagating through ${phenom.slice(1).join(' and ') || 'adjacent domains'} into a deployable ${solutionType} intervention.`,
    feasibility: round3(rand(0.3, 0.95)),
    expectedGain: pick(EXPECTED_GAIN[solutionType]),
    timeHorizon: pick(TIME_HORIZONS),
  }
}

export function buildBreakthroughSummary(solutionType: SolutionType, synthesis: Synthesis): string {
  return `Deployable ${solutionType}: ${synthesis.mechanism} Expected gain ${synthesis.expectedGain} on a ${synthesis.timeHorizon} horizon (feasibility ${Math.round(synthesis.feasibility * 100)}%).`
}

// ─── Governance content (Layer 7) ────────────────────────────────────────────

const BASE_RISK: Record<SolutionType, [number, number]> = {
  financial: [0.5, 0.9],
  molecule: [0.45, 0.85],
  engineering: [0.2, 0.6],
  protocol: [0.28, 0.68],
  model: [0.12, 0.5],
}

const FLAGS_BY_TYPE: Record<SolutionType, readonly string[]> = {
  financial: ['market-manipulation risk', 'systemic-liquidity exposure'],
  molecule: ['dual-use potential', 'patient-safety review'],
  engineering: ['infrastructure dependency', 'dual-use potential'],
  protocol: ['patient-safety review', 'informed-consent scope'],
  model: ['algorithmic bias risk', 'data-provenance opacity'],
}

const GENERIC_FLAGS = ['provenance unverified', 'deployment blast radius', 'cross-jurisdiction conflict'] as const

export interface GovernanceContent {
  riskScore: number
  ethicalFlags: string[]
  notes: string
}

export function buildGovernanceContent(solutionType: SolutionType, domains: string[]): GovernanceContent {
  const [lo, hi] = BASE_RISK[solutionType]
  const riskScore = round3(clamp01(rand(lo, hi) + rand(-0.05, 0.05)))

  const flags = new Set<string>()
  for (const f of FLAGS_BY_TYPE[solutionType]) if (chance(0.75)) flags.add(f)
  if (domains.includes('clinical') && solutionType !== 'protocol') flags.add('patient-safety review')
  if (domains.includes('markets') && solutionType !== 'financial') flags.add('market-manipulation risk')
  if (chance(0.3)) flags.add(pick(GENERIC_FLAGS))
  if (flags.size === 0) flags.add(pick(FLAGS_BY_TYPE[solutionType]))

  const flagList = [...flags]
  const notes =
    riskScore < 0.35
      ? `Automated review: risk posture acceptable (${solutionType} class). ${flagList.length ? `Monitored flags: ${flagList.join(', ')}.` : 'No flags raised.'}`
      : `Automated review escalated: ${solutionType} class exceeds the risk budget. ${flagList.join(', ')} require human sign-off before deployment.`
  return { riskScore, ethicalFlags: flagList, notes }
}

// ─── Report content (Layer 8) ────────────────────────────────────────────────

export function buildCycleSummary(input: {
  cycle: number
  signals: number
  anomalies: number
  hypotheses: number
  validated: number
  breakthroughs: number
  governed: number
  flagged: number
}): string {
  return (
    `Cycle ${input.cycle}: ingested ${input.signals} signals (${input.anomalies} high-anomaly) across the active stream mesh. ` +
    `${input.validated}/${input.hypotheses} hypotheses survived counterfactual simulation, producing ${input.breakthroughs} synthesized breakthrough${input.breakthroughs === 1 ? '' : 's'}. ` +
    `Governance cleared ${input.governed} and flagged ${input.flagged} for human review.`
  )
}

export function buildAlertReport(input: {
  title: string
  impactRank: number
  solutionType: string
  riskScore: number
  status: string
}): { title: string; content: string } {
  return {
    title: `High-impact breakthrough: ${input.title}`,
    content: `Breakthrough "${input.title}" (${input.solutionType}) scored impactRank ${input.impactRank.toFixed(3)} — above the 0.80 alert threshold. Governance status "${input.status}" with riskScore ${input.riskScore.toFixed(2)}; recommend immediate dashboard review.`,
  }
}

export function buildBlindSpotReport(input: {
  cycle: number
  streamName: string
  health: number
  velocity: number
  successRate: number
}): { title: string; content: string } {
  return {
    title: `Blind-spot deep-dive — cycle ${input.cycle}`,
    content:
      `Self-optimization layer flagged ${input.streamName} (health ${input.health.toFixed(2)}, velocity ${input.velocity.toFixed(2)}) as an information blind spot this cycle. ` +
      `Discovery success rate of ${(input.successRate * 100).toFixed(0)}% suggests the stream mesh is under-exposing ${pick(['low-entropy regimes', 'cross-domain tails', 'slow-onset anomalies'])}; stream weighting will be nudged upstream.`,
  }
}
