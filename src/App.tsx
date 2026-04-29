import { useEffect, useMemo, useRef, useState } from 'react'
import Vapi from '@vapi-ai/web'
import './App.css'
import { analyzeTranscript, formatTimestamp, metricLabel, type FeedbackItem, type SessionInsight, type TranscriptEntry } from './lib/feedback'

type SessionStatus = 'idle' | 'connecting' | 'active' | 'ended' | 'error'
type TranscriptRole = TranscriptEntry['role']
type AppRoute = '/' | '/sign-in' | '/simulate'

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

const ARCHIVE_STORAGE_KEY = 'vapi-coaching-archive'
const AUTH_STORAGE_KEY = 'clinical-coach-auth'
const DEFAULT_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY ?? ''
const DEFAULT_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID ?? ''
const DEMO_ACCOUNT: DemoAccount = {
  email: 'learner@clinicalcoach.app',
  password: 'CoachDemo2026!',
  name: 'Demo Learner',
}

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

const getRouteFromPath = (pathname: string): AppRoute => {
  if (pathname.startsWith('/sign-in')) return '/sign-in'
  if (pathname.startsWith('/simulate')) return '/simulate'
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

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromPath(window.location.pathname))
  const [signedInUser, setSignedInUser] = useState<string | null>(() => getStoredUser())
  const [email, setEmail] = useState(DEMO_ACCOUNT.email)
  const [password, setPassword] = useState(DEMO_ACCOUNT.password)
  const [signInError, setSignInError] = useState('')
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [partialCaptions, setPartialCaptions] = useState<{ user: string; assistant: string }>({ user: '', assistant: '' })
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [volumeLevel, setVolumeLevel] = useState(0)
  const [lastError, setLastError] = useState('')
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [archive, setArchive] = useState<ArchivedSession[]>(() => getStoredArchive())

  const vapiRef = useRef<Vapi | null>(null)
  const transcriptRef = useRef<TranscriptEntry[]>([])
  const insightRef = useRef<SessionInsight>(analyzeTranscript([]))
  const startedAtRef = useRef<string | null>(null)
  const sessionSecondsRef = useRef(0)
  const archiveFinalizedRef = useRef(false)

  const isSignedIn = Boolean(signedInUser)
  const insight = useMemo(() => analyzeTranscript(transcript), [transcript])
  const totalFlags = insight.positive.length + insight.negative.length

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
    if (status !== 'active' || !startedAt) return

    const interval = window.setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
      setSessionSeconds(elapsed)
    }, 1000)

    return () => window.clearInterval(interval)
  }, [status, startedAt])

  useEffect(() => {
    if (!DEFAULT_PUBLIC_KEY) {
      vapiRef.current = null
      return
    }

    const client = new Vapi(DEFAULT_PUBLIC_KEY)
    vapiRef.current = client

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
    }

    const handleMessage = (message: any) => {
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

    const handleError = (error: any) => {
      setLastError(cleanText(error?.message) || 'The voice session hit a snag.')
      setStatus('error')
    }

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

    client.on('message', handleMessage)
    client.on('error', handleError)
    client.on('call-start-failed', handleError)

    return () => {
      client.removeAllListeners()
      if (vapiRef.current === client) {
        vapiRef.current = null
      }
    }
  }, [])

  const handleSignIn = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (email.trim().toLowerCase() !== DEMO_ACCOUNT.email || password !== DEMO_ACCOUNT.password) {
      setSignInError('Use the demo account shown on this page.')
      return
    }

    window.sessionStorage.setItem(AUTH_STORAGE_KEY, DEMO_ACCOUNT.name)
    setSignedInUser(DEMO_ACCOUNT.name)
    setSignInError('')
    navigate('/simulate')
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

  const startSimulation = async () => {
    if (!DEFAULT_PUBLIC_KEY || !DEFAULT_ASSISTANT_ID) {
      setLastError('The preset voice agent is not configured yet.')
      setStatus('error')
      return
    }

    if (!vapiRef.current) {
      setLastError('The voice client is not ready yet. Refresh and try again.')
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
      await vapiRef.current.start(DEFAULT_ASSISTANT_ID, {
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

  const renderLandingPage = () => (
    <section className="hero-page">
      <div className="hero-panel">
        <span className="eyebrow">Clinical communication training</span>
        <h1>Clinical Communication Trainer</h1>
        <p className="hero-copy">
          This app is for communications training. Learners sign in, open a preset voice simulation, and review the
          transcript with coaching feedback after each interaction.
        </p>
        <div className="hero-actions">
          <button className="button primary" onClick={() => navigate('/sign-in')}>
            Sign in
          </button>
          {isSignedIn ? (
            <button className="button secondary" onClick={() => navigate('/simulate')}>
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
          <h2>What is preset</h2>
          <p>The voice agent is already configured in the app, so learners do not need to enter any Vapi details.</p>
        </article>
        <article className="info-card">
          <h2>Who it is for</h2>
          <p>Healthcare teams practicing difficult conversations, de-escalation, and day-to-day patient communication.</p>
        </article>
      </div>
    </section>
  )

  const renderSignInPage = () => (
    <section className="auth-page">
      <div className="auth-panel">
        <span className="eyebrow">Sign in</span>
        <h1>Training access</h1>
        <p className="hero-copy">Use the demo account below to access the preset simulation.</p>

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

  const renderSimulationPage = () => (
    <section className="simulation-page">
      <div className="simulation-header panel">
        <div>
          <span className="eyebrow">Simulation</span>
          <h1>Preset voice session</h1>
          <p className="hero-copy">
            Signed in as {signedInUser}. The voice agent is preset for this training session, so there is nothing for the
            learner to configure.
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
                  <div className="transcript-role">
                    {entry.role === 'user' ? signedInUser : entry.role === 'assistant' ? 'Voice agent' : 'System'}
                  </div>
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
            {archive.map((session) => (
              <article key={session.id} className="archive-card">
                <div className="archive-time">{formatTimestamp(session.startedAt)}</div>
                <h3>{formatDuration(session.durationSeconds)} session</h3>
                <p>
                  {session.transcript.length} turns · {session.insight.positive.length} positive cues · {session.insight.negative.length}{' '}
                  improvement flags
                </p>
                <div className="archive-tags">
                  <span>Empathy {session.insight.metrics.empathy}</span>
                  <span>De-escalation {session.insight.metrics.deEscalation}</span>
                  <span>Clarity {session.insight.metrics.clarity}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">Completed simulations will be archived in this browser for quick debriefing.</div>
        )}
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
          <button className="nav-link" onClick={() => navigate('/sign-in')}>
            Sign in
          </button>
          {isSignedIn ? (
            <button className="nav-link strong" onClick={() => navigate('/simulate')}>
              Simulation
            </button>
          ) : null}
        </nav>
      </header>

      {route === '/' ? renderLandingPage() : null}
      {route === '/sign-in' ? renderSignInPage() : null}
      {route === '/simulate' && isSignedIn ? renderSimulationPage() : null}
    </div>
  )
}

export default App
