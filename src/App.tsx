import { useEffect, useMemo, useRef, useState } from 'react'
import type Vapi from '@vapi-ai/web'
import './App.css'
import { analyzeTranscript, formatTimestamp, metricLabel, type FeedbackItem, type SessionInsight, type TranscriptEntry } from './lib/feedback'

type SessionStatus = 'idle' | 'connecting' | 'active' | 'ended' | 'error'
type TranscriptRole = TranscriptEntry['role']
type ScenarioAvailability = 'live' | 'placeholder'
type ScenarioRoute = `/agents/${string}`
type AppRoute = '/' | '/sign-in' | '/simulate' | '/admin/sign-in' | '/admin' | ScenarioRoute

type ArchivedSession = {
  id: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  transcript: TranscriptEntry[]
  insight: SessionInsight
}

type DemoAccount = {
  email: string
  password: string
  name: string
}

type ScenarioDefinition = {
  slug: string
  title: string
  strapline: string
  summary: string
  learningGoals: string[]
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  openingLine: string
  persona: string
  availability: ScenarioAvailability
}

type EntryFeedbackGroup = {
  positive: FeedbackItem[]
  negative: FeedbackItem[]
}

type AdminAgentRecord = {
  slug: string
  title: string
  status: 'Live' | 'Pilot' | 'Draft'
  assistantId: string
  publicKeyLabel: string
  scriptNotes: string
  openingLine: string
  persona: string
  difficulty: ScenarioDefinition['difficulty']
  lastEditedAt: string
}

const ARCHIVE_STORAGE_KEY = 'vapi-coaching-archive'
const AUTH_STORAGE_KEY = 'clinical-coach-auth'
const ADMIN_AUTH_STORAGE_KEY = 'clinical-coach-admin-auth'
const ADMIN_AGENT_STORAGE_KEY = 'clinical-coach-admin-agents'
const DEFAULT_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY ?? ''
const DEFAULT_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID ?? ''
const DEMO_ACCOUNT: DemoAccount = {
  email: 'learner@clinicalcoach.app',
  password: 'CoachDemo2026!',
  name: 'Demo Learner',
}
const ADMIN_ACCOUNT: DemoAccount = {
  email: 'admin@clinicalcoach.app',
  password: 'AdminConsole2026!',
  name: 'Admin Test User',
}

const SCENARIOS: ScenarioDefinition[] = [
  {
    slug: 'angry-family-member',
    title: 'Angry family member',
    strapline: 'Live preset scenario',
    summary: 'A distressed family member feels ignored and wants immediate answers. This is the current live simulation in the app.',
    learningGoals: [
      'Acknowledge emotion before explaining or correcting',
      'Lower tension with collaborative language',
      'End with a clear next-step summary',
    ],
    difficulty: 'Intermediate',
    openingLine: 'I have been standing here for twenty minutes and nobody is telling me what is happening with my father.',
    persona: 'Escalated bedside conversation',
    availability: 'live',
  },
  {
    slug: 'unexpected-diagnosis-anxiety',
    title: 'Unexpected diagnosis anxiety',
    strapline: 'Placeholder voice agent page',
    summary: 'A patient has just heard unsettling news and keeps cycling between fear, questions, and long pauses.',
    learningGoals: [
      'Check what the patient already understands',
      'Use short, digestible explanations',
      'Name the emotion before offering more detail',
    ],
    difficulty: 'Intermediate',
    openingLine: 'Wait, are you telling me this could actually be cancer? I do not even know what to ask right now.',
    persona: 'High-emotion disclosure conversation',
    availability: 'placeholder',
  },
  {
    slug: 'discharge-plan-confusion',
    title: 'Discharge plan confusion',
    strapline: 'Placeholder voice agent page',
    summary: 'A patient is overwhelmed by medications, follow-up instructions, and what happens next after leaving the hospital.',
    learningGoals: [
      'Translate instructions into plain language',
      'Use teach-back to check understanding',
      'Clarify the next action before ending the conversation',
    ],
    difficulty: 'Beginner',
    openingLine: 'I am sorry, I know you explained it, but I still do not understand which pills I am supposed to take tonight.',
    persona: 'Care-transition communication',
    availability: 'placeholder',
  },
  {
    slug: 'end-of-life-family-meeting',
    title: 'End-of-life family meeting',
    strapline: 'Placeholder voice agent page',
    summary: 'A family needs a serious update and the conversation requires warmth, clarity, and enough space for grief.',
    learningGoals: [
      'Set up the conversation with sensitivity and structure',
      'Deliver serious news without rushing',
      'Pause and respond to emotion before moving forward',
    ],
    difficulty: 'Advanced',
    openingLine: 'Please just tell me honestly — is my mother dying, and how much time are we really talking about?',
    persona: 'Family meeting under stress',
    availability: 'placeholder',
  },
  {
    slug: 'clinic-scheduling-breakdown',
    title: 'Clinic scheduling breakdown',
    strapline: 'Placeholder voice agent page',
    summary: 'A caller is frustrated about delays, mixed messages, and an appointment that seems to have fallen through the cracks.',
    learningGoals: [
      'Open with ownership instead of defensiveness',
      'Separate apology from excuse-making',
      'Offer a concrete recovery plan',
    ],
    difficulty: 'Beginner',
    openingLine: 'I took time off work for this appointment and now you are telling me nobody even put me on the schedule?',
    persona: 'Operational frustration scenario',
    availability: 'placeholder',
  },
  {
    slug: 'pain-management-mistrust',
    title: 'Pain management mistrust',
    strapline: 'Placeholder voice agent page',
    summary: 'A patient believes their pain is being underestimated and arrives ready for a fight before the conversation even starts.',
    learningGoals: [
      'Reflect the patient’s frustration without sounding defensive',
      'Separate validation from immediate agreement',
      'Explain options and limits clearly and respectfully',
    ],
    difficulty: 'Advanced',
    openingLine: 'Every single person here acts like I am exaggerating. You are not listening to how much this hurts.',
    persona: 'Trust-repair under distress',
    availability: 'placeholder',
  },
  {
    slug: 'informed-consent-hesitation',
    title: 'Informed consent hesitation',
    strapline: 'Placeholder voice agent page',
    summary: 'A patient is hesitant about a recommended procedure and wants reassurance without feeling pressured into saying yes.',
    learningGoals: [
      'Elicit the real concern behind hesitation',
      'Balance benefits, risks, and uncertainty plainly',
      'Support patient choice without coercive language',
    ],
    difficulty: 'Intermediate',
    openingLine: 'I hear what you are saying, but I am not comfortable signing this until I understand exactly what could go wrong.',
    persona: 'Shared decision-making conversation',
    availability: 'placeholder',
  },
]

const EMPTY_ENTRY_FEEDBACK: EntryFeedbackGroup = {
  positive: [],
  negative: [],
}

const getScenarioRoute = (slug: string): ScenarioRoute => `/agents/${slug}`

const getStoredArchive = (): ArchivedSession[] => {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(ARCHIVE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ArchivedSession[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const getStoredUser = () => {
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(AUTH_STORAGE_KEY)
}

const getStoredAdmin = () => {
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY)
}

const createDefaultAdminAgents = (): AdminAgentRecord[] =>
  SCENARIOS.map((scenario, index) => ({
    slug: scenario.slug,
    title: scenario.title,
    status: scenario.availability === 'live' ? 'Live' : index % 2 === 0 ? 'Pilot' : 'Draft',
    assistantId: scenario.slug === 'angry-family-member' ? DEFAULT_ASSISTANT_ID || 'preset-live-assistant' : `mock-${scenario.slug}`,
    publicKeyLabel: scenario.slug === 'angry-family-member' ? (DEFAULT_PUBLIC_KEY ? 'Connected env key' : 'Env key missing') : 'Shared coaching workspace',
    scriptNotes: `Goal: ${scenario.learningGoals[0]}. Preserve a ${scenario.persona.toLowerCase()} tone and keep the opening beat clinically believable.`,
    openingLine: scenario.openingLine,
    persona: scenario.persona,
    difficulty: scenario.difficulty,
    lastEditedAt: new Date(Date.now() - index * 36e5).toISOString(),
  }))

const getStoredAdminAgents = (): AdminAgentRecord[] => {
  if (typeof window === 'undefined') return createDefaultAdminAgents()

  try {
    const raw = window.localStorage.getItem(ADMIN_AGENT_STORAGE_KEY)
    if (!raw) return createDefaultAdminAgents()
    const parsed = JSON.parse(raw) as AdminAgentRecord[]
    return Array.isArray(parsed) && parsed.length ? parsed : createDefaultAdminAgents()
  } catch {
    return createDefaultAdminAgents()
  }
}

const getRouteFromPath = (pathname: string): AppRoute => {
  if (pathname.startsWith('/admin/sign-in')) return '/admin/sign-in'
  if (pathname.startsWith('/admin')) return '/admin'
  if (pathname.startsWith('/sign-in')) return '/sign-in'
  if (pathname.startsWith('/simulate')) return '/simulate'

  const matchingScenario = SCENARIOS.find((scenario) => pathname.startsWith(getScenarioRoute(scenario.slug)))
  if (matchingScenario) return getScenarioRoute(matchingScenario.slug)

  return '/'
}

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const normalizeRole = (role: unknown): TranscriptRole => {
  if (role === 'assistant' || role === 'user' || role === 'system') return role
  return 'system'
}

const statusCopy: Record<SessionStatus, string> = {
  idle: 'Ready',
  connecting: 'Connecting',
  active: 'Live',
  ended: 'Complete',
  error: 'Issue detected',
}

const resolveVapiConstructor = (moduleValue: unknown) => {
  const candidates = [
    (moduleValue as { default?: unknown } | undefined)?.default,
    (moduleValue as { default?: { default?: unknown } } | undefined)?.default?.default,
    moduleValue,
  ]

  return candidates.find((candidate) => typeof candidate === 'function') as
    | (new (apiToken: string) => Vapi)
    | undefined
}

const buildEntryFeedbackLookup = (insight: SessionInsight) => {
  const lookup: Record<string, EntryFeedbackGroup> = {}

  for (const item of insight.positive) {
    if (!lookup[item.entryId]) {
      lookup[item.entryId] = { positive: [], negative: [] }
    }
    lookup[item.entryId].positive.push(item)
  }

  for (const item of insight.negative) {
    if (!lookup[item.entryId]) {
      lookup[item.entryId] = { positive: [], negative: [] }
    }
    lookup[item.entryId].negative.push(item)
  }

  return lookup
}

const getSpeakerLabel = (role: TranscriptRole, learnerLabel: string | null) => {
  if (role === 'user') return learnerLabel ?? DEMO_ACCOUNT.name
  if (role === 'assistant') return 'Voice agent'
  return 'System'
}

const getAdminAgentCounts = (agents: AdminAgentRecord[]) => ({
  live: agents.filter((agent) => agent.status === 'Live').length,
  pilot: agents.filter((agent) => agent.status === 'Pilot').length,
  draft: agents.filter((agent) => agent.status === 'Draft').length,
})

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromPath(window.location.pathname))
  const [signedInUser, setSignedInUser] = useState<string | null>(() => getStoredUser())
  const [adminUser, setAdminUser] = useState<string | null>(() => getStoredAdmin())
  const [email, setEmail] = useState(DEMO_ACCOUNT.email)
  const [password, setPassword] = useState(DEMO_ACCOUNT.password)
  const [adminEmail, setAdminEmail] = useState(ADMIN_ACCOUNT.email)
  const [adminPassword, setAdminPassword] = useState(ADMIN_ACCOUNT.password)
  const [signInError, setSignInError] = useState('')
  const [adminSignInError, setAdminSignInError] = useState('')
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [partialCaptions, setPartialCaptions] = useState<{ user: string; assistant: string }>({ user: '', assistant: '' })
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [volumeLevel, setVolumeLevel] = useState(0)
  const [lastError, setLastError] = useState('')
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [archive, setArchive] = useState<ArchivedSession[]>(() => getStoredArchive())
  const [expandedArchiveId, setExpandedArchiveId] = useState<string | null>(null)
  const [adminAgents, setAdminAgents] = useState<AdminAgentRecord[]>(() => getStoredAdminAgents())
  const [selectedAdminSlug, setSelectedAdminSlug] = useState<string>(() => SCENARIOS[0].slug)
  const [adminNotice, setAdminNotice] = useState('')

  const vapiRef = useRef<Vapi | null>(null)
  const transcriptRef = useRef<TranscriptEntry[]>([])
  const insightRef = useRef<SessionInsight>(analyzeTranscript([]))
  const startedAtRef = useRef<string | null>(null)
  const sessionSecondsRef = useRef(0)
  const archiveFinalizedRef = useRef(false)

  const isSignedIn = Boolean(signedInUser)
  const isAdminSignedIn = Boolean(adminUser)
  const insight = useMemo(() => analyzeTranscript(transcript), [transcript])
  const totalFlags = insight.positive.length + insight.negative.length
  const selectedScenario = useMemo(
    () => SCENARIOS.find((scenario) => route === getScenarioRoute(scenario.slug)) ?? null,
    [route],
  )
  const adminCounts = useMemo(() => getAdminAgentCounts(adminAgents), [adminAgents])
  const selectedAdminAgent = useMemo(
    () => adminAgents.find((agent) => agent.slug === selectedAdminSlug) ?? adminAgents[0] ?? null,
    [adminAgents, selectedAdminSlug],
  )
  const averageMetrics = useMemo(() => {
    if (!archive.length) {
      return { empathy: 0, deEscalation: 0, clarity: 0, flags: 0 }
    }

    const totals = archive.reduce(
      (accumulator, session) => ({
        empathy: accumulator.empathy + session.insight.metrics.empathy,
        deEscalation: accumulator.deEscalation + session.insight.metrics.deEscalation,
        clarity: accumulator.clarity + session.insight.metrics.clarity,
        flags: accumulator.flags + session.insight.negative.length,
      }),
      { empathy: 0, deEscalation: 0, clarity: 0, flags: 0 },
    )

    return {
      empathy: Math.round(totals.empathy / archive.length),
      deEscalation: Math.round(totals.deEscalation / archive.length),
      clarity: Math.round(totals.clarity / archive.length),
      flags: Number((totals.flags / archive.length).toFixed(1)),
    }
  }, [archive])
  const latestSession = archive[0] ?? null

  const navigate = (nextRoute: AppRoute) => {
    window.history.pushState({}, '', nextRoute === '/' ? '/' : nextRoute)
    setRoute(nextRoute)
  }

  useEffect(() => {
    const handlePopState = () => setRoute(getRouteFromPath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (route === '/simulate' && !isSignedIn) {
      navigate('/sign-in')
    }
  }, [isSignedIn, route])

  useEffect(() => {
    if (route === '/admin' && !isAdminSignedIn) {
      navigate('/admin/sign-in')
    }
  }, [isAdminSignedIn, route])

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  useEffect(() => {
    insightRef.current = insight
  }, [insight])

  useEffect(() => {
    startedAtRef.current = startedAt
  }, [startedAt])

  useEffect(() => {
    sessionSecondsRef.current = sessionSeconds
  }, [sessionSeconds])

  useEffect(() => {
    window.localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archive))
  }, [archive])

  useEffect(() => {
    window.localStorage.setItem(ADMIN_AGENT_STORAGE_KEY, JSON.stringify(adminAgents))
  }, [adminAgents])

  useEffect(() => {
    if (status !== 'active' || !startedAt) return

    const interval = window.setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
      setSessionSeconds(elapsed)
    }, 1000)

    return () => window.clearInterval(interval)
  }, [status, startedAt])

  const appendTranscriptEntry = (role: TranscriptRole, text: string) => {
    if (!text) return

    setTranscript((current) => {
      const previous = current[current.length - 1]
      if (previous && previous.role === role && previous.text === text) return current

      return [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role,
          text,
          timestamp: new Date().toISOString(),
        },
      ]
    })
  }

  const finalizeArchive = () => {
    if (archiveFinalizedRef.current) return
    archiveFinalizedRef.current = true

    const endedAt = new Date().toISOString()
    const snapshot = transcriptRef.current
    if (!snapshot.length) return

    const archivedSession: ArchivedSession = {
      id: `session-${Date.now()}`,
      startedAt: startedAtRef.current ?? endedAt,
      endedAt,
      durationSeconds: sessionSecondsRef.current,
      transcript: snapshot,
      insight: insightRef.current,
    }

    setArchive((current) => [archivedSession, ...current].slice(0, 8))
    setExpandedArchiveId(archivedSession.id)
  }

  const handleVapiMessage = (message: any) => {
    const messageType = cleanText(message?.type)

    if (messageType === 'transcript' || messageType.startsWith('transcript[')) {
      const role = normalizeRole(message?.role)
      const text = cleanText(message?.transcript ?? message?.text ?? message?.message)
      const isFinal = message?.transcriptType === 'final' || messageType.includes('final')

      if (!text) return

      if (isFinal) {
        if (role === 'user' || role === 'assistant') {
          setPartialCaptions((current) => ({ ...current, [role]: '' }))
        }
        appendTranscriptEntry(role, text)
      } else if (role === 'user' || role === 'assistant') {
        setPartialCaptions((current) => ({ ...current, [role]: text }))
      }
      return
    }

    if (messageType === 'assistant.speechStarted') {
      const assistantText = cleanText(message?.text)
      if (assistantText) {
        setPartialCaptions((current) => ({ ...current, assistant: assistantText }))
      }
      return
    }

    if (messageType === 'status-update' && message?.status === 'ended') {
      setStatus('ended')
      finalizeArchive()
    }
  }

  const handleVapiError = (error: any) => {
    setLastError(cleanText(error?.message) || 'The voice session hit a snag.')
    setStatus('error')
  }

  const ensureVapiClient = async () => {
    if (vapiRef.current) return vapiRef.current
    if (!DEFAULT_PUBLIC_KEY) {
      throw new Error('The preset voice agent is not configured yet.')
    }

    const moduleValue = await import('@vapi-ai/web')
    const VapiConstructor = resolveVapiConstructor(moduleValue)

    if (!VapiConstructor) {
      throw new Error('The voice client failed to load correctly. Refresh and try again.')
    }

    const client = new VapiConstructor(DEFAULT_PUBLIC_KEY)
    client.on('call-start', () => {
      setStatus('active')
      setLastError('')
    })
    client.on('call-end', () => {
      setStatus('ended')
      setPartialCaptions({ user: '', assistant: '' })
      finalizeArchive()
    })
    client.on('volume-level', (level: number) => {
      setVolumeLevel(Math.max(0, Math.min(100, Math.round(level * 100))))
    })
    client.on('message', handleVapiMessage)
    client.on('error', handleVapiError)
    client.on('call-start-failed', handleVapiError)

    vapiRef.current = client
    return client
  }

  useEffect(() => {
    return () => {
      vapiRef.current?.removeAllListeners()
      vapiRef.current = null
    }
  }, [])

  const handleSignIn = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (email.trim().toLowerCase() !== DEMO_ACCOUNT.email || password !== DEMO_ACCOUNT.password) {
      setSignInError('Use the demo learner account shown on this page.')
      return
    }

    window.sessionStorage.setItem(AUTH_STORAGE_KEY, DEMO_ACCOUNT.name)
    setSignedInUser(DEMO_ACCOUNT.name)
    setSignInError('')
    navigate('/simulate')
  }

  const handleAdminSignIn = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (adminEmail.trim().toLowerCase() !== ADMIN_ACCOUNT.email || adminPassword !== ADMIN_ACCOUNT.password) {
      setAdminSignInError('Use the admin test account shown on this page.')
      return
    }

    window.sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, ADMIN_ACCOUNT.name)
    setAdminUser(ADMIN_ACCOUNT.name)
    setAdminSignInError('')
    navigate('/admin')
  }

  const handleSignOut = async () => {
    try {
      await vapiRef.current?.stop()
    } catch {
      // Ignore stop errors during sign-out.
    }

    window.sessionStorage.removeItem(AUTH_STORAGE_KEY)
    setSignedInUser(null)
    setStatus('idle')
    setTranscript([])
    setPartialCaptions({ user: '', assistant: '' })
    setSessionSeconds(0)
    setStartedAt(null)
    setLastError('')
    navigate('/')
  }

  const handleAdminSignOut = () => {
    window.sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY)
    setAdminUser(null)
    navigate('/')
  }

  const startSimulation = async () => {
    if (!DEFAULT_PUBLIC_KEY || !DEFAULT_ASSISTANT_ID) {
      setLastError('The preset voice agent is not configured yet.')
      setStatus('error')
      return
    }

    archiveFinalizedRef.current = false
    setStatus('connecting')
    setTranscript([])
    setPartialCaptions({ user: '', assistant: '' })
    setSessionSeconds(0)
    setVolumeLevel(0)
    setIsMuted(false)
    setLastError('')
    setStartedAt(new Date().toISOString())

    try {
      const client = await ensureVapiClient()
      await client.start(DEFAULT_ASSISTANT_ID, {
        variableValues: {
          learnerName: signedInUser ?? DEMO_ACCOUNT.name,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start the simulation.'
      setLastError(message)
      setStatus('error')
    }
  }

  const stopSimulation = async () => {
    try {
      await vapiRef.current?.stop()
      setStatus('ended')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to stop the session cleanly.'
      setLastError(message)
      setStatus('error')
    }
  }

  const toggleMute = () => {
    if (!vapiRef.current) return
    const nextValue = !isMuted
    vapiRef.current.setMuted(nextValue)
    setIsMuted(nextValue)
  }

  const jumpToFeedback = (item: FeedbackItem) => {
    document.getElementById(item.entryId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const toggleArchiveExpansion = (sessionId: string) => {
    setExpandedArchiveId((current) => (current === sessionId ? null : sessionId))
  }

  const updateAdminAgent = (slug: string, updates: Partial<AdminAgentRecord>) => {
    setAdminAgents((current) =>
      current.map((agent) =>
        agent.slug === slug
          ? {
              ...agent,
              ...updates,
              lastEditedAt: new Date().toISOString(),
            }
          : agent,
      ),
    )
  }

  const resetAdminAgents = () => {
    const defaults = createDefaultAdminAgents()
    setAdminAgents(defaults)
    setSelectedAdminSlug(defaults[0]?.slug ?? '')
    setAdminNotice('Reset the admin workspace to the seeded frontend defaults.')
  }

  const saveAdminNote = (message: string) => {
    setAdminNotice(message)
    window.setTimeout(() => {
      setAdminNotice((current) => (current === message ? '' : current))
    }, 2800)
  }

  const handleScriptNoteChange = (value: string) => {
    if (!selectedAdminAgent) return
    updateAdminAgent(selectedAdminAgent.slug, { scriptNotes: value })
  }

  const handleOpeningLineChange = (value: string) => {
    if (!selectedAdminAgent) return
    updateAdminAgent(selectedAdminAgent.slug, { openingLine: value })
  }

  const cycleAgentStatus = () => {
    if (!selectedAdminAgent) return
    const order: AdminAgentRecord['status'][] = ['Draft', 'Pilot', 'Live']
    const nextStatus = order[(order.indexOf(selectedAdminAgent.status) + 1) % order.length]
    updateAdminAgent(selectedAdminAgent.slug, { status: nextStatus })
    saveAdminNote(`${selectedAdminAgent.title} moved to ${nextStatus}.`)
  }

  const renderScenarioLibrary = (currentSlug?: string) => (
    <div className="scenario-grid">
      {SCENARIOS.filter((scenario) => scenario.slug !== currentSlug).map((scenario) => (
        <article key={scenario.slug} className="info-card scenario-card">
          <div className="scenario-header-row">
            <div>
              <span className={`scenario-status ${scenario.availability}`}>
                {scenario.availability === 'live' ? 'Live now' : 'Placeholder'}
              </span>
              <h2>{scenario.title}</h2>
            </div>
          </div>
          <p>{scenario.summary}</p>
          <div className="scenario-meta">
            <span>{scenario.persona}</span>
            <span>{scenario.difficulty}</span>
          </div>
          <div className="scenario-actions">
            <button className="button secondary" onClick={() => navigate(getScenarioRoute(scenario.slug))}>
              Open scenario page
            </button>
          </div>
        </article>
      ))}
    </div>
  )

  const renderLandingPage = () => (
    <section className="hero-page">
      <div className="hero-panel">
        <span className="eyebrow">Clinical communication training</span>
        <h1>Clinical Communication Trainer</h1>
        <p className="hero-copy">
          This app is for communications training. Learners sign in, open a preset voice simulation, review coaching feedback,
          and browse upcoming roleplay agents for additional scenarios.
        </p>
        <div className="hero-actions">
          <button className="button primary" onClick={() => navigate('/sign-in')}>
            Learner sign in
          </button>
          <button className="button secondary" onClick={() => navigate('/admin/sign-in')}>
            Admin console
          </button>
          {isSignedIn ? (
            <button className="button ghost" onClick={() => navigate('/simulate')}>
              Go to simulation
            </button>
          ) : null}
        </div>
      </div>

      <div className="card-grid compact">
        <article className="info-card">
          <h2>What learners do</h2>
          <p>Run a voice scenario, speak naturally, then review the transcript and flagged feedback.</p>
        </article>
        <article className="info-card">
          <h2>What admins do</h2>
          <p>Monitor scenario readiness, inspect the Vapi connection state, and make minor script changes without pretending it is a full CMS.</p>
        </article>
        <article className="info-card">
          <h2>What is next</h2>
          <p>Separate admin and learner entry points now make the app feel like a product instead of a brave little demo stitched together with hope.</p>
        </article>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">Scenario library</span>
            <h2>Voice agents and placeholder pages</h2>
          </div>
        </div>
        {renderScenarioLibrary()}
      </div>
    </section>
  )

  const renderSignInPage = () => (
    <section className="auth-page">
      <div className="auth-panel">
        <span className="eyebrow">Learner sign in</span>
        <h1>Training access</h1>
        <p className="hero-copy">Use the demo learner account below to access the preset simulation.</p>

        <div className="demo-account">
          <div>
            <span>Test account</span>
            <strong>{DEMO_ACCOUNT.email}</strong>
          </div>
          <div>
            <span>Password</span>
            <strong>{DEMO_ACCOUNT.password}</strong>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSignIn}>
          <label>
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>

          {signInError ? <div className="alert error">{signInError}</div> : null}

          <div className="hero-actions auth-actions">
            <button className="button primary" type="submit">
              Continue to simulation
            </button>
            <button className="button secondary" type="button" onClick={() => navigate('/')}>
              Back
            </button>
          </div>
        </form>
      </div>
    </section>
  )

  const renderAdminSignInPage = () => (
    <section className="auth-page">
      <div className="auth-panel">
        <span className="eyebrow">Admin sign in</span>
        <h1>Voice agent control room</h1>
        <p className="hero-copy">Use the frontend-only admin test account to manage agent metadata, script notes, and dashboard visibility.</p>

        <div className="demo-account">
          <div>
            <span>Admin account</span>
            <strong>{ADMIN_ACCOUNT.email}</strong>
          </div>
          <div>
            <span>Password</span>
            <strong>{ADMIN_ACCOUNT.password}</strong>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleAdminSignIn}>
          <label>
            <span>Email</span>
            <input value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} autoComplete="username" />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>

          {adminSignInError ? <div className="alert error">{adminSignInError}</div> : null}

          <div className="hero-actions auth-actions">
            <button className="button primary" type="submit">
              Open admin console
            </button>
            <button className="button secondary" type="button" onClick={() => navigate('/')}>
              Back
            </button>
          </div>
        </form>
      </div>
    </section>
  )

  const renderSimulationPage = () => (
    <section className="simulation-page">
      <div className="simulation-header panel">
        <div>
          <span className="eyebrow">Simulation</span>
          <h1>Preset voice session</h1>
          <p className="hero-copy">
            Signed in as {signedInUser}. The voice agent is preset for this training session, so there is nothing for the learner to configure.
          </p>
        </div>
        <div className="simulation-actions">
          <div className={`status-pill status-${status}`}>{statusCopy[status]}</div>
          <button className="button secondary" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="card-grid compact summary-grid">
        <article className="info-card">
          <span className="mini-stat">Preset agent</span>
          <strong>Connected in-app</strong>
        </article>
        <article className="info-card">
          <span className="mini-stat">Session timer</span>
          <strong>{formatDuration(sessionSeconds)}</strong>
        </article>
        <article className="info-card">
          <span className="mini-stat">Flags raised</span>
          <strong>{totalFlags}</strong>
        </article>
      </div>

      <div className="workspace">
        <div className="panel control-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">Session controls</span>
              <h2>Run the scenario</h2>
            </div>
          </div>

          <div className="runtime-strip">
            <div>
              <span className="runtime-label">Voice activity</span>
              <div className="meter">
                <div className="meter-fill" style={{ width: `${volumeLevel}%` }} />
              </div>
            </div>
            <div>
              <span className="runtime-label">Agent access</span>
              <strong>{DEFAULT_PUBLIC_KEY && DEFAULT_ASSISTANT_ID ? 'Preset and ready' : 'Needs configuration'}</strong>
            </div>
          </div>

          <div className="button-row">
            <button className="button primary" onClick={startSimulation} disabled={status === 'connecting' || status === 'active'}>
              {status === 'connecting' ? 'Connecting…' : 'Start simulation'}
            </button>
            <button className="button secondary" onClick={stopSimulation} disabled={status !== 'active' && status !== 'connecting'}>
              End simulation
            </button>
            <button className="button ghost" onClick={toggleMute} disabled={status !== 'active'}>
              {isMuted ? 'Unmute learner mic' : 'Mute learner mic'}
            </button>
          </div>

          {lastError ? <div className="alert error">{lastError}</div> : null}
          <div className="alert muted">Learners use the preset voice agent. Vapi credentials are not shown in the UI.</div>

          <div className="panel transcript-panel nested-panel">
            <div className="panel-header compact">
              <div>
                <span className="section-kicker">Transcript</span>
                <h3>Live conversation</h3>
              </div>
              {startedAt ? <span className="transcript-meta">Started {formatTimestamp(startedAt)}</span> : null}
            </div>

            {!transcript.length && !partialCaptions.user && !partialCaptions.assistant ? (
              <div className="empty-state">Start the simulation to populate the transcript.</div>
            ) : null}

            <div className="transcript-list">
              {transcript.map((entry) => (
                <article key={entry.id} id={entry.id} className={`transcript-entry role-${entry.role}`}>
                  <div className="transcript-role">{getSpeakerLabel(entry.role, signedInUser)}</div>
                  <p>{entry.text}</p>
                  <span className="transcript-time">{formatTimestamp(entry.timestamp)}</span>
                </article>
              ))}

              {partialCaptions.user ? (
                <article className="transcript-entry role-user partial">
                  <div className="transcript-role">{signedInUser} · live</div>
                  <p>{partialCaptions.user}</p>
                </article>
              ) : null}

              {partialCaptions.assistant ? (
                <article className="transcript-entry role-assistant partial">
                  <div className="transcript-role">Voice agent · live</div>
                  <p>{partialCaptions.assistant}</p>
                </article>
              ) : null}
            </div>
          </div>
        </div>

        <div className="panel feedback-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">Coaching review</span>
              <h2>Immediate feedback</h2>
            </div>
          </div>

          <div className="score-grid">
            {[
              { label: 'Empathy', value: insight.metrics.empathy },
              { label: 'De-escalation', value: insight.metrics.deEscalation },
              { label: 'Clarity', value: insight.metrics.clarity },
            ].map((metric) => (
              <article key={metric.label} className="score-card">
                <span className="score-label">{metric.label}</span>
                <strong>{metric.value}</strong>
                <span className="score-caption">{metricLabel(metric.value)}</span>
              </article>
            ))}
          </div>

          {insight.neverWords.length ? (
            <div className="alert warning">Escalating phrases were detected and should be reviewed before the next attempt.</div>
          ) : null}

          <div className="feedback-columns">
            <div>
              <div className="subsection-header positive">Positive feedback</div>
              <div className="feedback-list">
                {insight.positive.length ? (
                  insight.positive.map((item) => (
                    <article key={item.id} className="feedback-card positive">
                      <div className="feedback-title-row">
                        <h3>{item.title}</h3>
                        <button className="link-button" onClick={() => jumpToFeedback(item)}>
                          {item.reference}
                        </button>
                      </div>
                      <p>{item.detail}</p>
                      <blockquote>{item.evidence}</blockquote>
                    </article>
                  ))
                ) : (
                  <div className="empty-feedback">Positive feedback will appear here as the learner demonstrates effective communication.</div>
                )}
              </div>
            </div>

            <div>
              <div className="subsection-header negative">Needs attention</div>
              <div className="feedback-list">
                {insight.negative.length ? (
                  insight.negative.map((item) => (
                    <article key={item.id} className="feedback-card negative">
                      <div className="feedback-title-row">
                        <h3>{item.title}</h3>
                        <button className="link-button" onClick={() => jumpToFeedback(item)}>
                          {item.reference}
                        </button>
                      </div>
                      <p>{item.detail}</p>
                      <blockquote>{item.evidence}</blockquote>
                    </article>
                  ))
                ) : (
                  <div className="empty-feedback">Negative flags will appear here when the learner slips into escalatory or unclear phrasing.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel archive-panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">Saved locally</span>
            <h2>Recent sessions</h2>
          </div>
        </div>

        {archive.length ? (
          <div className="archive-grid">
            {archive.map((session) => {
              const isExpanded = expandedArchiveId === session.id
              const feedbackLookup = buildEntryFeedbackLookup(session.insight)

              return (
                <article key={session.id} className={`archive-card ${isExpanded ? 'expanded' : ''}`}>
                  <div className="archive-card-header">
                    <div>
                      <div className="archive-time">{formatTimestamp(session.startedAt)}</div>
                      <h3>{formatDuration(session.durationSeconds)} session</h3>
                    </div>
                    <button className="button secondary archive-toggle" onClick={() => toggleArchiveExpansion(session.id)}>
                      {isExpanded ? 'Hide transcript' : 'Expand transcript'}
                    </button>
                  </div>

                  <p>
                    {session.transcript.length} turns · {session.insight.positive.length} positive cues · {session.insight.negative.length} improvement flags
                  </p>
                  <div className="archive-tags">
                    <span>Empathy {session.insight.metrics.empathy}</span>
                    <span>De-escalation {session.insight.metrics.deEscalation}</span>
                    <span>Clarity {session.insight.metrics.clarity}</span>
                  </div>

                  {isExpanded ? (
                    <div className="archive-session-body">
                      <div className="alert muted archive-legend">
                        <strong>Transcript cues:</strong> warm gold chips mark positive moves, coral chips mark language that needs another look.
                      </div>

                      <div className="transcript-list archive-transcript-list">
                        {session.transcript.map((entry) => {
                          const entryFeedback = feedbackLookup[entry.id] ?? EMPTY_ENTRY_FEEDBACK
                          const cueClass = entryFeedback.negative.length
                            ? 'has-negative'
                            : entryFeedback.positive.length
                              ? 'has-positive'
                              : ''

                          return (
                            <article key={entry.id} className={`transcript-entry role-${entry.role} ${cueClass}`}>
                              <div className="transcript-role-row">
                                <div className="transcript-role">{getSpeakerLabel(entry.role, signedInUser)}</div>
                                <span className="transcript-time">{formatTimestamp(entry.timestamp)}</span>
                              </div>
                              <p>{entry.text}</p>

                              {entryFeedback.positive.length || entryFeedback.negative.length ? (
                                <div className="transcript-cues">
                                  {entryFeedback.positive.map((item) => (
                                    <span key={item.id} className="transcript-cue positive" title={item.detail}>
                                      ✓ {item.title}
                                    </span>
                                  ))}
                                  {entryFeedback.negative.map((item) => (
                                    <span key={item.id} className="transcript-cue negative" title={item.detail}>
                                      ⚠ {item.title}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </article>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="empty-state">Completed simulations will be archived in this browser for quick debriefing.</div>
        )}
      </div>
    </section>
  )

  const renderAdminPage = () => (
    <section className="simulation-page admin-page">
      <div className="simulation-header panel admin-hero">
        <div>
          <span className="eyebrow">Administrator</span>
          <h1>Voice agent admin console</h1>
          <p className="hero-copy">
            Signed in as {adminUser}. This frontend-only workspace lets you manage agent metadata, minor script edits, and a quick learner dashboard overview without pretending the backend exists when it doesn’t.
          </p>
        </div>
        <div className="simulation-actions">
          <div className="status-pill status-active">Frontend preview</div>
          <button className="button secondary" onClick={handleAdminSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <div className="card-grid compact summary-grid">
        <article className="info-card">
          <span className="mini-stat">Agents live</span>
          <strong>{adminCounts.live}</strong>
        </article>
        <article className="info-card">
          <span className="mini-stat">Pilots / drafts</span>
          <strong>
            {adminCounts.pilot} / {adminCounts.draft}
          </strong>
        </article>
        <article className="info-card">
          <span className="mini-stat">Learner sessions</span>
          <strong>{archive.length}</strong>
        </article>
      </div>

      <div className="workspace admin-workspace">
        <div className="panel admin-agent-list-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">Voice agents</span>
              <h2>Manage scenarios</h2>
            </div>
            <button className="button ghost" onClick={resetAdminAgents}>
              Reset defaults
            </button>
          </div>

          <div className="admin-agent-list">
            {adminAgents.map((agent) => (
              <button
                key={agent.slug}
                className={`admin-agent-row ${selectedAdminAgent?.slug === agent.slug ? 'selected' : ''}`}
                onClick={() => setSelectedAdminSlug(agent.slug)}
              >
                <div>
                  <strong>{agent.title}</strong>
                  <span>{agent.persona}</span>
                </div>
                <span className={`scenario-status admin-status ${agent.status.toLowerCase()}`}>{agent.status}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel admin-editor-panel">
          {selectedAdminAgent ? (
            <>
              <div className="panel-header">
                <div>
                  <span className="section-kicker">Agent editor</span>
                  <h2>{selectedAdminAgent.title}</h2>
                </div>
                <div className="scenario-actions">
                  <button className="button secondary" onClick={cycleAgentStatus}>
                    Cycle status
                  </button>
                  <button className="button primary" onClick={() => saveAdminNote(`Saved ${selectedAdminAgent.title} in local browser storage.`)}>
                    Save changes
                  </button>
                </div>
              </div>

              <div className="admin-section-grid">
                <article className="info-card admin-kpi-card">
                  <span className="mini-stat">Assistant mapping</span>
                  <strong>{selectedAdminAgent.assistantId}</strong>
                  <p>{selectedAdminAgent.status === 'Live' ? 'Ready for the production-style preset flow.' : 'Staged for testing before promotion.'}</p>
                </article>
                <article className="info-card admin-kpi-card">
                  <span className="mini-stat">Public key status</span>
                  <strong>{selectedAdminAgent.publicKeyLabel}</strong>
                  <p>{DEFAULT_PUBLIC_KEY ? 'Environment key detected in the app runtime.' : 'No env key detected in this build, so live calling stays theoretical.'}</p>
                </article>
              </div>

              <div className="admin-form-grid">
                <label>
                  <span>Opening line</span>
                  <textarea value={selectedAdminAgent.openingLine} onChange={(event) => handleOpeningLineChange(event.target.value)} rows={4} />
                </label>
                <label>
                  <span>Script notes</span>
                  <textarea value={selectedAdminAgent.scriptNotes} onChange={(event) => handleScriptNoteChange(event.target.value)} rows={8} />
                </label>
              </div>

              <div className="admin-detail-strip">
                <div className="archive-tags">
                  <span>{selectedAdminAgent.difficulty}</span>
                  <span>{selectedAdminAgent.persona}</span>
                  <span>Edited {formatTimestamp(selectedAdminAgent.lastEditedAt)}</span>
                </div>
                <div className="alert muted admin-helper-copy">
                  Minor edits save to local browser storage only. Nice for demos, terrible as a real audit trail — exactly the kind of thing an admin should distrust on principle.
                </div>
                {adminNotice ? <div className="alert">{adminNotice}</div> : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="panel admin-dashboard-panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">Learner dashboard</span>
            <h2>Overview of coaching activity</h2>
          </div>
        </div>

        <div className="score-grid admin-dashboard-grid">
          <article className="score-card">
            <span className="score-label">Average empathy</span>
            <strong>{averageMetrics.empathy}</strong>
            <span className="score-caption">{archive.length ? metricLabel(averageMetrics.empathy) : 'No sessions yet'}</span>
          </article>
          <article className="score-card">
            <span className="score-label">Average de-escalation</span>
            <strong>{averageMetrics.deEscalation}</strong>
            <span className="score-caption">{archive.length ? metricLabel(averageMetrics.deEscalation) : 'No sessions yet'}</span>
          </article>
          <article className="score-card">
            <span className="score-label">Average clarity</span>
            <strong>{averageMetrics.clarity}</strong>
            <span className="score-caption">{archive.length ? metricLabel(averageMetrics.clarity) : 'No sessions yet'}</span>
          </article>
        </div>

        <div className="admin-section-grid learner-overview-grid">
          <article className="info-card admin-kpi-card">
            <span className="mini-stat">Negative flags / session</span>
            <strong>{averageMetrics.flags}</strong>
            <p>Calculated from locally archived practice sessions in this browser.</p>
          </article>
          <article className="info-card admin-kpi-card">
            <span className="mini-stat">Latest session snapshot</span>
            <strong>{latestSession ? formatTimestamp(latestSession.startedAt) : 'Waiting for activity'}</strong>
            <p>
              {latestSession
                ? `${latestSession.insight.positive.length} positive cues and ${latestSession.insight.negative.length} coaching flags.`
                : 'Run a learner simulation and this panel stops looking so lonely.'}
            </p>
          </article>
        </div>
      </div>
    </section>
  )

  const renderScenarioPage = (scenario: ScenarioDefinition) => (
    <section className="simulation-page">
      <div className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Voice agent scenario</span>
            <h1>{scenario.title}</h1>
            <p className="hero-copy">{scenario.summary}</p>
          </div>
          <span className={`scenario-status ${scenario.availability}`}>
            {scenario.availability === 'live' ? 'Live now' : 'Placeholder page'}
          </span>
        </div>

        <div className="card-grid compact summary-grid">
          <article className="info-card">
            <span className="mini-stat">Persona</span>
            <strong>{scenario.persona}</strong>
          </article>
          <article className="info-card">
            <span className="mini-stat">Difficulty</span>
            <strong>{scenario.difficulty}</strong>
          </article>
          <article className="info-card">
            <span className="mini-stat">Status</span>
            <strong>{scenario.strapline}</strong>
          </article>
        </div>

        <div className="scenario-page-section-grid">
          <article className="info-card scenario-detail-card">
            <span className="mini-stat">Short scenario brief</span>
            <p>{scenario.summary}</p>
          </article>
          <article className="info-card scenario-detail-card">
            <span className="mini-stat">Sample opening line</span>
            <blockquote>{scenario.openingLine}</blockquote>
          </article>
        </div>

        <article className="info-card scenario-detail-card">
          <span className="mini-stat">Learning goals</span>
          <div className="learning-goals-list">
            {scenario.learningGoals.map((goal) => (
              <span key={goal} className="learning-goal-chip">
                {goal}
              </span>
            ))}
          </div>
        </article>

        {scenario.availability === 'placeholder' ? (
          <div className="alert muted">
            This page is intentionally a placeholder so future voice agents can each have their own destination instead of being stuffed into one generic room.
          </div>
        ) : null}

        <div className="hero-actions">
          {scenario.availability === 'live' ? (
            <button className="button primary" onClick={() => (isSignedIn ? navigate('/simulate') : navigate('/sign-in'))}>
              {isSignedIn ? 'Open live simulation' : 'Sign in for simulation'}
            </button>
          ) : (
            <button className="button secondary" onClick={() => navigate('/sign-in')}>
              Sign in for future access
            </button>
          )}
          <button className="button secondary" onClick={() => navigate('/admin/sign-in')}>
            Open admin console
          </button>
          <button className="button ghost" onClick={() => navigate('/')}>
            Back to home
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">More scenarios</span>
            <h2>Other roleplay pages</h2>
          </div>
        </div>
        {renderScenarioLibrary(scenario.slug)}
      </div>
    </section>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')}>
          Clinical Communication Trainer
        </button>
        <nav className="topbar-actions">
          <button className="nav-link" onClick={() => navigate('/')}>
            Home
          </button>
          <button className="nav-link" onClick={() => navigate(getScenarioRoute(SCENARIOS[0].slug))}>
            Scenarios
          </button>
          <button className="nav-link" onClick={() => navigate('/sign-in')}>
            Learner sign in
          </button>
          <button className="nav-link" onClick={() => navigate('/admin/sign-in')}>
            Admin
          </button>
          {isSignedIn ? (
            <button className="nav-link strong" onClick={() => navigate('/simulate')}>
              Simulation
            </button>
          ) : null}
          {isAdminSignedIn ? (
            <button className="nav-link strong" onClick={() => navigate('/admin')}>
              Console
            </button>
          ) : null}
        </nav>
      </header>

      {route === '/' ? renderLandingPage() : null}
      {route === '/sign-in' ? renderSignInPage() : null}
      {route === '/admin/sign-in' ? renderAdminSignInPage() : null}
      {route === '/simulate' && isSignedIn ? renderSimulationPage() : null}
      {route === '/admin' && isAdminSignedIn ? renderAdminPage() : null}
      {selectedScenario ? renderScenarioPage(selectedScenario) : null}
    </div>
  )
}

export default App
