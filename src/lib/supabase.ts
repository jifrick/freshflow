import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

const hasSupabaseConfiguration = Boolean(url || key)
let validUrl = false
if (url && !url.includes('your-project')) {
  try {
    const parsed = new URL(url)
    validUrl = parsed.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(parsed.hostname)
  } catch {
    validUrl = false
  }
}

export const supabaseConfigurationError = hasSupabaseConfiguration && (!validUrl || !key || key.includes('your-supabase-publishable-key'))
  ? 'Supabase configuration is incomplete or invalid. Check the public project URL and publishable key.'
  : ''
export const isSupabaseConfigured = Boolean(validUrl && key && !supabaseConfigurationError)
export const isDemoMode = !hasSupabaseConfiguration
export const supabase = isSupabaseConfigured ? createClient(url!, key!) : null
