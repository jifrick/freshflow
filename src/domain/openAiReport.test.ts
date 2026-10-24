import { describe, expect, it, vi } from 'vitest'
import { evaluateOption } from './decisionEngine'
import { calculateGrossSalesValue, calculateNetProceeds } from './economics'
import { requestAiDecisionNarrative, type AiReportEvidence } from './openAiReport'
import type { BuyerDemand, InventoryBatch } from './types'

const facts: AiReportEvidence = {
  allowedNextAction: 'complete_missing_information',
  inventory: { id: 'batch-1', produce: 'Tomatoes', quantity: 10, availableQuantity: 10, unit: 'kg', location: 'Aluva', condition: 'Good', harvestedOrPurchasedAt: null, freshnessHours: null, risk: 'unknown', hoursRemaining: null },
  demands: [{ id: 'demand-1', produce: 'Tomatoes', quantity: 8, remainingQuantity: 8, unit: 'kg', maxPrice: 30, location: 'Aluva', requiredBy: '2026-11-01T00:00:00Z', quality: null }],
  options: [{ demandId: 'demand-1', quantity: 8, unitPrice: 28, costs: { transport: null, handling: null, storage: null, processing: null, platform: null }, grossProceeds: 224, netProceeds: null, feasible: false, missing: ['Transport quote'], requiredChecks: [], reason: 'Comparison is incomplete.' }],
  offers: [],
  missingInformation: ['Harvest or purchase date; freshness age is unknown', 'Transport quote'],
}
const validNarrative = {
  summary: 'A published demand may be relevant, but the evidence is incomplete.',
  riskObservations: [{ text: 'Freshness age cannot be assessed from the supplied record.', evidenceIds: ['freshness'] }],
  matchNotes: [{ demandId: 'demand-1', text: 'The product and quantity are compatible with the recorded requirement.' }],
  offerNotes: [],
  recommendedAction: 'complete_missing_information' as const,
  recommendedDemandId: null,
  recommendationRationale: 'Confirm the missing delivery costs before comparing net proceeds.',
  recommendationEvidenceIds: ['demand:demand-1'],
  cautions: ['Freshness remains unknown until a harvest or purchase date is recorded.'],
}

function openAiResponse(output: string, status = 200): Response {
  return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: output }] }] }), { status })
}

describe('OpenAI decision narrative', () => {
  it('parses a valid structured Responses API result', async () => {
    let requestBody = ''
    const fetcher: typeof fetch = async (...args) => { requestBody = String(args[1]?.body); return openAiResponse(JSON.stringify(validNarrative)) }
    const result = await requestAiDecisionNarrative(facts, { apiKey: 'server-only-test', fetcher })
    expect(result.summary).toBe(validNarrative.summary)
    const body = JSON.parse(requestBody)
    expect(body.model).toBe('gpt-5-mini')
    expect(body.text.format.strict).toBe(true)
    expect(body.store).toBe(false)
    expect(body.input[1].content).toContain('"risk":"unknown"')
  })

  it('rejects malformed structured output', async () => {
    await expect(requestAiDecisionNarrative(facts, { apiKey: 'test', fetcher: async () => openAiResponse('{bad') }))
      .rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('handles unknown freshness and no matched demand without inventing a candidate', async () => {
    const noMatch: AiReportEvidence = { ...facts, allowedNextAction: 'review_inventory_or_find_demand', demands: [], options: [], missingInformation: ['No published buyer requirement', 'Freshness age is unknown'] }
    const narrative = { ...validNarrative, matchNotes: [], recommendedAction: 'review_inventory_or_find_demand', recommendedDemandId: null, recommendationEvidenceIds: ['freshness'] }
    let requestBody = ''
    const fetcher: typeof fetch = async (...args) => { requestBody = String(args[1]?.body); return openAiResponse(JSON.stringify(narrative)) }
    await requestAiDecisionNarrative(noMatch, { apiKey: 'test', fetcher })
    const body = JSON.parse(requestBody)
    expect(body.input[1].content).toContain('"demands":[]')
    expect(noMatch.inventory.risk).toBe('unknown')
    expect(noMatch.options).toHaveLength(0)
  })

  it('rejects a recommendation for an infeasible or unknown demand', async () => {
    const invalid = { ...validNarrative, recommendedAction: 'evaluate_feasible_option', recommendedDemandId: 'untrusted-demand' }
    await expect(requestAiDecisionNarrative(facts, { apiKey: 'test', fetcher: async () => openAiResponse(JSON.stringify(invalid)) }))
      .rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('rejects extra fields even if a mocked provider response includes them', async () => {
    const invalid = { ...validNarrative, inventedPrice: 999 }
    await expect(requestAiDecisionNarrative(facts, { apiKey: 'test', fetcher: async () => openAiResponse(JSON.stringify(invalid)) }))
      .rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('reports unavailable credentials without making a network request', async () => {
    const fetcher = vi.fn()
    await expect(requestAiDecisionNarrative(facts, { fetcher })).rejects.toMatchObject({ kind: 'unavailable' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('handles OpenAI API failures without exposing provider details', async () => {
    await expect(requestAiDecisionNarrative(facts, { apiKey: 'test', fetcher: async () => new Response('private provider error', { status: 500 }) }))
      .rejects.toMatchObject({ kind: 'api', message: 'The analysis service returned an error. Please retry later.' })
  })

  it('handles network failure as a retryable timeout state', async () => {
    await expect(requestAiDecisionNarrative(facts, { apiKey: 'test', fetcher: async () => { throw new Error('network failure') } }))
      .rejects.toMatchObject({ kind: 'timeout' })
  })

  it('keeps report economics identical to the deterministic economics module', () => {
    const costs = { transport: 12.5, handling: 3, storage: 0, processing: 0, platform: 1 }
    const batch: InventoryBatch = { id: 'b', ownerId: 'seller', produce: 'Tomatoes', quantity: 10, availableQuantity: 10, unit: 'kg', location: 'Aluva', quality: 'Good', askingPrice: 28, purchaseCost: null, availableAt: '2026-10-24T00:00:00Z', harvestedOrPurchasedAt: '2026-10-24T00:00:00Z', freshnessHours: 72, status: 'available' }
    const demand: BuyerDemand = { id: 'd', buyerName: 'Published buyer requirement', produce: 'Tomatoes', quantity: 8, unit: 'kg', maxPrice: 30, location: 'Aluva', requiredBy: '2026-11-01T00:00:00Z', confirmed: true, status: 'published' }
    const option = evaluateOption(batch, demand, costs, new Date('2026-10-24T01:00:00Z'))
    expect(calculateGrossSalesValue(option.quantity, option.unitPrice!)).toBe(224)
    expect(option.netProceeds).toBe(calculateNetProceeds(option.quantity, option.unitPrice!, costs))
    expect(option.netProceeds).toBe(207.5)
  })
})
