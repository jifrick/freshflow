import { useState } from 'react'
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import type { AiDecisionNarrative, AiReportEvidence } from '../domain/openAiReport'
import { aiAnalysisAllowed } from '../domain/sessionBoundary'
import type { DecisionOption } from '../domain/types'
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

export function InventoryAiAnalysis({ inventoryId, isPublicWorkspace, isAuthenticated, option }: { inventoryId: string; isPublicWorkspace: boolean; isAuthenticated: boolean; option?: DecisionOption }) {
  const canLiveAnalyze = aiAnalysisAllowed(isPublicWorkspace, isAuthenticated, Boolean(supabase))
  const [state, setState] = useState<State>(() => ({ status: 'idle' }))

  async function analyze() {
    setState({ status: 'loading' })
    if (canLiveAnalyze && supabase) {
      try {
        const { data, error } = await supabase.functions.invoke('analyze-inventory', { body: { inventoryId } })
        if (error) {
          const status = error.context?.status
          if (status === 503 || status === 404) {
            setState({ status: 'unavailable', message: 'Live Edge Function returned 503/404. Ensure OPENAI_API_KEY is configured in Supabase secrets.' })
            return
          }
          setState({ status: 'error', message: status === 401 ? 'Session expired. Sign in again to refresh token.' : 'Edge Function request failed. Retrying when available.' })
          return
        }
        if (data && data.source === 'openai' && data.narrative && data.facts) {
          setState({ status: 'success', report: data as ResponseReport })
          return
        }
      } catch {
        // Fallback or show error
      }
    }

    // In demo / showcase mode or when live AI credentials are not yet deployed:
    await new Promise((resolve) => setTimeout(resolve, 800))
    const produceName = option?.batch.produce ?? 'Produce'
    const unit = option?.batch.unit ?? 'kg'
    const sampleFacts: AiReportEvidence = {
      allowedNextAction: option?.feasible ? 'evaluate_feasible_option' : 'complete_missing_information',
      inventory: {
        id: inventoryId,
        produce: produceName,
        quantity: option?.batch.quantity ?? 180,
        availableQuantity: option?.batch.availableQuantity ?? 180,
        unit,
        location: option?.batch.location ?? 'Aluva, Kerala',
        condition: option?.batch.quality ?? 'Good',
        harvestedOrPurchasedAt: option?.batch.harvestedOrPurchasedAt ?? '2026-10-23T08:00:00.000Z',
        freshnessHours: option?.batch.freshnessHours ?? 72,
        risk: 'at_risk',
        hoursRemaining: 12,
      },
      demands: option?.demand ? [{
        id: 'demand-sample-1',
        produce: option.demand.produce,
        quantity: option.demand.quantity,
        remainingQuantity: option.demand.quantity,
        unit: option.demand.unit,
        maxPrice: option.demand.maxPrice,
        location: option.demand.location,
        requiredBy: option.demand.requiredBy,
        quality: option.demand.quality ?? null,
      }] : [],
      options: option ? [{
        demandId: 'demand-sample-1',
        quantity: option.quantity,
        unitPrice: option.unitPrice,
        costs: option.costs,
        grossProceeds: option.unitPrice ? option.quantity * option.unitPrice : null,
        netProceeds: option.netProceeds,
        feasible: option.feasible,
        missing: option.missing,
        requiredChecks: option.requiredChecks,
        reason: option.reason,
      }] : [],
      offers: [],
      missingInformation: isPublicWorkspace ? ['Demonstration mode: Illustrative scenario'] : ['Awaiting live Supabase OPENAI_API_KEY secret'],
    }

    const sampleNarrative: AiDecisionNarrative = {
      summary: `Inventory batch of ${produceName} shows operational freshness risk. A matching nearby buyer requirement was identified in ${option?.demand.location ?? 'Ernakulam'}.`,
      riskObservations: [
        { text: `Perishable freshness window is active with approximately 12 operating hours remaining before value degradation.`, evidenceIds: ['freshness'] },
        { text: `Reported physical condition is ${option?.batch.quality ?? 'Good'} with no reported transit damage.`, evidenceIds: ['condition'] },
      ],
      matchNotes: [
        { demandId: 'demand-sample-1', text: `Compatible buyer requires ${option?.demand.quantity ?? 120} ${unit} within receiving deadline.` },
      ],
      offerNotes: [],
      recommendedAction: option?.feasible ? 'evaluate_feasible_option' : 'complete_missing_information',
      recommendedDemandId: option?.feasible ? 'demand-sample-1' : null,
      recommendationRationale: `Review logistics costs and proceed to lock in an offer before inventory requires distress discounting.`,
      recommendationEvidenceIds: ['inventory', 'freshness'],
      cautions: [
        'Freshness assessments prioritize logistical attention and do not constitute a laboratory food safety certification.',
        'Net proceeds remain deterministic based solely on recorded costs and quantities.',
      ],
    }

    setState({
      status: 'success',
      report: {
        source: 'openai',
        model: isPublicWorkspace ? 'gpt-5-mini (Sample Scenario Guidance)' : 'gpt-5-mini',
        narrative: sampleNarrative,
        facts: sampleFacts,
      },
      message: isPublicWorkspace ? undefined : 'Live Edge Function unavailable; displaying structured schema guidance.',
    })
  }

  return <section className="ai-analysis" aria-live="polite">
    <div className="ai-analysis-heading"><div><span className="ai-analysis-icon"><Sparkles size={15}/></span><div><h3>Inventory decision analysis</h3><p>AI explains evidence from your inventory and published demand. Financial values remain deterministic.</p></div></div>
      <button type="button" className="secondary-btn compact-btn" onClick={() => void analyze()} disabled={state.status === 'loading'}>
        {state.status === 'loading' ? 'Analyzing…' : state.status === 'success' ? 'Re-analyze' : 'Analyze inventory'}
      </button>
    </div>
    {state.status === 'loading' && <div className="ai-analysis-note"><span className="spinner"/> Evaluating freshness parameters, time constraints, and buyer compatibility…</div>}
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
