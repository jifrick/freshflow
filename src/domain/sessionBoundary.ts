/** Live mutations require an authenticated account and an explicitly live session. */
export function liveMutationAllowed(demoSession: boolean, authenticated: boolean): boolean {
  return !demoSession && authenticated
}

/** Live AI calls follow the same explicit demo/auth boundary as database mutations. */
export function aiAnalysisAllowed(demoSession: boolean, authenticated: boolean, configured: boolean): boolean {
  return !demoSession && authenticated && configured
}
