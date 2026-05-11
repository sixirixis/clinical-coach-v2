import { randomUUID } from 'node:crypto'
import { buildProfilePayload } from './account-utils.js'

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '').trim()

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
    try { data = JSON.parse(text) } catch { data = text }
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

  const text = await res.text()
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }

  if (!res.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || text || `HTTP ${res.status}`
    const error = new Error(message)
    error.status = res.status
    error.details = data
    throw error
  }

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
      password: clean(password) || `ClinicalCoach-${randomUUID()}!`,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role,
      },
    },
  })
  return data?.user || data
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  if (!supabaseUrl || !serviceRoleKey) {
    return json(res, 500, {
      error: 'Supabase server credentials are not configured for account profiles.',
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

  let profilePayload
  try {
    profilePayload = buildProfilePayload(body)
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Invalid account profile.' })
  }

  const now = new Date().toISOString()

  try {
    const existingByEmail = await supabaseRest(
      `user_profiles?email=eq.${encodeFilterValue(profilePayload.email)}&select=id,email,full_name,role,created_at,updated_at&limit=1`,
    )

    const emailProfile = Array.isArray(existingByEmail) ? existingByEmail[0] : null
    const authUser = emailProfile?.id
      ? { id: emailProfile.id }
      : await findAuthUserByEmail(profilePayload.email)
        || await createAuthUser({
          email: profilePayload.email,
          password: body?.password,
          fullName: profilePayload.full_name,
          role: profilePayload.role,
        })

    if (!authUser?.id) {
      return json(res, 500, { error: 'Supabase Auth user save returned no id.' })
    }

    // Supabase projects often have an Auth trigger that creates user_profiles
    // immediately when an auth user is created. Re-check by Auth UUID before
    // inserting so sign-in is idempotent and cannot collide on user_profiles_pkey.
    const existingById = await supabaseRest(
      `user_profiles?id=eq.${encodeFilterValue(authUser.id)}&select=id,email,full_name,role,created_at,updated_at&limit=1`,
    )
    const idProfile = Array.isArray(existingById) ? existingById[0] : null
    const existingProfile = idProfile || emailProfile

    const result = existingProfile?.id
      ? await supabaseRest(
          `user_profiles?id=eq.${encodeFilterValue(existingProfile.id)}&select=id,email,full_name,role,created_at,updated_at`,
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
            id: authUser.id,
            ...profilePayload,
            created_at: now,
            updated_at: now,
          },
        })

    const profile = Array.isArray(result) ? result[0] : result
    if (!profile?.id) {
      return json(res, 500, { error: 'Supabase profile save returned no row.', details: result })
    }

    return json(res, 200, {
      ok: true,
      profile: {
        id: profile.id,
        email: clean(profile.email),
        full_name: clean(profile.full_name),
        role: profile.role === 'admin' ? 'admin' : 'learner',
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      },
    })
  } catch (error) {
    return json(res, 500, {
      error: 'Account profile save failed.',
      details: error instanceof Error ? error.message : String(error),
      supabaseStatus: error?.status,
      supabaseDetails: error?.details,
    })
  }
}
