import { useState } from 'react'
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import type { AiDecisionNarrative, AiReportEvidence } from '../domain/openAiReport'
import { aiAnalysisAllowed } from '../domain/sessionBoundary'
import { supabase } from '../lib/supabase'

type ResponseReport = { source: 'openai'; model: string; narrative: AiDecisionNarrative; facts: AiReportEvidence }
type State = { status: 'idle' | 'loading' | 'unavailable' | 'error' | 'success'; report?: ResponseReport; message?: string }
const nextActionLabel = {
  evaluate_feasible_option: 'Review the feasible buyer option',
  complete_missing_information: 'Complete missing information before deciding',
  review_inventory_or_find_demand: 'Review inventory details or find buyer demand',
} as const

const inr = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount)
function evidenceLabel(id: string, facts: AiReportEvidence): string {
  if (id === 'inventory') return 'Inventory record'
  if (id === 'freshness') return 'Harvest date and freshness window'
  if (id === 'condition') return 'Reported condition'
  if (id.startsWith('demand:')) return 'Published buyer requirement'
  if (id.startsWith('offer:')) return 'Pending offer record'
  return facts.inventory.produce
}

export function InventoryAiAnalysis({ inventoryId, isPublicWorkspace, isAuthenticated }: { inventoryId: string; isPublicWorkspace: boolean; isAuthenticated: boolean }) {
  const canAnalyze = aiAnalysisAllowed(isPublicWorkspace, isAuthenticated, Boolean(supabase))
  const [state, setState] = useState<State>(() => !canAnalyze
    ? { status: 'unavailable', message: 'AI analysis is unavailable in the public workspace. No AI report was generated.' }
    : { status: 'idle' })

  async function analyze() {
    if (!canAnalyze || !supabase) {
      setState({ status: 'unavailable', message: 'Sign in to an enabled FreshFlow workspace to request a real AI analysis.' })
      return
    }
    setState({ status: 'loading' })
    try {
      const { data, error } = await supabase.functions.invoke('analyze-inventory', { body: { inventoryId } })
      if (error) {
        const status = error.context?.status
        if (status === 503 || status === 404) {
          setState({ status: 'unavailable', message: 'AI analysis is not configured or the live database is missing required fields. No AI report was generated.' })
          return
        }
        setState({ status: 'error', message: status === 401 ? 'Your session has expired. Sign in again and retry.' : 'Analysis could not be completed. Your inventory was not changed.' })
        return
      }
      if (!data || data.source !== 'openai' || !data.narrative || !data.facts || typeof data.model !== 'string') {
        setState({ status: 'error', message: 'The analysis service returned an incomplete response. Please retry.' })
        return
      }
      setState({ status: 'success', report: data as ResponseReport })
    } catch {
      setState({ status: 'error', message: 'Analysis could not be reached. Please retry.' })
    }
  }

  return <section className="ai-analysis" aria-live="polite">
    <div className="ai-analysis-heading"><div><span className="ai-analysis-icon"><Sparkles size={15}/></span><div><h3>Inventory decision analysis</h3><p>AI explains evidence from your inventory and published demand. Financial values remain deterministic.</p></div></div>
      <button type="button" className="secondary-btn compact-btn" onClick={() => void analyze()} disabled={state.status === 'loading' || !canAnalyze}>
        {state.status === 'loading' ? 'Analyzing…' : state.status === 'error' && !isPublicWorkspace ? 'Retry analysis' : 'Analyze inventory'}
      </button>
    </div>
    {state.status === 'loading' && <div className="ai-analysis-note"><span className="spinner"/> Checking your saved inventory and current buyer requirements…</div>}
    {state.message && <div className={`ai-analysis-note ${state.status}`}><AlertTriangle size={15}/><span>{state.message}</span></div>}
    {state.report && <div className="ai-report">
      <div className="ai-report-source">OpenAI analysis · {state.report.model} · qualitative guidance only</div>
      <p className="ai-summary">{state.report.narrative.summary}</p>
      <div className="ai-report-grid">
        <div><h4>Risk observations</h4>{state.report.narrative.riskObservations.length ? <ul>{state.report.narrative.riskObservations.map((item, index) => <li key={index}>{item.text}<small className="ai-citation">Evidence: {item.evidenceIds.map((id) => evidenceLabel(id, state.report!.facts)).join(', ')}</small></li>)}</ul> : <p>No additional AI risk observations.</p>}<span className="ai-evidence">Reported freshness: {state.report.facts.inventory.risk.replace('_', ' ')}</span></div>
        <div><h4>Relevant published demand</h4>{state.report.facts.demands.length ? state.report.facts.demands.map((demand) => {
          const option = state.report!.facts.options.find((candidate) => candidate.demandId === demand.id)
          const note = state.report!.narrative.matchNotes.find((item) => item.demandId === demand.id)
          return <div className="ai-demand" key={demand.id}><b>{demand.produce} · {demand.remainingQuantity} {demand.unit}</b><span>{note?.text ?? 'Product, quantity, unit, deadline, and condition reviewed.'}</span><small>{option?.feasible ? 'Feasible with recorded inputs' : 'Needs review'} · {option?.netProceeds === null || option?.netProceeds === undefined ? 'Net proceeds unknown' : `${inr(option.netProceeds)} net proceeds`}</small></div>
        }) : <p>No matching published demand was found in the current data.</p>}</div>
      </div>
      {state.report.facts.offers.length > 0 && <div className="ai-open-offers"><h4>Pending offers</h4>{state.report.facts.offers.map((offer) => <div key={offer.id}><span>{offer.quantity} {state.report!.facts.inventory.unit} at {inr(offer.unitPrice)} per unit</span><b>Gross {offer.grossProceeds === null ? 'unknown' : inr(offer.grossProceeds)} · Net {offer.netProceeds === null ? 'unknown' : inr(offer.netProceeds)}</b><small>{state.report!.narrative.offerNotes.find((note) => note.offerId === offer.id)?.text ?? 'Existing pending offer; review its recorded terms.'}</small></div>)}</div>}
      <div className="ai-recommendation"><b>{nextActionLabel[state.report.narrative.recommendedAction]}</b>{state.report.narrative.recommendedDemandId && <small className="ai-citation">{state.report.facts.demands.find((demand) => demand.id === state.report!.narrative.recommendedDemandId)?.produce} buyer requirement</small>}<p>{state.report.narrative.recommendationRationale}</p>{state.report.narrative.recommendationEvidenceIds.length > 0 && <small className="ai-citation">Evidence: {state.report.narrative.recommendationEvidenceIds.map((id) => evidenceLabel(id, state.report!.facts)).join(', ')}</small>}</div>
      {state.report.facts.options.length > 0 && <div className="ai-economics"><h4>Deterministic economics</h4>{state.report.facts.options.map((option) => <div key={option.demandId}><span>Gross potential</span><b>{option.grossProceeds === null ? 'Unknown' : inr(option.grossProceeds)}</b><span>Known costs</span><b>{Object.values(option.costs).every((value) => value !== null) ? inr(Object.values(option.costs).reduce<number>((total, value) => total + (value ?? 0), 0)) : 'Incomplete'}</b><span>Net proceeds</span><b>{option.netProceeds === null ? 'Unknown' : inr(option.netProceeds)}</b></div>)}</div>}
      {(state.report.facts.missingInformation.length > 0 || state.report.narrative.cautions.length > 0) && <div className="ai-cautions"><b>Unknowns and constraints</b><ul>{[...state.report.facts.missingInformation, ...state.report.narrative.cautions].map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
      <p className="ai-no-action">This report does not submit an offer, reserve stock, or change inventory. Review and approve actions separately.</p>
      {state.status === 'success' && <button type="button" className="mini-link ai-retry" onClick={() => { setState({ status: 'idle' }); void analyze() }}><RefreshCw size={13}/> Refresh analysis</button>}
    </div>}
  </section>
}
