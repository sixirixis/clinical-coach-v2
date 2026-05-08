import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null

export type UserRole = 'learner' | 'admin'
export type ScenarioStatus = 'live' | 'pilot' | 'draft'

export type Profile = {
  id: string
  email: string
  full_name: string
  role: UserRole
  created_at: string
}

export type TranscriptLine = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: string
}

export type CallRecord = {
  id: string
  user_id: string | null
  scenario_slug: string
  vapi_call_id: string | null
  status: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  transcript: TranscriptLine[]
  insight: Record<string, unknown>
}

export type ScenarioConfig = {
  slug: string
  title: string
  status: ScenarioStatus
  assistant_id: string
  opening_line: string
  script_notes: string
  image_theme: string
  updated_at: string
}

export const getProfile = async (userId: string): Promise<Profile | null> => {
  if (!supabase) return null

  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) return null
  return data as Profile
}

export const upsertProfile = async (profile: Partial<Profile> & { id: string }) => {
  if (!supabase) return false
  const { error } = await supabase.from('profiles').upsert(profile)
  return !error
}

export const getAllProfiles = async (): Promise<Profile[]> => {
  if (!supabase) return []

  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(100)
  if (error) return []
  return data as Profile[]
}

export const logCallStart = async (payload: {
  user_id: string
  scenario_slug: string
  vapi_call_id?: string | null
}): Promise<string | null> => {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('calls')
    .insert({
      ...payload,
      vapi_call_id: payload.vapi_call_id ?? null,
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return null
  return data.id as string
}

export const logCallEnd = async (
  callId: string,
  payload: {
    ended_at: string
    duration_seconds: number
    transcript: TranscriptLine[]
    insight: Record<string, unknown>
    status: string
    vapi_call_id?: string | null
  },
) => {
  if (!supabase) return false

  const { error } = await supabase.from('calls').update(payload).eq('id', callId)
  return !error
}

export const getUserCalls = async (userId: string): Promise<CallRecord[]> => {
  if (!supabase) return []

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
  if (!supabase) return []

  const { data, error } = await supabase.from('calls').select('*').order('started_at', { ascending: false }).limit(100)
  if (error) return []
  return data as CallRecord[]
}

export const getScenarioConfigs = async (): Promise<ScenarioConfig[]> => {
  if (!supabase) return []

  const { data, error } = await supabase.from('scenario_configs').select('*').order('title', { ascending: true })
  if (error) return []
  return data as ScenarioConfig[]
}

export const upsertScenarioConfig = async (config: ScenarioConfig) => {
  if (!supabase) return false
  const { error } = await supabase.from('scenario_configs').upsert(config)
  return !error
}
