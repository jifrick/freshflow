import { describe, expect, it } from 'vitest'
import { compareOptions, completeSale, evaluateOption, matchDemand, reserveQuantity, riskLevel } from './decisionEngine'
import type { BuyerDemand, InventoryBatch } from './types'

const batch: InventoryBatch = { id: 'b1', ownerId: 'u1', produce: 'Tomato', quantity: 100, availableQuantity: 100, unit: 'kg', location: 'Kochi', quality: 'Good', askingPrice: 30, purchaseCost: 20, availableAt: '2026-10-24T06:00:00.000Z', freshnessHours: 96, status: 'available' }
const demand: BuyerDemand = { id: 'd1', buyerName: 'Sample buyer', produce: 'Tomato', quantity: 60, unit: 'kg', maxPrice: 35, location: 'Kochi', requiredBy: '2026-10-28', confirmed: true }

describe('FreshFlow decision rules', () => {
  it('matches only the same product and unit, using the partial available amount', () => {
    expect(matchDemand({ ...batch, availableQuantity: 20 }, demand)).toMatchObject({ matched: true, quantity: 20 })
    expect(matchDemand(batch, { ...demand, unit: 'crate' }).matched).toBe(false)
  })
  it('returns unknown freshness risk when the window is missing', () => {
    expect(riskLevel({ ...batch, freshnessHours: null })).toBe('unknown')
    expect(riskLevel(batch, new Date('2026-10-28T02:00:00.000Z'))).toBe('urgent')
  })
  it('does not treat unknown costs as zero', () => {
    const option = evaluateOption(batch, demand, { transport: null, handling: 0, storage: 0, processing: 0, platform: 0 })
    expect(option.netProceeds).toBeNull()
    expect(option.feasible).toBe(false)
    expect(option.missing).toContain('Transport quote')
  })
  it('calculates net proceeds from known costs deterministically', () => {
    const option = evaluateOption(batch, demand, { transport: 100, handling: 20, storage: 0, processing: 0, platform: 5 })
    expect(option.netProceeds).toBe(1675)
    expect(option.feasible).toBe(true)
  })
  it('ranks feasible options before incomplete options', () => {
    const good = evaluateOption(batch, demand, { transport: 100, handling: 20, storage: 0, processing: 0, platform: 5 })
    const incomplete = evaluateOption(batch, demand, { transport: null, handling: 0, storage: 0, processing: 0, platform: 0 })
    expect(compareOptions([incomplete, good])[0]).toBe(good)
  })
  it('reserves partial stock and rejects overselling', () => {
    expect(reserveQuantity(batch, 40).availableQuantity).toBe(60)
    expect(() => reserveQuantity(batch, 101)).toThrow(/exceeds available/)
    expect(completeSale({ ...batch, availableQuantity: 40 }, 40)).toMatchObject({ quantity: 60, status: 'partially_sold' })
  })
})
