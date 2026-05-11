import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '').trim()

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '')

const toIntSeconds = (value) => {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.round(raw))
}

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value))

const normalizeTranscript = (value) => {
  if (!Array.isArray(value)) return []

  return value
    .map((turn, index) => {
      const role = turn?.role === 'assistant' || turn?.role === 'user' || turn?.role === 'system'
        ? turn.role
        : null
      const text = clean(turn?.text ?? turn?.content ?? turn?.message ?? turn?.transcript)
      const timestamp = clean(turn?.timestamp ?? turn?.createdAt) || new Date().toISOString()
      if (!role || !text) return null
      return {
        id: clean(turn?.id) || `turn-${index + 1}`,
        role,
        text,
        timestamp,
      }
    })
    .filter(Boolean)
}

const readBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  if (!supabaseUrl || !serviceRoleKey) {
    return json(res, 500, {
      error: 'Supabase server credentials are not configured for transcript capture.',
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
    })
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    return json(res, 400, { error: 'Invalid JSON body.' })
  }

  const transcript = normalizeTranscript(body?.transcript)
  if (!transcript.length) {
    return json(res, 400, { error: 'Transcript is required.' })
  }

  const scenarioSlug = clean(body?.scenarioSlug) || 'angry-relative'
  const scenarioTitle = clean(body?.scenarioTitle) || scenarioSlug
  const vapiCallId = clean(body?.vapiCallId ?? body?.callId) || null
  const userId = isUuid(body?.userId) ? clean(body.userId) : null
  const startedAt = clean(body?.startedAt) || new Date().toISOString()
  const endedAt = clean(body?.endedAt) || new Date().toISOString()
  const durationSeconds = toIntSeconds(body?.durationSeconds)
  const insight = body?.insight && typeof body.insight === 'object' ? body.insight : {}
  const status = clean(body?.status) || 'completed'

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    await supabase
      .from('scenario_configs')
      .upsert({
        slug: scenarioSlug,
        title: scenarioTitle,
        status: 'live',
        assistant_id: '',
        opening_line: clean(body?.openingLine),
        script_notes: 'Auto-created from client-captured transcript save.',
        image_theme: clean(body?.imageTheme) || 'navy',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'slug', ignoreDuplicates: true })

    const payload = {
      user_id: userId,
      scenario_slug: scenarioSlug,
      vapi_call_id: vapiCallId,
      status,
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      transcript,
      insight,
    }

    let result
    if (vapiCallId) {
      result = await supabase
        .from('calls')
        .upsert(payload, { onConflict: 'vapi_call_id' })
        .select('id, transcript, duration_seconds, status')
        .single()
    } else {
      result = await supabase
        .from('calls')
        .insert(payload)
        .select('id, transcript, duration_seconds, status')
        .single()
    }

    if (result.error) {
      return json(res, 500, {
        error: 'Supabase call save failed.',
        details: result.error.message,
        code: result.error.code,
      })
    }

    return json(res, 200, {
      ok: true,
      callId: result.data?.id,
      vapiCallId,
      transcriptCount: transcript.length,
      durationSeconds: result.data?.duration_seconds,
      status: result.data?.status,
    })
  } catch (error) {
    return json(res, 500, {
      error: 'Unexpected transcript capture failure.',
      details: error instanceof Error ? error.message : String(error),
    })
  }
}
