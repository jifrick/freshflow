import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { compareOptions, evaluateOption, hoursRemaining, matchDemand, riskLevel } from '../../../src/domain/decisionEngine.ts'
import { calculateGrossSalesValue, calculateNetProceeds } from '../../../src/domain/economics.ts'
import { AiReportError, requestAiDecisionNarrative, type AiReportEvidence } from '../../../src/domain/openAiReport.ts'
import type { BuyerDemand, DecisionOption, InventoryBatch } from '../../../src/domain/types.ts'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'content-type': 'application/json',
  'cache-control': 'no-store',
}
const windowMs = 5 * 60_000
const maxCallsPerWindow = 4
const requestsByUser = new Map<string, number[]>()

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: cors })
}

function rateLimited(userId: string, now = Date.now()): boolean {
  if (requestsByUser.size > 2_000) {
    for (const [key, values] of requestsByUser) {
      const active = values.filter((timestamp) => now - timestamp < windowMs)
      if (active.length) requestsByUser.set(key, active)
      else requestsByUser.delete(key)
    }
    while (requestsByUser.size > 2_000) requestsByUser.delete(requestsByUser.keys().next().value!)
  }
  const recent = (requestsByUser.get(userId) ?? []).filter((timestamp) => now - timestamp < windowMs)
  if (recent.length >= maxCallsPerWindow) {
    requestsByUser.set(userId, recent)
    return true
  }
  requestsByUser.set(userId, [...recent, now])
  return false
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return json(401, { error: 'authentication_required' })

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > 2048) return json(413, { error: 'request_too_large' })
  let payload: unknown
  try {
    const reader = request.body?.getReader()
    if (!reader) return json(400, { error: 'invalid_request' })
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2048) { await reader.cancel(); return json(413, { error: 'request_too_large' }) }
      chunks.push(value)
    }
    let offset = 0
    const bytes = new Uint8Array(size)
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const bodyText = new TextDecoder().decode(bytes)
    payload = JSON.parse(bodyText)
  } catch {
    return json(400, { error: 'invalid_request' })
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>).inventoryId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((payload as Record<string, string>).inventoryId)) {
    return json(400, { error: 'invalid_inventory_id' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const publishableKeyMap = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  let publishableKey: string | undefined
  try { publishableKey = publishableKeyMap ? (JSON.parse(publishableKeyMap) as Record<string, string>).default : undefined } catch { publishableKey = undefined }
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || publishableKey
  if (!supabaseUrl || !anonKey) return json(503, { error: 'backend_unavailable' })

  const boundedFetch: typeof fetch = (input, init) => fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(8_000),
  })
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: boundedFetch },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  const user = authData.user
  if (authError || !user) return json(401, { error: 'authentication_required' })
  if (rateLimited(user.id)) return json(429, { error: 'rate_limited' })
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) return json(503, { error: 'ai_unavailable' })

  const inventoryId = (payload as { inventoryId: string }).inventoryId
  const { data: row, error: inventoryError } = await supabase.from('inventory_batches')
    .select('id, owner_id, produce, quantity, available_quantity, unit, location, quality, asking_price, available_at, harvested_or_purchased_at, freshness_hours, status, archived_at')
    .eq('id', inventoryId).eq('owner_id', user.id).maybeSingle()
  if (inventoryError) return json(503, { error: 'inventory_unavailable' })
  if (!row) return json(404, { error: 'inventory_not_found' })
  if (row.archived_at || !['available', 'at_risk', 'partially_sold'].includes(row.status)) {
    return json(409, { error: 'inventory_not_analyzable' })
  }

  const { data: demandRows, error: demandError } = await supabase.from('buyer_demands')
    .select('id, buyer_id, produce, quantity, fulfilled_quantity, unit, max_price, location, required_by, quality, status, is_published')
    .eq('is_published', true).eq('status', 'published').gte('required_by', new Date().toISOString())
    .order('required_by', { ascending: true }).limit(20)
  if (demandError) return json(503, { error: 'demand_unavailable' })
  const { data: offerRows, error: offerError } = await supabase.from('offers')
    .select('id, demand_id, quantity, unit_price, known_costs')
    .eq('inventory_id', inventoryId).eq('seller_id', user.id).eq('status', 'pending').limit(20)
  if (offerError) return json(503, { error: 'offers_unavailable' })

  const now = new Date()
  const batch: InventoryBatch = {
    id: row.id, ownerId: row.owner_id, produce: row.produce, quantity: Number(row.quantity),
    availableQuantity: Number(row.available_quantity), unit: row.unit, location: row.location,
    quality: row.quality, askingPrice: row.asking_price === null ? null : Number(row.asking_price),
    purchaseCost: null, availableAt: row.available_at,
    harvestedOrPurchasedAt: row.harvested_or_purchased_at,
    freshnessHours: row.freshness_hours === null ? null : Number(row.freshness_hours),
    status: row.status, archivedAt: row.archived_at,
  }
  const demands: BuyerDemand[] = (demandRows ?? []).map((demand) => ({
    id: demand.id, ownerId: demand.buyer_id, buyerName: 'Published buyer requirement',
    produce: String(demand.produce).slice(0, 100), quantity: Number(demand.quantity), fulfilledQuantity: Number(demand.fulfilled_quantity),
    unit: demand.unit, maxPrice: demand.max_price === null ? null : Number(demand.max_price),
    location: String(demand.location).slice(0, 100), requiredBy: demand.required_by, quality: demand.quality,
    confirmed: demand.is_published, status: demand.status,
  }))
  const costs = { transport: null, handling: null, storage: null, processing: null, platform: null }
  const options = compareOptions(demands.map((demand) => evaluateOption(batch, demand, costs, now)))
  const matchingDemands = demands.filter((demand) => matchDemand(batch, demand, now).matched)
  const matches = compareOptions(matchingDemands.map((demand) => evaluateOption(batch, demand, costs, now)))
  const demandReferences = new Map(matchingDemands.map((demand, index) => [demand.id, `requirement-${index + 1}`]))
  const offerReferences = new Map((offerRows ?? []).map((offer, index) => [offer.id, `offer-${index + 1}`]))
  const allowedNextAction: AiReportEvidence['allowedNextAction'] = matches.some((option) => option.feasible)
    ? 'evaluate_feasible_option'
    : matches.length > 0 ? 'complete_missing_information' : 'review_inventory_or_find_demand'
  const existingOffers = (offerRows ?? []).flatMap((offer) => {
    const rawCosts = offer.known_costs && typeof offer.known_costs === 'object' ? offer.known_costs as Record<string, unknown> : {}
    const normalizedCosts = Object.fromEntries(['transport', 'handling', 'storage', 'processing', 'platform'].map((key) => {
      const value = rawCosts[key]
      return [key, value === null || value === undefined || value === '' ? null : Number(value)]
    })) as { transport: number | null; handling: number | null; storage: number | null; processing: number | null; platform: number | null }
    const quantity = Number(offer.quantity)
    const unitPrice = Number(offer.unit_price)
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0 ||
        Object.values(normalizedCosts).some((value) => value !== null && (!Number.isFinite(value) || value < 0))) return []
    let netProceeds: number | null = null
    try { netProceeds = calculateNetProceeds(quantity, unitPrice, normalizedCosts) } catch { netProceeds = null }
    return [{
      id: offerReferences.get(offer.id)!, demandId: demandReferences.get(offer.demand_id) ?? 'related_requirement', quantity, unitPrice, costs: normalizedCosts,
      grossProceeds: calculateGrossSalesValue(quantity, unitPrice), netProceeds,
    }]
  })
  const missingInformation = new Set<string>()
  if (!batch.harvestedOrPurchasedAt) missingInformation.add('Harvest or purchase date; freshness age is unknown')
  if (batch.freshnessHours === null) missingInformation.add('Reported freshness window')
  if (batch.askingPrice === null) missingInformation.add('Seller asking price')
  for (const option of matches) {
    option.missing.forEach((item) => missingInformation.add(item))
    option.requiredChecks.forEach((item) => missingInformation.add(item))
  }
  if (!matches.length) missingInformation.add('No compatible published buyer requirement is currently available')
  if (!existingOffers.length) missingInformation.add('No pending seller offer is recorded for this inventory')
  missingInformation.add('No live transport, handling, storage, or processing quote is recorded')
  missingInformation.add('Open buyer offers are not yet included in this analysis')

  const facts: AiReportEvidence = {
    allowedNextAction,
    inventory: {
      id: 'selected_inventory', produce: String(batch.produce).slice(0, 100), quantity: batch.quantity, availableQuantity: batch.availableQuantity,
      unit: batch.unit, location: String(batch.location).slice(0, 100), condition: batch.quality,
      harvestedOrPurchasedAt: batch.harvestedOrPurchasedAt, freshnessHours: batch.freshnessHours,
      risk: riskLevel(batch, now), hoursRemaining: hoursRemaining(batch, now),
    },
    demands: matchingDemands.map((demand) => ({
      id: demandReferences.get(demand.id)!, produce: demand.produce, quantity: demand.quantity,
      remainingQuantity: demand.quantity - (demand.fulfilledQuantity ?? 0), unit: demand.unit,
      maxPrice: demand.maxPrice, location: demand.location, requiredBy: demand.requiredBy,
      quality: demand.quality ?? null,
    })),
    options: matches.map((option) => ({
      demandId: demandReferences.get(option.demand.id)!, quantity: option.quantity, unitPrice: option.unitPrice,
      costs: option.costs, grossProceeds: option.unitPrice === null ? null : calculateGrossSalesValue(option.quantity, option.unitPrice),
      netProceeds: option.netProceeds, feasible: option.feasible, missing: option.missing,
      requiredChecks: option.requiredChecks, reason: option.reason,
    })),
    offers: existingOffers,
    missingInformation: [...missingInformation],
  }

  try {
    const narrative = await requestAiDecisionNarrative(facts, {
      apiKey, model: Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini', signal: AbortSignal.timeout(15_000),
    })
    return json(200, { source: 'openai', model: Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini', narrative, facts })
  } catch (error) {
    if (error instanceof AiReportError) {
      const status = error.kind === 'unavailable' ? 503 : error.kind === 'timeout' ? 504 : 502
      return json(status, { error: error.kind })
    }
    return json(502, { error: 'analysis_failed' })
  }
}

Deno.serve(async (request: Request) => {
  try {
    return await handleRequest(request)
  } catch {
    return json(500, { error: 'analysis_failed' })
  }
})
