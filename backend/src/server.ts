import 'dotenv/config'

import cors from 'cors'
import express, { type Request, type Response, type NextFunction } from 'express'

type TranscriptTurn = {
  role: 'assistant' | 'user' | 'system'
  text: string
  createdAt: string
}

type StoredSession = {
  callId: string
  status?: string
  startedAt?: string
  endedAt?: string
  endedReason?: string
  transcript: TranscriptTurn[]
  artifacts?: Record<string, unknown>
  messages?: unknown[]
  lastEventType?: string
}

type ReviewRequest = {
  sessionId?: string
  scenarioType?: string
  transcript?: Array<{ role: string; text: string }>
}

const app = express()
const port = Number(process.env.PORT || 3001)
const env = process.env.NODE_ENV || 'development'
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const sessions = new Map<string, StoredSession>()

const booleanFromEnv = (value: string | undefined, fallback: boolean) => {
  if (value == null) return fallback
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase())
}

const enableLlmReview = booleanFromEnv(process.env.ENABLE_LLM_REVIEW, true)
const webhookBearerToken = process.env.VAPI_WEBHOOK_BEARER_TOKEN?.trim()
const webhookSecret = process.env.VAPI_WEBHOOK_SECRET?.trim()

app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes(origin)) return callback(null, true)
      return callback(new Error(`Origin not allowed: ${origin}`))
    },
    credentials: true,
  }),
)

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    env,
    allowedOrigins,
    llmReviewEnabled: enableLlmReview,
    hasVapiPrivateKey: Boolean(process.env.VAPI_PRIVATE_KEY),
    hasWebhookProtection: Boolean(webhookBearerToken || webhookSecret),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    sessionCount: sessions.size,
  })
})

const requireWebhookAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.header('authorization')
  const xVapiSecret = req.header('x-vapi-secret')

  if (!webhookBearerToken && !webhookSecret && env !== 'production') {
    return next()
  }

  if (webhookBearerToken && authHeader === `Bearer ${webhookBearerToken}`) {
    return next()
  }

  if (webhookSecret && xVapiSecret === webhookSecret) {
    return next()
  }

  return res.status(401).json({ error: 'Unauthorized webhook request.' })
}

const getSession = (callId: string) => {
  const existing = sessions.get(callId)
  if (existing) return existing

  const created: StoredSession = {
    callId,
    transcript: [],
  }
  sessions.set(callId, created)
  return created
}

const normalizeRole = (role: unknown): TranscriptTurn['role'] => {
  if (role === 'assistant' || role === 'user' || role === 'system') return role
  return 'system'
}

const textFromUnknown = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

app.post('/api/vapi/webhook', requireWebhookAuth, (req, res) => {
  const message = req.body?.message
  const eventType = textFromUnknown(message?.type)
  const callId = textFromUnknown(message?.call?.id) || 'unknown-call'
  const session = getSession(callId)
  session.lastEventType = eventType

  if (!session.startedAt) {
    session.startedAt = new Date().toISOString()
  }

  if (eventType === 'transcript' || eventType.startsWith('transcript[')) {
    const transcriptType = textFromUnknown(message?.transcriptType)
    const text =
      textFromUnknown(message?.transcript) ||
      textFromUnknown(message?.text) ||
      textFromUnknown(message?.message)

    if (text && (!transcriptType || transcriptType === 'final' || eventType.includes('final'))) {
      session.transcript.push({
        role: normalizeRole(message?.role),
        text,
        createdAt: new Date().toISOString(),
      })
    }
  }

  if (eventType === 'status-update') {
    session.status = textFromUnknown(message?.status)
    if (session.status === 'ended') {
      session.endedAt = new Date().toISOString()
    }
  }

  if (eventType === 'conversation-update' && Array.isArray(message?.messages)) {
    session.messages = message.messages
  }

  if (eventType === 'end-of-call-report') {
    session.status = 'ended'
    session.endedAt = new Date().toISOString()
    session.endedReason = textFromUnknown(message?.endedReason)

    if (typeof message?.artifact?.transcript === 'string' && !session.transcript.length) {
      session.transcript.push({
        role: 'system',
        text: message.artifact.transcript,
        createdAt: new Date().toISOString(),
      })
    }

    if (Array.isArray(message?.artifact?.messages)) {
      session.messages = message.artifact.messages
    }

    session.artifacts = message?.artifact ?? undefined
  }

  sessions.set(callId, session)

  res.json({
    ok: true,
    received: eventType,
    callId,
    transcriptCount: session.transcript.length,
  })
})

app.get('/api/sessions', (_req, res) => {
  const data = Array.from(sessions.values())
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
    .map((session) => ({
      callId: session.callId,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      endedReason: session.endedReason,
      transcriptCount: session.transcript.length,
      lastEventType: session.lastEventType,
    }))

  res.json({ sessions: data })
})

app.get('/api/sessions/:callId', (req, res) => {
  const session = sessions.get(req.params.callId)
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' })
  }

  return res.json({ session })
})

const scoreTranscript = (turns: Array<{ role: string; text: string }>) => {
  const learnerText = turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.text.toLowerCase())
    .join('\n')

  const empathyHits = [
    'it sounds like you felt',
    'am i understanding that correctly',
    'i can hear how',
    'that is very frustrating',
    'our priority is making sure',
  ].filter((phrase) => learnerText.includes(phrase)).length

  const neverWordHits = [
    'there is nothing else we can do',
    "there's nothing else we can do",
    "why didn't you come in sooner",
    'you should have come in sooner',
  ].filter((phrase) => learnerText.includes(phrase)).length

  const spikesHits = [
    'private room',
    'what is your understanding',
    'would you like me to go over the technical details',
    'which is why',
    'i can hear how much you care',
    'to make sure we are on the same page',
  ].filter((phrase) => learnerText.includes(phrase)).length

  return {
    empathyScore: Math.max(0, Math.min(100, 60 + empathyHits * 10 - neverWordHits * 12)),
    deEscalationScore: Math.max(0, Math.min(100, 58 + empathyHits * 8 + spikesHits * 4 - neverWordHits * 18)),
    spikesCoverageScore: Math.max(0, Math.min(100, 20 + spikesHits * 13)),
    neverWordHits,
    empathyHits,
  }
}

app.post('/api/review-call', async (req, res) => {
  if (!enableLlmReview) {
    return res.status(503).json({ error: 'LLM review is disabled for this environment.' })
  }

  const body = (req.body ?? {}) as ReviewRequest
  const transcript = Array.isArray(body.transcript) ? body.transcript : []

  if (!transcript.length) {
    return res.status(400).json({ error: 'Transcript is required.' })
  }

  const scores = scoreTranscript(transcript)
  const strengths: string[] = []
  const growthAreas: string[] = []

  if (scores.empathyHits > 0) {
    strengths.push('The learner used reflective listening instead of rushing to defend or explain.')
  }

  if (scores.spikesCoverageScore >= 46) {
    strengths.push('The learner demonstrated parts of the SPIKES structure, which keeps difficult conversations organized.')
  }

  if (scores.neverWordHits > 0) {
    growthAreas.push('A NEVER phrase was detected. That wording should be coached out immediately because it escalates distress.')
  }

  if (!strengths.length) {
    strengths.push('The conversation remained coachable, but the learner needs more explicit empathy markers for a stronger appraisal.')
  }

  if (!growthAreas.length) {
    growthAreas.push('Next step: make the summary and follow-up plan more explicit so the family member leaves with a clearer roadmap.')
  }

  return res.json({
    provider: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY ? 'llm-ready-backend' : 'heuristic-local',
    model: process.env.REVIEW_MODEL || 'gpt-4.1-mini',
    sessionId: body.sessionId ?? null,
    scenarioType: body.scenarioType ?? null,
    review: {
      summary:
        scores.neverWordHits > 0
          ? 'The learner showed some structure, but used at least one escalation-prone phrase that should be corrected before live deployment.'
          : 'The learner showed a workable foundation in empathy and structured communication, with room to make the plan and reassurance even clearer.',
      strengths,
      growthAreas,
      scores,
    },
  })
})

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (error.message.startsWith('Origin not allowed')) {
    return res.status(403).json({ error: error.message })
  }

  console.error(error)
  return res.status(500).json({ error: 'Internal server error.' })
})

app.listen(port, () => {
  console.log(`Clinical coach backend listening on port ${port}`)
})
