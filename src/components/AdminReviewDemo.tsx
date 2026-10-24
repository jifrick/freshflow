import { useState } from 'react'
import { ArrowLeft, BadgeCheck, Check, Clock3, MapPin, RotateCcw, ShieldCheck, X } from 'lucide-react'

type ReviewStatus = 'pending' | 'approved' | 'rejected'
type Submission = { id: string; produce: string; quantity: number; unit: string; location: string; freshness: string; condition: string; seller: string; photo: null; status: ReviewStatus }

const initialSubmissions: Submission[] = [
  { id: 'demo-sub-1', produce: 'Tomatoes', quantity: 180, unit: 'kg', location: 'Aluva, Kerala', freshness: 'Harvest reported 60 hours ago · 72 hour window', condition: 'Good · seller reported', seller: 'Illustrative supplier A', photo: null, status: 'pending' },
  { id: 'demo-sub-2', produce: 'Nendran banana', quantity: 240, unit: 'kg', location: 'Aluva, Kerala', freshness: 'Harvest reported 24 hours ago · 168 hour window', condition: 'Premium · seller reported', seller: 'Illustrative supplier B', photo: null, status: 'pending' },
  { id: 'demo-sub-3', produce: 'Green chilies', quantity: 65, unit: 'kg', location: 'Kochi, Kerala', freshness: 'Harvest date not provided · insufficient data', condition: 'Good · seller reported', seller: 'Illustrative supplier C', photo: null, status: 'pending' },
]

export function AdminReviewDemo({ onBack }: { onBack: () => void }) {
  const [submissions, setSubmissions] = useState(initialSubmissions)
  const [selected, setSelected] = useState<Submission | null>(initialSubmissions[0])
  const [filter, setFilter] = useState<ReviewStatus | 'all'>('all')
  const [message, setMessage] = useState('')
  const visible = submissions.filter((submission) => filter === 'all' || submission.status === filter)

  function review(id: string, status: Exclude<ReviewStatus, 'pending'>) {
    const submission = submissions.find((item) => item.id === id)
    if (!submission) { setMessage('That submission is no longer available. Reset the walkthrough and retry.'); return }
    const action = status === 'approved' ? 'approve' : 'reject'
    if (!window.confirm(`Apply a simulated ${action} to ${submission.produce} (${submission.quantity} ${submission.unit})? This changes illustrative data only.`)) return
    setSubmissions((current) => current.map((item) => item.id === id ? { ...item, status } : item))
    setSelected((current) => current?.id === id ? { ...current, status } : current)
    setMessage(`Illustrative submission ${status}. No live inventory was published or changed.`)
  }

  function reset() { setSubmissions(initialSubmissions); setSelected(initialSubmissions[0]); setFilter('all'); setMessage('Review walkthrough reset.') }

  return <main className="admin-demo-shell">
    <header className="admin-demo-header"><button className="admin-back" onClick={onBack}><ArrowLeft size={16}/> Back to showcase</button><a className="showcase-brand" href="#admin-demo"><span><ShieldCheck size={18}/></span>FreshFlow review</a><button className="admin-reset" onClick={reset}><RotateCcw size={14}/> Reset walkthrough</button></header>
    <div className="admin-demo-content" id="admin-demo">
      <div className="admin-demo-heading"><div><span className="showcase-kicker"><i/> SUPPLIER REVIEW WALKTHROUGH</span><h1>Review supplier submissions</h1><p>Illustrative submissions only. This public walkthrough is not connected to admin accounts, Supabase, or live inventory.</p></div><span className="admin-demo-lock"><ShieldCheck size={15}/> No live permissions</span></div>
      <div className="admin-demo-warning"><ShieldCheck size={17}/><span><b>Illustrative review only</b> Approve and reject update this local sample queue. Live review requires a server-verified admin role and protected database operations.</span></div>
      <div className="admin-filter-row"><div className="admin-filters">{(['all','pending','approved','rejected'] as const).map((value) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'All submissions' : value[0].toUpperCase() + value.slice(1)}<span>{value === 'all' ? submissions.length : submissions.filter((item) => item.status === value).length}</span></button>)}</div><span className="admin-sample-tag">ILLUSTRATIVE RECORDS</span></div>
      {message && <div className="admin-demo-message" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss message"><X size={14}/></button></div>}
      <div className="admin-review-grid"><section className="admin-submission-list" aria-label="Supplier submissions">{visible.map((submission) => <button key={submission.id} className={`admin-submission-card ${selected?.id === submission.id ? 'active' : ''}`} onClick={() => setSelected(submission)}><span className="admin-produce-icon">{submission.produce[0]}</span><span className="admin-submission-copy"><b>{submission.produce}</b><small>{submission.quantity} {submission.unit} · {submission.location}</small></span><span className={`admin-state state-${submission.status}`}>{submission.status}</span></button>)}{!visible.length && <div className="admin-empty"><BadgeCheck size={20}/><b>No {filter} submissions</b><span>Choose another filter or reset the review walkthrough.</span></div>}</section>
        <section className="admin-review-detail" aria-label="Selected submission details">{selected ? <><div className="admin-detail-top"><div><span className="showcase-kicker">SUBMISSION DETAILS</span><h2>{selected.produce}</h2></div><span className={`admin-state state-${selected.status}`}>{selected.status}</span></div><div className="admin-detail-photo"><div className="admin-photo-placeholder"><span>{selected.produce[0]}</span><b>Photo not supplied</b><small>Visual evidence is optional and cannot establish food safety.</small></div></div><div className="admin-facts"><div><span>Quantity</span><b>{selected.quantity} {selected.unit}</b></div><div><span>Location</span><b><MapPin size={13}/>{selected.location}</b></div><div><span>Freshness information</span><b><Clock3 size={13}/>{selected.freshness}</b></div><div><span>Condition</span><b>{selected.condition}</b></div><div><span>Submitted by</span><b>{selected.seller}</b></div><div><span>Review status</span><b>{selected.status[0].toUpperCase() + selected.status.slice(1)}</b></div></div>{selected.status === 'pending' ? <div className="admin-review-actions"><button className="admin-reject" onClick={() => review(selected.id, 'rejected')}><X size={15}/> Reject submission</button><button className="admin-approve" onClick={() => review(selected.id, 'approved')}><Check size={15}/> Approve submission</button></div> : <div className="admin-reviewed-note"><BadgeCheck size={16}/> This illustrative submission is {selected.status}. Reset to replay the review.</div>}</> : <div className="admin-empty"><span>Select an illustrative submission to review.</span></div>}</section></div>
      <p className="admin-demo-footnote">Approval in this walkthrough does not publish a listing. Real approval requires protected server-side authorization and an audited database transition.</p>
    </div>
  </main>
}
