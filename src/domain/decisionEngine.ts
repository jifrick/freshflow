import type { BuyerDemand, DecisionOption, InventoryBatch } from './types.ts'
import { calculateNetProceeds } from './economics.ts'

// Operational review thresholds only. They are not crop-specific spoilage predictions.
export const FRESHNESS_THRESHOLDS_HOURS = { urgent: 24, atRisk: 72, monitor: 120 } as const

export function hoursRemaining(batch: InventoryBatch, now = new Date()): number | null {
  if (batch.freshnessHours === null || !Number.isFinite(batch.freshnessHours) || batch.freshnessHours <= 0) return null
  if (!batch.harvestedOrPurchasedAt) return null
  const ageStart = new Date(batch.harvestedOrPurchasedAt).getTime()
  const current = now.getTime()
  if (!Number.isFinite(ageStart) || !Number.isFinite(current) || ageStart > current) return null
  return batch.freshnessHours - (current - ageStart) / 3_600_000
}

export function riskLevel(batch: InventoryBatch, now = new Date()): 'urgent' | 'at_risk' | 'monitor' | 'unknown' | 'normal' {
  const remaining = hoursRemaining(batch, now)
  if (remaining === null) return 'unknown'
  if (remaining <= FRESHNESS_THRESHOLDS_HOURS.urgent) return 'urgent'
  if (remaining <= FRESHNESS_THRESHOLDS_HOURS.atRisk) return 'at_risk'
  if (remaining <= FRESHNESS_THRESHOLDS_HOURS.monitor) return 'monitor'
  return 'normal'
}

export function matchDemand(batch: InventoryBatch, demand: BuyerDemand, now = new Date()): { matched: boolean; reasons: string[]; quantity: number } {
  const reasons: string[] = []
  if (batch.produce.trim().toLocaleLowerCase() !== demand.produce.trim().toLocaleLowerCase()) reasons.push('Product does not match')
  if (batch.unit !== demand.unit) reasons.push('Quantity units do not match')
  if (batch.archivedAt) reasons.push('Inventory batch is archived')
  if (!['available', 'at_risk', 'partially_sold'].includes(batch.status)) reasons.push('Inventory batch is not available')
  if (batch.availableQuantity <= 0) reasons.push('No available quantity')
  if (demand.confirmed === false) reasons.push('Buyer requirement is not published')
  if (demand.status && demand.status !== 'published') reasons.push('Buyer requirement is not active')
  const remainingDemand = demand.quantity - (demand.fulfilledQuantity ?? 0)
  if (!Number.isFinite(demand.quantity) || demand.quantity <= 0 || !Number.isFinite(remainingDemand) || remainingDemand <= 0) reasons.push('Buyer requirement has no valid remaining quantity')
  const deadline = new Date(demand.requiredBy).getTime()
  if (!Number.isFinite(deadline) || deadline < now.getTime()) reasons.push('Buyer requirement is expired or has an invalid deadline')
  const qualityRank = { 'Needs sorting': 1, Good: 2, Premium: 3 }
  if (demand.quality && qualityRank[batch.quality] < qualityRank[demand.quality]) reasons.push('Inventory quality does not meet the buyer requirement')
  const quantity = Math.min(batch.availableQuantity, Math.max(0, remainingDemand))
  return { matched: reasons.length === 0, reasons, quantity: reasons.length === 0 ? quantity : 0 }
}

export function evaluateOption(batch: InventoryBatch, demand: BuyerDemand, costs: DecisionOption['costs'], now = new Date()): DecisionOption {
  const match = matchDemand(batch, demand, now)
  const missing: string[] = []
  const requiredChecks: string[] = []
  if (demand.maxPrice === null) missing.push('Buyer price limit')
  if (batch.askingPrice === null) missing.push('Seller asking price')
  if (costs.transport === null) missing.push('Transport quote')
  if (costs.handling === null) missing.push('Handling cost')
  if (costs.storage === null) missing.push('Storage cost')
  if (costs.processing === null) missing.push('Processing cost')
  if (costs.platform === null) missing.push('Platform fee')
  const sameLocation = batch.location.trim().toLocaleLowerCase() === demand.location.trim().toLocaleLowerCase()
  if (!sameLocation) requiredChecks.push('Confirm route and delivery feasibility')
  const unitPrice = demand.maxPrice !== null && batch.askingPrice !== null
    ? Math.min(demand.maxPrice, batch.askingPrice)
    : null
  const netProceeds = unitPrice !== null && match.matched
    ? calculateNetProceeds(match.quantity, unitPrice, costs)
    : null
  const priceCompatible = unitPrice !== null && (batch.askingPrice === null || unitPrice >= batch.askingPrice)
  const feasible = match.matched && priceCompatible && requiredChecks.length === 0 && unitPrice !== null && unitPrice > 0 && netProceeds !== null && netProceeds >= 0
  return {
    batch, demand, quantity: match.quantity, unitPrice, costs, feasible, missing, netProceeds,
    reason: !match.matched ? match.reasons.join(', ') : !priceCompatible ? 'Buyer price limit is below the seller asking price.' : requiredChecks.length ? 'Confirm route and delivery feasibility before acting.' : feasible
      ? `Up to ${match.quantity} ${batch.unit} can be fulfilled. Net proceeds include all recorded costs.`
      : missing.length ? `Comparison is incomplete. Add ${missing.join(', ').toLocaleLowerCase()}.` : 'Recorded costs exceed potential revenue.',
    requiredChecks,
  }
}

export function compareOptions(options: DecisionOption[]): DecisionOption[] {
  return [...options].sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1
    return (b.netProceeds ?? Number.NEGATIVE_INFINITY) - (a.netProceeds ?? Number.NEGATIVE_INFINITY)
  })
}

export function reserveQuantity(batch: InventoryBatch, quantity: number): InventoryBatch {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Reservation quantity must be greater than zero')
  if (quantity > batch.availableQuantity) throw new Error('Reservation exceeds available inventory')
  return { ...batch, availableQuantity: batch.availableQuantity - quantity, status: batch.availableQuantity === quantity ? 'reserved' : batch.status }
}

export function completeSale(batch: InventoryBatch, quantity: number): InventoryBatch {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Sale quantity must be greater than zero')
  const reserved = batch.quantity - batch.availableQuantity
  if (quantity > reserved) throw new Error('Sale quantity exceeds reserved inventory')
  const remaining = batch.quantity - quantity
  return { ...batch, quantity: remaining, availableQuantity: batch.availableQuantity, status: remaining === 0 ? 'completed' : 'partially_sold' }
}
