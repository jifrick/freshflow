import type { AlternativeCost } from './types.ts'

export type AiReportEvidence = {
  allowedNextAction: 'evaluate_feasible_option' | 'complete_missing_information' | 'review_inventory_or_find_demand'
  inventory: {
    id: string
    produce: string
    quantity: number
    availableQuantity: number
    unit: string
    location: string
    condition: string
    harvestedOrPurchasedAt: string | null
    freshnessHours: number | null
    risk: string
    hoursRemaining: number | null
  }
  demands: Array<{
    id: string
    produce: string
    quantity: number
    remainingQuantity: number
    unit: string
    maxPrice: number | null
    location: string
    requiredBy: string
    quality: string | null
  }>
  options: Array<{
    demandId: string
    quantity: number
    unitPrice: number | null
    costs: AlternativeCost
    grossProceeds: number | null
    netProceeds: number | null
    feasible: boolean
    missing: string[]
    requiredChecks: string[]
    reason: string
  }>
  offers: Array<{
    id: string
    demandId: string
    quantity: number
    unitPrice: number
    costs: AlternativeCost
    grossProceeds: number | null
    netProceeds: number | null
  }>
  missingInformation: string[]
}

export type AiDecisionNarrative = {
  summary: string
  riskObservations: Array<{ text: string; evidenceIds: string[] }>
  matchNotes: Array<{ demandId: string; text: string }>
  offerNotes: Array<{ offerId: string; text: string }>
  recommendedAction: AiReportEvidence['allowedNextAction']
  recommendedDemandId: string | null
  recommendationRationale: string
  recommendationEvidenceIds: string[]
  cautions: string[]
}

export class AiReportError extends Error {
  constructor(readonly kind: 'unavailable' | 'api' | 'invalid_response' | 'timeout', message: string) {
    super(message)
    this.name = 'AiReportError'
  }
}

const nonNumericText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 400 && !/[\d₹$€£]/u.test(value)

function stringList(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every(nonNumericText)
}

function hasExactKeys(value: unknown, expected: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)))
}

export function validateAiDecisionNarrative(value: unknown, facts: AiReportEvidence): AiDecisionNarrative {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiReportError('invalid_response', 'The analysis response was not valid.')
  const item = value as Record<string, unknown>
  const demandIds = new Set(facts.demands.map((demand) => demand.id))
  const offerIds = new Set(facts.offers.map((offer) => offer.id))
  const eligibleIds = new Set(facts.options.filter((option) => option.feasible).map((option) => option.demandId))
  const evidenceIds = new Set(['inventory', 'freshness', 'condition', ...facts.demands.map((demand) => `demand:${demand.id}`), ...facts.offers.map((offer) => `offer:${offer.id}`)])
  const citationsValid = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 5 && ids.every((id) => typeof id === 'string' && evidenceIds.has(id))

  if (!hasExactKeys(item, ['summary', 'riskObservations', 'matchNotes', 'offerNotes', 'recommendedAction', 'recommendedDemandId', 'recommendationRationale', 'recommendationEvidenceIds', 'cautions']) ||
      !nonNumericText(item.summary) || !Array.isArray(item.riskObservations) || item.riskObservations.length > 5 ||
      !item.riskObservations.every((observation) => hasExactKeys(observation, ['text', 'evidenceIds']) &&
        nonNumericText((observation as Record<string, unknown>).text) && citationsValid((observation as Record<string, unknown>).evidenceIds)) ||
      !Array.isArray(item.matchNotes) || item.matchNotes.length > 8 ||
      !item.matchNotes.every((note) => hasExactKeys(note, ['demandId', 'text']) && demandIds.has(String((note as Record<string, unknown>).demandId)) && nonNumericText((note as Record<string, unknown>).text)) ||
      !Array.isArray(item.offerNotes) || item.offerNotes.length > 8 ||
      !item.offerNotes.every((note) => hasExactKeys(note, ['offerId', 'text']) && offerIds.has(String((note as Record<string, unknown>).offerId)) && nonNumericText((note as Record<string, unknown>).text)) ||
      item.recommendedAction !== facts.allowedNextAction ||
      (item.recommendedAction === 'evaluate_feasible_option'
        ? !(typeof item.recommendedDemandId === 'string' && eligibleIds.has(item.recommendedDemandId))
        : item.recommendedDemandId !== null) ||
      !(item.recommendedDemandId === null || (typeof item.recommendedDemandId === 'string' && eligibleIds.has(item.recommendedDemandId))) ||
      !nonNumericText(item.recommendationRationale) || !citationsValid(item.recommendationEvidenceIds) || !stringList(item.cautions, 5)) {
    throw new AiReportError('invalid_response', 'The analysis response did not pass validation.')
  }
  return item as AiDecisionNarrative
}

export async function requestAiDecisionNarrative(
  facts: AiReportEvidence,
  options: { apiKey?: string; model?: string; fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<AiDecisionNarrative> {
  if (!options.apiKey) throw new AiReportError('unavailable', 'AI analysis is not configured.')
  const fetcher = options.fetcher ?? fetch
  const model = options.model || 'gpt-5-mini'
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      riskObservations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, evidenceIds: { type: 'array', items: { type: 'string' } } }, required: ['text', 'evidenceIds'] } },
      matchNotes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { demandId: { type: 'string' }, text: { type: 'string' } }, required: ['demandId', 'text'] } },
      offerNotes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { offerId: { type: 'string' }, text: { type: 'string' } }, required: ['offerId', 'text'] } },
      recommendedAction: { type: 'string', enum: ['evaluate_feasible_option', 'complete_missing_information', 'review_inventory_or_find_demand'] },
      recommendedDemandId: { type: ['string', 'null'] },
      recommendationRationale: { type: 'string' },
      recommendationEvidenceIds: { type: 'array', items: { type: 'string' } },
      cautions: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'riskObservations', 'matchNotes', 'offerNotes', 'recommendedAction', 'recommendedDemandId', 'recommendationRationale', 'recommendationEvidenceIds', 'cautions'],
  }
  let response: Response
  try {
    response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST', signal: options.signal,
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 900,
        input: [
          { role: 'system', content: 'You write cautious decision-support notes for food inventory. Use only the supplied facts. Do not calculate or state numbers, prices, names, or unsupported claims. Never claim food safety or guaranteed shelf life. Cite only supplied evidence IDs. Explain only submitted demand or pending offer records. Copy allowedNextAction exactly from the supplied evidence. Recommend a demand only if its supplied option is feasible; otherwise use null and explain what information or checks are needed. You cannot execute actions.' },
          { role: 'user', content: JSON.stringify(facts) },
        ],
        text: { format: { type: 'json_schema', name: 'freshflow_decision_narrative', strict: true, schema } },
      }),
    })
  } catch {
    throw new AiReportError('timeout', 'The analysis service could not be reached. Please retry.')
  }
  if (!response.ok) throw new AiReportError('api', 'The analysis service returned an error. Please retry later.')

  try {
    const responseText = await response.text()
    if (responseText.length > 64_000) throw new Error('response too large')
    const body = JSON.parse(responseText) as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }> }
    const outputs = body.output?.flatMap((item) => item.content ?? []) ?? []
    if (outputs.some((part) => part.type === 'refusal')) throw new Error('refusal')
    const text = outputs.find((part) => part.type === 'output_text')?.text
    if (!text) throw new Error('missing output')
    return validateAiDecisionNarrative(JSON.parse(text), facts)
  } catch (error) {
    if (error instanceof AiReportError) throw error
    throw new AiReportError('invalid_response', 'The analysis response was incomplete or invalid. Please retry.')
  }
}
