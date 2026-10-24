import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ArrowLeft, BadgeCheck, Check, Clock3, MapPin, RefreshCw, ShieldCheck, X } from 'lucide-react'

type ReviewStatus = 'pending_review' | 'approved' | 'rejected'
type Submission = { batch_id: string; owner_id: string; produce: string; quantity: number; unit: string; location: string; quality: string; available_at: string; harvested_or_purchased_at: string | null; freshness_hours: number | null; photo_path: string | null; moderation_status: ReviewStatus; submitted_at: string; seller_phone?: string | null }

export function AdminReviewLive({ client, onBack }: { client: SupabaseClient; onBack: () => void }) {
  const [pending, setPending] = useState<Submission[]>([])
  const [reviewed, setReviewed] = useState<Submission[]>([])
  const [filter, setFilter] = useState<ReviewStatus>('pending_review')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [photo, setPhoto] = useState<{ path: string; url: string } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selected = [...pending, ...reviewed].find((item) => item.batch_id === selectedId) ?? null

  const visible = filter === 'pending_review' ? pending : reviewed.filter((item) => item.moderation_status === filter)

  const load = useCallback(async () => {
    setBusy(true); setError('')
    const { data, error: rpcError } = await client.rpc('admin_list_inventory_submissions')
    if (rpcError) { setError(`Admin queue unavailable: ${rpcError.message}`); setBusy(false); return }
    const rows = (data ?? []) as Submission[]
    const waiting = rows.filter((row) => row.moderation_status === 'pending_review')
    const completed = rows.filter((row) => row.moderation_status !== 'pending_review')
    setPending(waiting); setReviewed(completed)
    setSelectedId((current) => rows.some((row) => row.batch_id === current) ? current : rows[0]?.batch_id ?? null)
    setBusy(false)
  }, [client])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => {
    if (!selected?.photo_path) return
    let current = true
    void client.storage.from('inventory-photos').createSignedUrl(selected.photo_path, 60)
      .then(({ data, error: signedError }) => {
        if (!current) return
        if (signedError) setError(`Photo access is unavailable: ${signedError.message}`)
        else setPhoto({ path: selected.photo_path!, url: data.signedUrl })
      })
    return () => { current = false }
  }, [client, selected?.batch_id, selected?.photo_path])

  async function review(decision: 'approved' | 'rejected') {
    if (!selected || selected.moderation_status !== 'pending_review' || busy) return
    if (decision === 'rejected' && (!note.trim() || note.trim().length < 5)) {
      setError('A clear rejection reason (at least 5 characters) is required when rejecting a submission.')
      return
    }
    if (!window.confirm(`${decision === 'approved' ? 'Approve' : 'Reject'} ${selected.produce} (${selected.quantity} ${selected.unit})? This will ${decision === 'approved' ? 'publish' : 'decline'} the live submission.`)) return
    setBusy(true); setError(''); setNotice('')
    const { error: rpcError } = await client.rpc('review_inventory_submission', { p_batch_id: selected.batch_id, p_decision: decision, p_note: note.trim() || null })
    if (rpcError) { setError(`Review action failed: ${rpcError.message}`); setBusy(false); return }
    const updated = { ...selected, moderation_status: decision }
    setPending((rows) => rows.filter((row) => row.batch_id !== selected.batch_id))
    setReviewed((rows) => [updated, ...rows.filter((row) => row.batch_id !== selected.batch_id)])
    setFilter(decision)
    setNotice(`Submission ${decision}. The database recorded the action.`)
    setNote(''); setBusy(false)
  }

  return <main className="admin-demo-shell">
    <header className="admin-demo-header"><button className="admin-back" onClick={onBack}><ArrowLeft size={16}/> Back to workspace</button><a className="showcase-brand" href="#admin-live"><span><ShieldCheck size={18}/></span>FreshFlow admin</a><button className="admin-reset" onClick={() => void load()} disabled={busy}><RefreshCw size={14}/> Refresh queue</button></header>
    <div className="admin-demo-content" id="admin-live">
      <div className="admin-demo-heading"><div><span className="showcase-kicker"><i/> LIVE ADMIN WORKSPACE</span><h1>Review supplier submissions</h1><p>Protected by the server-verified Supabase app_metadata role claim. Every decision is recorded.</p></div><span className="admin-demo-lock"><ShieldCheck size={15}/> Authenticated admin</span></div>
      {error && <div className="admin-demo-message admin-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={14}/></button></div>}
      {notice && <div className="admin-demo-message" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={14}/></button></div>}
      <div className="admin-filter-row"><div className="admin-filters">{(['pending_review','approved','rejected'] as const).map((status) => <button key={status} className={filter === status ? 'selected' : ''} type="button" onClick={() => { setFilter(status); const row = status === 'pending_review' ? pending[0] : reviewed.find((item) => item.moderation_status === status); setSelectedId(row?.batch_id ?? null) }}>{status === 'pending_review' ? 'Pending' : status[0].toUpperCase() + status.slice(1)}<span>{status === 'pending_review' ? pending.length : reviewed.filter((row) => row.moderation_status === status).length}</span></button>)}</div><span className="admin-sample-tag live-admin-tag">LIVE DATA</span></div>
      <div className="admin-review-grid"><section className="admin-submission-list" aria-label={`${filter.replace('_review','')} supplier submissions`}>
        {visible.map((submission) => <button key={submission.batch_id} className={`admin-submission-card ${selected?.batch_id === submission.batch_id ? 'active' : ''}`} onClick={() => setSelectedId(submission.batch_id)}><span className="admin-produce-icon">{submission.produce[0]}</span><span className="admin-submission-copy"><b>{submission.produce}</b><small>{submission.quantity} {submission.unit} · {submission.location}</small></span><span className={`admin-state state-${submission.moderation_status === 'pending_review' ? 'pending' : submission.moderation_status}`}>{submission.moderation_status.replace('_review','')}</span></button>)}
        {busy && <div className="admin-empty"><span className="spinner"/><span>Loading protected queue…</span></div>}{!busy && !visible.length && <div className="admin-empty"><BadgeCheck size={20}/><b>No {filter.replace('_review','')} submissions</b><span>Submissions will appear here as their status changes.</span></div>}
      </section>
        <section className="admin-review-detail" aria-label="Submission review details">{selected ? <><div className="admin-detail-top"><div><span className="showcase-kicker">SUBMISSION DETAILS</span><h2>{selected.produce}</h2></div><span className={`admin-state state-${selected.moderation_status === 'pending_review' ? 'pending' : selected.moderation_status}`}>{selected.moderation_status.replace('_', ' ')}</span></div><div className="admin-detail-photo">{photo?.path === selected.photo_path && photo?.url ? <img className="admin-live-photo" src={photo.url} alt={`${selected.produce} submission evidence`}/> : <div className="admin-photo-placeholder"><span>{selected.produce[0]}</span><b>{selected.photo_path ? 'Photo preview unavailable' : 'Photo not supplied'}</b><small>Images are evidence only; they do not establish food safety.</small></div>}</div><div className="admin-facts"><div><span>Quantity</span><b>{selected.quantity} {selected.unit}</b></div><div><span>Location</span><b><MapPin size={13}/>{selected.location}</b></div><div><span>Harvest / purchase</span><b>{selected.harvested_or_purchased_at ? new Date(selected.harvested_or_purchased_at).toLocaleString() : 'Not provided'}</b></div><div><span>Freshness window</span><b><Clock3 size={13}/>{selected.freshness_hours === null ? 'Unknown' : `${selected.freshness_hours} hours · seller reported`}</b></div><div><span>Condition</span><b>{selected.quality} · seller reported</b></div><div><span>Submitted</span><b>{new Date(selected.submitted_at).toLocaleString()}</b></div><div><span>Seller ID</span><b>{selected.owner_id.slice(0, 8)}…</b></div><div><span>Seller contact</span><b>{selected.seller_phone || 'Private / on file'}</b></div><div><span>Review state</span><b>{selected.moderation_status.replace('_', ' ')}</b></div></div>{selected.moderation_status === 'pending_review' ? <><label className="admin-note-field">Review / Rejection note<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Required if rejecting (min 5 characters)"/></label><div className="admin-review-actions"><button className="admin-reject" disabled={busy} onClick={() => void review('rejected')}><X size={15}/> Reject</button><button className="admin-approve" disabled={busy} onClick={() => void review('approved')}><Check size={15}/> Approve and publish</button></div></> : <div className="admin-reviewed-note"><BadgeCheck size={16}/> {selected.moderation_status} · this status is shown for this session.</div>}</> : <div className="admin-empty"><ShieldCheck size={20}/><b>Select a submission</b><span>Live inventory data will be loaded from the protected RPC.</span></div>}</section></div>
      <p className="admin-demo-footnote">The client only presents the workflow. The database RPC checks the signed admin claim and applies each status change atomically.</p>
    </div>
  </main>
}
