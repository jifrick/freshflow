import type { AlternativeCost } from './types.ts'

function scaledInteger(value: number, scale: number): bigint | null {
  if (!Number.isFinite(value) || value < 0) return null
  const text = String(value)
  if (/[eE]/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  if (fraction.length > scale || !/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return null
  return BigInt(whole) * BigInt(10 ** scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0')
}

/** Returns rounded INR proceeds, or null until every cost is a valid amount. */
export function calculateNetProceeds(quantity: number, unitPrice: number, costs: AlternativeCost): number | null {
  const quantityMilli = scaledInteger(quantity, 3)
  const priceCents = scaledInteger(unitPrice, 2)
  const costValues = Object.values(costs)
  if (quantityMilli === null || quantityMilli <= 0n || priceCents === null || priceCents <= 0n || costValues.some((cost) => cost === null)) return null
  const costCents = costValues.reduce<bigint>((total, cost) => {
    if (cost === null) return total
    const amount = scaledInteger(cost, 2)
    if (amount === null) throw new Error('Cost must be a non-negative amount with at most two decimal places')
    return total + amount
  }, 0n)
  const grossCents = (priceCents * quantityMilli + 500n) / 1000n
  const netCents = grossCents - costCents
  const result = Number(netCents) / 100
  return Number.isSafeInteger(Number(netCents)) ? result : null
}

/** Returns gross sales value rounded to cents, or null for invalid/unsupported precision. */
export function calculateGrossSalesValue(quantity: number, unitPrice: number): number | null {
  const quantityMilli = scaledInteger(quantity, 3)
  const priceCents = scaledInteger(unitPrice, 2)
  if (quantityMilli === null || quantityMilli <= 0n || priceCents === null || priceCents <= 0n) return null
  const grossCents = (priceCents * quantityMilli + 500n) / 1000n
  const result = Number(grossCents) / 100
  return Number.isSafeInteger(Number(grossCents)) ? result : null
}
