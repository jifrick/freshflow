import type { BuyerDemand, DecisionOption, InventoryBatch } from './types'

export function hoursRemaining(batch: InventoryBatch, now = new Date()): number | null {
  if (batch.freshnessHours === null) return null
  const available = new Date(batch.availableAt).getTime()
  if (!Number.isFinite(available)) return null
  return batch.freshnessHours - (now.getTime() - available) / 3_600_000
}

export function riskLevel(batch: InventoryBatch, now = new Date()): 'urgent' | 'at_risk' | 'monitor' | 'unknown' | 'normal' {
  const remaining = hoursRemaining(batch, now)
  if (remaining === null) return 'unknown'
  if (remaining <= 24) return 'urgent'
  if (remaining <= 72) return 'at_risk'
  if (remaining <= 120) return 'monitor'
  return 'normal'
}

export function matchDemand(batch: InventoryBatch, demand: BuyerDemand): { matched: boolean; reasons: string[]; quantity: number } {
  const reasons: string[] = []
  if (batch.produce.trim().toLocaleLowerCase() !== demand.produce.trim().toLocaleLowerCase()) reasons.push('Product does not match')
  if (batch.unit !== demand.unit) reasons.push('Quantity units do not match')
  if (batch.availableQuantity <= 0) reasons.push('No available quantity')
  if (demand.quantity <= 0) reasons.push('Demand quantity is invalid')
  if (!Number.isFinite(new Date(demand.requiredBy).getTime()) || new Date(demand.requiredBy).getTime() < Date.now()) reasons.push('Buyer requirement is expired or has an invalid deadline')
  const qualityRank = { 'Needs sorting': 1, Good: 2, Premium: 3 }
  if (demand.quality && qualityRank[batch.quality] < qualityRank[demand.quality]) reasons.push('Inventory quality does not meet the buyer requirement')
  const quantity = Math.min(batch.availableQuantity, demand.quantity)
  return { matched: reasons.length === 0, reasons, quantity: reasons.length === 0 ? quantity : 0 }
}

export function evaluateOption(batch: InventoryBatch, demand: BuyerDemand, costs: DecisionOption['costs']): DecisionOption {
  const match = matchDemand(batch, demand)
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
  const totalCosts = Object.values(costs).every((value) => value !== null)
    ? Object.values(costs).reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null
  const netProceeds = unitPrice !== null && totalCosts !== null && match.matched
    ? (Math.round(unitPrice * match.quantity * 100) - Math.round(totalCosts * 100)) / 100
    : null
  const priceCompatible = unitPrice !== null && (batch.askingPrice === null || unitPrice >= batch.askingPrice)
  const feasible = match.matched && priceCompatible && requiredChecks.length === 0 && unitPrice !== null && unitPrice > 0 && totalCosts !== null && netProceeds !== null && netProceeds >= 0
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
