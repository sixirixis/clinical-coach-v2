import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import angryRelativeScene from './assets/angry-relative-scene.svg'
import minorMishapScene from './assets/minor-mishap-scene.svg'
import schedulingChangeScene from './assets/scheduling-change-scene.svg'
import { analyzeTranscript, formatTimestamp, metricLabel, type FeedbackItem, type SessionInsight, type TranscriptEntry } from './lib/feedback'
import { isSupabaseConfigured, getScenarioConfigs, type ScenarioConfig } from './lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

type SessionStatus = 'idle' | 'connecting' | 'active' | 'ended' | 'error'

type ArchivedSession = {
  id: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  transcript: TranscriptEntry[]
  insight: SessionInsight
}

type CallLog = {
  id: string
  scenario_slug: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  status: string
  positive: number
  negative: number
}

type UserRole = 'learner' | 'admin'

// ─── Env / Config ─────────────────────────────────────────────────────────────

const VAPI_PUBLIC_KEY    = import.meta.env.VITE_VAPI_PUBLIC_KEY    ?? ''
const VAPI_ASSISTANT_ID  = import.meta.env.VITE_VAPI_ASSISTANT_ID  ?? ''
const DEMO_EMAIL         = 'learner@clinicalcoach.app'
const DEMO_PASS          = 'CoachDemo2026!'
const ADMIN_EMAIL        = 'admin@clinicalcoach.app'
const ADMIN_PASS         = 'AdminConsole2026!'


// ─── Local storage keys ───────────────────────────────────────────────────────

const SESS_KEY  = 'cc2-sessions'
const AUTH_KEY  = 'cc2-auth'
const ADMIN_KEY = 'cc2-admin'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDur = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`

const clean = (v: unknown) => typeof v === 'string' ? v.trim() : ''

const SCENARIO_IMAGE_URLS: Record<string, string> = {
  'angry-relative': angryRelativeScene,
  'minor-medical-mishap': minorMishapScene,
  'scheduling-change': schedulingChangeScene,
}

const resolveVapiConstructor = (m: unknown) => {
  const candidates = [
    (m as { default?: unknown } | undefined)?.default,
    (m as { default?: { default?: unknown } } | undefined)?.default?.default,
    m,
  ]
  return candidates.find((candidate) => typeof candidate === 'function') as (new (k: string) => any) | undefined
}

const speakerLabel = (role: TranscriptEntry['role'], name: string | null) =>
  role === 'user' ? name ?? DEMO_EMAIL : role === 'assistant' ? 'Voice agent' : 'System'

// ─── Scenario definitions ─────────────────────────────────────────────────────

export type Scenario = {
  slug:        string
  title:       string
  summary:     string
  focus:       string
  difficulty:  'Beginner' | 'Intermediate' | 'Advanced'
  openingLine: string
  imageKey:    string
  learningGoals: string[]
  status:      'live' | 'pilot' | 'draft'
  persona:     string
  colorTheme:  'coral' | 'teal' | 'amber'
}

export const SCENARIOS: Scenario[] = [
  {
    slug: 'angry-relative',
    title: 'Angry patient or relative',
    summary: 'A distressed relative has been waiting for answers and is on the edge of escalation. The challenge is to validate their emotion, lower the heat, and close with a clear next step.',
    focus: 'De-escalation · Emotional validation · Actionable close',
    difficulty: 'Intermediate',
    openingLine: 'I have asked three times already. Why is nobody giving me a straight answer about what is happening?',
    imageKey: 'angry-relative',
    learningGoals: [
      'Name the emotion before jumping to explanation',
      'Avoid defensive language and blame-shifting',
      'Offer a concrete, named next step before ending',
    ],
    status: 'live',
    persona: 'Elevated emotional state — needs validation first',
    colorTheme: 'coral',
  },
  {
    slug: 'minor-medical-mishap',
    title: 'Minor medical mishap disclosure',
    summary: 'A small but real error was made during care today. The patient deserves a plain, honest disclosure — owning what happened, apologising cleanly, and explaining what is being done about it.',
    focus: 'Plain disclosure · Ownership · Trust repair',
    difficulty: 'Intermediate',
    openingLine: 'Before we go further, I want to explain something that happened during your care today and what we are doing about it.',
    imageKey: 'minor-medical-mishap',
    learningGoals: [
      'Begin with the disclosure — do not soften before the facts',
      'Own the issue without qualification or deflection',
      'Explain the remediation alongside the apology',
    ],
    status: 'pilot',
    persona: 'High-stakes honesty situation — no spin allowed',
    colorTheme: 'teal',
  },
  {
    slug: 'scheduling-change',
    title: 'Unforeseen scheduling change',
    summary: 'A patient took time off work and is now being told their appointment has been cancelled or moved with no explanation. They deserve a clear apology, an honest reason, and a genuine recovery plan.',
    focus: 'Early apology · Avoiding excuse-stacking · Recovery options',
    difficulty: 'Beginner',
    openingLine: 'I am sorry, but I need to let you know about an unexpected change to today\u2019s schedule and help you with the next step.',
    imageKey: 'scheduling-change',
    learningGoals: [
      'Apologise without immediately following with a justification',
      'Name the concrete impact before moving to resolution',
      'Offer a specific, achievable recovery option',
    ],
    status: 'pilot',
    persona: 'Operational frustration — acknowledgement before explanation',
    colorTheme: 'amber',
  },
]

// ─── Route types ───────────────────────────────────────────────────────────────

type Route =
  | 'landing'
  | 'gallery'
  | 'scenario'
  | 'simulation'
  | 'sign-in'
  | 'admin-sign-in'
  | 'admin'
  | 'archive'

function getRoute(pathname: string, scenarioSlug?: string | null): Route {
  if (pathname === '/' || pathname === '')    return 'landing'
  if (pathname.startsWith('/admin/sign-in'))  return 'admin-sign-in'
  if (pathname.startsWith('/admin'))          return 'admin'
  if (pathname.startsWith('/sign-in'))        return 'sign-in'
  if (pathname.startsWith('/gallery'))        return 'gallery'
  if (pathname.startsWith('/scenario/') && pathname.endsWith('/simulation')) return 'simulation'
  if (pathname.startsWith('/archive'))        return 'archive'
  if (scenarioSlug)                           return 'scenario'
  return 'landing'
}

// ─── App Component ─────────────────────────────────────────────────────────────

type SupabaseUser = { id: string; email: string; role: UserRole; full_name: string }

function App() {

  // Routing
  const [route, setRoute] = useState<Route>(() => {
    const path = window.location.pathname
    const match = SCENARIOS.find(s => path.startsWith(`/scenario/${s.slug}`))
    return getRoute(path, match?.slug)
  })
  const [activeScenario, setActiveScenario] = useState<string | null>(() => {
    const path = window.location.pathname
    const match = SCENARIOS.find(s => path.startsWith(`/scenario/${s.slug}`))
    return match?.slug ?? null
  })

  // Auth
  const [user, setUser] = useState<SupabaseUser | null>(() => {
    try { const s = sessionStorage.getItem(AUTH_KEY); return s ? JSON.parse(s) : null } catch { return null }
  })
  const [admin, setAdmin] = useState<SupabaseUser | null>(() => {
    try { const s = sessionStorage.getItem(ADMIN_KEY); return s ? JSON.parse(s) : null } catch { return null }
  })

  // Sign-in form
  const [email, setEmail]   = useState(DEMO_EMAIL)
  const [password, setPass] = useState(DEMO_PASS)
  const [signErr, setSignErr] = useState('')

  // Admin form
  const [adminEmail, setAdminEmail]   = useState(ADMIN_EMAIL)
  const [adminPass, setAdminPass]     = useState(ADMIN_PASS)
  const [adminErr, setAdminErr]       = useState('')

  // Session
  const [status, setStatus]           = useState<SessionStatus>('idle')
  const [transcript, setTranscript]   = useState<TranscriptEntry[]>([])
  const [partial, setPartial]         = useState({ user: '', assistant: '' })
  const [seconds, setSeconds]         = useState(0)
  const [muted, setMuted]             = useState(false)
  const [volLevel, setVolLevel]       = useState(0)
  const [errMsg, setErrMsg]           = useState('')
  const [startedAt, setStartedAt]     = useState<string | null>(null)

  // Archive
  const [archive, setArchive] = useState<ArchivedSession[]>(() => {
    try { const s = localStorage.getItem(SESS_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Admin call log (mocked for now — replaces localStorage)
  const [callLog, setCallLog] = useState<CallLog[]>([])
  const [adminTab, setAdminTab] = useState<'overview' | 'scenarios' | 'calls'>('overview')
  const [scenarioConfigs, setScenarioConfigs] = useState<ScenarioConfig[]>([])

  // Vapi refs
  const vapiRef         = useRef<any>(null)
  const transcriptRef   = useRef<TranscriptEntry[]>([])
  const insightRef      = useRef<SessionInsight>(analyzeTranscript([]))
  const startedAtRef    = useRef<string | null>(null)
  const sessionSecRef   = useRef(0)
  const archiveFinalRef = useRef(false)

  // Derived
  const insight   = useMemo(() => analyzeTranscript(transcript), [transcript])
  const isSignedIn   = Boolean(user)
  const isAdminSignedIn = Boolean(admin)

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const navigate = (path: string) => {
    window.history.pushState({}, '', path)
    const match = SCENARIOS.find(s => path.startsWith(`/scenario/${s.slug}`))
    setRoute(getRoute(path, match?.slug))
    if (match) setActiveScenario(match.slug)
  }

  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname
      const match = SCENARIOS.find(s => path.startsWith(`/scenario/${s.slug}`))
      setRoute(getRoute(path, match?.slug))
      if (match) setActiveScenario(match.slug)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Auth guard
  useEffect(() => {
    if ((route === 'simulation' || route === 'gallery' || route === 'scenario') && !isSignedIn) navigate('/sign-in')
    if (route === 'admin' && !isAdminSignedIn) navigate('/admin/sign-in')
  }, [isSignedIn, isAdminSignedIn, route])

  // Sync transcript to ref
  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  useEffect(() => { insightRef.current = insight }, [insight])
  useEffect(() => { startedAtRef.current = startedAt }, [startedAt])
  useEffect(() => { sessionSecRef.current = seconds }, [seconds])

  // Persist archive
  useEffect(() => { localStorage.setItem(SESS_KEY, JSON.stringify(archive)) }, [archive])

  // Load scenario configs from Supabase (or local fallback)
  useEffect(() => {
    if (!isAdminSignedIn) return
    if (isSupabaseConfigured) {
      getScenarioConfigs().then(c => setScenarioConfigs(c))
    } else {
      // Fallback: map SCENARIOS to configs
      setScenarioConfigs(SCENARIOS.map(s => ({
        slug: s.slug, title: s.title, status: s.status as any,
        assistant_id: '', opening_line: s.openingLine,
        script_notes: `Goal: ${s.learningGoals[0]}`, image_theme: s.colorTheme,
        updated_at: new Date().toISOString(),
      })))
    }
  }, [isAdminSignedIn])

  // Session timer
  useEffect(() => {
    if (status !== 'active' || !startedAt) return
    const id = setInterval(() => {
      const el = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      setSeconds(Math.max(0, el))
    }, 1000)
    return () => clearInterval(id)
  }, [status, startedAt])

  // Vapi client teardown
  useEffect(() => {
    return () => {
      vapiRef.current?.removeAllListeners()
      vapiRef.current = null
    }
  }, [])

  // ─── Transcript helpers ─────────────────────────────────────────────────────

  const appendEntry = (role: TranscriptEntry['role'], text: string) => {
    if (!text) return
    setTranscript(prev => {
      const last = prev[prev.length - 1]
      if (last?.role === role && last.text === text) return prev
      return [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, role, text, timestamp: new Date().toISOString() }]
    })
  }

  const finalizeArchive = () => {
    if (archiveFinalRef.current) return
    archiveFinalRef.current = true
    const snap = transcriptRef.current
    if (!snap.length) return
    const session: ArchivedSession = {
      id: `session-${Date.now()}`,
      startedAt: startedAtRef.current ?? new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: sessionSecRef.current,
      transcript: snap,
      insight: insightRef.current,
    }
    setArchive(prev => [session, ...prev].slice(0, 8))
    setExpandedId(session.id)
    // Also push to call log
    setCallLog(prev => [{
      id: session.id,
      scenario_slug: activeScenario ?? 'angry-relative',
      started_at: session.startedAt,
      ended_at: session.endedAt,
      duration_seconds: session.durationSeconds,
      status: 'completed',
      positive: insightRef.current.positive.length,
      negative: insightRef.current.negative.length,
    }, ...prev].slice(0, 50))
  }

  const handleMessage = (msg: any) => {
    const t = clean(msg?.type)
    if (t?.startsWith('transcript') || t?.includes('transcript')) {
      const role = (msg?.role === 'assistant' || msg?.role === 'user') ? msg.role : undefined
      const text = clean(msg?.transcript ?? msg?.text ?? msg?.message)
      const isFinal = msg?.transcriptType === 'final' || t.includes('final')
      if (!text || !role) return
      if (isFinal) {
        if (role === 'user' || role === 'assistant') setPartial(p => ({ ...p, [role]: '' }))
        appendEntry(role, text)
      } else {
        if (role === 'user' || role === 'assistant') setPartial(p => ({ ...p, [role]: text }))
      }
      return
    }
    if (t === 'assistant.speechStarted') {
      const text = clean(msg?.text)
      if (text) setPartial(p => ({ ...p, assistant: text }))
      return
    }
    if (t === 'status-update' && msg?.status === 'ended') {
      setStatus('ended')
      finalizeArchive()
    }
  }

  const handleError = (err: any) => {
    setErrMsg(clean(err?.message) || 'Session error.')
    setStatus('error')
  }

  const ensureVapi = async () => {
    if (vapiRef.current) return vapiRef.current
    if (!VAPI_PUBLIC_KEY) throw new Error('VAPI_PUBLIC_KEY not configured.')
    const mod = await import('@vapi-ai/web')
    const VapiCtor = resolveVapiConstructor(mod)
    if (!VapiCtor) throw new Error('Vapi client failed to load.')
    const client = new VapiCtor(VAPI_PUBLIC_KEY)
    client.on('call-start', () => { setStatus('active'); setErrMsg('') })
    client.on('call-end',   () => { setStatus('ended'); setPartial({ user:'', assistant:'' }); finalizeArchive() })
    client.on('volume-level', (l: number) => setVolLevel(Math.round(Math.max(0, Math.min(100, l * 100)))))
    client.on('message', handleMessage)
    client.on('error', handleError)
    client.on('call-start-failed', handleError)
    vapiRef.current = client
    return client
  }

  // ─── Auth handlers ──────────────────────────────────────────────────────────

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault()
    const role = email.trim().toLowerCase() === ADMIN_EMAIL ? 'admin' : 'learner'

    const ok = role === 'admin'
      ? (adminEmail.trim().toLowerCase() === ADMIN_EMAIL && adminPass === ADMIN_PASS)
      : (email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASS)

    if (!ok) {
      if (role === 'admin') setAdminErr('Use the admin test account shown on this page.')
      else setSignErr('Use the demo learner account shown on this page.')
      return
    }

    const u: SupabaseUser = {
      id: role === 'admin' ? 'admin-test-id' : 'learner-test-id',
      email: role === 'admin' ? ADMIN_EMAIL : DEMO_EMAIL,
      role: role as UserRole,
      full_name: role === 'admin' ? 'Admin Test User' : 'Demo Learner',
    }

    if (role === 'admin') {
      sessionStorage.setItem(ADMIN_KEY, JSON.stringify(u))
      setAdmin(u)
      setAdminErr('')
      navigate('/admin')
    } else {
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(u))
      setUser(u)
      setSignErr('')
      navigate('/gallery')
    }
  }

  const handleSignOut = async () => {
    try { await vapiRef.current?.stop() } catch { /* ignore */ }
    sessionStorage.removeItem(AUTH_KEY)
    setUser(null)
    setStatus('idle'); setTranscript([]); setPartial({ user:'', assistant:'' })
    setSeconds(0); setStartedAt(null); setErrMsg('')
    navigate('/')
  }

  const handleAdminSignOut = () => {
    sessionStorage.removeItem(ADMIN_KEY)
    setAdmin(null)
    navigate('/')
  }

  // ─── Simulation controls ────────────────────────────────────────────────────

  const startSim = async () => {
    if (!VAPI_PUBLIC_KEY || !VAPI_ASSISTANT_ID) { setErrMsg('Vapi credentials not configured.'); setStatus('error'); return }
    archiveFinalRef.current = false
    setStatus('connecting'); setTranscript([]); setPartial({ user:'', assistant:'' })
    setSeconds(0); setVolLevel(0); setMuted(false); setErrMsg('')
    setStartedAt(new Date().toISOString())
    try {
      const client = await ensureVapi()
      await client.start(VAPI_ASSISTANT_ID, { variableValues: { learnerName: user?.full_name ?? 'Learner' } })
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not start simulation.')
      setStatus('error')
    }
  }

  const stopSim = async () => {
    try { await vapiRef.current?.stop(); setStatus('ended') } catch { setStatus('error') }
  }

  const toggleMute = () => {
    if (!vapiRef.current) return
    const n = !muted
    vapiRef.current.setMuted(n)
    setMuted(n)
  }

  const jumpTo = (item: FeedbackItem) =>
    document.getElementById(item.entryId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const scenario = activeScenario ? SCENARIOS.find(s => s.slug === activeScenario) : null

  const statusLabel: Record<SessionStatus, string> = {
    idle: 'Ready', connecting: 'Connecting', active: 'Live', ended: 'Ended', error: 'Error'
  }

  const accentColor = scenario?.colorTheme === 'coral' ? '#F87171'
    : scenario?.colorTheme === 'teal'   ? '#14B8A6'
    : scenario?.colorTheme === 'amber'  ? '#F59E0B' : '#64748B'

  const diffColor = (d: string) =>
    d === 'Beginner' ? '#22c55e' : d === 'Intermediate' ? '#f59e0b' : '#ef4444'

  // ─── Pages ──────────────────────────────────────────────────────────────────

  const renderLanding = () => (
    <div className='landing-wrap'>
      <section className='landing-hero card'>
        <div className='landing-copy'>
          <span className='landing-kicker'>Communication skills simulation</span>
          <h1>Practice difficult clinical conversations before they happen in real life.</h1>
          <p>
            Clinical Coach is a communication training simulation app for healthcare teams. Learners sign in, choose a scenario,
            run a live voice simulation, and review transcript-based coaching feedback immediately afterwards.
          </p>
          <div className='landing-actions'>
            <button className='btn btn-navy' onClick={() => navigate('/sign-in')}>Learner sign in</button>
            <button className='btn btn-outline' onClick={() => navigate('/admin/sign-in')}>Admin sign in</button>
          </div>
        </div>
        <div className='landing-highlights'>
          <div className='landing-highlight'>
            <strong>3 focused scenarios</strong>
            <span>Angry relative, minor mishap disclosure, and unforeseen scheduling changes.</span>
          </div>
          <div className='landing-highlight'>
            <strong>Live voice practice</strong>
            <span>Phone-style HUD with live transcript overlay, mute, start, and end-call controls.</span>
          </div>
          <div className='landing-highlight'>
            <strong>Immediate coaching</strong>
            <span>Transcript scoring for empathy, de-escalation, and clarity after each call.</span>
          </div>
        </div>
      </section>
    </div>
  )

  const renderGallery = () => (
    <div className='gallery-wrap'>
      <div className='gallery-hero'>
        <p className='gallery-tagline'>Real conversations. Simulated practice. Measurable growth.</p>
        <h1>Scenario Gallery</h1>
        <p className='gallery-sub'>Choose a communication scenario below and run a live voice simulation with AI-powered coaching feedback.</p>
        <div className='gallery-hero-actions'>
          {isSignedIn
            ? <button className='btn btn-navy' onClick={() => navigate('/gallery')}>Open scenario gallery</button>
            : <button className='btn btn-navy' onClick={() => navigate('/sign-in')}>Sign in to continue</button>
          }
          <button className='btn btn-outline' onClick={() => navigate('/admin/sign-in')}>Admin access</button>
        </div>
      </div>

      <div className='gallery-grid'>
        {SCENARIOS.map(s => (
          <div key={s.slug} className='scenario-card card card-hover' onClick={() => navigate(`/scenario/${s.slug}`)}>
            <div className='scenario-img-wrap'>
              <img src={SCENARIO_IMAGE_URLS[s.imageKey]} alt={s.title} className='scenario-img' loading='lazy' />
              <div className='scenario-overlay'>
                <span className={`chip chip-${s.status === 'live' ? 'green' : s.status === 'pilot' ? 'amber' : 'slate'}`}>
                  {s.status === 'live' ? '● Live' : s.status === 'pilot' ? '◎ Pilot' : '○ Draft'}
                </span>
              </div>
            </div>
            <div className='scenario-body'>
              <div>
                <h2 className='scenario-title'>{s.title}</h2>
                <p className='scenario-summary'>{s.summary.slice(0, 120)}…</p>
              </div>
              <div className='scenario-tags'>
                <span className='chip chip-slate'>{s.difficulty}</span>
                <span className='chip chip-amber'>{s.focus.split(' · ')[0]}</span>
              </div>
              <div className='scenario-footer'>
                <span className='scenario-cta'>Open scenario →</span>
                <span className='scenario-goal-count'>{s.learningGoals.length} learning goals</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const renderScenarioPage = () => {
    if (!scenario) return null
    return (
      <div className='detail-wrap'>
        <div className='detail-hero'>
          <div className='detail-hero-text'>
            <div className='detail-chips'>
              <span className={`chip chip-${scenario.status === 'live' ? 'green' : 'amber'}`}>
                {scenario.status === 'live' ? '● Live' : '◎ Pilot'}
              </span>
              <span className='chip chip-slate'>{scenario.difficulty}</span>
              <span className='chip chip-navy'>{scenario.focus.split(' · ')[0]}</span>
            </div>
            <h1>{scenario.title}</h1>
            <p className='detail-summary'>{scenario.summary}</p>
            <div className='detail-persona'>
              <span className='detail-persona-label'>Persona</span>
              <span>{scenario.persona}</span>
            </div>
            <div className='detail-hero-actions'>
              {scenario.status === 'live'
                ? isSignedIn
                  ? <button className='btn btn-navy' onClick={() => navigate(`/scenario/${scenario.slug}/simulation`)}>Start simulation →</button>
                  : <button className='btn btn-navy' onClick={() => navigate('/sign-in')}>Sign in → simulate</button>
                : <button className='btn btn-outline'>Coming soon — pilot stage</button>
              }
              <button className='btn btn-ghost' onClick={() => navigate('/')}>← Back to gallery</button>
            </div>
          </div>
          <div className='detail-hero-img'>
            <img src={SCENARIO_IMAGE_URLS[scenario.imageKey]} alt={scenario.title} />
          </div>
        </div>

        <div className='detail-body'>
          <div className='detail-main'>
            <div className='card detail-card'>
              <h4>Opening line</h4>
              <div className='opening-quote'>{scenario.openingLine}</div>
            </div>
            <div className='card detail-card'>
              <h4>Learning goals</h4>
              <div className='learning-points'>
                {scenario.learningGoals.map(g => (
                  <div key={g} className='learning-point'>
                    <div className='point-dot' style={{ background: accentColor }} />
                    <p>{g}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className='card detail-card'>
              <h4>Scenario brief</h4>
              <p>{scenario.summary}</p>
            </div>
          </div>

          <div className='detail-sidebar'>
            <div className='card detail-card detail-sticky'>
              <h4>Focus skills</h4>
              <div className='focus-tags'>
                {scenario.focus.split(' · ').map(f => <span key={f} className='chip chip-teal'>{f}</span>)}
              </div>
              <hr className='divider' />
              <h4>Recommended difficulty</h4>
              <span className='chip' style={{ background: diffColor(scenario.difficulty) + '22', color: diffColor(scenario.difficulty) }}>
                {scenario.difficulty}
              </span>
              <hr className='divider' />
              {scenario.status === 'live' && isSignedIn && (
                <button className='btn btn-teal' style={{ width: '100%' }} onClick={() => navigate(`/scenario/${scenario.slug}/simulation`)}>
                  ▶ Run simulation
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderSimulationPage = () => (
    <div className='sim-page'>
      <div className='sim-topbar'>
        <div>
          <h2>{scenario?.title ?? 'Simulation'} — {statusLabel[status]}</h2>
          {user && <p>Signed in as {user.full_name}</p>}
        </div>
        <div className='sim-topbar-actions'>
          <div className={`status-badge status-${status}`}>{statusLabel[status]}</div>
          <button className='btn btn-ghost' onClick={handleSignOut}>Sign out</button>
          <button className='btn btn-outline' onClick={() => navigate('/gallery')}>Gallery</button>
        </div>
      </div>

      <div className='sim-layout'>
        {/* Phone HUD */}
        <div className='phone-wrap'>
          <div className='phone-shell'>
            <div className='phone-notch' />
            <div className='phone-screen'>
              <div className='phone-avatar-wrap'>
                {status === 'active' ? (
                  <div className='pulse-ring' />
                ) : null}
                <div className='phone-avatar' style={{ background: accentColor }}>
                  {scenario?.title[0] ?? '?'}
                </div>
              </div>
              <div className='phone-name'>{scenario?.title ?? 'Voice Agent'}</div>
              <div className='phone-state'>
                {status === 'active' ? 'Connected · speaking' : status === 'connecting' ? 'Connecting…' : statusLabel[status]}
              </div>

              {/* Live caption */}
              <div className='phone-transcript'>
                {(partial.user || partial.assistant) ? (
                  <>
                    {partial.assistant ? (
                      <div className='t-line'>
                        <span className='t-label assistant'>Agent</span>
                        <span>{partial.assistant}</span>
                      </div>
                    ) : null}
                    {partial.user ? (
                      <div className='t-line'>
                        <span className='t-label user'>You</span>
                        <span>{partial.user}</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className='t-idle'>
                    {status === 'idle' ? 'Start the call to see the transcript here' : 'Connecting…'}
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className='phone-controls'>
                <button className='ctrl-btn' onClick={toggleMute} disabled={status !== 'active'}>
                  <div className={`ctrl-icon ${muted ? 'active' : 'default'}`}>
                    {muted ? '🔇' : '🎤'}
                  </div>
                  <span>{muted ? 'Unmute' : 'Mute'}</span>
                </button>
                <button className='ctrl-btn' onClick={status === 'idle' || status === 'error' || status === 'ended' ? startSim : undefined}
                  disabled={status === 'connecting' || status === 'active'}>
                  <div className={`ctrl-icon ${status === 'active' ? 'red' : 'green'}`}>
                    {status === 'active' ? '⬇' : '▶'}
                  </div>
                  <span>{status === 'active' ? 'End' : 'Call'}</span>
                </button>
                <button className='ctrl-btn' disabled>
                  <div className='ctrl-icon default' style={{ opacity: .5 }}>
                    {status === 'active' ? fmtDur(seconds) : '--:--'}
                  </div>
                  <span>Timer</span>
                </button>
              </div>

              {/* Volume meter */}
              {status === 'active' && (
                <div className='vol-meter'>
                  <div className='vol-fill' style={{ width: `${volLevel}%` }} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className='sim-panel-stack'>
          {/* Status / controls (desktop) */}
          <div className='card sim-card'>
            <div className='sim-controls-row'>
              <div className='sim-stat'>
                <span className='mini-stat'>Timer</span>
                <strong className='phone-timer'>{fmtDur(seconds)}</strong>
              </div>
              <div className='sim-stat'>
                <span className='mini-stat'>Vol</span>
                <div className='meter' style={{ width: 80 }}>
                  <div className='meter-fill' style={{ width: `${volLevel}%` }} />
                </div>
              </div>
              <div className='sim-stat'>
                <span className='mini-stat'>Flags</span>
                <strong>{insight.negative.length}</strong>
              </div>
            </div>

            {errMsg && <div className='alert alert-error'>{errMsg}</div>}

            <div className='btn-row'>
              <button className='btn btn-navy' onClick={startSim}
                disabled={status === 'connecting' || status === 'active'}>
                {status === 'connecting' ? 'Connecting…' : '▶ Start call'}
              </button>
              <button className='btn btn-outline' onClick={stopSim}
                disabled={status !== 'active' && status !== 'connecting'}>
                ⬇ End call
              </button>
              <button className='btn btn-ghost' onClick={toggleMute}
                disabled={status !== 'active'}>
                {muted ? '🔇 Unmute' : '🎤 Mute'}
              </button>
            </div>
          </div>

          {/* Transcript */}
          <div className='card sim-card transcript-card'>
            <div className='panel-header'>
              <span className='section-kicker'>Live transcript</span>
            </div>
            <div className='transcript-list'>
              {transcript.length === 0 && !partial.user && !partial.assistant ? (
                <div className='empty-state'>Start the call to see the conversation transcript here.</div>
              ) : (
                <>
                  {transcript.map(entry => (
                    <div key={entry.id} id={entry.id} className={`t-entry role-${entry.role}`}>
                      <div className='t-entry-role'>{speakerLabel(entry.role, user?.full_name ?? null)}</div>
                      <p>{entry.text}</p>
                    </div>
                  ))}
                  {partial.assistant && (
                    <div className='t-entry role-assistant partial'>
                      <div className='t-entry-role'>Agent · live</div>
                      <p>{partial.assistant}</p>
                    </div>
                  )}
                  {partial.user && (
                    <div className='t-entry role-user partial'>
                      <div className='t-entry-role'>{user?.full_name ?? 'You'} · live</div>
                      <p>{partial.user}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Feedback */}
          <div className='card sim-card'>
            <div className='panel-header'><span className='section-kicker'>Coaching feedback</span></div>
            <div className='score-row'>
              {[
                { label: 'Empathy',        v: insight.metrics.empathy },
                { label: 'De-escalation',  v: insight.metrics.deEscalation },
                { label: 'Clarity',        v: insight.metrics.clarity },
              ].map(m => (
                <div key={m.label} className='score-item'>
                  <span className='score-label'>{m.label}</span>
                  <strong>{m.v}</strong>
                  <span className='score-cap'>{metricLabel(m.v)}</span>
                </div>
              ))}
            </div>
            {insight.neverWords.length > 0 && (
              <div className='alert alert-error' style={{ marginTop: '.75rem' }}>
                ⚠ {insight.neverWords.length} escalating phrase{insight.neverWords.length > 1 ? 's' : ''} detected. Review before next attempt.
              </div>
            )}
            <div className='feedback-split'>
              <div>
                <div className='subsection-header positive'>✓ Positive cues</div>
                {insight.positive.length === 0
                  ? <div className='empty-feedback'>Effective communication cues will appear here as you speak.</div>
                  : insight.positive.map(item => (
                    <div key={item.id} className='feedback-card positive'>
                      <h3>{item.title}</h3>
                      <p>{item.detail}</p>
                      <blockquote>« {item.evidence} »</blockquote>
                      <button className='link-btn' onClick={() => jumpTo(item)}>{item.reference} →</button>
                    </div>
                  ))
                }
              </div>
              <div>
                <div className='subsection-header negative'>⚠ Needs attention</div>
                {insight.negative.length === 0
                  ? <div className='empty-feedback'>Flags will appear here when escalatory language is detected.</div>
                  : insight.negative.map(item => (
                    <div key={item.id} className='feedback-card negative'>
                      <h3>{item.title}</h3>
                      <p>{item.detail}</p>
                      <blockquote>« {item.evidence} »</blockquote>
                      <button className='link-btn' onClick={() => jumpTo(item)}>{item.reference} →</button>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>

          {/* Archive */}
          {archive.length > 0 && (
            <div className='card sim-card'>
              <div className='panel-header'><span className='section-kicker'>Recent sessions (local)</span></div>
              <div className='archive-list'>
                {archive.slice(0, 3).map(s => (
                  <div key={s.id} className={`archive-row ${expandedId === s.id ? 'expanded' : ''}`}>
                    <div className='archive-row-top'>
                      <div>
                        <div className='archive-time'>{formatTimestamp(s.startedAt)}</div>
                        <strong>{fmtDur(s.durationSeconds)} · {s.transcript.length} turns</strong>
                      </div>
                      <button className='btn btn-ghost btn-sm' onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                        {expandedId === s.id ? 'Hide' : 'Expand'}
                      </button>
                    </div>
                    <div className='archive-chips'>
                      <span className='chip chip-green'>✓ {s.insight.positive.length}</span>
                      <span className='chip chip-red'>⚠ {s.insight.negative.length}</span>
                      <span className='chip chip-slate'>E:{s.insight.metrics.empathy}</span>
                      <span className='chip chip-slate'>D:{s.insight.metrics.deEscalation}</span>
                      <span className='chip chip-slate'>C:{s.insight.metrics.clarity}</span>
                    </div>
                    {expandedId === s.id && (
                      <div className='archive-expanded'>
                        {s.transcript.map(e => (
                          <div key={e.id} className={`t-entry role-${e.role}`}>
                            <div className='t-entry-role'>{speakerLabel(e.role, user?.full_name ?? null)}</div>
                            <p>{e.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  const renderSignIn = () => (
    <div className='auth-page'>
      <div className='auth-card'>
        <span className='auth-logo'>Clinical Coach — Learner</span>
        <h2>Sign in to simulate</h2>
        <p>Use the demo account to access the voice training simulations.</p>
        <div className='demo-creds'>
          <div><span>Email</span><strong>{DEMO_EMAIL}</strong></div>
          <div><span>Password</span><strong>{DEMO_PASS}</strong></div>
        </div>
        <form className='auth-form' onSubmit={handleSignIn}>
          <div className='field'>
            <label>Email</label>
            <input className='input' value={email} onChange={e => setEmail(e.target.value)} type='email' autoComplete='username' />
          </div>
          <div className='field'>
            <label>Password</label>
            <input className='input' value={password} onChange={e => setPass(e.target.value)} type='password' autoComplete='current-password' />
          </div>
          {signErr && <div className='alert alert-error'>{signErr}</div>}
          <button className='btn btn-navy' type='submit'>Continue to simulation</button>
          <button className='btn btn-ghost' type='button' onClick={() => navigate('/')}>Back to gallery</button>
        </form>
      </div>
    </div>
  )

  const renderAdminSignIn = () => (
    <div className='auth-page'>
      <div className='auth-card'>
        <span className='auth-logo'>Clinical Coach — Admin</span>
        <h2>Voice agent control room</h2>
        <p>Use the admin test account to manage scenarios and review call logs.</p>
        <div className='demo-creds'>
          <div><span>Email</span><strong>{ADMIN_EMAIL}</strong></div>
          <div><span>Password</span><strong>{ADMIN_PASS}</strong></div>
        </div>
        <form className='auth-form' onSubmit={handleSignIn}>
          <div className='field'>
            <label>Email</label>
            <input className='input' value={adminEmail} onChange={e => setAdminEmail(e.target.value)} type='email' autoComplete='username' />
          </div>
          <div className='field'>
            <label>Password</label>
            <input className='input' value={adminPass} onChange={e => setAdminPass(e.target.value)} type='password' autoComplete='current-password' />
          </div>
          {adminErr && <div className='alert alert-error'>{adminErr}</div>}
          <button className='btn btn-navy' type='submit'>Open admin console</button>
          <button className='btn btn-ghost' type='button' onClick={() => navigate('/')}>Back to gallery</button>
        </form>
      </div>
    </div>
  )

  const renderAdminPage = () => {
    const avg = (key: 'positive' | 'negative') => {
      if (!callLog.length) return 0
      return Math.round(callLog.reduce((s, c) => s + c[key], 0) / callLog.length)
    }
    return (
      <div className='admin-grid'>
        {/* Sidebar */}
        <div className='admin-sidebar'>
          <div className='sidebar-brand'>Clinical Coach</div>
          <div className='sidebar-item'>Admin Console</div>
          <div className='sidebar-sep' />
          <div className={`sidebar-item ${adminTab === 'overview' ? 'active' : ''}`} onClick={() => setAdminTab('overview')}>📊 Overview</div>
          <div className={`sidebar-item ${adminTab === 'scenarios' ? 'active' : ''}`} onClick={() => setAdminTab('scenarios')}>🎭 Scenarios</div>
          <div className={`sidebar-item ${adminTab === 'calls' ? 'active' : ''}`} onClick={() => setAdminTab('calls')}>📞 Call log</div>
          <div className='sidebar-sep' />
          <div className='sidebar-item' onClick={handleAdminSignOut}>↩ Sign out</div>
        </div>

        {/* Content */}
        <div className='admin-content'>
          {adminTab === 'overview' && (
            <>
              <h2>Admin Overview</h2>
              <div className='stat-grid'>
                <div className='card stat-card'>
                  <div className='stat-num'>{SCENARIOS.filter(s => s.status === 'live').length}</div>
                  <div className='stat-label'>Live scenarios</div>
                </div>
                <div className='card stat-card'>
                  <div className='stat-num'>{SCENARIOS.filter(s => s.status === 'pilot').length}</div>
                  <div className='stat-label'>Pilots</div>
                </div>
                <div className='card stat-card'>
                  <div className='stat-num'>{callLog.length}</div>
                  <div className='stat-label'>Total calls</div>
                </div>
                <div className='card stat-card'>
                  <div className='stat-num'>{avg('positive')}</div>
                  <div className='stat-label'>Avg positive cues / call</div>
                </div>
              </div>
              <div className='card' style={{ padding: '1.5rem' }}>
                <h4>Supabase status</h4>
                <div className='chip-chip'>
                  <span className={`chip ${isSupabaseConfigured ? 'chip-green' : 'chip-amber'}`}>
                    {isSupabaseConfigured ? '● Connected' : '○ Not configured'}
                  </span>
                  <span className='chip chip-slate'>Vapi: {VAPI_PUBLIC_KEY ? '● Env key detected' : '○ No env key'}</span>
                </div>
                <p style={{ marginTop: '.75rem', fontSize: '.88rem' }}>
                  Configure VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_VAPI_PUBLIC_KEY, and VITE_VAPI_ASSISTANT_ID in your .env file to connect the backend.
                </p>
              </div>
            </>
          )}

          {adminTab === 'scenarios' && (
            <>
              <h2>Scenario Configuration</h2>
              <p style={{ marginBottom: '1.5rem' }}>Manage the three communication scenarios. Vapi assistant IDs are set server-side.</p>
              <div className='scenario-config-list'>
                {scenarioConfigs.map(cfg => (
                  <div key={cfg.slug} className='card scenario-config-row'>
                    <div>
                      <strong>{cfg.title}</strong>
                      <p>{cfg.opening_line || SCENARIOS.find(s => s.slug === cfg.slug)?.openingLine}</p>
                    </div>
                    <div className='scenario-config-status'>
                      <span className={`chip ${cfg.status === 'live' ? 'chip-green' : cfg.status === 'pilot' ? 'chip-amber' : 'chip-slate'}`}>
                        {cfg.status}
                      </span>
                      {cfg.assistant_id
                        ? <span className='chip chip-teal'>● Vapi connected</span>
                        : <span className='chip chip-red'>○ No assistant ID</span>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {adminTab === 'calls' && (
            <>
              <h2>Call Log</h2>
              {callLog.length === 0
                ? <div className='card' style={{ padding: '2rem', textAlign: 'center' }}>
                    <p>No calls recorded yet. Run a simulation and it will appear here.</p>
                  </div>
                : <div className='card' style={{ overflowX: 'auto' }}>
                    <table className='calls-table'>
                      <thead>
                        <tr>
                          <th>Date</th><th>Scenario</th><th>Duration</th><th>Status</th>
                          <th>✓ Positive</th><th>⚠ Flags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {callLog.map(c => (
                          <tr key={c.id}>
                            <td>{formatTimestamp(c.started_at)}</td>
                            <td>{SCENARIOS.find(s => s.slug === c.scenario_slug)?.title ?? c.scenario_slug}</td>
                            <td>{c.duration_seconds != null ? fmtDur(c.duration_seconds) : '—'}</td>
                            <td><span className={`chip chip-${c.status === 'completed' ? 'green' : 'slate'}`}>{c.status}</span></td>
                            <td>{c.positive}</td>
                            <td>{c.negative}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              }
            </>
          )}
        </div>
      </div>
    )
  }

  // ─── Root render ────────────────────────────────────────────────────────────

  return (
    <div className='app-shell'>
      {/* Navbar */}
      <nav className='navbar'>
        <button className='navbar-brand' onClick={() => navigate('/')}>Clinical Coach</button>
        <div className='navbar-links'>
          <button className='nav-btn' onClick={() => navigate('/')}>Home</button>
          <button className='nav-btn' onClick={() => navigate('/sign-in')}>Sign in</button>
          <button className='nav-btn' onClick={() => navigate('/admin/sign-in')}>Admin</button>
          {isSignedIn && (
            <button className='nav-btn nav-btn-primary' onClick={() => navigate('/gallery')}>Gallery ▶</button>
          )}
        </div>
      </nav>

      {/* Page content */}
      {route === 'landing'        && renderLanding()}
      {route === 'gallery'        && isSignedIn && renderGallery()}
      {route === 'scenario'       && renderScenarioPage()}
      {route === 'simulation' && isSignedIn && renderSimulationPage()}
      {route === 'sign-in'        && renderSignIn()}
      {route === 'admin-sign-in'  && renderAdminSignIn()}
      {route === 'admin'      && isAdminSignedIn && renderAdminPage()}
    </div>
  )
}

export default App