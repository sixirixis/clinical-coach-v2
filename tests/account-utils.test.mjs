import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProfilePayload, isUuid, normalizeRole } from '../api/account-utils.js'

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
