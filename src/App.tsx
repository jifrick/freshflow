import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownRight, ArrowRight, BadgeCheck, Bell, Check, ChevronDown, CircleHelp, Clock3, Leaf, LogOut, MapPin, Menu, Plus, Search, ShieldCheck, Sparkles, Sprout, TrendingUp, Truck, X } from 'lucide-react'
import { compareOptions, evaluateOption, riskLevel } from './domain/decisionEngine'
import type { BuyerDemand, DecisionOption, InventoryBatch, RecordedOutcome, Unit } from './domain/types'
import { getInventoryPhotoUrl, uploadInventoryPhoto } from './lib/inventoryPhotos'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type Tab = 'Overview' | 'Inventory' | 'Decisions' | 'Demand & buyers' | 'Transactions' | 'Impact & reports'
type Modal = 'inventory' | 'demand' | 'decision' | 'outcome' | null
type Language = 'en' | 'ml'
type PendingTransaction = { id: string | null; option: DecisionOption; quantity: number }
type PendingOffer = { id: string; produce: string; location: string; quantity: number; unit: Unit; unitPrice: number; sellerId: string; option?: DecisionOption }

const seedBatches: InventoryBatch[] = [
  { id: 'sample-b1', ownerId: 'sample', produce: 'Tomatoes', quantity: 180, availableQuantity: 180, unit: 'kg', location: 'Aluva, Kerala', quality: 'Good', askingPrice: 28, purchaseCost: 19, availableAt: '2026-10-23T08:00:00.000Z', freshnessHours: 72, status: 'available' },
  { id: 'sample-b2', ownerId: 'sample', produce: 'Nendran banana', quantity: 240, availableQuantity: 240, unit: 'kg', location: 'Thrissur, Kerala', quality: 'Premium', askingPrice: 34, purchaseCost: null, availableAt: '2026-10-22T08:00:00.000Z', freshnessHours: 168, status: 'available' },
  { id: 'sample-b3', ownerId: 'sample', produce: 'Green chilies', quantity: 65, availableQuantity: 65, unit: 'kg', location: 'Kochi, Kerala', quality: 'Good', askingPrice: null, purchaseCost: null, availableAt: '2026-10-24T06:00:00.000Z', freshnessHours: null, status: 'available' },
]
const seedDemands: BuyerDemand[] = [
  { id: 'sample-d1', buyerName: 'Demo • Community kitchen', produce: 'Tomatoes', quantity: 120, unit: 'kg', maxPrice: 34, location: 'Ernakulam, Kerala', requiredBy: '2026-10-26T12:00:00.000Z', confirmed: true },
  { id: 'sample-d2', buyerName: 'Demo • Produce retailer', produce: 'Nendran banana', quantity: 80, unit: 'kg', maxPrice: 38, location: 'Thrissur, Kerala', requiredBy: '2026-10-27T10:00:00.000Z', confirmed: true },
]
const menu: Tab[] = ['Overview', 'Inventory', 'Decisions', 'Demand & buyers', 'Transactions', 'Impact & reports']
const translations: Record<Language, Record<string, string>> = {
  en: {},
  ml: { Overview: 'അവലോകനം', Inventory: 'ശേഖരം', Decisions: 'തീരുമാനങ്ങൾ', 'Demand & buyers': 'ആവശ്യവും വാങ്ങുന്നവരും', Transactions: 'ഇടപാടുകൾ', 'Impact & reports': 'ഫലവും റിപ്പോർട്ടുകളും', 'Good morning,': 'സുപ്രഭാതം,', 'Your supply, in good hands.': 'നിങ്ങളുടെ ഉൽപ്പന്നങ്ങൾ, നല്ല കൈകളിൽ.', 'Inventory at a glance': 'ശേഖരം ഒറ്റനോട്ടത്തിൽ', 'Needs your attention': 'ശ്രദ്ധിക്കേണ്ടവ', 'Matching demand': 'പൊരുത്തപ്പെടുന്ന ആവശ്യം', 'Potential net recovery': 'സാധ്യമായ ശുദ്ധ വരുമാനം', 'Verified outcomes': 'സ്ഥിരീകരിച്ച ഫലങ്ങൾ', 'Add inventory': 'ശേഖരം ചേർക്കുക', 'Create buyer requirement': 'വാങ്ങൽ ആവശ്യം ചേർക്കുക' },
}
const emptyCosts = { transport: null, handling: null, storage: null, processing: null, platform: null }
const INITIAL_AVAILABLE_AT = new Date().toISOString().slice(0, 16)
const INITIAL_REQUIRED_BY = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const fmt = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
const timeLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(value))

function readSandbox<T>(key: string, fallback: T): T {
  try { const saved = localStorage.getItem(`freshflow.${key}`); return saved ? JSON.parse(saved) as T : fallback } catch { return fallback }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Overview')
  const [modal, setModal] = useState<Modal>(null)
  const [batches, setBatches] = useState(() => readSandbox('batches', seedBatches))
  const [demands, setDemands] = useState(() => readSandbox('demands', seedDemands))
  const [outcomes, setOutcomes] = useState<RecordedOutcome[]>(() => readSandbox('outcomes', []))
  const [transactions, setTransactions] = useState<PendingTransaction[]>(() => readSandbox('transactions', []))
  const [pendingOffers, setPendingOffers] = useState<PendingOffer[]>(() => readSandbox('pendingOffers', []))
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState('')
  const [language, setLanguage] = useState<Language>('en')
  const [currentTime] = useState(() => Date.now())
  const [mobileMenu, setMobileMenu] = useState(false)
  const [activeBatch, setActiveBatch] = useState<InventoryBatch | null>(null)
  const [activeDemand, setActiveDemand] = useState<BuyerDemand | null>(null)
  const [activeOption, setActiveOption] = useState<DecisionOption | null>(null)
  const [decisionId, setDecisionId] = useState<string | null>(null)
  const [decisionNetPreview, setDecisionNetPreview] = useState<number | null>(null)
  const [activeTransaction, setActiveTransaction] = useState<PendingTransaction | null>(null)
  const tr = (label: string) => translations[language][label] ?? label

  const ensureProfile = useCallback(async (account: { id: string; user_metadata?: Record<string, unknown> }) => {
    if (!supabase) return
    const { data: profile } = await supabase.from('profiles').select('id').eq('id', account.id).maybeSingle()
    if (profile) return
    const metadataName = account.user_metadata?.full_name
    await supabase.from('profiles').insert({ id: account.id, display_name: typeof metadataName === 'string' ? metadataName : '' })
  }, [])

  const loadCloud = useCallback(async (uid: string) => {
    if (!supabase) return
    setLoading(true)
    const [batchResult, demandResult, outcomeResult, transactionResult, offerResult] = await Promise.all([
      supabase.from('inventory_batches').select('*').eq('owner_id', uid).order('created_at', { ascending: false }),
      supabase.from('buyer_demands').select('*').order('required_by'),
      supabase.from('outcomes').select('*, transactions!inner(id, unit)').eq('recorded_by', uid).order('recorded_at', { ascending: false }),
      supabase.from('transactions').select('id, accepted_quantity, agreed_unit_price, offers!inner(inventory_id, demand_id)').eq('seller_id', uid).eq('completion_status', 'handover_pending'),
      supabase.from('offers').select('id, produce_snapshot, location_snapshot, quantity, unit, unit_price, seller_id').eq('buyer_id', uid).eq('status', 'pending'),
    ])
    if (batchResult.error || demandResult.error || outcomeResult.error || transactionResult.error || offerResult.error) setError('FreshFlow could not load some workspace data. Check your database migration and RLS setup.')
    if (batchResult.data) setBatches(batchResult.data.map((row) => ({ id: row.id, ownerId: row.owner_id, produce: row.produce, quantity: Number(row.quantity), availableQuantity: Number(row.available_quantity), unit: row.unit, location: row.location, quality: row.quality, askingPrice: row.asking_price === null ? null : Number(row.asking_price), purchaseCost: row.purchase_cost === null ? null : Number(row.purchase_cost), availableAt: row.available_at, freshnessHours: row.freshness_hours, status: row.status, photoPath: row.photo_path })))
    if (demandResult.data) setDemands(demandResult.data.map((row) => ({ id: row.id, buyerName: `Buyer ${row.buyer_id.slice(0, 6)}`, produce: row.produce, quantity: Number(row.quantity), unit: row.unit, maxPrice: row.max_price === null ? null : Number(row.max_price), location: row.location, requiredBy: row.required_by, confirmed: row.is_published && row.status === 'published', quality: row.quality, status: row.status })))
    if (outcomeResult.data) setOutcomes(outcomeResult.data.map((row) => { const tx = Array.isArray(row.transactions) ? row.transactions[0] : row.transactions; return { id: row.id, batchId: row.batch_id, demandId: '', quantity: Number(row.accepted_quantity), unit: tx?.unit ?? 'kg', unitPrice: Number(row.gross_value) / Number(row.accepted_quantity), netProceeds: row.net_proceeds === null ? Number.NaN : Number(row.net_proceeds), recordedAt: row.recorded_at } }))
    if (transactionResult.data) setTransactions(transactionResult.data.flatMap((row) => {
      const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers
      if (!offer) return []
      const batch = batchResult.data?.find((item) => item.id === offer.inventory_id)
      const demand = demandResult.data?.find((item) => item.id === offer.demand_id)
      if (!batch || !demand) return []
      const mappedBatch: InventoryBatch = { id: batch.id, ownerId: batch.owner_id, produce: batch.produce, quantity: Number(batch.quantity), availableQuantity: Number(batch.available_quantity), unit: batch.unit, location: batch.location, quality: batch.quality, askingPrice: batch.asking_price === null ? null : Number(batch.asking_price), purchaseCost: batch.purchase_cost === null ? null : Number(batch.purchase_cost), availableAt: batch.available_at, freshnessHours: batch.freshness_hours, status: batch.status, photoPath: batch.photo_path }
      const mappedDemand: BuyerDemand = { id: demand.id, buyerName: `Buyer ${demand.buyer_id.slice(0, 6)}`, produce: demand.produce, quantity: Number(demand.quantity), unit: demand.unit, maxPrice: demand.max_price === null ? null : Number(demand.max_price), location: demand.location, requiredBy: demand.required_by, confirmed: true, quality: demand.quality, status: demand.status }
      return [{ id: row.id, quantity: Number(row.accepted_quantity), option: evaluateOption(mappedBatch, mappedDemand, emptyCosts) }]
    }))
    if (offerResult.data) setPendingOffers(offerResult.data.map((row) => ({ id: row.id, produce: row.produce_snapshot, location: row.location_snapshot, quantity: Number(row.quantity), unit: row.unit, unitPrice: Number(row.unit_price), sellerId: row.seller_id })))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      const current = data.session?.user
      if (current) { setUser({ id: current.id, email: current.email }); void ensureProfile(current); void loadCloud(current.id) }
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const current = session?.user
      setUser(current ? { id: current.id, email: current.email } : null)
      if (current) { void ensureProfile(current); void loadCloud(current.id) }
    })
    return () => subscription.unsubscribe()
  }, [ensureProfile, loadCloud])

  useEffect(() => { if (!isSupabaseConfigured) { localStorage.setItem('freshflow.batches', JSON.stringify(batches)); localStorage.setItem('freshflow.demands', JSON.stringify(demands)); localStorage.setItem('freshflow.outcomes', JSON.stringify(outcomes)); localStorage.setItem('freshflow.transactions', JSON.stringify(transactions)); localStorage.setItem('freshflow.pendingOffers', JSON.stringify(pendingOffers)) } }, [batches, demands, outcomes, transactions, pendingOffers])

  const sellerBatches = useMemo(() => user ? batches.filter((batch) => batch.ownerId === user.id) : batches, [batches, user])
  const activeDemands = useMemo(() => demands.filter((demand) => (demand.status === undefined || demand.status === 'published') && new Date(demand.requiredBy).getTime() >= currentTime), [demands, currentTime])
  const options = useMemo(() => compareOptions(sellerBatches.flatMap((batch) => activeDemands.map((demand) => evaluateOption(batch, demand, emptyCosts))).filter((option) => option.quantity > 0)), [sellerBatches, activeDemands])
  const matches = useMemo(() => sellerBatches.flatMap((batch) => activeDemands.filter((demand) => batch.produce.toLocaleLowerCase() === demand.produce.toLocaleLowerCase() && batch.unit === demand.unit && batch.availableQuantity > 0).map((demand) => ({ batch, demand, qty: Math.min(batch.availableQuantity, demand.quantity) }))), [sellerBatches, activeDemands])
  const attention = sellerBatches.filter((batch) => ['unknown', 'urgent', 'at_risk'].includes(riskLevel(batch)))
  const pending = sellerBatches.filter((batch) => batch.availableQuantity > 0 && (riskLevel(batch) === 'unknown' || riskLevel(batch) === 'urgent' || riskLevel(batch) === 'at_risk'))
  const t = (label: string) => tr(label)

  async function addInventory(form: FormData) {
    const quantity = Number(form.get('quantity'))
    const selectedPhoto = form.get('photo')
    const photo = selectedPhoto instanceof File && selectedPhoto.size > 0 ? selectedPhoto : null
    const row = { owner_id: user?.id, produce: String(form.get('produce')), quantity, available_quantity: quantity, unit: form.get('unit'), location: String(form.get('location')), quality: form.get('quality'), asking_price: form.get('askingPrice') ? Number(form.get('askingPrice')) : null, purchase_cost: form.get('purchaseCost') ? Number(form.get('purchaseCost')) : null, available_at: new Date(String(form.get('availableAt'))).toISOString(), freshness_hours: form.get('freshnessHours') ? Number(form.get('freshnessHours')) : null, is_published: form.get('publish') === 'on' }
    if (supabase && user) {
      const { data, error: dbError } = await supabase.from('inventory_batches').insert({ ...row, owner_id: user.id }).select().single()
      if (dbError) { setError(dbError.message); return }
      const created: InventoryBatch = { id: data.id, ownerId: user.id, produce: data.produce, quantity: Number(data.quantity), availableQuantity: Number(data.available_quantity), unit: data.unit as Unit, location: data.location, quality: data.quality, askingPrice: data.asking_price === null ? null : Number(data.asking_price), purchaseCost: data.purchase_cost === null ? null : Number(data.purchase_cost), availableAt: data.available_at, freshnessHours: data.freshness_hours, status: data.status, photoPath: null }
      if (photo) {
        try {
          const path = await uploadInventoryPhoto(created.id, photo)
          const { error: updateError } = await supabase.from('inventory_batches').update({ photo_path: path }).eq('id', created.id)
          if (updateError) { await supabase.storage.from('inventory-photos').remove([path]); throw updateError }
          created.photoPath = path
        } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : 'Photo upload failed. The inventory was saved without a photo.') }
      }
      setBatches((current) => [created, ...current])
    } else setBatches((current) => [{ id: crypto.randomUUID(), ownerId: 'sandbox', produce: String(form.get('produce')), quantity, availableQuantity: quantity, unit: form.get('unit') as Unit, location: String(form.get('location')), quality: form.get('quality') as InventoryBatch['quality'], askingPrice: form.get('askingPrice') ? Number(form.get('askingPrice')) : null, purchaseCost: form.get('purchaseCost') ? Number(form.get('purchaseCost')) : null, availableAt: new Date(String(form.get('availableAt'))).toISOString(), freshnessHours: form.get('freshnessHours') ? Number(form.get('freshnessHours')) : null, status: 'available' }, ...current])
    setModal(null)
  }

  async function addDemand(form: FormData) {
    const entry: BuyerDemand = { id: crypto.randomUUID(), buyerName: user?.email?.split('@')[0] ?? 'Demo buyer', produce: String(form.get('produce')), quantity: Number(form.get('quantity')), unit: form.get('unit') as Unit, maxPrice: form.get('maxPrice') ? Number(form.get('maxPrice')) : null, location: String(form.get('location')), requiredBy: new Date(String(form.get('requiredBy'))).toISOString(), confirmed: true }
    if (supabase && user) {
      const { data, error: dbError } = await supabase.from('buyer_demands').insert({ buyer_id: user.id, produce: entry.produce, quantity: entry.quantity, unit: entry.unit, max_price: entry.maxPrice, location: entry.location, required_by: entry.requiredBy, status: 'published', is_published: true }).select().single()
      if (dbError) { setError(dbError.message); return }
      entry.id = data.id
    }
    setDemands((current) => [entry, ...current]); setModal(null)
  }

  async function reviewOption(option: DecisionOption) {
    setActiveOption(option); setActiveBatch(option.batch); setActiveDemand(option.demand); setError('')
    setDecisionNetPreview(null)
    if (supabase && user) {
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
    const knownCosts = Object.fromEntries(Object.entries(costs).filter(([, v]) => v !== null))
    if (supabase && decisionId) {
      const { error: dbError } = await supabase.rpc('approve_decision', { p_decision_id: decisionId, p_quantity: quantity, p_unit_price: price, p_known_costs: knownCosts, p_delivery_feasible: form.get('routeConfirmed') === 'on' })
      if (dbError) { setError(dbError.message); return }
      await loadCloud(user!.id)
    } else {
      setPendingOffers((current) => [{ id: crypto.randomUUID(), sellerId: 'Demo seller', produce: activeOption.batch.produce, location: activeOption.batch.location, quantity, unit: activeOption.batch.unit, unitPrice: price, option: activeOption }, ...current])
    }
    setModal(null); setTab('Transactions')
  }

  async function recordOutcome(form: FormData) {
    const option = activeTransaction?.option ?? activeOption
    if (!option) return
    const quantity = Number(form.get('quantity'))
    const price = Number(form.get('price'))
    const actualCosts = { transport: form.get('transport') ? Number(form.get('transport')) : null, handling: form.get('handling') ? Number(form.get('handling')) : null, storage: form.get('storage') ? Number(form.get('storage')) : null, processing: form.get('processing') ? Number(form.get('processing')) : null, platform: form.get('platform') ? Number(form.get('platform')) : null }
    const knownCosts = Object.fromEntries(Object.entries(actualCosts).filter(([, value]) => value !== null))
    const costsComplete = Object.values(actualCosts).every((value) => value !== null)
    if (supabase) {
      if (!activeTransaction?.id) { setError('No pending transaction was found for this account.'); return }
      const { error: dbError } = await supabase.rpc('complete_transaction', { p_transaction_id: activeTransaction.id, p_accepted_quantity: quantity, p_known_costs: knownCosts, p_costs_complete: costsComplete })
      if (dbError) { setError(dbError.message); return }
      await loadCloud(user!.id)
    } else {
      const netProceeds = costsComplete ? (Math.round(quantity * price * 100) - Math.round(Object.values(actualCosts).reduce<number>((sum, cost) => sum + (cost ?? 0), 0) * 100)) / 100 : Number.NaN
      setOutcomes((current) => [{ id: crypto.randomUUID(), batchId: option.batch.id, demandId: option.demand.id, quantity, unit: option.batch.unit, unitPrice: price, netProceeds, recordedAt: new Date().toISOString() }, ...current])
      setBatches((current) => current.map((batch) => batch.id === option.batch.id ? { ...batch, quantity: batch.quantity - quantity, availableQuantity: batch.availableQuantity + (activeTransaction?.quantity ?? 0) - quantity, status: batch.quantity === quantity ? 'completed' : 'partially_sold' } : batch))
      setTransactions((current) => current.filter((transaction) => transaction !== activeTransaction))
    }
    setModal(null); setTab('Impact & reports')
  }

  async function signIn() { if (supabase) { const { error: authError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }); if (authError) setError(authError.message) } }

  async function acceptOffer(offer: PendingOffer) {
    if (!supabase) {
      if (!offer.option) { setError('This example offer has no matching inventory context.'); return }
      setBatches((current) => current.map((batch) => batch.id === offer.option!.batch.id ? { ...batch, availableQuantity: batch.availableQuantity - offer.quantity, status: batch.availableQuantity === offer.quantity ? 'reserved' : batch.status } : batch))
      setTransactions((current) => [{ id: null, option: offer.option!, quantity: offer.quantity }, ...current])
      setPendingOffers((current) => current.filter((item) => item.id !== offer.id))
      setError('Preview only: this sample acceptance simulates a buyer response. No real buyer or stock reservation is involved.')
      return
    }
    const { error: dbError } = await supabase.rpc('accept_offer', { p_offer_id: offer.id })
    if (dbError) { setError(dbError.message); return }
    setPendingOffers((current) => current.filter((item) => item.id !== offer.id))
    await loadCloud(user!.id)
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#overview" onClick={() => setTab('Overview')}><span className="brand-icon"><Leaf size={19} strokeWidth={2.5} /></span><span>freshflow<span className="brand-dot">.</span></span></a>
      <div className="workspace-chip"><span className="workspace-avatar">{user?.email?.[0]?.toUpperCase() ?? 'F'}</span><span><b>{user?.email?.split('@')[0] ?? 'Field operations'}</b><small>{user ? 'Personal workspace' : 'Workspace preview'}</small></span><ChevronDown size={14} /></div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="nav-list">{menu.map((item, i) => {
        const Icon = [Activity, Sprout, Sparkles, Search, Truck, TrendingUp][i]
        return <button key={item} className={`nav-item ${tab === item ? 'nav-active' : ''}`} onClick={() => { setTab(item); setMobileMenu(false) }}><Icon size={17} strokeWidth={1.8} /><span>{t(item)}</span>{item === 'Decisions' && attention.length > 0 && <i>{attention.length}</i>}</button>
      })}</nav>
      <div className="sidebar-bottom"><div className="side-help"><span className="help-icon"><CircleHelp size={16} /></span><div><b>Here to help</b><span>Talk to our support team</span></div><ArrowRight size={15} /></div><div className="user-row"><div className="profile-avatar">{user?.email?.[0]?.toUpperCase() ?? 'A'}</div><div className="profile-info"><b>{user?.email ?? 'Aarav Menon'}</b><span>{user ? 'Signed in' : 'Sample profile'}</span></div><button title={user ? 'Sign out' : 'Continue with Google'} onClick={async () => user && supabase ? void await supabase.auth.signOut() : void signIn()}>{user ? <LogOut size={16} /> : <ChevronDown size={17} />}</button></div></div>
    </aside>
    {mobileMenu && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu-btn icon-btn" aria-label="Open navigation" onClick={() => setMobileMenu(true)}><Menu size={19} /></button><div className="breadcrumbs">Workspace <span>/</span> <b>{t(tab)}</b></div></div><div className="topbar-actions"><label className="language-select"><span>EN</span><select value={language} aria-label="Language" onChange={(e) => setLanguage(e.target.value as Language)}><option value="en">English</option><option value="ml">മലയാളം</option></select><ChevronDown size={12} /></label><button className="icon-btn notification-btn" aria-label="Notifications"><Bell size={17} /><i /></button><span className="topbar-divider" /><div className="date-label">{new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())}</div></div></header>
      <div className="content-area">
        {error && <div className="error-banner"><span>{error}</span><button aria-label="Dismiss" onClick={() => setError('')}><X size={16} /></button></div>}
        {!isSupabaseConfigured && <div className="preview-banner"><span className="preview-dot" /><b>Workspace preview</b><span>Example records are labelled “Demo”. Add Supabase credentials to use live accounts and shared data.</span><button onClick={() => setModal('inventory')}>Explore the workflow <ArrowRight size={14} /></button></div>}
        {isSupabaseConfigured && !user && !loading ? <section className="auth-panel"><span className="eyebrow">FRESHFLOW WORKSPACE</span><h1>Good food, moving forward.</h1><p>Sign in to manage your inventory, find confirmed demand, and make a clear next move.</p><button className="primary-btn" onClick={() => void signIn()}>Continue with Google <ArrowRight size={16} /></button><small>Google sign-in is configured in Supabase Auth.</small></section> : <>
          {tab === 'Overview' && <>
            <section className="welcome-row"><div><div className="eyebrow">SATURDAY, OCTOBER 24, 2026 <span className="eyebrow-dot">·</span> ALUVA, KERALA</div><h1>{t('Good morning,')} Aarav <span className="wave">✳</span></h1><p>{t('Your supply, in good hands.')}</p></div><div className="welcome-actions"><button className="secondary-btn" onClick={() => setModal('demand')}><Search size={16} />{t('Create buyer requirement')}</button><button className="primary-btn" onClick={() => setModal('inventory')}><Plus size={17} />{t('Add inventory')}</button></div></section>
            <section className="metric-grid"><Metric icon={<Sprout size={17}/>} label="Inventory at a glance" value={`${batches.length}`} detail={`${batches.reduce((sum, b) => sum + b.availableQuantity, 0).toLocaleString('en-IN')} ${batches[0]?.unit ?? 'kg'} available`} tone="green" /><Metric icon={<Search size={17}/>} label="Matching demand" value={`${matches.length}`} detail="Confirmed buyer requirements" tone="blue" /><Metric icon={<TrendingUp size={17}/>} label="Potential net recovery" value="—" detail="Add costs to compare options" tone="amber" /><Metric icon={<BadgeCheck size={17}/>} label="Verified outcomes" value={`${outcomes.length}`} detail="Recorded completed handovers" tone="purple" /></section>
            <section className="dashboard-grid"><div className="panel inventory-panel"><div className="panel-heading"><div><h2>Inventory at a glance</h2><p>Freshness window is a guide, not a safety assessment.</p></div><button className="text-link" onClick={() => setTab('Inventory')}>View inventory <ArrowRight size={14}/></button></div><div className="inventory-list">{batches.slice(0, 4).map((batch) => <InventoryRow key={batch.id} batch={batch} onClick={() => { setActiveBatch(batch); setTab('Inventory') }} />)}{batches.length === 0 && <Empty text="No inventory yet. Add a batch to get started." />}</div><button className="add-row" onClick={() => setModal('inventory')}><Plus size={15}/> Add an inventory batch</button></div>
              <div className="right-stack"><div className="panel attention-panel"><div className="panel-heading"><div className="heading-with-icon"><span className="attention-icon"><Clock3 size={16}/></span><div><h2>Needs your attention</h2><p>Review freshness and available action</p></div></div><span className="count-pill">{pending.length}</span></div>{pending.length ? pending.slice(0, 2).map((batch) => <button key={batch.id} className="attention-item" onClick={() => { setActiveBatch(batch); setTab('Decisions') }}><span className="attention-item-name">{batch.produce}<small>{batch.availableQuantity} {batch.unit} · {batch.location}</small></span><RiskPill risk={riskLevel(batch)}/><ArrowRight size={15}/></button>) : <Empty text="No inventory currently needs a decision." />}</div>
              <div className="panel demand-panel"><div className="panel-heading"><div><h2>Matching demand</h2><p>Published buyer requirements</p></div><button className="mini-link" onClick={() => setTab('Demand & buyers')}>See all</button></div>{matches.length ? matches.slice(0, 2).map(({ batch, demand, qty }) => <button key={`${batch.id}-${demand.id}`} className="demand-match" onClick={() => void reviewOption(evaluateOption(batch, demand, emptyCosts))}><span className="buyer-avatar">{demand.produce[0]}</span><span className="match-copy"><b>{demand.produce} <span className="confirmed-dot" title="Published requirement" /></b><small>{qty} {demand.unit} · {demand.location}</small></span><ArrowDownRight size={15}/></button>) : <Empty text="Add inventory and buyer requirements to find matches." />}</div></div></section>
            <section className="bottom-grid"><div className="panel decision-panel"><div className="panel-heading"><div className="heading-with-icon"><span className="decision-icon"><Sparkles size={16}/></span><div><h2>Decision queue</h2><p>Compare the next best actions for your stock</p></div></div><button className="text-link" onClick={() => setTab('Decisions')}>Open decisions <ArrowRight size={14}/></button></div>{options.slice(0, 2).map((option) => <DecisionRow key={`${option.batch.id}-${option.demand.id}`} option={option} onClick={() => void reviewOption(option)} />)}{!options.length && <Empty text="No matching supply and demand yet."/>}</div><div className="impact-card"><div className="impact-top"><span className="impact-icon"><Leaf size={18}/></span><span className="impact-caption">YOUR IMPACT</span><span className="impact-spark"><TrendingUp size={16}/></span></div><h2>Better moves,</h2><h2 className="impact-light">measured honestly.</h2><p>Food is counted as recovered only after a completed, recorded handover.</p><button onClick={() => setTab('Impact & reports')}>View verified outcomes <ArrowRight size={14}/></button><div className="impact-decoration"><span>✳</span></div></div></section>
          </>}
          {tab !== 'Overview' && <WorkspaceTab tab={tab} batches={batches} demands={demands} outcomes={outcomes} options={options} transactions={transactions} pendingOffers={pendingOffers} onAcceptOffer={(offer) => void acceptOffer(offer)} onInventory={() => setModal('inventory')} onDemand={() => setModal('demand')} onReview={(option) => void reviewOption(option)} onRecord={(transaction) => { setActiveTransaction(transaction); setActiveOption(transaction.option); setModal('outcome') }} />}
          {loading && <div className="loading-cover"><span className="spinner"/> Loading your workspace…</div>}
        </>}
        <footer className="footer"><span>FreshFlow <b>·</b> Food, in the right place.</span><span><ShieldCheck size={13}/> Your data stays yours</span></footer>
      </div>
    </main>
    {modal && <ModalShell title={modal === 'inventory' ? 'Add inventory' : modal === 'demand' ? 'New buyer requirement' : modal === 'decision' ? 'Review this decision' : 'Record completed handover'} onClose={() => { setModal(null); setError('') }}>
      {modal === 'inventory' && <form action={(form) => void addInventory(form)}><p className="modal-intro">Start with the essentials. You can add more details later.</p><div className="form-grid"><Field label="Produce" required><input name="produce" placeholder="e.g. Tomatoes" required /></Field><Field label="Available quantity" required><div className="input-with-unit"><input name="quantity" type="number" min="0.01" step="0.01" placeholder="0" required/><select name="unit"><option>kg</option><option>crate</option><option>box</option></select></div></Field><Field label="Location" required><input name="location" placeholder="Town or collection point" required /></Field><Field label="Quality"><select name="quality"><option>Good</option><option>Premium</option><option>Needs sorting</option></select></Field><details className="advanced-fields"><summary>More details <ChevronDown size={13}/></summary><div className="form-grid"><Field label="Asking price (₹/unit)"><input name="askingPrice" type="number" min="0" step="0.01" placeholder="Optional"/></Field><Field label="Purchase cost (₹/unit)"><input name="purchaseCost" type="number" min="0" step="0.01" placeholder="Optional"/></Field><Field label="Available from"><input name="availableAt" type="datetime-local" defaultValue={INITIAL_AVAILABLE_AT} /></Field><Field label="Freshness window (hours)"><input name="freshnessHours" type="number" min="1" placeholder="Unknown if blank"/></Field><Field label="Inventory photo (optional)"><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={!isSupabaseConfigured}/></Field></div></details></div><label className="publish-toggle"><input type="checkbox" name="publish"/> <span><b>Publish this batch for buyers to discover</b><small>Private until you choose this. You can stop publishing later.</small></span></label><p className="form-note"><ShieldCheck size={14}/> Your batch stays private unless you publish it. Photos are stored privately in Supabase Storage.</p><ModalActions onCancel={() => setModal(null)} submit="Save inventory"/></form>}
      {modal === 'demand' && <form action={(form) => void addDemand(form)}><p className="modal-intro">Record a real buyer requirement. Only requirements you publish can be matched.</p><div className="form-grid"><Field label="Produce" required><input name="produce" placeholder="e.g. Tomatoes" required /></Field><Field label="Required quantity" required><div className="input-with-unit"><input name="quantity" type="number" min="0.01" step="0.01" placeholder="0" required/><select name="unit"><option>kg</option><option>crate</option><option>box</option></select></div></Field><Field label="Delivery location" required><input name="location" placeholder="Town or receiving point" required /></Field><Field label="Price limit (₹/unit)"><input name="maxPrice" type="number" min="0" step="0.01" placeholder="Optional"/></Field><Field label="Required by" required><input name="requiredBy" type="date" required defaultValue={INITIAL_REQUIRED_BY}/></Field></div><p className="form-note"><ShieldCheck size={14}/> A published requirement is visible to signed-in users with compatible inventory.</p><ModalActions onCancel={() => setModal(null)} submit="Publish requirement"/></form>}
      {modal === 'decision' && activeOption && <form action={(form) => void approveOption(form)} onInput={(event) => { const values = new FormData(event.currentTarget); const names = ['transport', 'handling', 'storage', 'processing', 'platform']; const qty = Number(values.get('quantity')); const price = Number(values.get('price')); const costs = names.map((name) => values.get(name)); setDecisionNetPreview(costs.every((value) => value !== null && value !== '') && qty > 0 && price > 0 ? (Math.round(qty * price * 100) - Math.round(costs.reduce<number>((sum, value) => sum + Number(value), 0) * 100)) / 100 : null) }}><p className="modal-intro">Compare a real demand match. Approval submits an offer; stock is reserved only after the buyer accepts it.</p><div className="decision-summary"><div><span className="summary-label">MATCHED REQUIREMENT</span><b>{activeDemand?.buyerName} · {activeDemand?.location}</b><small>{activeDemand?.quantity} {activeDemand?.unit} requested by {activeDemand ? timeLabel(activeDemand.requiredBy) : ''}</small></div><span className="confirmed-badge"><BadgeCheck size={14}/> Published demand</span></div><div className="form-grid"><Field label="Quantity to offer" required><input name="quantity" type="number" min="0.01" max={Math.min(activeOption.batch.availableQuantity, activeOption.demand.quantity)} step="0.01" defaultValue={Math.min(activeOption.batch.availableQuantity, activeOption.demand.quantity)} required/></Field><Field label="Agreed price (₹/unit)" required><input name="price" type="number" min="0.01" step="0.01" defaultValue={activeOption.unitPrice ?? activeBatch?.askingPrice ?? ''} required/></Field><Field label="Transport (₹)" required><input name="transport" type="number" min="0" step="0.01" placeholder="Confirmed quote, or 0" required/></Field><Field label="Handling (₹)" required><input name="handling" type="number" min="0" step="0.01" placeholder="Known cost, or 0" required/></Field><Field label="Storage (₹)" required><input name="storage" type="number" min="0" step="0.01" placeholder="Known cost, or 0" required/></Field><Field label="Processing (₹)" required><input name="processing" type="number" min="0" step="0.01" placeholder="Known cost, or 0" required/></Field><Field label="Platform fee (₹)" required><input name="platform" type="number" min="0" step="0.01" placeholder="Known fee, or 0" required/></Field></div><div className="net-preview"><span>Indicative net proceeds</span><b>{decisionNetPreview === null ? 'Complete all cost fields' : fmt(decisionNetPreview)}</b><small>Calculated as quantity × proposed price − entered costs. Confirmed only after offer acceptance and completed handover.</small></div><label className="publish-toggle route-check"><input type="checkbox" name="routeConfirmed" required/><span><b>I've confirmed this route and delivery can meet the buyer's deadline</b><small>A transport amount alone does not confirm route or delivery availability.</small></span></label><div className="comparison-note"><CircleHelp size={15}/><span>Enter each known cost. Use ₹0 only if you have confirmed no cost applies. Unknown costs remain incomplete and do not become zero.</span></div>{(activeOption.missing.length > 0 || activeOption.requiredChecks.length > 0) && <div className="missing-note">This option still needs: {[...activeOption.missing, ...activeOption.requiredChecks].join(', ')}.</div>}<ModalActions onCancel={() => setModal(null)} submit="Submit approved offer"/></form>}
      {modal === 'outcome' && <form action={(form) => void recordOutcome(form)}><p className="modal-intro">Record only what was actually accepted and handed over. Net proceeds are shown only when each cost is recorded.</p><div className="form-grid"><Field label="Accepted quantity" required><input name="quantity" type="number" min="0.01" max={activeTransaction?.quantity} step="0.01" defaultValue={activeTransaction?.quantity ?? ''} required/></Field><Field label="Agreed price (₹/unit)" required><input name="price" type="number" min="0.01" step="0.01" defaultValue={activeOption?.unitPrice ?? ''} required/></Field><Field label="Transport (₹)" required><input name="transport" type="number" min="0" step="0.01" placeholder="Actual cost, or 0" required/></Field><Field label="Handling (₹)" required><input name="handling" type="number" min="0" step="0.01" placeholder="Actual cost, or 0" required/></Field><Field label="Storage (₹)" required><input name="storage" type="number" min="0" step="0.01" placeholder="Actual cost, or 0" required/></Field><Field label="Processing (₹)" required><input name="processing" type="number" min="0" step="0.01" placeholder="Actual cost, or 0" required/></Field><Field label="Platform fee (₹)" required><input name="platform" type="number" min="0" step="0.01" placeholder="Actual fee, or 0" required/></Field></div><p className="form-note"><BadgeCheck size={14}/> Only completed, recorded handovers count as verified outcomes.</p><ModalActions onCancel={() => setModal(null)} submit="Record completed handover"/></form>}
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
function InventoryRow({ batch, onClick }: { batch: InventoryBatch; onClick: () => void }) { return <button className="inventory-row" onClick={onClick}><InventoryPhotoThumb batch={batch}/><span className="inventory-name"><b>{batch.produce} {batch.id.startsWith('sample-') && <span className="sample-badge">DEMO</span>}</b><small><MapPin size={12}/> {batch.location}</small></span><span className="inventory-qty"><b>{batch.availableQuantity} <small>{batch.unit}</small></b><span>{batch.quality}</span></span><span className="inventory-price">{batch.askingPrice === null ? <em>Price unknown</em> : <><b>{fmt(batch.askingPrice)}</b><small>/ {batch.unit}</small></>}<span>asking price</span></span><RiskPill risk={riskLevel(batch)}/><ArrowRight className="row-arrow" size={15}/></button> }
function RiskPill({ risk }: { risk: string }) { const text: Record<string, string> = { urgent: 'Urgent review', at_risk: 'At risk', monitor: 'Monitor', unknown: 'Insufficient data', normal: 'On track' }; return <span className={`risk-pill risk-${risk}`}><i/>{text[risk] ?? risk}</span> }
function DecisionRow({ option, onClick }: { option: DecisionOption; onClick: () => void }) { return <button className="decision-row" onClick={onClick}><span className="decision-product">{option.batch.produce[0]}</span><span className="decision-main"><b>{option.batch.produce} <span className="arrow-inline">→</span> {option.demand.buyerName}</b><small>{option.quantity} {option.batch.unit} · {option.demand.location} · {option.reason}</small></span><span className="decision-value"><b>{option.netProceeds === null ? 'Add costs' : fmt(option.netProceeds)}</b><small>{option.feasible ? 'net proceeds' : 'incomplete'}</small></span><ArrowRight size={15}/></button> }
function Empty({ text }: { text: string }) { return <div className="empty-state"><span className="empty-sprout"><Sprout size={16}/></span>{text}</div> }
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="field"><span>{label}{required && <i> *</i>}</span>{children}</label> }
function ModalActions({ onCancel, submit }: { onCancel: () => void; submit: string }) { return <div className="modal-actions"><button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button><button type="submit" className="primary-btn">{submit}<ArrowRight size={15}/></button></div> }
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-header"><div><span className="eyebrow">FRESHFLOW WORKSPACE</span><h2 id="modal-title">{title}</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button></header>{children}</section></div> }
function WorkspaceTab({ tab, batches, demands, outcomes, options, transactions, pendingOffers, onAcceptOffer, onInventory, onDemand, onReview, onRecord }: { tab: Tab; batches: InventoryBatch[]; demands: BuyerDemand[]; outcomes: RecordedOutcome[]; options: DecisionOption[]; transactions: PendingTransaction[]; pendingOffers: PendingOffer[]; onAcceptOffer: (offer: PendingOffer) => void; onInventory: () => void; onDemand: () => void; onReview: (option: DecisionOption) => void; onRecord: (transaction: PendingTransaction) => void }) {
  const headings: Record<Tab, [string, string]> = { Overview: ['', ''], Inventory: ['Your inventory', 'A clear view of each batch, its available quantity and freshness information.'], Decisions: ['Decision queue', 'Match available stock to published demand, then review costs before you act.'], 'Demand & buyers': ['Demand & buyers', 'Requirements are real only when they are published by a signed-in user.'], Transactions: ['Transactions', 'A seller submits an offer. The buyer accepts it before stock is reserved.'], 'Impact & reports': ['Impact & reports', 'Verified outcomes include only handovers recorded as complete.'] }
  const [title, subtitle] = headings[tab]
  return <><section className="page-heading"><div><div className="eyebrow">WORKSPACE / {tab.toUpperCase()}</div><h1>{title}</h1><p>{subtitle}</p></div><div className="welcome-actions">{tab !== 'Impact & reports' && <>{tab !== 'Demand & buyers' && <button className="secondary-btn" onClick={onDemand}><Search size={15}/> New requirement</button>}{tab !== 'Demand & buyers' && <button className="primary-btn" onClick={onInventory}><Plus size={16}/> Add inventory</button>}{tab === 'Demand & buyers' && <button className="primary-btn" onClick={onDemand}><Plus size={16}/> Create requirement</button>}</>}</div></section>
    {tab === 'Inventory' && <div className="panel page-panel"><div className="panel-heading"><div><h2>Inventory batches</h2><p>Unknown freshness information is shown as insufficient data.</p></div><span className="count-pill">{batches.length} batches</span></div><div className="inventory-list">{batches.map((batch) => <InventoryRow key={batch.id} batch={batch} onClick={() => {}} />)}</div>{!batches.length && <Empty text="Add your first inventory batch."/>}</div>}
    {tab === 'Demand & buyers' && <div className="panel page-panel"><div className="panel-heading"><div><h2>Published requirements</h2><p>Location, quantity and delivery date help assess a match.</p></div><span className="count-pill">{demands.length} active</span></div>{demands.map((demand) => <div className="demand-card" key={demand.id}><span className="buyer-avatar">{demand.produce[0]}</span><div className="demand-card-main"><b>{demand.produce}<span className="confirmed-dot"/></b><small>{demand.buyerName} · {demand.location}</small></div><div className="demand-card-data"><b>{demand.quantity} {demand.unit}</b><small>required by {timeLabel(demand.requiredBy)}</small></div><div className="demand-card-data"><b>{demand.maxPrice === null ? 'Price not supplied' : `${fmt(demand.maxPrice)} / ${demand.unit}`}</b><small>buyer price limit</small></div><span className="status-pill">Published</span></div>)}{!demands.length && <Empty text="No published buyer requirements yet."/>}</div>}
    {tab === 'Decisions' && <div className="panel page-panel"><div className="panel-heading"><div><h2>Available options</h2><p>Transport and handling costs are required before a sale can be approved.</p></div></div>{options.map((option) => <DecisionRow key={`${option.batch.id}-${option.demand.id}`} option={option} onClick={() => onReview(option)}/>)}{!options.length && <Empty text="No exact product and unit matches yet."/>}<div className="info-strip"><CircleHelp size={15}/> Freshness windows prioritize attention. They do not predict food safety or guaranteed shelf life.</div></div>}
    {tab === 'Transactions' && <><div className="panel page-panel"><div className="panel-heading"><div><h2>Offers awaiting your response</h2><p>Accepting an offer reserves available stock and creates the transaction.</p></div></div>{pendingOffers.map((offer) => <div className="offer-row" key={offer.id}><span className="buyer-avatar">{offer.produce[0]}</span><div className="demand-card-main"><b>{offer.produce} {offer.option && <span className="status-pill">DEMO</span>}</b><small>From seller {offer.sellerId.slice(0, 6)} · {offer.location}</small></div><div className="demand-card-data"><b>{offer.quantity} {offer.unit}</b><small>{fmt(offer.unitPrice)} / {offer.unit}</small></div><button className="primary-btn compact-btn" onClick={() => onAcceptOffer(offer)}>Accept offer <Check size={14}/></button></div>)}{!pendingOffers.length && <Empty text="No buyer offers are waiting for your response."/>}{pendingOffers.some((offer) => offer.option) && <div className="info-strip">Preview only: the buyer decision is simulated. No real offer or stock reservation exists.</div>}</div><div className="panel page-panel"><div className="panel-heading"><div><h2>Awaiting handover</h2><p>Record accepted quantities when a real handover is complete.</p></div></div>{transactions.map((transaction) => <div className="offer-row" key={transaction.id ?? transaction.option.batch.id}><span className="buyer-avatar">{transaction.option.batch.produce[0]}</span><div className="demand-card-main"><b>{transaction.option.batch.produce} → {transaction.option.demand.buyerName}</b><small>{transaction.option.demand.location} · Accepted offer</small></div><div className="demand-card-data"><b>{transaction.quantity} {transaction.option.batch.unit}</b><small>{transaction.option.unitPrice ? `${fmt(transaction.option.unitPrice)} / ${transaction.option.batch.unit}` : 'Price recorded'}</small></div><button className="secondary-btn compact-btn" onClick={() => onRecord(transaction)}>Record handover <ArrowRight size={14}/></button></div>)}{!transactions.length && <Empty text="No accepted offers are awaiting handover."/>}<div className="info-strip"><ShieldCheck size={15}/> A buyer requirement is not a purchase commitment. Only accepted offers reserve stock.</div></div></>}
    {tab === 'Impact & reports' && <><div className="metric-grid"><Metric icon={<BadgeCheck size={17}/>} label="Verified outcomes" value={`${outcomes.length}`} detail="Completed handovers" tone="green"/><Metric icon={<Sprout size={17}/>} label="Quantity recorded" value={`${outcomes.reduce((s, o) => s + o.quantity, 0).toLocaleString('en-IN')}`} detail={outcomes[0]?.unit ?? 'kg'} tone="blue"/><Metric icon={<TrendingUp size={17}/>} label="Net proceeds recorded" value={outcomes.length && outcomes.every((o) => Number.isFinite(o.netProceeds)) ? fmt(outcomes.reduce((s, o) => s + o.netProceeds, 0)) : '—'} detail="Only when costs are complete" tone="amber"/><Metric icon={<ArrowDownRight size={17}/>} label="Avoided loss" value="Not measured" detail="Requires a documented baseline" tone="purple"/></div><div className="panel page-panel"><div className="panel-heading"><div><h2>Recorded outcomes</h2><p>FreshFlow does not claim impact from an uncompleted transaction.</p></div></div>{outcomes.map((outcome) => <div className="demand-card" key={outcome.id}><span className="confirmed-badge"><BadgeCheck size={14}/> Verified</span><div className="demand-card-main"><b>Completed handover</b><small>{timeLabel(outcome.recordedAt)}</small></div><div className="demand-card-data"><b>{outcome.quantity} {outcome.unit}</b><small>accepted quantity</small></div><div className="demand-card-data"><b>{fmt(outcome.unitPrice * outcome.quantity)}</b><small>gross value</small></div><div className="demand-card-data"><b>{Number.isFinite(outcome.netProceeds) ? fmt(outcome.netProceeds) : 'Incomplete'}</b><small>net proceeds</small></div></div>)}{!outcomes.length && <Empty text="Completed handovers will appear here. No food recovery is counted in advance."/>}</div></>}
  </>
}
