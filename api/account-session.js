import { buildAuthPayload, buildProfilePayload } from './account-utils.js'

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '').trim()
const adminEmail = (process.env.ADMIN_EMAIL || 'admin@clinicalcoach.app').trim().toLowerCase()

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '')
const encodeFilterValue = (value) => encodeURIComponent(String(value).replace(/%/g, '%25'))

const readBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

const parseResponse = async (res) => {
  const text = await res.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

const throwHttp = (res, data) => {
  const message = data?.msg || data?.message || data?.error_description || data?.error || (typeof data === 'string' ? data : '') || `HTTP ${res.status}`
  const error = new Error(message)
  error.status = res.status
  error.details = data
  throw error
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
  const data = await parseResponse(res)
  if (!res.ok) throwHttp(res, data)
  return data
}

const authAdminRest = async (path, { method = 'GET', body } = {}) => {
  const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/${path}`
  const res = await fetch(url, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await parseResponse(res)
  if (!res.ok) throwHttp(res, data)
  return data
}

const signInWithPassword = async ({ email, password }) => {
  const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  const data = await parseResponse(res)
  if (!res.ok) throwHttp(res, data)
  return data
}

const findAuthUserByEmail = async (email) => {
  const data = await authAdminRest('users?per_page=100&page=1')
  const users = Array.isArray(data?.users) ? data.users : []
  return users.find((candidate) => clean(candidate?.email).toLowerCase() === email) || null
}

const createAuthUser = async ({ email, password, fullName, role }) => {
  const data = await authAdminRest('users', {
    method: 'POST',
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role,
      },
    },
  })
  return data?.user || data
}

const getProfileByEmail = async (email) => {
  const rows = await supabaseRest(
    `user_profiles?email=eq.${encodeFilterValue(email)}&select=id,email,full_name,role,created_at,updated_at&limit=1`,
  )
  return Array.isArray(rows) ? rows[0] : null
}

const getProfileById = async (id) => {
  const rows = await supabaseRest(
    `user_profiles?id=eq.${encodeFilterValue(id)}&select=id,email,full_name,role,created_at,updated_at&limit=1`,
  )
  return Array.isArray(rows) ? rows[0] : null
}

const syncProfile = async ({ authUserId, email, fullName, role }) => {
  const now = new Date().toISOString()
  const profilePayload = buildProfilePayload({ email, fullName, role })
  const byId = await getProfileById(authUserId)
  const byEmail = byId ? null : await getProfileByEmail(email)
  const existing = byId || byEmail

  const result = existing?.id
    ? await supabaseRest(
        `user_profiles?id=eq.${encodeFilterValue(existing.id)}&select=id,email,full_name,role,created_at,updated_at`,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: {
            email: profilePayload.email,
            full_name: profilePayload.full_name,
            role: profilePayload.role,
            updated_at: now,
          },
        },
      )
    : await supabaseRest('user_profiles?select=id,email,full_name,role,created_at,updated_at', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          id: authUserId,
          ...profilePayload,
          created_at: now,
          updated_at: now,
        },
      })

  return Array.isArray(result) ? result[0] : result
}

const responseProfile = (profile) => ({
  id: profile.id,
  email: clean(profile.email),
  full_name: clean(profile.full_name),
  role: profile.role === 'admin' ? 'admin' : 'learner',
  created_at: profile.created_at,
  updated_at: profile.updated_at,
})

const responseSession = (session) => session ? ({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  expires_at: session.expires_at,
  expires_in: session.expires_in,
  token_type: session.token_type,
}) : null

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  if (!supabaseUrl || !serviceRoleKey) {
    return json(res, 500, {
      error: 'Supabase server credentials are not configured for account auth.',
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

  let authPayload
  try {
    authPayload = buildAuthPayload(body)
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Invalid account credentials.' })
  }

  const role = authPayload.email === adminEmail ? 'admin' : 'learner'
  const fullName = authPayload.fullName || (role === 'admin' ? 'Admin User' : undefined)

  try {
    if (authPayload.action === 'signup') {
      if (role === 'admin') {
        return json(res, 403, { error: 'Admin accounts cannot be created from public sign up.' })
      }

      const existing = await findAuthUserByEmail(authPayload.email)
      if (existing?.id) {
        return json(res, 409, { error: 'An account with this email already exists. Please log in instead.' })
      }

      const authUser = await createAuthUser({
        email: authPayload.email,
        password: authPayload.password,
        fullName: authPayload.fullName,
        role,
      })
      if (!authUser?.id) return json(res, 500, { error: 'Supabase Auth signup returned no user id.' })

      // Auth triggers may auto-create user_profiles. Re-check by UUID and update.
      const profile = await syncProfile({
        authUserId: authUser.id,
        email: authPayload.email,
        fullName: authPayload.fullName,
        role,
      })
      const session = await signInWithPassword({ email: authPayload.email, password: authPayload.password })

      return json(res, 200, {
        ok: true,
        action: 'signup',
        emailConfirmed: true,
        profile: responseProfile(profile),
        session: responseSession(session),
      })
    }

    const session = await signInWithPassword({ email: authPayload.email, password: authPayload.password })
    const authUser = session?.user
    if (!authUser?.id) return json(res, 401, { error: 'Invalid login credentials.' })

    const existingProfile = await getProfileById(authUser.id)
    const profile = await syncProfile({
      authUserId: authUser.id,
      email: authPayload.email,
      fullName: fullName || existingProfile?.full_name || authUser.user_metadata?.full_name,
      role: existingProfile?.role === 'admin' ? 'admin' : role,
    })

    return json(res, 200, {
      ok: true,
      action: 'login',
      emailConfirmed: Boolean(authUser.email_confirmed_at || authUser.confirmed_at),
      profile: responseProfile(profile),
      session: responseSession(session),
    })
  } catch (error) {
    const status = error?.status === 400 ? 401 : error?.status === 409 ? 409 : 500
    return json(res, status, {
      error: status === 401 ? 'Invalid login credentials.' : 'Account auth failed.',
      details: error instanceof Error ? error.message : String(error),
      supabaseStatus: error?.status,
      supabaseDetails: error?.details,
    })
  }
}
