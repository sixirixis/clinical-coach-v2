import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type UserRole = 'learner' | 'admin'

export type Profile = {
  id: string
  email: string
  full_name: string
  role: UserRole
  created_at: string
}

export type CallRecord = {
  id: string
  user_id: string
  scenario_slug: string
  vapi_call_id: string | null
  status: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  transcript: TranscriptLine[]
  insight: Record<string, unknown>
}

export type TranscriptLine = {
  role: 'user' | 'assistant'
  text: string
  timestamp: string
}

export const getProfile = async (userId: string): Promise<Profile | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) return null
  return data as Profile
}

export const upsertProfile = async (profile: Partial<Profile> & { id: string }) => {
  const { error } = await supabase.from('profiles').upsert(profile)
  return !error
}

export const logCallStart = async (payload: {
  user_id: string
  scenario_slug: string
  vapi_call_id?: string
}): Promise<string | null> => {
  const { data, error } = await supabase
    .from('calls')
    .insert({ ...payload, status: 'active', started_at: new Date().toISOString() })
    .select('id')
    .single()
  if (error) return null
  return data.id
}

export const logCallEnd = async (
  callId: string,
  payload: {
    ended_at: string
    duration_seconds: number
    transcript: TranscriptLine[]
    insight: Record<string, unknown>
    status: string
  },
) => {
  const { error } = await supabase.from('calls').update(payload).eq('id', callId)
  return !error
}

export const getUserCalls = async (userId: string): Promise<CallRecord[]> => {
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) return []
  return data as CallRecord[]
}

export const getAllCalls = async (): Promise<CallRecord[]> => {
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(100)
  if (error) return []
  return data as CallRecord[]
}
