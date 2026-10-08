// ─── Real signal connectors ──────────────────────────────────────────────────
// Layer 1 of the discovery engine ingests from these connectors. Every item is
// fetched live from a public API and mapped to the engine's signal shape.
//
// Honest-scoring note: anomaly/novelty here are computed from real, inspectable
// properties of the fetched items (recency and lexical novelty against the
// currently-known titles). They are heuristics, not a validated anomaly detector.
//
// Fail-closed: a connector that errors returns [] and the stream ingests nothing.
// Nothing is synthesized to fill a gap.

export interface RawSignalDraft {
  title: string
  content: string
  features: Record<string, number | string | boolean>
  anomalyScore: number
  noveltyScore: number
}

export interface ConnectorContext {
  /** Titles already known to the engine, used for lexical novelty. */
  knownTitles: string[]
  /** Clock injection for tests. */
  now?: number
}

export interface StreamConnector {
  /** Matches DomainStream.category. */
  category: string
  /** Query used against the upstream API. */
  query: string
  fetch: (limit: number, ctx: ConnectorContext) => Promise<RawSignalDraft[]>
}

const USER_AGENT = 'prometheus-discovery-engine/1.0 (research; contact: operator)'

async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

// ─── Scoring (pure, testable) ────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'of', 'and', 'for', 'with', 'a', 'an', 'in', 'on', 'to', 'by', 'via',
  'from', 'using', 'based', 'new', 'novel', 'study', 'analysis', 'results',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

/**
 * Lexical novelty in [0, 1]: 1 - the highest Jaccard similarity to any known
 * title. An item unlike anything known scores near 1.
 */
export function lexicalNovelty(title: string, knownTitles: string[]): number {
  const tokens = new Set(tokenize(title))
  if (tokens.size === 0) return 0
  let maxSim = 0
  for (const known of knownTitles) {
    const sim = jaccard(tokens, new Set(tokenize(known)))
    if (sim > maxSim) maxSim = sim
  }
  return Math.max(0, Math.min(1, 1 - maxSim))
}

/**
 * Recency in [0, 1]: 1 for an item from today, decaying with a 14-day half-life.
 * Returns 0.5 when no date is available rather than guessing.
 */
export function recencyScore(iso: string | undefined, now = Date.now()): number {
  if (!iso) return 0.5
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 0.5
  const ageDays = Math.max(0, (now - t) / 86_400_000)
  return Math.max(0, Math.min(1, Math.pow(0.5, ageDays / 14)))
}

/** Anomaly is a blend of recency and lexical novelty — both real properties. */
export function anomalyScore(recency: number, novelty: number): number {
  return Math.max(0, Math.min(1, 0.45 * recency + 0.55 * novelty))
}

// ─── arXiv connector ─────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function firstTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? decodeXml(m[1]) : undefined
}

export function parseArxivAtom(xml: string): Array<{ title: string; summary: string; published: string; id: string; categories: string[] }> {
  const entries: Array<{ title: string; summary: string; published: string; id: string; categories: string[] }> = []
  const blocks = xml.match(/<entry[\s\S]*?<\/entry>/gi) || []
  for (const block of blocks) {
    const title = firstTag(block, 'title')
    if (!title) continue
    const cats = Array.from(block.matchAll(/<category[^>]*term="([^"]+)"/gi)).map((m) => m[1])
    entries.push({
      title,
      summary: firstTag(block, 'summary') || '',
      published: firstTag(block, 'published') || '',
      id: firstTag(block, 'id') || '',
      categories: cats,
    })
  }
  return entries
}

const ARXIV: StreamConnector = {
  category: 'papers',
  query: 'cat:q-bio.QM OR cat:cs.AI OR cat:q-bio.GN',
  async fetch(limit, ctx) {
    const url =
      `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(this.query)}` +
      `&sortBy=submittedDate&sortOrder=descending&max_results=${Math.max(1, Math.min(50, limit))}`
    const xml = await fetchText(url)
    return parseArxivAtom(xml).map((e) => {
      const title = e.title
      const novelty = lexicalNovelty(title, ctx.knownTitles)
      const recency = recencyScore(e.published, ctx.now)
      return {
        title,
        content: e.summary.slice(0, 1000),
        features: { source: 'arxiv', published: e.published, categories: e.categories.join(','), arxivId: e.id },
        anomalyScore: anomalyScore(recency, novelty),
        noveltyScore: novelty,
      }
    })
  },
}

// ─── ClinicalTrials.gov connector ────────────────────────────────────────────

interface CtStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string }
    statusModule?: { overallStatus?: string; lastUpdatePostDateStruct?: { date?: string } }
    descriptionModule?: { briefSummary?: string }
  }
}

export function parseClinicalTrials(json: { studies?: CtStudy[] }): Array<{ nctId: string; title: string; summary: string; status: string; updated: string }> {
  const out: Array<{ nctId: string; title: string; summary: string; status: string; updated: string }> = []
  for (const s of json.studies || []) {
    const p = s.protocolSection
    const nctId = p?.identificationModule?.nctId
    const title = p?.identificationModule?.briefTitle
    if (!nctId || !title) continue
    out.push({
      nctId,
      title: decodeXml(title),
      summary: decodeXml(p?.descriptionModule?.briefSummary || ''),
      status: p?.statusModule?.overallStatus || 'UNKNOWN',
      updated: p?.statusModule?.lastUpdatePostDateStruct?.date || '',
    })
  }
  return out
}

const CLINICAL: StreamConnector = {
  category: 'clinical',
  query: 'oncology OR metastasis',
  async fetch(limit, ctx) {
    const url =
      `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(this.query)}` +
      `&pageSize=${Math.max(1, Math.min(50, limit))}` +
      `&fields=NCTId,BriefTitle,BriefSummary,LastUpdatePostDate,OverallStatus`
    const json = await fetchJson<{ studies?: CtStudy[] }>(url)
    return parseClinicalTrials(json).map((e) => {
      const novelty = lexicalNovelty(e.title, ctx.knownTitles)
      const recency = recencyScore(e.updated, ctx.now)
      return {
        title: e.title,
        content: e.summary.slice(0, 1000),
        features: { source: 'clinicaltrials.gov', nctId: e.nctId, status: e.status, updated: e.updated },
        anomalyScore: anomalyScore(recency, novelty),
        noveltyScore: novelty,
      }
    })
  },
}

export const CONNECTORS: StreamConnector[] = [ARXIV, CLINICAL]

export function connectorFor(category: string): StreamConnector | undefined {
  return CONNECTORS.find((c) => c.category === category)
}
