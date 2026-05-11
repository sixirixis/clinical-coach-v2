const clean = (value) => (typeof value === 'string' ? value.trim() : '')

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const normalizeRole = (value) => (value === 'admin' ? 'admin' : 'learner')

export const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value))

const titleFromEmail = (email) => {
  const local = email.split('@')[0] || 'Learner'
  return local
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Learner'
}

export const buildProfilePayload = (body = {}) => {
  const email = clean(body.email).toLowerCase()
  if (!emailRegex.test(email)) throw new Error('Valid email is required.')

  const fullName = clean(body.fullName ?? body.full_name) || titleFromEmail(email)
  const role = normalizeRole(clean(body.role))

  return {
    email,
    full_name: fullName,
    role,
  }
}
