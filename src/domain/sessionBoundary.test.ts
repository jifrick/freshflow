import { describe, expect, it } from 'vitest'
import { aiAnalysisAllowed, liveMutationAllowed } from './sessionBoundary'

describe('demo/live mutation boundary', () => {
  it('blocks every live mutation while the explicit demo session is active', () => {
    expect(liveMutationAllowed(true, true)).toBe(false)
    expect(liveMutationAllowed(true, false)).toBe(false)
  })

  it('requires an authenticated user in live mode', () => {
    expect(liveMutationAllowed(false, false)).toBe(false)
    expect(liveMutationAllowed(false, true)).toBe(true)
  })
})

describe('AI analysis boundary', () => {
  it('does not call the live analysis function from demo, anonymous, or unconfigured states', () => {
    expect(aiAnalysisAllowed(true, true, true)).toBe(false)
    expect(aiAnalysisAllowed(false, false, true)).toBe(false)
    expect(aiAnalysisAllowed(false, true, false)).toBe(false)
    expect(aiAnalysisAllowed(false, true, true)).toBe(true)
  })
})
