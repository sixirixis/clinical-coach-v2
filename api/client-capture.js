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

const supabaseRest = async (path, { method = 'GET', body, prefer } = {}) => {
  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/${path}`
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
  if (prefer) headers.Prefer = prefer

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const message = data?.message || data?.error || text || `HTTP ${res.status}`
    const error = new Error(message)
    error.status = res.status
    error.details = data
    throw error
  }

  return data
}

const encodeFilterValue = (value) => encodeURIComponent(String(value).replace(/%/g, '%25'))

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
  const callId = clean(body?.vapiCallId ?? body?.callId) || `client-${Date.now()}`
  const userId = isUuid(body?.userId) ? clean(body.userId) : null
  const startedAt = clean(body?.startedAt) || new Date().toISOString()
  const endedAt = clean(body?.endedAt) || new Date().toISOString()
  const durationSeconds = toIntSeconds(body?.durationSeconds)
  const feedback = body?.insight && typeof body.insight === 'object'
    ? body.insight
    : body?.feedback && typeof body.feedback === 'object'
      ? body.feedback
      : {}
  const status = clean(body?.status) || 'completed'

  const payload = {
    user_id: userId,
    call_id: callId,
    scenario_slug: scenarioSlug,
    scenario_title: scenarioTitle,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    transcript,
    feedback,
  }

  try {
    const existing = await supabaseRest(
      `coaching_sessions?call_id=eq.${encodeFilterValue(callId)}&select=id&limit=1`,
    )

    const result = Array.isArray(existing) && existing.length > 0
      ? await supabaseRest(
          `coaching_sessions?call_id=eq.${encodeFilterValue(callId)}&select=id,transcript,duration_seconds,status`,
          {
            method: 'PATCH',
            prefer: 'return=representation',
            body: payload,
          },
        )
      : await supabaseRest('coaching_sessions?select=id,transcript,duration_seconds,status', {
          method: 'POST',
          prefer: 'return=representation',
          body: payload,
        })

    const saved = Array.isArray(result) ? result[0] : result
    if (!saved?.id) {
      return json(res, 500, {
        error: 'Supabase transcript save returned no row.',
        details: result,
      })
    }

    return json(res, 200, {
      ok: true,
      sessionId: saved.id,
      callId,
      transcriptCount: transcript.length,
      durationSeconds: saved.duration_seconds,
      status: saved.status,
    })
  } catch (error) {
    return json(res, 500, {
      error: 'Transcript capture save failed.',
      details: error instanceof Error ? error.message : String(error),
      supabaseStatus: error?.status,
      supabaseDetails: error?.details,
    })
  }
}
