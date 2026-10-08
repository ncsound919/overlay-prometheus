// ─── LLM discovery helper (Layer 4) ──────────────────────────────────────────
// The LLM is an enhancement, never a blocker: every call is wrapped in a
// ~20s timeout guard and a defensive try/catch. On any failure the caller
// falls back to the deterministic template generator.

import ZAI from 'z-ai-web-dev-sdk'
import { CATEGORIES, clamp01, round3 } from '@/lib/engine/content'

const LLM_TIMEOUT_MS = 20_000

// ─── Rate-limit cooldown (progressive backoff) ──────────────────────────────
// The engine now ticks 7x24 (engine-feed heartbeat), so discovery calls fire
// even with no browser open. On a 429 we back off before touching the quota
// again: 90s first, each extra 429 multiplies the pause, capped at 10 min.
// During cooldown generateHypothesesWithLlm resolves null immediately and the
// caller falls back to the deterministic template generator.

const COOLDOWN_BASE_MS = 90_000
const COOLDOWN_MAX_MS = 600_000

const llmRate = globalThis as unknown as {
  __llmCooldownUntil?: number
  __llm429Strikes?: number
}

function inCooldown(now = Date.now()): boolean {
  return (llmRate.__llmCooldownUntil ?? 0) > now
}

function tripCooldown(now = Date.now()): number {
  const strikes = (llmRate.__llm429Strikes ?? 0) + 1
  llmRate.__llm429Strikes = strikes
  const ms = Math.min(COOLDOWN_BASE_MS * 2 ** (strikes - 1), COOLDOWN_MAX_MS)
  llmRate.__llmCooldownUntil = now + ms
  console.warn(`[engine/llm] 429 rate limit — LLM discovery cooling down for ${Math.round(ms / 1000)}s (strike ${strikes})`)
  return ms
}

function is429(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status
    if (status === 429) return true
  }
  return error instanceof Error && /\b429\b|too many requests/i.test(error.message)
}

export interface LlmCounterfactual {
  question: string
  result: string
  supports: boolean
}

export interface LlmHypothesis {
  title: string
  summary: string
  domains: string[]
  novelty: number
  impact: number
  confidence: number
  counterfactuals: LlmCounterfactual[]
}

const SYSTEM_PROMPT =
  'You are an expert cross-domain scientific hypothesis engine operating inside an autonomous discovery system. ' +
  'You connect anomalous signals from disparate scientific domains into falsifiable, novel, high-impact hypotheses. ' +
  'You respond with STRICT JSON only — no prose, no markdown fences, no commentary.'

function buildUserPrompt(signalTitles: string[]): string {
  const lines = signalTitles.slice(0, 10).map((t) => `- ${t}`).join('\n')
  return (
    'Anomalous signals observed this cycle:\n' +
    lines +
    '\n\nGenerate 2-3 cross-domain hypotheses inspired by these signals. ' +
    'Each hypothesis must connect at least two DIFFERENT domains.\n' +
    `Allowed domain strings: ${CATEGORIES.join(', ')}.\n` +
    'Respond with a STRICT JSON array only, shaped exactly like:\n' +
    '[{"title": string, "summary": string, "domains": string[2-3], "novelty": 0-1, "impact": 0-1, "confidence": 0-1, ' +
    '"counterfactuals": [{"question": string, "result": string, "supports": boolean}]}]'
  )
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asString(v: unknown, minLen: number): string | null {
  return typeof v === 'string' && v.trim().length >= minLen ? v.trim() : null
}

function sanitizeDomains(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') continue
    const norm = item.trim().toLowerCase()
    if ((CATEGORIES as readonly string[]).includes(norm) && !out.includes(norm)) out.push(norm)
    if (out.length === 3) break
  }
  return out.length >= 1 ? out : null
}

function sanitizeCounterfactuals(v: unknown): LlmCounterfactual[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const out: LlmCounterfactual[] = []
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue
    const rec = raw as Record<string, unknown>
    const question = asString(rec.question, 8)
    const result = asString(rec.result, 4)
    if (!question || !result) continue
    out.push({ question, result, supports: rec.supports === true })
    if (out.length === 4) break
  }
  return out.length > 0 ? out : null
}

/**
 * Parse and validate a raw LLM completion into well-formed hypotheses.
 * Returns null when nothing usable survives validation.
 */
export function parseLlmHypotheses(rawText: string): LlmHypothesis[] | null {
  try {
    const jsonSlice = extractJsonArray(rawText)
    if (!jsonSlice) return null
    const parsed: unknown = JSON.parse(jsonSlice)
    if (!Array.isArray(parsed)) return null

    const out: LlmHypothesis[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const rec = item as Record<string, unknown>
      const title = asString(rec.title, 8)
      const summary = asString(rec.summary, 20)
      const domains = sanitizeDomains(rec.domains)
      const counterfactuals = sanitizeCounterfactuals(rec.counterfactuals)
      const novelty = asFiniteNumber(rec.novelty)
      const impact = asFiniteNumber(rec.impact)
      const confidence = asFiniteNumber(rec.confidence)
      if (!title || !summary || !domains || !counterfactuals) continue
      if (novelty === null || impact === null || confidence === null) continue
      out.push({
        title: title.slice(0, 220),
        summary: summary.slice(0, 1200),
        domains,
        novelty: round3(clamp01(novelty)),
        impact: round3(clamp01(impact)),
        confidence: round3(clamp01(confidence)),
        counterfactuals: counterfactuals.map((c) => ({
          question: c.question.slice(0, 300),
          result: c.result.slice(0, 500),
          supports: c.supports,
        })),
      })
      if (out.length === 3) break
    }
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

async function callLlm(signalTitles: string[]): Promise<LlmHypothesis[] | null> {
  const zai = await ZAI.create()
  const completion = (await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(signalTitles) },
    ],
    thinking: { type: 'disabled' },
  })) as { choices?: Array<{ message?: { content?: string } }> }

  const text = completion?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.length === 0) return null
  return parseLlmHypotheses(text)
}

/**
 * Generate hypotheses with the LLM under a hard timeout.
 * Resolves null on timeout, transport error, or unusable output —
 * callers must fall back to the template generator.
 */
export async function generateHypothesesWithLlm(
  signalTitles: string[],
): Promise<LlmHypothesis[] | null> {
  if (signalTitles.length === 0) return null
  if (inCooldown()) return null // quota protection — template fallback takes over
  try {
    const result = await Promise.race([
      callLlm(signalTitles),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), LLM_TIMEOUT_MS)
        if (typeof timer === 'object' && 'unref' in timer) {
          ;(timer as { unref: () => void }).unref()
        }
      }),
    ])
    if (!result) {
      console.error('[engine/llm] discovery call returned no usable hypotheses (timeout or empty)')
      return null
    }
    llmRate.__llm429Strikes = 0 // success resets the backoff ladder
    return result
  } catch (error) {
    if (is429(error)) {
      tripCooldown()
    } else {
      console.error('[engine/llm] discovery call failed, falling back to templates:', error)
    }
    return null
  }
}
