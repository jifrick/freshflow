import { supabase } from './supabase'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export async function uploadInventoryPhoto(batchId: string, file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase Storage is not configured.')
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.')
  if (file.size <= 0 || file.size > MAX_BYTES) throw new Error('Image size must be between 1 byte and 5 MB.')

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in before uploading an inventory photo.')
  const path = `${user.id}/${batchId}/${crypto.randomUUID()}.${EXTENSIONS[file.type]}`
  const { error } = await supabase.storage.from('inventory-photos').upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw new Error(`Photo upload failed: ${error.message}`)
  return path
}

export async function getInventoryPhotoUrl(path: string): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from('inventory-photos').createSignedUrl(path, 300)
  return error ? null : data.signedUrl
}
