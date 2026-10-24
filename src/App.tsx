import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownRight, ArrowRight, BadgeCheck, Bell, ChevronDown, CircleHelp, Clock3, Leaf, LogOut, MapPin, Menu, Plus, Search, ShieldCheck, Sparkles, Sprout, TrendingUp, Truck, X } from 'lucide-react'
import { compareOptions, evaluateOption, riskLevel } from './domain/decisionEngine'
import { calculateNetProceeds } from './domain/economics'
import { liveMutationAllowed } from './domain/sessionBoundary'
import type { BuyerDemand, DecisionOption, InventoryBatch, RecordedOutcome, Unit } from './domain/types'
import { getInventoryPhotoUrl, uploadInventoryPhoto } from './lib/inventoryPhotos'
import { isDemoMode, isSupabaseConfigured, supabase, supabaseConfigurationError } from './lib/supabase'
import { ShowcaseLanding } from './components/ShowcaseLanding'
import { AdminReviewDemo } from './components/AdminReviewDemo'
import { AdminReviewLive } from './components/AdminReviewLive'
import { InventoryAiAnalysis } from './components/InventoryAiAnalysis'

type Tab = 'Overview' | 'Inventory' | 'Decisions' | 'Demand & buyers' | 'Transactions' | 'Impact & reports'
type Modal = 'inventory' | 'demand' | 'decision' | 'outcome' | null
type Language = 'en' | 'ml'
type PendingTransaction = { id: string | null; option: DecisionOption; quantity: number }
type PendingConfirmation = { id: string; produce: string; quantity: number; unit: Unit; unitPrice: number; recordedAt: string }
type PendingOffer = { id: string; produce: string; location: string; quantity: number; unit: Unit; unitPrice: number; sellerId: string; buyerId: string; role: 'buyer' | 'seller'; counteredBy: string | null; canRespond: boolean; option?: DecisionOption }

const seedBatches: InventoryBatch[] = [
  { id: 'sample-b1', ownerId: 'sample', produce: 'Tomatoes', quantity: 180, availableQuantity: 180, unit: 'kg', location: 'Aluva, Kerala', quality: 'Good', askingPrice: 28, purchaseCost: 19, availableAt: '2026-10-23T08:00:00.000Z', harvestedOrPurchasedAt: '2026-10-23T08:00:00.000Z', freshnessHours: 72, status: 'available' },
  { id: 'sample-b2', ownerId: 'sample', produce: 'Nendran banana', quantity: 240, availableQuantity: 240, unit: 'kg', location: 'Thrissur, Kerala', quality: 'Premium', askingPrice: 34, purchaseCost: null, availableAt: '2026-10-22T08:00:00.000Z', harvestedOrPurchasedAt: '2026-10-22T08:00:00.000Z', freshnessHours: 168, status: 'available' },
  { id: 'sample-b3', ownerId: 'sample', produce: 'Green chilies', quantity: 65, availableQuantity: 65, unit: 'kg', location: 'Kochi, Kerala', quality: 'Good', askingPrice: null, purchaseCost: null, availableAt: '2026-10-24T06:00:00.000Z', harvestedOrPurchasedAt: null, freshnessHours: null, status: 'available' },
]
const seedDemands: BuyerDemand[] = [
  { id: 'sample-d1', ownerId: 'sample', buyerName: 'Illustrative community kitchen', produce: 'Tomatoes', quantity: 120, unit: 'kg', maxPrice: 34, location: 'Ernakulam, Kerala', requiredBy: '2026-10-26T12:00:00.000Z', confirmed: true, status: 'published' },
  { id: 'sample-d2', ownerId: 'sample', buyerName: 'Illustrative produce retailer', produce: 'Nendran banana', quantity: 80, unit: 'kg', maxPrice: 38, location: 'Thrissur, Kerala', requiredBy: '2026-10-27T10:00:00.000Z', confirmed: true, status: 'published' },
]
const menu: Tab[] = ['Overview', 'Inventory', 'Decisions', 'Demand & buyers', 'Transactions', 'Impact & reports']
const translations: Record<Language, Record<string, string>> = {
  en: {},
  ml: { Overview: 'അവലോകനം', Inventory: 'ശേഖരം', Decisions: 'തീരുമാനങ്ങൾ', 'Demand & buyers': 'ആവശ്യവും വാങ്ങുന്നവരും', Transactions: 'ഇടപാടുകൾ', 'Impact & reports': 'ഫലവും റിപ്പോർട്ടുകളും', 'Good morning,': 'സുപ്രഭാതം,', 'Your supply, in good hands.': 'നിങ്ങളുടെ ഉൽപ്പന്നങ്ങൾ, നല്ല കൈകളിൽ.', 'Inventory at a glance': 'ശേഖരം ഒറ്റനോട്ടത്തിൽ', 'Needs your attention': 'ശ്രദ്ധിക്കേണ്ടവ', 'Matching demand': 'പൊരുത്തപ്പെടുന്ന ആവശ്യം', 'Potential net recovery': 'സാധ്യമായ ശുദ്ധ വരുമാനം', 'Verified outcomes': 'സ്ഥിരീകരിച്ച ഫലങ്ങൾ', 'Add inventory': 'ശേഖരം ചേർക്കുക', 'Create buyer requirement': 'വാങ്ങൽ ആവശ്യം ചേർക്കുക' },
}
const emptyCosts = { transport: null, handling: null, storage: null, processing: null, platform: null }
const illustrativeCosts = { transport: 240, handling: 90, storage: 0, processing: 0, platform: 0 }
const INITIAL_AVAILABLE_AT = new Date().toISOString().slice(0, 16)
const INITIAL_REQUIRED_BY = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const fmt = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
const timeLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(value))
function localDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
function readSandbox<T>(key: string, fallback: T): T {
  try { const saved = localStorage.getItem(`freshflow.${key}`); return saved ? JSON.parse(saved) as T : fallback } catch { return fallback }
}

export default function App() {
  const [showWorkspace, setShowWorkspace] = useState(false)
  const [showAdminDemo, setShowAdminDemo] = useState(false)
  const [showLiveAdmin, setShowLiveAdmin] = useState(false)
  const [demoSession, setDemoSession] = useState(false)
  const demoSessionRef = useRef(false)
  const [tab, setTab] = useState<Tab>('Overview')
  const [modal, setModal] = useState<Modal>(null)
  const [batches, setBatches] = useState<InventoryBatch[]>(() => isDemoMode ? readSandbox('batches', seedBatches) : [])
  const [demands, setDemands] = useState<BuyerDemand[]>(() => isDemoMode ? readSandbox('demands', seedDemands) : [])
  const [outcomes, setOutcomes] = useState<RecordedOutcome[]>(() => isDemoMode ? readSandbox('outcomes', []) : [])
  const [transactions, setTransactions] = useState<PendingTransaction[]>(() => isDemoMode ? readSandbox('transactions', []) : [])
  const [pendingOffers, setPendingOffers] = useState<PendingOffer[]>(() => isDemoMode ? readSandbox('pendingOffers', []) : [])
  const [pendingConfirmations, setPendingConfirmations] = useState<PendingConfirmation[]>([])
  const [user, setUser] = useState<{ id: string; email?: string; isAdmin: boolean } | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState('')
  const [language, setLanguage] = useState<Language>('en')
  const [currentTime] = useState(() => Date.now())
  const [mobileMenu, setMobileMenu] = useState(false)
  const [activeBatch, setActiveBatch] = useState<InventoryBatch | null>(null)
  const [editingBatch, setEditingBatch] = useState<InventoryBatch | null>(null)
  const [editingDemand, setEditingDemand] = useState<BuyerDemand | null>(null)
  const [activeDemand, setActiveDemand] = useState<BuyerDemand | null>(null)
  const [activeOption, setActiveOption] = useState<DecisionOption | null>(null)
  const [decisionId, setDecisionId] = useState<string | null>(null)
  const [decisionNetPreview, setDecisionNetPreview] = useState<number | null>(null)
  const [activeTransaction, setActiveTransaction] = useState<PendingTransaction | null>(null)
  const tr = (label: string) => translations[language][label] ?? label

  const ensureProfile = useCallback(async (account: { id: string; user_metadata?: Record<string, unknown> }) => {
    if (!supabase) return
    const metadataName = account.user_metadata?.full_name
    const { error: profileError } = await supabase.from('profiles').upsert(
      { id: account.id, display_name: typeof metadataName === 'string' ? metadataName : '' },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    if (profileError) setError('Your account is signed in, but its profile could not be loaded. Retry or contact support.')
  }, [])

  const loadCloud = useCallback(async (uid: string) => {
    if (!supabase) return
    setLoading(true)
    try {
    const [batchResult, privateCostResult, demandResult, outcomeResult, transactionResult, offerResult, confirmationResult] = await Promise.all([
      supabase.from('inventory_listings').select('*').eq('owner_id', uid).order('created_at', { ascending: false }),
      supabase.from('inventory_private_costs').select('batch_id, purchase_cost'),
      supabase.from('buyer_demands').select('*').order('required_by'),
      supabase.from('outcomes').select('*, transactions!inner(id, unit, agreed_unit_price)').eq('recorded_by', uid).order('recorded_at', { ascending: false }),
      supabase.from('transactions').select('id, accepted_quantity, agreed_unit_price, offers!inner(inventory_id, demand_id)').eq('seller_id', uid).eq('completion_status', 'handover_pending'),
      supabase.from('offers').select('id, produce_snapshot, location_snapshot, quantity, unit, unit_price, seller_id, buyer_id, countered_by').or(`buyer_id.eq.${uid},seller_id.eq.${uid}`).eq('status', 'pending'),
      supabase.from('transactions').select('id, accepted_quantity, agreed_unit_price, unit, outcomes!inner(verification_status, recorded_at), offers!inner(produce_snapshot)').eq('buyer_id', uid).eq('completion_status', 'completed').eq('outcomes.verification_status', 'seller_reported'),
    ])
    if (batchResult.error || privateCostResult.error || demandResult.error || outcomeResult.error || transactionResult.error || offerResult.error || confirmationResult.error) {
      setError('FreshFlow could not load live data. Check the latest database migration and access policies, then retry.')
      setBatches([]); setDemands([]); setOutcomes([]); setTransactions([]); setPendingOffers([]); setPendingConfirmations([])
      return
    }
    if (demoSessionRef.current) return
    const privateCosts = new Map(privateCostResult.data.map((row) => [row.batch_id, Number(row.purchase_cost)]))
    if (batchResult.data) setBatches(batchResult.data.map((row) => ({ id: row.id, ownerId: row.owner_id, produce: row.produce, quantity: Number(row.quantity), availableQuantity: Number(row.available_quantity), unit: row.unit, location: row.location, quality: row.quality, askingPrice: row.asking_price === null ? null : Number(row.asking_price), purchaseCost: privateCosts.get(row.id) ?? null, availableAt: row.available_at, harvestedOrPurchasedAt: row.harvested_or_purchased_at, freshnessHours: row.freshness_hours, status: row.status, photoPath: row.photo_path, isPublished: row.is_published, archivedAt: row.archived_at })))
    if (demandResult.data) setDemands(demandResult.data.map((row) => ({ id: row.id, ownerId: row.buyer_id, buyerName: `Buyer ${row.buyer_id.slice(0, 6)}`, produce: row.produce, quantity: Number(row.quantity), fulfilledQuantity: Number(row.fulfilled_quantity), unit: row.unit, maxPrice: row.max_price === null ? null : Number(row.max_price), location: row.location, requiredBy: row.required_by, confirmed: row.is_published && row.status === 'published', quality: row.quality, status: row.status })))
    if (outcomeResult.data) setOutcomes(outcomeResult.data.map((row) => { const tx = Array.isArray(row.transactions) ? row.transactions[0] : row.transactions; return { id: row.id, batchId: row.batch_id, demandId: '', quantity: Number(row.accepted_quantity), unit: tx?.unit ?? 'kg', unitPrice: Number(tx?.agreed_unit_price ?? 0), netProceeds: row.net_proceeds === null ? Number.NaN : Number(row.net_proceeds), recordedAt: row.recorded_at, verificationStatus: row.verification_status } }))
    if (transactionResult.data) setTransactions(transactionResult.data.flatMap((row) => {
      const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers
      if (!offer) return []
      const batch = batchResult.data?.find((item) => item.id === offer.inventory_id)
      const demand = demandResult.data?.find((item) => item.id === offer.demand_id)
      if (!batch || !demand) return []
      const mappedBatch: InventoryBatch = { id: batch.id, ownerId: batch.owner_id, produce: batch.produce, quantity: Number(batch.quantity), availableQuantity: Number(batch.available_quantity), unit: batch.unit, location: batch.location, quality: batch.quality, askingPrice: batch.asking_price === null ? null : Number(batch.asking_price), purchaseCost: privateCosts.get(batch.id) ?? null, availableAt: batch.available_at, harvestedOrPurchasedAt: batch.harvested_or_purchased_at, freshnessHours: batch.freshness_hours, status: batch.status, photoPath: batch.photo_path, isPublished: batch.is_published, archivedAt: batch.archived_at }
      const mappedDemand: BuyerDemand = { id: demand.id, ownerId: demand.buyer_id, buyerName: `Buyer ${demand.buyer_id.slice(0, 6)}`, produce: demand.produce, quantity: Number(demand.quantity), fulfilledQuantity: Number(demand.fulfilled_quantity), unit: demand.unit, maxPrice: demand.max_price === null ? null : Number(demand.max_price), location: demand.location, requiredBy: demand.required_by, confirmed: true, quality: demand.quality, status: demand.status }
      return [{ id: row.id, quantity: Number(row.accepted_quantity), option: { ...evaluateOption(mappedBatch, mappedDemand, emptyCosts), unitPrice: Number(row.agreed_unit_price) } }]
    }))
    if (offerResult.data) setPendingOffers(offerResult.data.map((row) => {
      const recipientId = row.countered_by === null ? row.buyer_id : row.countered_by === row.buyer_id ? row.seller_id : row.buyer_id
      return { id: row.id, produce: row.produce_snapshot, location: row.location_snapshot, quantity: Number(row.quantity), unit: row.unit, unitPrice: Number(row.unit_price), sellerId: row.seller_id, buyerId: row.buyer_id, role: row.buyer_id === uid ? 'buyer' as const : 'seller' as const, counteredBy: row.countered_by, canRespond: recipientId === uid }
    }))
    if (confirmationResult.data) setPendingConfirmations(confirmationResult.data.map((row) => {
      const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers
      const outcome = Array.isArray(row.outcomes) ? row.outcomes[0] : row.outcomes
      return { id: row.id, produce: offer?.produce_snapshot ?? 'Produce', quantity: Number(row.accepted_quantity), unit: row.unit, unitPrice: Number(row.agreed_unit_price), recordedAt: outcome?.recorded_at ?? '' }
    }))
    } catch {
      setError('A network error prevented FreshFlow from loading live data. Retry when the connection is available.')
      setBatches([]); setDemands([]); setOutcomes([]); setTransactions([]); setPendingOffers([]); setPendingConfirmations([])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) throw sessionError
      const current = data.session?.user
      if (current) { setUser({ id: current.id, email: current.email, isAdmin: current.app_metadata?.role === 'admin' }); void ensureProfile(current); void loadCloud(current.id) }
      else { setUser(null); setBatches([]); setDemands([]); setOutcomes([]); setTransactions([]); setPendingOffers([]); setPendingConfirmations([]); setLoading(false) }
    }).catch(() => { setError('FreshFlow could not restore your sign-in session. Sign in again when the connection is available.'); setLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const current = session?.user
      setUser(current ? { id: current.id, email: current.email, isAdmin: current.app_metadata?.role === 'admin' } : null)
      if (current) { void ensureProfile(current); void loadCloud(current.id) }
      else { setBatches([]); setDemands([]); setOutcomes([]); setTransactions([]); setPendingOffers([]); setPendingConfirmations([]); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [ensureProfile, loadCloud])

  useEffect(() => { if (demoSession) { localStorage.setItem('freshflow.batches', JSON.stringify(batches)); localStorage.setItem('freshflow.demands', JSON.stringify(demands)); localStorage.setItem('freshflow.outcomes', JSON.stringify(outcomes)); localStorage.setItem('freshflow.transactions', JSON.stringify(transactions)); localStorage.setItem('freshflow.pendingOffers', JSON.stringify(pendingOffers)) } }, [demoSession, batches, demands, outcomes, transactions, pendingOffers])

  const sellerBatches = useMemo(() => user ? batches.filter((batch) => batch.ownerId === user.id) : batches, [batches, user])
  const activeDemands = useMemo(() => demands.filter((demand) => (demand.status === undefined || demand.status === 'published') && new Date(demand.requiredBy).getTime() >= currentTime), [demands, currentTime])
  const options = useMemo(() => compareOptions(sellerBatches.flatMap((batch) => activeDemands.map((demand) => evaluateOption(batch, demand, demoSession && batch.id === 'sample-b1' && demand.id === 'sample-d1' ? illustrativeCosts : emptyCosts))).filter((option) => option.quantity > 0)), [sellerBatches, activeDemands, demoSession])
  const matches = options
  const attention = sellerBatches.filter((batch) => !batch.archivedAt && ['unknown', 'urgent', 'at_risk'].includes(riskLevel(batch)))
  const pending = sellerBatches.filter((batch) => !batch.archivedAt && batch.availableQuantity > 0 && (riskLevel(batch) === 'unknown' || riskLevel(batch) === 'urgent' || riskLevel(batch) === 'at_risk'))
  const t = (label: string) => tr(label)

  function startDemo() {
    setShowAdminDemo(false)
    demoSessionRef.current = true
    setDemoSession(true)
    const startedAt = Date.now()
    setBatches(seedBatches.map((batch, index) => ({ ...batch, availableAt: new Date(startedAt - 4 * 3_600_000).toISOString(), harvestedOrPurchasedAt: index === 2 ? null : new Date(startedAt - (index === 0 ? 60 : 24) * 3_600_000).toISOString(), location: index < 2 ? 'Aluva, Kerala' : batch.location })))
    setDemands(seedDemands.map((demand, index) => ({ ...demand, buyerName: index === 0 ? 'Illustrative community kitchen' : 'Illustrative produce retailer', location: 'Aluva, Kerala', requiredBy: new Date(startedAt + (index === 0 ? 36 : 48) * 3_600_000).toISOString() })))
    setOutcomes([]); setTransactions([]); setPendingOffers([]); setError('')
    setTab('Overview'); setShowWorkspace(true)
  }

  function openLiveSignIn() { setShowAdminDemo(false); demoSessionRef.current = false; setDemoSession(false); setBatches([]); setDemands([]); setOutcomes([]); setTransactions([]); setPendingOffers([]); setPendingConfirmations([]); setError(''); setShowWorkspace(true); setTab('Overview') }

  function restartDemo() {
    localStorage.removeItem('freshflow.batches'); localStorage.removeItem('freshflow.demands')
    localStorage.removeItem('freshflow.outcomes'); localStorage.removeItem('freshflow.transactions'); localStorage.removeItem('freshflow.pendingOffers')
    startDemo()
  }

  async function addInventory(form: FormData) {
    const quantity = Number(form.get('quantity'))
    const selectedPhoto = form.get('photo')
    const photo = selectedPhoto instanceof File && selectedPhoto.size > 0 ? selectedPhoto : null
    if (!demoSession && supabaseConfigurationError) { setError(supabaseConfigurationError); return }
    if (!demoSession && isSupabaseConfigured && (!supabase || !user)) { setError('Sign in before adding or editing live inventory.'); return }
    let availableAt: string
    let harvestedOrPurchasedAt: string | null
    try {
      availableAt = new Date(String(form.get('availableAt'))).toISOString()
      const harvestValue = String(form.get('harvestedOrPurchasedAt') ?? '')
      harvestedOrPurchasedAt = harvestValue ? new Date(harvestValue).toISOString() : null
    } catch { setError('Enter valid availability and harvest or purchase dates.'); return }
    const produce = String(form.get('produce')).trim()
    const unit = String(form.get('unit')) as Unit
    const location = String(form.get('location')).trim()
    const quality = String(form.get('quality')) as InventoryBatch['quality']
    const askingPrice = form.get('askingPrice') === '' ? null : Number(form.get('askingPrice'))
    const purchaseCost = form.get('purchaseCost') === '' ? null : Number(form.get('purchaseCost'))
    const freshnessHours = form.get('freshnessHours') === '' ? null : Number(form.get('freshnessHours'))
    if (!produce || !location || !Number.isFinite(quantity) || quantity <= 0 || (askingPrice !== null && (!Number.isFinite(askingPrice) || askingPrice < 0)) || (purchaseCost !== null && (!Number.isFinite(purchaseCost) || purchaseCost < 0)) || (freshnessHours !== null && (!Number.isInteger(freshnessHours) || freshnessHours <= 0))) { setError('Check produce, quantity, location, price, cost, and freshness values.'); return }
    if (demoSession) {
      setBatches((current) => {
        const saved: InventoryBatch = { id: editingBatch?.id ?? crypto.randomUUID(), ownerId: 'demo-only', produce, quantity, availableQuantity: editingBatch?.availableQuantity ?? quantity, unit, location, quality, askingPrice, purchaseCost, availableAt, harvestedOrPurchasedAt, freshnessHours, status: editingBatch?.status ?? 'available', isPublished: form.get('publish') === 'on' }
        return editingBatch ? current.map((batch) => batch.id === saved.id ? saved : batch) : [saved, ...current]
      })
    } else if (liveMutationAllowed(demoSession, Boolean(user)) && supabase && user) {
      let batchId: string
      if (editingBatch) {
        const { error: saveError } = await supabase.rpc('update_inventory_batch', { p_batch_id: editingBatch.id, p_produce: produce, p_quantity: quantity, p_unit: unit, p_location: location, p_quality: quality, p_asking_price: askingPrice, p_purchase_cost: purchaseCost, p_available_at: availableAt, p_harvested_or_purchased_at: harvestedOrPurchasedAt, p_freshness_hours: freshnessHours, p_is_published: form.get('publish') === 'on' })
        if (saveError) { setError(saveError.message); return }
        batchId = editingBatch.id
      } else {
        const { data, error: saveError } = await supabase.rpc('create_inventory_batch', { p_produce: produce, p_quantity: quantity, p_unit: unit, p_location: location, p_quality: quality, p_asking_price: askingPrice, p_purchase_cost: purchaseCost, p_available_at: availableAt, p_harvested_or_purchased_at: harvestedOrPurchasedAt, p_freshness_hours: freshnessHours, p_is_published: form.get('publish') === 'on' })
        if (saveError || !data) { setError(saveError?.message ?? 'Inventory could not be saved.'); return }
        batchId = data
      }
      if (photo) {
        try {
          const path = await uploadInventoryPhoto(batchId, photo)
          const { error: photoUpdateError } = await supabase.from('inventory_batches').update({ photo_path: path }).eq('id', batchId)
          if (photoUpdateError) { await supabase.storage.from('inventory-photos').remove([path]); throw photoUpdateError }
          if (editingBatch?.photoPath) await supabase.storage.from('inventory-photos').remove([editingBatch.photoPath])
        } catch (photoError) { setError(photoError instanceof Error ? `Inventory was saved, but its photo was not updated: ${photoError.message}` : 'Inventory was saved, but its photo was not updated.') }
      }
      await loadCloud(user.id)
    } else { setError('Live inventory is unavailable until valid Supabase settings are provided.'); return }
    setEditingBatch(null); setModal(null)
  }

  async function addDemand(form: FormData) {
    if (!demoSession && supabaseConfigurationError) { setError(supabaseConfigurationError); return }
    if (!demoSession && isSupabaseConfigured && (!supabase || !user)) { setError('Sign in before managing live buyer requirements.'); return }
    const requiredByRaw = String(form.get('requiredBy') ?? '')
    const maxPriceRaw = String(form.get('maxPrice') ?? '')
    const entry: BuyerDemand = { id: editingDemand?.id ?? crypto.randomUUID(), buyerName: user?.email?.split('@')[0] ?? 'Illustrative buyer', produce: String(form.get('produce')).trim(), quantity: Number(form.get('quantity')), unit: form.get('unit') as Unit, maxPrice: maxPriceRaw ? Number(maxPriceRaw) : null, location: String(form.get('location')).trim(), requiredBy: '', confirmed: true, quality: String(form.get('quality') || '') as BuyerDemand['quality'] }
    if (!entry.produce || !entry.location || !Number.isFinite(entry.quantity) || entry.quantity <= 0 || (entry.maxPrice !== null && (!Number.isFinite(entry.maxPrice) || entry.maxPrice < 0))) { setError('Check product, quantity, location, and price limit.'); return }
    try { entry.requiredBy = new Date(requiredByRaw).toISOString() } catch { setError('Enter a valid required-by date.'); return }
    if (demoSession) setDemands((current) => editingDemand ? current.map((demand) => demand.id === editingDemand.id ? entry : demand) : [entry, ...current])
    else if (liveMutationAllowed(demoSession, Boolean(user)) && supabase && user) {
      const result = editingDemand
        ? await supabase.rpc('update_buyer_demand', { p_demand_id: editingDemand.id, p_produce: entry.produce, p_quantity: entry.quantity, p_unit: entry.unit, p_max_price: entry.maxPrice, p_location: entry.location, p_required_by: entry.requiredBy, p_quality: entry.quality || null })
        : await supabase.from('buyer_demands').insert({ buyer_id: user.id, produce: entry.produce, quantity: entry.quantity, unit: entry.unit, max_price: entry.maxPrice, location: entry.location, required_by: entry.requiredBy, quality: entry.quality || null, status: 'published', is_published: true })
      const { error: dbError } = result
      if (dbError) { setError(dbError.message); return }
      await loadCloud(user.id)
    } else { setError('Live buyer requirements are unavailable until valid Supabase settings are provided.'); return }
    setEditingDemand(null); setModal(null)
  }

  async function archiveInventory(batch: InventoryBatch) {
    if (!demoSession && supabaseConfigurationError) { setError(supabaseConfigurationError); return }
    if (demoSession) setBatches((current) => current.map((row) => row.id === batch.id ? { ...row, archivedAt: new Date().toISOString(), isPublished: false, status: 'unavailable' } : row))
    else if (liveMutationAllowed(demoSession, Boolean(user)) && supabase && user) {
      const { error: archiveError } = await supabase.rpc('archive_inventory_batch', { p_batch_id: batch.id })
      if (archiveError) { setError(archiveError.message); return }
      await loadCloud(user.id)
    } else { setError('Sign in before archiving live inventory.'); return }
  }

  async function transitionDemand(demand: BuyerDemand, action: 'close' | 'cancel') {
    if (!demoSession && supabaseConfigurationError) { setError(supabaseConfigurationError); return }
    if (demoSession) setDemands((current) => current.map((row) => row.id === demand.id ? { ...row, status: action === 'close' ? 'closed' : 'cancelled', confirmed: false } : row))
    else if (liveMutationAllowed(demoSession, Boolean(user)) && supabase && user) {
      const { error: transitionError } = await supabase.rpc('transition_buyer_demand', { p_demand_id: demand.id, p_action: action })
      if (transitionError) { setError(transitionError.message); return }
      await loadCloud(user.id)
    } else setError('Sign in before changing live buyer requirements.')
  }

  async function reviewOption(option: DecisionOption) {
    if (!demoSession && supabaseConfigurationError) { setError(supabaseConfigurationError); return }
    if (!demoSession && isSupabaseConfigured && (!supabase || !user)) { setError('Sign in before reviewing live inventory decisions.'); return }
    setActiveOption(option); setActiveBatch(option.batch); setActiveDemand(option.demand); setError('')
    setDecisionNetPreview(null)
    if (liveMutationAllowed(demoSession, Boolean(user)) && supabase && user) {
      const { data, error: dbError } = await supabase.from('decisions').insert({ owner_id: user.id, inventory_id: option.batch.id, demand_id: option.demand.id, candidate_snapshot: { estimated_unit_price: option.unitPrice, known_costs: option.costs, missing: option.missing } }).select('id').single()
      if (dbError) { setError(dbError.message); return }
      setDecisionId(data.id)
    }
    setModal('decision')
  }

  async function approveOption(form: FormData) {
    if (!activeOption || !activeDemand) return
    const quantity = Number(form.get('quantity'))
    const price = Number(form.get('price'))
    const costs = { transport: form.get('transport') ? Number(form.get('transport')) : null, handling: form.get('handling') ? Number(form.get('handling')) : null, storage: form.get('storage') ? Number(form.get('storage')) : null, processing: form.get('processing') ? Number(form.get('processing')) : null, platform: form.get('platform') ? Number(form.get('platform')) : null }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Math.min(activeOption.batch.availableQuantity, activeDemand.quantity) || !Number.isFinite(price) || price <= 0 || Object.values(costs).some((cost) => cost === null || !Number.isFinite(cost) || cost < 0) || form.get('routeConfirmed') !== 'on') { setError('Enter valid quantity, price, all five known costs, and confirm delivery feasibility.'); return }
    const knownCosts = Object.fromEntries(Object.entries(costs).filter(([, v]) => v !== null))
    if (demoSession) setPendingOffers((current) => [{ id: crypto.randomUUID(), sellerId: 'Illustrative supplier', buyerId: 'Illustrative buyer', role: 'buyer', counteredBy: null, canRespond: true, produce: activeOption.batch.produce, location: activeDemand.location, quantity, unit: activeOption.batch.unit, unitPrice: price, option: { ...activeOption, quantity, unitPrice: price, costs: { transport: costs.transport, handling: costs.handling, storage: costs.storage, processing: costs.processing, platform: costs.platform } } }, ...current])
    else if (liveMutationAllowed(demoSession, Boolean(user)) && supabase && user && decisionId) {
      const { error: dbError } = await supabase.rpc('approve_decision', { p_decision_id: decisionId, p_quantity: quantity, p_unit_price: price, p_known_costs: knownCosts, p_delivery_feasible: form.get('routeConfirmed') === 'on' })
      if (dbError) { setError(dbError.message); return }
      await loadCloud(user!.id)
    } else { setError('Live offer submission is unavailable until valid Supabase settings and a signed-in account are available.'); return }
    setModal(null); setTab('Transactions')
  }

  async function recordOutcome(form: FormData) {
    const option = activeTransaction?.option ?? activeOption
    if (!option) return
    const quantity = Number(form.get('quantity'))
    const actualCosts = { transport: form.get('transport') ? Number(form.get('transport')) : null, handling: form.get('handling') ? Number(form.get('handling')) : null, storage: form.get('storage') ? Number(form.get('storage')) : null, processing: form.get('processing') ? Number(form.get('processing')) : null, platform: form.get('platform') ? Number(form.get('platform')) : null }
    const knownCosts = Object.fromEntries(Object.entries(actualCosts).filter(([, value]) => value !== null))
    const costsComplete = Object.values(actualCosts).every((value) => value !== null)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > (activeTransaction?.quantity ?? 0) || Object.values(actualCosts).some((value) => value !== null && (!Number.isFinite(value) || value < 0))) { setError('Enter a valid accepted quantity and non-negative costs.'); return }
    if (liveMutationAllowed(demoSession, Boolean(user)) && supabase && user) {
      if (!activeTransaction?.id) { setError('No pending transaction was found for this account.'); return }
      const { error: dbError } = await supabase.rpc('complete_transaction', { p_transaction_id: activeTransaction.id, p_accepted_quantity: quantity, p_known_costs: knownCosts, p_costs_complete: costsComplete })
      if (dbError) { setError(dbError.message); return }
      await loadCloud(user!.id)
    } else if (demoSession) {
      const unitPrice = option.unitPrice ?? 0
      const netProceeds = costsComplete && option.unitPrice !== null ? calculateNetProceeds(quantity, unitPrice, actualCosts) ?? Number.NaN : Number.NaN
      setOutcomes((current) => [{ id: crypto.randomUUID(), batchId: option.batch.id, demandId: option.demand.id, quantity, unit: option.batch.unit, unitPrice, netProceeds, recordedAt: new Date().toISOString(), verificationStatus: 'seller_reported' }, ...current])
      setBatches((current) => current.map((batch) => batch.id === option.batch.id ? { ...batch, quantity: batch.quantity - quantity, availableQuantity: batch.availableQuantity + (activeTransaction?.quantity ?? 0) - quantity, status: batch.quantity === quantity ? 'completed' : 'partially_sold' } : batch))
      setTransactions((current) => current.filter((transaction) => transaction !== activeTransaction))
    } else { setError('Sign in before recording a live transaction outcome.'); return }
    setModal(null); setTab('Impact & reports')
  }

  async function signIn() {
    if (supabaseConfigurationError) { setError(supabaseConfigurationError); return }
    if (!supabase) { setError('Configure the Supabase project URL and publishable key before using Google sign-in.'); return }
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (authError) setError(`Google sign-in could not start: ${authError.message}`)
  }

  async function signOut() {
    if (!supabase) return
    const { error: authError } = await supabase.auth.signOut()
    if (authError) setError(`Sign-out failed: ${authError.message}`)
  }

  async function respondOffer(offer: PendingOffer, action: 'accept' | 'reject' | 'cancel') {
    if (!offer.canRespond && action !== 'cancel') { setError('Wait for the other participant to respond to the latest offer terms.'); return }
    if (demoSession) {
      if (action !== 'accept') { setPendingOffers((current) => current.filter((item) => item.id !== offer.id)); setError('Illustrative scenario only: no live offer was changed.'); return }
      if (!offer.option) { setError('This example offer has no matching inventory context.'); return }
      setBatches((current) => current.map((batch) => batch.id === offer.option!.batch.id ? { ...batch, availableQuantity: batch.availableQuantity - offer.quantity, status: batch.availableQuantity === offer.quantity ? 'reserved' : batch.status } : batch))
      setTransactions((current) => [{ id: null, option: offer.option!, quantity: offer.quantity }, ...current])
      setPendingOffers((current) => current.filter((item) => item.id !== offer.id))
      setError('Illustrative scenario only: this records a simulated buyer response. No real buyer or stock reservation is involved.')
      return
    }
    if (!liveMutationAllowed(demoSession, Boolean(user)) || !supabase || !user) { setError('Sign in before responding to live offers.'); return }
    const { error: rpcError } = await supabase.rpc('respond_to_offer', { p_offer_id: offer.id, p_action: action })
    if (rpcError) { setError(rpcError.message); return }
    await loadCloud(user.id)
  }

  async function counterOffer(offer: PendingOffer) {
    if (!offer.canRespond || !liveMutationAllowed(demoSession, Boolean(user)) || !supabase || !user) { setError(demoSession ? 'Counter-offers are available in the live workspace; this showcase keeps the scenario deterministic.' : 'Only the recipient of a live offer can submit a counter-offer.'); return }
    const rawPrice = window.prompt(`Counter price in INR per ${offer.unit}`, String(offer.unitPrice))
    if (rawPrice === null) return
    const price = Number(rawPrice)
    if (!Number.isFinite(price) || price <= 0) { setError('Enter a valid positive counter price.'); return }
    const { error: rpcError } = await supabase.rpc('counter_offer', { p_offer_id: offer.id, p_unit_price: price })
    if (rpcError) { setError(rpcError.message); return }
    await loadCloud(user.id)
  }

  async function confirmHandover(transactionId: string) {
    if (demoSession) { setError('Showcase handovers cannot be buyer-verified. This action does not contact a buyer.'); return }
    if (!liveMutationAllowed(demoSession, Boolean(user)) || !supabase || !user) { setError('Sign in before confirming a live handover.'); return }
    const { error: confirmationError } = await supabase.rpc('confirm_transaction_handover', { p_transaction_id: transactionId })
    if (confirmationError) { setError(confirmationError.message); return }
    await loadCloud(user.id)
  }

  if (showLiveAdmin && supabase && user?.isAdmin && !demoSession) return <AdminReviewLive client={supabase} onBack={() => { setShowLiveAdmin(false); void loadCloud(user.id) }} />
  if (showAdminDemo) return <AdminReviewDemo onBack={() => setShowAdminDemo(false)} />
  if (!showWorkspace) return <ShowcaseLanding onExplore={startDemo} onLive={openLiveSignIn} onAdminDemo={() => setShowAdminDemo(true)} />

  return <div className={`app-shell ${demoSession ? 'showcase-mode' : ''}`}>
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#overview" onClick={() => setTab('Overview')}><span className="brand-icon"><Leaf size={19} strokeWidth={2.5} /></span><span>freshflow<span className="brand-dot">.</span></span></a>
      <div className="workspace-chip"><span className="workspace-avatar">F</span><span><b>{demoSession ? 'FreshFlow Workspace' : user?.email?.split('@')[0] ?? 'Field operations'}</b><small>{demoSession ? 'Illustrative scenario' : user ? 'Personal workspace' : 'Sign-in required'}</small></span><ChevronDown size={14} /></div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="nav-list">{menu.map((item, i) => {
        const Icon = [Activity, Sprout, Sparkles, Search, Truck, TrendingUp][i]
        return <button key={item} className={`nav-item ${tab === item ? 'nav-active' : ''}`} onClick={() => { setTab(item); setMobileMenu(false) }}><Icon size={17} strokeWidth={1.8} /><span>{t(item)}</span>{item === 'Decisions' && attention.length > 0 && <i>{attention.length}</i>}</button>
      })}{!demoSession && user?.isAdmin && <button className="nav-item" onClick={() => setShowLiveAdmin(true)}><ShieldCheck size={17}/><span>Admin review</span></button>}</nav>
       <div className="sidebar-bottom"><div className="side-help"><span className="help-icon"><CircleHelp size={16} /></span><div><b>Here to help</b><span>Talk to our support team</span></div><ArrowRight size={15} /></div><div className="user-row"><div className="profile-avatar">{demoSession ? 'F' : user?.email?.[0]?.toUpperCase() ?? 'F'}</div><div className="profile-info"><b>{demoSession ? 'FreshFlow showcase' : user?.email ?? 'FreshFlow'}</b><span>{demoSession ? 'Local illustrative data' : user ? 'Signed in' : 'Live workspace'}</span></div><button title={demoSession ? 'Reset workspace scenario' : user ? 'Sign out' : 'Continue with Google'} onClick={() => demoSession ? restartDemo() : user && supabase ? void signOut() : void signIn()}>{demoSession ? <ArrowRight size={16}/> : user ? <LogOut size={16} /> : <ChevronDown size={17} />}</button></div></div>
    </aside>
    {mobileMenu && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu-btn icon-btn" aria-label="Open navigation" onClick={() => setMobileMenu(true)}><Menu size={19} /></button><div className="breadcrumbs">Workspace <span>/</span> <b>{t(tab)}</b></div></div><div className="topbar-actions"><label className="language-select"><span>EN</span><select value={language} aria-label="Language" onChange={(e) => setLanguage(e.target.value as Language)}><option value="en">English</option><option value="ml">മലയാളം</option></select><ChevronDown size={12} /></label><button className="icon-btn notification-btn" aria-label="Notifications"><Bell size={17} /><i /></button><span className="topbar-divider" /><div className="date-label">{new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())}</div></div></header>
      <div className="content-area">
        {error && <div className="error-banner"><span>{error}</span><button aria-label="Dismiss" onClick={() => setError('')}><X size={16} /></button></div>}
        {!demoSession && supabaseConfigurationError && <div className="error-banner"><span>{supabaseConfigurationError}</span></div>}{demoSession && <div className="preview-banner"><span className="preview-dot" /><b>Illustrative scenario</b><span>Sample inventory and buyer requirements; actions and outcomes remain local and simulated.</span><button onClick={restartDemo}>Reset workspace <ArrowRight size={14} /></button><button onClick={() => { demoSessionRef.current = false; setDemoSession(false); setShowWorkspace(false); setError('') }}>Back to landing page</button></div>}
        {!demoSession && isSupabaseConfigured && !user && !loading ? <section className="auth-panel"><span className="eyebrow">FRESHFLOW WORKSPACE</span><h1>Good food, moving forward.</h1><p>Sign in to manage your inventory, find confirmed demand, and make a clear next move.</p><button className="primary-btn" onClick={() => void signIn()}>Continue with Google <ArrowRight size={16} /></button><small>Google sign-in uses Supabase Auth when the provider is configured.</small></section> : <>
          {tab === 'Overview' && <>
            <section className="welcome-row"><div><div className="eyebrow">SATURDAY, OCTOBER 24, 2026 <span className="eyebrow-dot">·</span> ALUVA, KERALA</div><h1>{t('Good morning,')} Aarav <span className="wave">✳</span></h1><p>{t('Your supply, in good hands.')}</p></div><div className="welcome-actions"><button className="secondary-btn" onClick={() => setModal('demand')}><Search size={16} />{t('Create buyer requirement')}</button><button className="primary-btn" onClick={() => setModal('inventory')}><Plus size={17} />{t('Add inventory')}</button></div></section>
            <section className="metric-grid"><Metric icon={<Sprout size={17}/>} label="Inventory at a glance" value={`${batches.length}`} detail={`${batches.reduce((sum, b) => sum + b.availableQuantity, 0).toLocaleString('en-IN')} ${batches[0]?.unit ?? 'kg'} available`} tone="green" /><Metric icon={<Search size={17}/>} label="Matching demand" value={`${matches.length}`} detail={demoSession ? 'Illustrative requirements' : 'Published requirements'} tone="blue" /><Metric icon={<TrendingUp size={17}/>} label={demoSession ? 'Illustrative net proceeds' : 'Net proceeds recorded'} value={demoSession && options.some((option) => option.feasible) ? fmt(Math.max(...options.filter((option) => option.feasible).map((option) => option.netProceeds ?? 0))) : '—'} detail="Scenario assumptions only" tone="amber" /><Metric icon={<BadgeCheck size={17}/>} label={demoSession ? 'Scenario outcomes' : 'Recorded outcomes'} value={`${outcomes.length}`} detail={demoSession ? 'Simulated; not verified impact' : 'Recorded completed handovers'} tone="purple" /></section>
            <section className="dashboard-grid"><div className="panel inventory-panel"><div className="panel-heading"><div><h2>Inventory at a glance</h2><p>Freshness window is a guide, not a safety assessment.</p></div><button className="text-link" onClick={() => setTab('Inventory')}>View inventory <ArrowRight size={14}/></button></div><div className="inventory-list">{batches.slice(0, 4).map((batch) => <InventoryRow key={batch.id} batch={batch} onClick={() => { setActiveBatch(batch); setTab('Inventory') }} />)}{batches.length === 0 && <Empty text="No inventory yet. Add a batch to get started." />}</div><button className="add-row" onClick={() => setModal('inventory')}><Plus size={15}/> Add an inventory batch</button></div>
              <div className="right-stack"><div className="panel attention-panel"><div className="panel-heading"><div className="heading-with-icon"><span className="attention-icon"><Clock3 size={16}/></span><div><h2>Needs your attention</h2><p>Review freshness and available action</p></div></div><span className="count-pill">{pending.length}</span></div>{pending.length ? pending.slice(0, 2).map((batch) => <button key={batch.id} className="attention-item" onClick={() => { setActiveBatch(batch); setTab('Decisions') }}><span className="attention-item-name">{batch.produce}<small>{batch.availableQuantity} {batch.unit} · {batch.location}</small></span><RiskPill risk={riskLevel(batch)}/><ArrowRight size={15}/></button>) : <Empty text="No inventory currently needs a decision." />}</div>
              <div className="panel demand-panel"><div className="panel-heading"><div><h2>Matching demand</h2><p>Published buyer requirements</p></div><button className="mini-link" onClick={() => setTab('Demand & buyers')}>See all</button></div>{matches.length ? matches.slice(0, 2).map((option) => { const { batch, demand } = option; const qty = option.quantity; return <button key={`${batch.id}-${demand.id}`} className="demand-match" onClick={() => void reviewOption(evaluateOption(batch, demand, emptyCosts))}><span className="buyer-avatar">{demand.produce[0]}</span><span className="match-copy"><b>{demand.produce} <span className="confirmed-dot" title="Published requirement" /></b><small>{qty} {demand.unit} · {demand.location}</small></span><ArrowDownRight size={15}/></button>}) : <Empty text="Add inventory and buyer requirements to find matches." />}</div></div></section>
            <section className="bottom-grid"><div className="panel decision-panel"><div className="panel-heading"><div className="heading-with-icon"><span className="decision-icon"><Sparkles size={16}/></span><div><h2>Decision queue</h2><p>Compare the next best actions for your stock</p></div></div><button className="text-link" onClick={() => setTab('Decisions')}>Open decisions <ArrowRight size={14}/></button></div>{options.slice(0, 2).map((option) => <DecisionRow key={`${option.batch.id}-${option.demand.id}`} option={option} onClick={() => void reviewOption(option)} />)}{!options.length && <Empty text="No matching supply and demand yet."/>}</div><div className="impact-card"><div className="impact-top"><span className="impact-icon"><Leaf size={18}/></span><span className="impact-caption">YOUR IMPACT</span><span className="impact-spark"><TrendingUp size={16}/></span></div><h2>Better moves,</h2><h2 className="impact-light">measured honestly.</h2><p>Food is counted as recovered only after a completed, recorded handover.</p><button onClick={() => setTab('Impact & reports')}>View verified outcomes <ArrowRight size={14}/></button><div className="impact-decoration"><span>✳</span></div></div></section>
          </>}
          {tab !== 'Overview' && <WorkspaceTab demoSession={demoSession} tab={tab} batches={batches} demands={demands} outcomes={outcomes} options={options} transactions={transactions} pendingOffers={pendingOffers} pendingConfirmations={pendingConfirmations} onAcceptOffer={(offer) => void respondOffer(offer, 'accept')} onRespondOffer={(offer, action) => void respondOffer(offer, action)} onCounterOffer={(offer) => void counterOffer(offer)} onConfirmHandover={(id) => void confirmHandover(id)} onInventory={() => { setEditingBatch(null); setModal('inventory') }} onEditInventory={(batch) => { setEditingBatch(batch); setModal('inventory') }} onArchiveInventory={(batch) => void archiveInventory(batch)} onDemand={() => { setEditingDemand(null); setModal('demand') }} onEditDemand={(demand) => { setEditingDemand(demand); setModal('demand') }} onTransitionDemand={(demand, action) => void transitionDemand(demand, action)} canEditDemand={(demand) => demoSession || demand.ownerId === user?.id} onReview={(option) => void reviewOption(option)} onRecord={(transaction) => { setActiveTransaction(transaction); setActiveOption(transaction.option); setModal('outcome') }} />}
          {loading && <div className="loading-cover"><span className="spinner"/> Loading your workspace…</div>}
        </>}
        <footer className="footer"><span>FreshFlow <b>·</b> Food, in the right place.</span><span><ShieldCheck size={13}/> Your data stays yours</span></footer>
      </div>
    </main>
    {modal && <ModalShell title={modal === 'inventory' ? 'Add inventory' : modal === 'demand' ? 'New buyer requirement' : modal === 'decision' ? 'Review this decision' : demoSession ? 'Record scenario outcome' : 'Record completed handover'} onClose={() => { setModal(null); setError('') }}>
      {modal === 'inventory' && <form action={(form) => void addInventory(form)}><p className="modal-intro">Start with the essentials. You can add more details later.</p><div className="form-grid"><Field label="Produce" required><input name="produce" placeholder="e.g. Tomatoes" defaultValue={editingBatch?.produce ?? ''} required /></Field><Field label="Available quantity" required><div className="input-with-unit"><input name="quantity" type="number" min="0.01" step="0.01" placeholder="0" defaultValue={editingBatch?.quantity ?? ''} required/><select name="unit" defaultValue={editingBatch?.unit ?? 'kg'}><option>kg</option><option>crate</option><option>box</option></select></div></Field><Field label="Location" required><input name="location" placeholder="Town or collection point" defaultValue={editingBatch?.location ?? ''} required /></Field><Field label="Quality"><select name="quality" defaultValue={editingBatch?.quality ?? 'Good'}><option>Good</option><option>Premium</option><option>Needs sorting</option></select></Field><details className="advanced-fields"><summary>More details <ChevronDown size={13}/></summary><div className="form-grid"><Field label="Asking price (₹/unit)"><input name="askingPrice" type="number" min="0" step="0.01" placeholder="Optional" defaultValue={editingBatch?.askingPrice ?? ''}/></Field><Field label="Purchase cost (₹/unit)"><input name="purchaseCost" type="number" min="0" step="0.01" placeholder="Optional" defaultValue={editingBatch?.purchaseCost ?? ''}/></Field><Field label="Available from"><input name="availableAt" type="datetime-local" defaultValue={editingBatch ? localDateTime(editingBatch.availableAt) : INITIAL_AVAILABLE_AT} required /></Field><Field label="Harvest or purchase date/time"><input name="harvestedOrPurchasedAt" type="datetime-local" defaultValue={editingBatch?.harvestedOrPurchasedAt ? localDateTime(editingBatch.harvestedOrPurchasedAt) : ''}/></Field><Field label="Operational freshness window (hours)"><input name="freshnessHours" type="number" min="1" step="1" placeholder="Unknown if blank" defaultValue={editingBatch?.freshnessHours ?? ''}/></Field><Field label="Inventory photo (optional)"><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={!isSupabaseConfigured}/></Field></div></details></div><label className="publish-toggle"><input type="checkbox" name="publish" defaultChecked={editingBatch?.isPublished ?? false}/> <span><b>Publish this batch for buyers to discover</b><small>Private until you choose this. You can stop publishing later.</small></span></label><p className="form-note"><ShieldCheck size={14}/> Your batch stays private unless you publish it. Photos are stored privately in Supabase Storage.</p><div className="modal-actions">{editingBatch && <button type="button" className="secondary-btn" onClick={() => { void archiveInventory(editingBatch); setModal(null); setEditingBatch(null) }}>Archive batch</button>}<button type="button" className="secondary-btn" onClick={() => { setModal(null); setEditingBatch(null) }}>Cancel</button><button type="submit" className="primary-btn">{editingBatch ? 'Save inventory' : 'Add inventory'}<ArrowRight size={15}/></button></div></form>}
      {modal === 'demand' && <form action={(form) => void addDemand(form)}><p className="modal-intro">Record a real buyer requirement. Only requirements you publish can be matched.</p><div className="form-grid"><Field label="Produce" required><input name="produce" placeholder="e.g. Tomatoes" defaultValue={editingDemand?.produce ?? ''} required /></Field><Field label="Required quantity" required><div className="input-with-unit"><input name="quantity" type="number" min="0.01" step="0.01" placeholder="0" defaultValue={editingDemand?.quantity ?? ''} required/><select name="unit" defaultValue={editingDemand?.unit ?? 'kg'}><option>kg</option><option>crate</option><option>box</option></select></div></Field><Field label="Delivery location" required><input name="location" placeholder="Town or receiving point" defaultValue={editingDemand?.location ?? ''} required /></Field><Field label="Price limit (₹/unit)"><input name="maxPrice" type="number" min="0" step="0.01" placeholder="Optional" defaultValue={editingDemand?.maxPrice ?? ''}/></Field><Field label="Required by" required><input name="requiredBy" type="date" required defaultValue={editingDemand?.requiredBy.slice(0,10) ?? INITIAL_REQUIRED_BY}/></Field><Field label="Minimum acceptable condition"><select name="quality" defaultValue={editingDemand?.quality ?? ''}><option value="">Any condition</option><option>Needs sorting</option><option>Good</option><option>Premium</option></select></Field></div><p className="form-note"><ShieldCheck size={14}/> A published requirement is visible to signed-in users with compatible inventory.</p><ModalActions onCancel={() => { setModal(null); setEditingDemand(null) }} submit={editingDemand ? 'Save requirement' : 'Publish requirement'}/></form>}
      {modal === 'decision' && activeOption && <form action={(form) => void approveOption(form)} onInput={(event) => { const values = new FormData(event.currentTarget); const names = ['transport', 'handling', 'storage', 'processing', 'platform']; const qty = Number(values.get('quantity')); const price = Number(values.get('price')); const costs = names.map((name) => values.get(name)); setDecisionNetPreview(costs.every((value) => value !== null && value !== '') && qty > 0 && price > 0 ? (Math.round(qty * price * 100) - Math.round(costs.reduce<number>((sum, value) => sum + Number(value), 0) * 100)) / 100 : null) }}><p className="modal-intro">{demoSession ? 'This illustrative match shows the workflow. Continuing creates a local scenario offer only.' : 'Approval submits an offer; stock is reserved only after the buyer accepts it.'}</p><div className="decision-summary"><div><span className="summary-label">MATCHED REQUIREMENT</span><b>{activeDemand?.buyerName} · {activeDemand?.location}</b><small>{activeDemand?.quantity} {activeDemand?.unit} requested by {activeDemand ? timeLabel(activeDemand.requiredBy) : ''}</small></div><span className="confirmed-badge"><BadgeCheck size={14}/> {demoSession ? 'Illustrative requirement' : 'Published demand'}</span></div><InventoryAiAnalysis inventoryId={activeOption.batch.id} isPublicWorkspace={demoSession} isAuthenticated={Boolean(user)}/><div className="form-grid"><Field label="Quantity to offer" required><input name="quantity" type="number" min="0.01" max={Math.min(activeOption.batch.availableQuantity, activeOption.demand.quantity)} step="0.01" defaultValue={Math.min(activeOption.batch.availableQuantity, activeOption.demand.quantity)} required/></Field><Field label="Agreed price (₹/unit)" required><input name="price" type="number" min="0.01" step="0.01" defaultValue={activeOption.unitPrice ?? activeBatch?.askingPrice ?? ''} required/></Field><Field label="Transport (₹)" required><input name="transport" type="number" min="0" step="0.01" placeholder="Unknown" defaultValue={demoSession && activeOption.batch.id === 'sample-b1' ? 240 : ''} required/></Field><Field label="Handling (₹)" required><input name="handling" type="number" min="0" step="0.01" placeholder="Unknown" defaultValue={demoSession && activeOption.batch.id === 'sample-b1' ? 90 : ''} required/></Field><Field label="Storage (₹)" required><input name="storage" type="number" min="0" step="0.01" placeholder="Unknown" defaultValue={demoSession && activeOption.batch.id === 'sample-b1' ? 0 : ''} required/></Field><Field label="Processing (₹)" required><input name="processing" type="number" min="0" step="0.01" placeholder="Unknown" defaultValue={demoSession && activeOption.batch.id === 'sample-b1' ? 0 : ''} required/></Field><Field label="Platform fee (₹)" required><input name="platform" type="number" min="0" step="0.01" placeholder="Unknown" defaultValue={demoSession && activeOption.batch.id === 'sample-b1' ? 0 : ''} required/></Field></div><div className="net-preview"><span>{demoSession ? 'Illustrative net proceeds' : 'Indicative net proceeds'}</span><b>{decisionNetPreview === null ? 'Complete all cost fields' : fmt(decisionNetPreview)}</b><small>{demoSession ? 'Scenario assumptions only; these are not quotes or real costs.' : 'Calculated as quantity × proposed price − entered costs. Confirmed only after acceptance and handover.'}</small></div><label className="publish-toggle route-check"><input type="checkbox" name="routeConfirmed" required/><span><b>{demoSession ? 'Confirm illustrative route assumption' : "I've confirmed this route and delivery can meet the buyer's deadline"}</b><small>{demoSession ? 'This advances the local scenario only.' : 'A transport amount alone does not confirm route or delivery availability.'}</small></span></label><div className="comparison-note"><CircleHelp size={15}/><span>{demoSession ? 'Illustrative values stay in this browser workspace.' : 'Unknown costs remain incomplete; enter ₹0 only when you have confirmed no cost applies.'}</span></div>{(activeOption.missing.length > 0 || activeOption.requiredChecks.length > 0) && <div className="missing-note">This option still needs: {[...activeOption.missing, ...activeOption.requiredChecks].join(', ')}.</div>}<ModalActions onCancel={() => setModal(null)} submit={demoSession ? 'Continue scenario' : 'Submit approved offer'}/></form>}
      {modal === 'outcome' && <form action={(form) => void recordOutcome(form)}><p className="modal-intro">{demoSession ? "Record a simulated scenario outcome locally. It is not verified food recovery or real revenue." : "Record only what was actually accepted and handed over. Net proceeds are shown only when each cost is recorded."}</p><div className="form-grid"><Field label="Accepted quantity" required><input name="quantity" type="number" min="0.01" max={activeTransaction?.quantity} step="0.01" defaultValue={activeTransaction?.quantity ?? ''} required/></Field><Field label="Agreed price (₹/unit)" required><input name="price" type="number" min="0.01" step="0.01" defaultValue={activeOption?.unitPrice ?? ''} required/></Field><Field label="Transport (₹)" required><input name="transport" type="number" min="0" step="0.01" placeholder="Actual cost, or 0" required/></Field><Field label="Handling (₹)" required><input name="handling" type="number" min="0" step="0.01" placeholder="Actual cost, or 0" required/></Field><Field label="Storage (₹)" required><input name="storage" type="number" min="0" step="0.01" placeholder="Actual cost, or 0" required/></Field><Field label="Processing (₹)" required><input name="processing" type="number" min="0" step="0.01" placeholder="Actual cost, or 0" required/></Field><Field label="Platform fee (₹)" required><input name="platform" type="number" min="0" step="0.01" placeholder="Actual fee, or 0" required/></Field></div><p className="form-note"><BadgeCheck size={14}/> {demoSession ? "This scenario stays local and is not counted as verified impact." : "Only completed, recorded handovers count as verified outcomes."}</p><ModalActions onCancel={() => setModal(null)} submit={demoSession ? "Record scenario outcome" : "Record completed handover"}/></form>}
    </ModalShell>}
  </div>
}

function Metric({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><span className="metric-label">{label}</span><div className="metric-value">{value}<span className="metric-detail">{detail}</span></div></div> }
function InventoryPhotoThumb({ batch }: { batch: InventoryBatch }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!batch.photoPath) return
    let active = true
    void getInventoryPhotoUrl(batch.photoPath).then((url) => { if (active) setImageUrl(url) })
    return () => { active = false }
  }, [batch.photoPath])
  return imageUrl
    ? <img className="produce-icon photo-thumb" src={imageUrl} alt={`${batch.produce} inventory`} />
    : <div className={`produce-icon produce-${batch.produce[0].toLowerCase()}`}>{batch.produce[0]}</div>
}
function InventoryRow({ batch, onClick, onEdit, onArchive }: { batch: InventoryBatch; onClick: () => void; onEdit?: () => void; onArchive?: () => void }) {
  return <div className="inventory-item-row"><button className="inventory-row" onClick={onClick}><InventoryPhotoThumb batch={batch}/><span className="inventory-name"><b>{batch.produce} {batch.id.startsWith('sample-') && <span className="sample-badge">SAMPLE</span>}</b><small><MapPin size={12}/> {batch.location}</small></span><span className="inventory-qty"><b>{batch.availableQuantity} <small>{batch.unit}</small></b><span>{batch.quality}</span></span><span className="inventory-price">{batch.askingPrice === null ? <em>Price unknown</em> : <><b>{fmt(batch.askingPrice)}</b><small>/ {batch.unit}</small></>}<span>asking price</span></span><RiskPill risk={riskLevel(batch)}/><ArrowRight className="row-arrow" size={15}/></button>{onEdit && <button className="secondary-btn compact-btn" onClick={onEdit}>Edit</button>}{onArchive && <button className="secondary-btn compact-btn" onClick={onArchive}>Archive</button>}</div>
}
function RiskPill({ risk }: { risk: string }) { const text: Record<string, string> = { urgent: 'Urgent review', at_risk: 'At risk', monitor: 'Monitor', unknown: 'Insufficient data', normal: 'On track' }; return <span className={`risk-pill risk-${risk}`}><i/>{text[risk] ?? risk}</span> }
function DecisionRow({ option, onClick }: { option: DecisionOption; onClick: () => void }) { return <button className="decision-row" onClick={onClick}><span className="decision-product">{option.batch.produce[0]}</span><span className="decision-main"><b>{option.batch.produce} <span className="arrow-inline">→</span> {option.demand.buyerName}</b><small>{option.quantity} {option.batch.unit} · {option.demand.location} · {option.reason}</small></span><span className="decision-value"><b>{option.netProceeds === null ? 'Add costs' : fmt(option.netProceeds)}</b><small>{option.feasible ? 'net proceeds' : 'incomplete'}</small></span><ArrowRight size={15}/></button> }
function Empty({ text }: { text: string }) { return <div className="empty-state"><span className="empty-sprout"><Sprout size={16}/></span>{text}</div> }
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="field"><span>{label}{required && <i> *</i>}</span>{children}</label> }
function ModalActions({ onCancel, submit }: { onCancel: () => void; submit: string }) { return <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button><button type="submit" className="primary-btn">{submit}<ArrowRight size={15}/></button></div> }
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-header"><div><span className="eyebrow">FRESHFLOW WORKSPACE</span><h2 id="modal-title">{title}</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button></header>{children}</section></div> }
function WorkspaceTab({ demoSession, tab, batches, demands, outcomes, options, transactions, pendingOffers, pendingConfirmations, onAcceptOffer, onRespondOffer, onCounterOffer, onConfirmHandover, onInventory, onEditInventory, onArchiveInventory, onDemand, onEditDemand, onTransitionDemand, canEditDemand, onReview, onRecord }: { demoSession: boolean; tab: Tab; batches: InventoryBatch[]; demands: BuyerDemand[]; outcomes: RecordedOutcome[]; options: DecisionOption[]; transactions: PendingTransaction[]; pendingOffers: PendingOffer[]; pendingConfirmations: PendingConfirmation[]; onAcceptOffer: (offer: PendingOffer) => void; onRespondOffer: (offer: PendingOffer, action: 'accept' | 'reject' | 'cancel') => void; onCounterOffer: (offer: PendingOffer) => void; onConfirmHandover: (id: string) => void; onInventory: () => void; onEditInventory: (batch: InventoryBatch) => void; onArchiveInventory: (batch: InventoryBatch) => void; onDemand: () => void; onEditDemand: (demand: BuyerDemand) => void; onTransitionDemand: (demand: BuyerDemand, action: 'close' | 'cancel') => void; canEditDemand: (demand: BuyerDemand) => boolean; onReview: (option: DecisionOption) => void; onRecord: (transaction: PendingTransaction) => void }) {
  const headings: Record<Tab, [string, string]> = { Overview: ['', ''], Inventory: ['Your inventory', 'A clear view of each batch, its available quantity and freshness information.'], Decisions: ['Decision queue', 'Match available stock to published demand, then review costs before you act.'], 'Demand & buyers': ['Demand & buyers', demoSession ? 'Illustrative requirements; no real buyers are represented.' : 'Requirements are real only when they are published by a signed-in user.'], Transactions: ['Transactions', demoSession ? 'Offers in this scenario stay in this browser and never reserve real stock.' : 'A seller submits an offer. The buyer accepts it before stock is reserved.'], 'Impact & reports': ['Impact & reports', demoSession ? 'Outcomes in this scenario are simulated, not verified food recovery or revenue.' : 'Verified outcomes include only handovers recorded as complete.'] }
  const [title, subtitle] = headings[tab]
  return <><section className="page-heading"><div><div className="eyebrow">WORKSPACE / {tab.toUpperCase()}</div><h1>{title}</h1><p>{subtitle}</p></div><div className="welcome-actions">{tab !== 'Impact & reports' && <>{tab !== 'Demand & buyers' && <button className="secondary-btn" onClick={onDemand}><Search size={15}/> New requirement</button>}{tab !== 'Demand & buyers' && <button className="primary-btn" onClick={onInventory}><Plus size={16}/> Add inventory</button>}{tab === 'Demand & buyers' && <button className="primary-btn" onClick={onDemand}><Plus size={16}/> Create requirement</button>}</>}</div></section>
    {tab === 'Inventory' && <div className="panel page-panel"><div className="panel-heading"><div><h2>Inventory batches</h2><p>Unknown freshness information is shown as insufficient data.</p></div><span className="count-pill">{batches.length} batches</span></div><div className="inventory-list">{batches.map((batch) => <InventoryRow key={batch.id} batch={batch} onClick={() => { if (!batch.archivedAt) onEditInventory(batch) }} onEdit={!batch.archivedAt ? () => onEditInventory(batch) : undefined} onArchive={!batch.archivedAt ? () => onArchiveInventory(batch) : undefined} />)}</div>{!batches.length && <Empty text="Add your first inventory batch."/>}</div>}
    {tab === 'Demand & buyers' && <div className="panel page-panel"><div className="panel-heading"><div><h2>Published requirements</h2><p>Location, quantity and delivery date help assess a match.</p></div><span className="count-pill">{demands.length} active</span></div>{demands.map((demand) => <div className="demand-card" key={demand.id}><span className="buyer-avatar">{demand.produce[0]}</span><div className="demand-card-main"><b>{demand.produce}<span className="confirmed-dot"/></b><small>{demand.buyerName} · {demand.location}</small></div><div className="demand-card-data"><b>{demand.quantity} {demand.unit}</b><small>required by {timeLabel(demand.requiredBy)}</small></div><div className="demand-card-data"><b>{demand.maxPrice === null ? 'Price not supplied' : `${fmt(demand.maxPrice)} / ${demand.unit}`}</b><small>buyer price limit</small></div><span className="status-pill">{demand.status ?? "Published"}</span>{canEditDemand(demand) && demand.status !== "closed" && demand.status !== "cancelled" && <><button className="secondary-btn compact-btn" onClick={() => onEditDemand(demand)}>Edit</button><button className="secondary-btn compact-btn" onClick={() => onTransitionDemand(demand, "close")}>Close</button></>}</div>)}{!demands.length && <Empty text="No published buyer requirements yet."/>}</div>}
    {tab === 'Decisions' && <div className="panel page-panel"><div className="panel-heading"><div><h2>Available options</h2><p>Transport and handling costs are required before a sale can be approved.</p></div></div>{options.map((option) => <DecisionRow key={`${option.batch.id}-${option.demand.id}`} option={option} onClick={() => onReview(option)}/>)}{!options.length && <Empty text="No exact product and unit matches yet."/>}<div className="info-strip"><CircleHelp size={15}/> Freshness windows prioritize attention. They do not predict food safety or guaranteed shelf life.</div></div>}
    {tab === 'Transactions' && <><div className="panel page-panel"><div className="panel-heading"><div><h2>Offers awaiting your response</h2><p>Accepting an offer reserves available stock and creates the transaction.</p></div></div>{pendingOffers.map((offer) => <div className="offer-row" key={offer.id}><span className="buyer-avatar">{offer.produce[0]}</span><div className="demand-card-main"><b>{offer.produce} {offer.option && <span className="status-pill">SAMPLE</span>}</b><small>From seller {offer.sellerId.slice(0, 6)} · {offer.location}</small></div><div className="demand-card-data"><b>{offer.quantity} {offer.unit}</b><small>{fmt(offer.unitPrice)} / {offer.unit}</small></div><span className="status-pill">{offer.role === "buyer" ? "Buyer" : "Seller"}</span>{offer.canRespond && <><button className="primary-btn compact-btn" onClick={() => onAcceptOffer(offer)}>Accept</button><button className="secondary-btn compact-btn" onClick={() => onRespondOffer(offer, "reject")}>Reject</button><button className="secondary-btn compact-btn" onClick={() => onCounterOffer(offer)}>Counter</button>{offer.role === "seller" && <button className="secondary-btn compact-btn" onClick={() => onRespondOffer(offer, "cancel")}>Cancel</button>}</>}</div>)}{!pendingOffers.length && <Empty text="No buyer offers are waiting for your response."/>}{pendingOffers.some((offer) => offer.option) && <div className="info-strip">Illustrative offer only. No real buyer response or stock reservation exists.</div>}</div><div className="panel page-panel"><div className="panel-heading"><div><h2>Confirm seller-reported handovers</h2></div></div>{pendingConfirmations.map((item) => <div className="offer-row" key={item.id}><span className="demand-card-main"><b>{item.produce}</b><small>{item.quantity} {item.unit} at {fmt(item.unitPrice)} per {item.unit}</small></span><button className="primary-btn compact-btn" onClick={() => onConfirmHandover(item.id)}>Confirm handover</button></div>)}{!pendingConfirmations.length && <Empty text="No seller-reported handovers need confirmation."/>}</div><div className="panel page-panel"><div className="panel-heading"><div><h2>Awaiting handover</h2><p>Record accepted quantities when a real handover is complete.</p></div></div>{transactions.map((transaction) => <div className="offer-row" key={transaction.id ?? transaction.option.batch.id}><span className="buyer-avatar">{transaction.option.batch.produce[0]}</span><div className="demand-card-main"><b>{transaction.option.batch.produce} → {transaction.option.demand.buyerName}</b><small>{transaction.option.demand.location} · Accepted offer</small></div><div className="demand-card-data"><b>{transaction.quantity} {transaction.option.batch.unit}</b><small>{transaction.option.unitPrice ? `${fmt(transaction.option.unitPrice)} / ${transaction.option.batch.unit}` : 'Price recorded'}</small></div><button className="secondary-btn compact-btn" onClick={() => onRecord(transaction)}>Record handover <ArrowRight size={14}/></button></div>)}{!transactions.length && <Empty text="No accepted offers are awaiting handover."/>}<div className="info-strip"><ShieldCheck size={15}/> A buyer requirement is not a purchase commitment. Only accepted offers reserve stock.</div></div></>}
    {tab === 'Impact & reports' && <><div className="metric-grid"><Metric icon={<BadgeCheck size={17}/>} label="Verified outcomes" value={`${outcomes.filter((o) => o.verificationStatus === 'buyer_confirmed').length}`} detail="Buyer-confirmed handovers" tone="green"/><Metric icon={<Sprout size={17}/>} label="Quantity recorded" value={`${outcomes.reduce((s, o) => s + o.quantity, 0).toLocaleString('en-IN')}`} detail={outcomes[0]?.unit ?? 'kg'} tone="blue"/><Metric icon={<TrendingUp size={17}/>} label="Net proceeds recorded" value={outcomes.length && outcomes.every((o) => Number.isFinite(o.netProceeds)) ? fmt(outcomes.reduce((s, o) => s + o.netProceeds, 0)) : '—'} detail="Only when costs are complete" tone="amber"/><Metric icon={<ArrowDownRight size={17}/>} label="Avoided loss" value="Not measured" detail="Requires a documented baseline" tone="purple"/></div><div className="panel page-panel"><div className="panel-heading"><div><h2>Recorded outcomes</h2><p>FreshFlow does not claim impact from an uncompleted transaction.</p></div></div>{outcomes.map((outcome) => <div className="demand-card" key={outcome.id}><span className="confirmed-badge"><BadgeCheck size={14}/>{outcome.verificationStatus === 'buyer_confirmed' ? 'Buyer confirmed' : 'Seller reported'}</span><div className="demand-card-main"><b>{demoSession ? "Scenario outcome" : "Completed handover"}</b><small>{timeLabel(outcome.recordedAt)}</small></div><div className="demand-card-data"><b>{outcome.quantity} {outcome.unit}</b><small>accepted quantity</small></div><div className="demand-card-data"><b>{fmt(outcome.unitPrice * outcome.quantity)}</b><small>gross value</small></div><div className="demand-card-data"><b>{Number.isFinite(outcome.netProceeds) ? fmt(outcome.netProceeds) : 'Incomplete'}</b><small>net proceeds</small></div></div>)}{!outcomes.length && <Empty text="Completed handovers will appear here. No food recovery is counted in advance."/>}</div></>}
  </>
}
