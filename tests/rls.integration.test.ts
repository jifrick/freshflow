import { afterAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const tokenA = process.env.TEST_USER_A_ACCESS_TOKEN
const tokenB = process.env.TEST_USER_B_ACCESS_TOKEN
const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY
const enabled = Boolean(url && key && tokenA && tokenB)
const concurrencyEnabled = Boolean(enabled && serviceKey)
const clientFor = (token: string) => createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
let owner: SupabaseClient | undefined
let rowId = ''
let testInventoryId = ''
let testDemandId = ''
let testPhotoPath = ''

afterAll(async () => {
  if (owner && rowId) {
    await owner.from('inventory_batches').delete().eq('id', rowId)
  }
  if (owner && testPhotoPath) await owner.storage.from('inventory-photos').remove([testPhotoPath])
  if (serviceKey && url) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    if (testInventoryId) {
      const { data: offerRows } = await admin.from('offers').select('id').eq('inventory_id', testInventoryId)
      const offerIds = offerRows?.map((offer) => offer.id) ?? []
      if (offerIds.length) await admin.from('transactions').delete().in('offer_id', offerIds)
      if (offerIds.length) await admin.from('offer_events').delete().in('offer_id', offerIds)
      await admin.from('offers').delete().eq('inventory_id', testInventoryId)
      await admin.from('decisions').delete().eq('inventory_id', testInventoryId)
      await admin.from('inventory_batches').delete().eq('id', testInventoryId)
    }
    if (testDemandId) await admin.from('buyer_demands').delete().eq('id', testDemandId)
  }
})

describe('Supabase row-level access controls', () => {
  it.skipIf(!enabled)('keeps a private inventory row hidden from another signed-in user', async () => {
    owner = clientFor(tokenA!)
    const other = clientFor(tokenB!)
    const { data: user, error: authError } = await owner.auth.getUser(tokenA!)
    expect(authError).toBeNull()
    const { data: batchId, error } = await owner.rpc('create_inventory_batch', { p_produce: 'RLS test batch', p_quantity: 1, p_unit: 'kg', p_location: 'Test location', p_quality: 'Good', p_asking_price: null, p_purchase_cost: null, p_available_at: new Date().toISOString(), p_harvested_or_purchased_at: null, p_freshness_hours: null, p_is_published: false })
    expect(error).toBeNull()
    rowId = batchId as string
    const { error: costWriteError } = await owner.from('inventory_private_costs').insert({ batch_id: rowId, owner_id: user.user!.id, purchase_cost: 12 })
    expect(costWriteError).toBeNull()
    const ownerCost = await owner.from('inventory_private_costs').select('purchase_cost').eq('batch_id', rowId).single()
    expect(ownerCost.data?.purchase_cost).toBe(12)
    const privateListing = await other.from('inventory_listings').select('*').eq('id', rowId).single()
    expect(privateListing.data).toBeNull()
    const privateCost = await other.from('inventory_private_costs').select('purchase_cost').eq('batch_id', rowId)
    expect(privateCost.error).toBeNull()
    expect(privateCost.data).toHaveLength(0)
    const privateResult = await other.from('inventory_batches').select('id').eq('id', rowId)
    expect(privateResult.error).toBeNull()
    expect(privateResult.data).toHaveLength(0)
    const directPublish = await owner.from('inventory_batches').update({ is_published: true }).eq('id', rowId)
    expect(directPublish.error).not.toBeNull()
    const publicResult = await other.from('inventory_batches').select('id').eq('id', rowId)
    expect(publicResult.error).toBeNull()
    expect(publicResult.data).toHaveLength(0)
    const publishedListing = await other.from('inventory_listings').select('*').eq('id', rowId).single()
    expect(publishedListing.data).toBeNull()
    const directCost = await other.from('inventory_batches').select('purchase_cost').eq('id', rowId)
    expect(directCost.error).not.toBeNull()
    const adminQueue = await other.rpc('admin_list_inventory_submissions')
    expect(adminQueue.error?.message).toContain('Admin authorization required')
    const unauthorizedReview = await other.rpc('review_inventory_submission', { p_batch_id: rowId, p_decision: 'approved', p_note: null })
    expect(unauthorizedReview.error?.message).toContain('Admin authorization required')
  })

  it.skipIf(!concurrencyEnabled)('reserves a shared batch once when two offers are accepted concurrently', async () => {
    const seller = clientFor(tokenA!)
    const buyer = clientFor(tokenB!)
    const { data: sellerAuth } = await seller.auth.getUser(tokenA!)
    const { data: buyerAuth } = await buyer.auth.getUser(tokenB!)
    const inventory = await seller.rpc('create_inventory_batch', { p_produce: 'FreshFlow concurrency test', p_quantity: 1, p_unit: 'kg', p_location: 'Test hub', p_quality: 'Good', p_asking_price: null, p_purchase_cost: null, p_available_at: new Date().toISOString(), p_harvested_or_purchased_at: null, p_freshness_hours: null, p_is_published: false })
    expect(inventory.error).toBeNull()
    testInventoryId = inventory.data as string
    const demand = await buyer.from('buyer_demands').insert({ buyer_id: buyerAuth.user!.id, produce: 'FreshFlow concurrency test', quantity: 2, unit: 'kg', max_price: 30, location: 'Test hub', required_by: new Date(Date.now() + 86_400_000).toISOString(), status: 'published', is_published: true }).select('id').single()
    expect(demand.error).toBeNull()
    testDemandId = demand.data!.id
    const decisions = await seller.from('decisions').insert([0, 1].map(() => ({ owner_id: sellerAuth.user!.id, inventory_id: testInventoryId, demand_id: testDemandId, candidate_snapshot: {} }))).select('id')
    expect(decisions.error).toBeNull()
    const offers = await Promise.all(decisions.data!.map((decision) => seller.rpc('approve_decision', { p_decision_id: decision.id, p_quantity: 1, p_unit_price: 25, p_known_costs: { transport: 0, handling: 0, storage: 0, processing: 0, platform: 0 }, p_delivery_feasible: true })))
    expect(offers.every((result) => result.error === null)).toBe(true)
    const offerIds = offers.map((result) => result.data as string)
    const acceptResults = await Promise.all(offerIds.map((offerId) => buyer.rpc('accept_offer', { p_offer_id: offerId })))
    expect(acceptResults.filter((result) => result.error === null)).toHaveLength(1)
    expect(acceptResults.filter((result) => result.error !== null)).toHaveLength(1)
    const { data: reconciled, error } = await seller.from('inventory_batches').select('available_quantity, reserved_quantity, sold_quantity').eq('id', testInventoryId).single()
    expect(error).toBeNull()
    expect(reconciled).toMatchObject({ available_quantity: 0, reserved_quantity: 1, sold_quantity: 0 })
  })

  it.skipIf(!enabled)('keeps a private inventory photo readable only by its owner', async () => {
    owner = clientFor(tokenA!)
    const other = clientFor(tokenB!)
    const { data: authData, error: authError } = await owner.auth.getUser(tokenA!)
    expect(authError).toBeNull()
    testPhotoPath = `${authData.user!.id}/storage-rls-test/${crypto.randomUUID()}.png`
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p6sAAAAASUVORK5CYII='), (char) => char.charCodeAt(0))
    const file = new File([bytes.buffer], 'rls-check.png', { type: 'image/png' })
    const upload = await owner.storage.from('inventory-photos').upload(testPhotoPath, file, { contentType: 'image/png' })
    expect(upload.error).toBeNull()
    const ownerRead = await owner.storage.from('inventory-photos').download(testPhotoPath)
    expect(ownerRead.error).toBeNull()
    expect(ownerRead.data).not.toBeNull()
    const otherRead = await other.storage.from('inventory-photos').download(testPhotoPath)
    expect(otherRead.error).not.toBeNull()
    expect(otherRead.data).toBeNull()
  })
})
