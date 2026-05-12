import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAuthPayload, buildProfilePayload, isUuid, normalizeAuthAction, normalizeRole } from '../api/account-utils.js'

test('buildProfilePayload normalizes account fields for user_profiles', () => {
  const payload = buildProfilePayload({
    email: '  Learner@Example.COM  ',
    fullName: '  Demo Learner  ',
    role: 'learner',
  })

  assert.equal(payload.email, 'learner@example.com')
  assert.equal(payload.full_name, 'Demo Learner')
  assert.equal(payload.role, 'learner')
})

test('buildProfilePayload rejects invalid email', () => {
  assert.throws(() => buildProfilePayload({ email: 'not-an-email', fullName: 'Bad' }), /Valid email is required/)
})

test('normalizeRole only allows learner or admin', () => {
  assert.equal(normalizeRole('admin'), 'admin')
  assert.equal(normalizeRole('learner'), 'learner')
  assert.equal(normalizeRole('owner'), 'learner')
})

test('isUuid validates Supabase profile UUIDs', () => {
  assert.equal(isUuid('ef434be5-de2b-45c2-a087-b78377eef184'), true)
  assert.equal(isUuid('learner-test-id'), false)
})

test('normalizeAuthAction separates login from signup', () => {
  assert.equal(normalizeAuthAction('signup'), 'signup')
  assert.equal(normalizeAuthAction('login'), 'login')
  assert.equal(normalizeAuthAction('anything-else'), 'login')
})

test('buildAuthPayload validates login email and password', () => {
  const payload = buildAuthPayload({ action: 'login', email: '  Learner@Example.COM ', password: ' correct horse battery staple ' })

  assert.equal(payload.action, 'login')
  assert.equal(payload.email, 'learner@example.com')
  assert.equal(payload.password, 'correct horse battery staple')
  assert.equal(payload.fullName, '')
})

test('buildAuthPayload requires stronger password for signup', () => {
  assert.throws(() => buildAuthPayload({ action: 'signup', email: 'learner@example.com', password: 'short' }), /at least 8 characters/)
})

test('buildAuthPayload accepts signup full name', () => {
  const payload = buildAuthPayload({ action: 'signup', email: 'learner@example.com', password: 'StrongPass2026!', fullName: '  Test Learner  ' })

  assert.equal(payload.action, 'signup')
  assert.equal(payload.email, 'learner@example.com')
  assert.equal(payload.password, 'StrongPass2026!')
  assert.equal(payload.fullName, 'Test Learner')
})
