export type Unit = 'kg' | 'crate' | 'box'
export type BatchStatus = 'available' | 'reserved' | 'partially_sold' | 'completed'
export type DecisionStatus = 'needs_review' | 'approved' | 'completed'

export interface InventoryBatch {
  id: string
  ownerId: string
  produce: string
  quantity: number
  availableQuantity: number
  unit: Unit
  location: string
  quality: 'Premium' | 'Good' | 'Needs sorting'
  askingPrice: number | null
  purchaseCost: number | null
  availableAt: string
  freshnessHours: number | null
  status: BatchStatus
  photoPath?: string | null
}

export interface BuyerDemand {
  id: string
  buyerName: string
  produce: string
  quantity: number
  unit: Unit
  maxPrice: number | null
  location: string
  requiredBy: string
  confirmed: boolean
  quality?: 'Premium' | 'Good' | 'Needs sorting' | null
  status?: 'draft' | 'published' | 'fulfilled' | 'closed' | 'expired' | 'cancelled'
}

export interface AlternativeCost {
  transport: number | null
  handling: number | null
  storage: number | null
  processing: number | null
  platform: number | null
}

export interface DecisionOption {
  batch: InventoryBatch
  demand: BuyerDemand
  quantity: number
  unitPrice: number | null
  costs: AlternativeCost
  feasible: boolean
  missing: string[]
  netProceeds: number | null
  reason: string
  requiredChecks: string[]
}

export interface RecordedOutcome {
  id: string
  batchId: string
  demandId: string
  quantity: number
  unit: Unit
  unitPrice: number
  netProceeds: number
  recordedAt: string
}
