import { useEffect, useMemo, useRef, useState } from 'react'
import Vapi from '@vapi-ai/web'
import './App.css'
import {
  analyzeTranscript,
  formatTimestamp,
  metricLabel,
  type FeedbackItem,
  type SessionInsight,
  type TranscriptEntry,
} from './lib/feedback'

type SessionStatus = 'idle' | 'connecting' | 'active' | 'ended' | 'error'

type TranscriptRole = TranscriptEntry['role']

type ArchivedSession = {
  id: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  transcript: TranscriptEntry[]
  insight: SessionInsight
}

const ARCHIVE_STORAGE_KEY = 'vapi-coaching-archive'
const DEFAULT_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY ?? ''
const DEFAULT_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID ?? ''
const REVIEW_ENDPOINT = import.meta.env.VITE_LLM_REVIEW_ENDPOINT ?? '/api/review-call'

const spikesSteps = [
  {
    key: 'setting',
    letter: 'S',
    label: 'Setting',
    description: 'Create privacy and reduce ambient stress before the hard conversation starts.',
  },
  {
    key: 'perception',
    letter: 'P',
    label: 'Perception',
    description: 'Check what the family member already understands.',
  },
  {
    key: 'invitation',
    letter: 'I',
    label: 'Invitation',
    description: 'Offer choice about the level of detail.',
  },
  {
    key: 'knowledge',
    letter: 'K',
    label: 'Knowledge',
    description: 'Explain clearly, without weaponized jargon.',
  },
  {
    key: 'emotion',
    letter: 'E',
    label: 'Emotion',
    description: 'Name the feeling and respond to it before sprinting into facts.',
  },
  {
    key: 'summarize',
    letter: 'S',
    label: 'Summarize',
    description: 'Re-state the plan and check that it sounds workable.',
  },
] as const

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

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

const normalizeRole = (role: unknown): TranscriptRole => {
  if (role === 'assistant' || role === 'user' || role === 'system') return role
  return 'system'
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const statusCopy: Record<SessionStatus, string> = {
  idle: 'Ready',
  connecting: 'Connecting',
  active: 'Live',
  ended: 'Complete',
  error: 'Issue detected',
}

function App() {
  const [publicKey, setPublicKey] = useState(DEFAULT_PUBLIC_KEY)
  const [assistantId, setAssistantId] = useState(DEFAULT_ASSISTANT_ID)
  const [learnerLabel, setLearnerLabel] = useState('Healthcare learner')
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [partialCaptions, setPartialCaptions] = useState<{ user: string; assistant: string }>({
    user: '',
    assistant: '',
  })
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

  const insight = useMemo(() => analyzeTranscript(transcript), [transcript])
  const totalFlags = insight.positive.length + insight.negative.length
  const spikesCovered = Object.values(insight.spikes).filter(Boolean).length

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
    if (!publicKey) {
      vapiRef.current = null
      return
    }

    const client = new Vapi(publicKey)
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
          setPartialCaptions((current) => ({ ...current, [role]: '' }))
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

      if (messageType === 'conversation-update' && Array.isArray(message?.messages)) {
        return
      }

      if (messageType === 'status-update' && message?.status === 'ended') {
        setStatus('ended')
        finalizeArchive()
      }
    }

    const handleError = (error: any) => {
      const nextMessage = cleanText(error?.message) || 'The voice session hit a snag.'
      setLastError(nextMessage)
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

    client.on('volume-level', (volume) => {
      setVolumeLevel(Math.max(0, Math.min(100, Math.round(volume * 100))))
    })

    client.on('message', handleMessage)
    client.on('error', handleError)
    client.on('call-start-failed', (event) => {
      setLastError(cleanText(event?.error) || 'Call start failed.')
      setStatus('error')
    })

    return () => {
      client.removeAllListeners()
      if (vapiRef.current === client) {
        vapiRef.current = null
      }
    }
  }, [publicKey])

  const startSimulation = async () => {
    if (!publicKey || !assistantId) {
      setLastError('Add the public key and assistant ID before starting the simulation.')
      setStatus('error')
      return
    }

    if (!vapiRef.current) {
      setLastError('Vapi is not initialized yet. Recheck the public key.')
      setStatus('error')
      return
    }

    archiveFinalizedRef.current = false
    setStatus('connecting')
    setLastError('')
    setTranscript([])
    setPartialCaptions({ user: '', assistant: '' })
    setSessionSeconds(0)
    setVolumeLevel(0)
    setIsMuted(false)

    const now = new Date().toISOString()
    setStartedAt(now)

    try {
      await vapiRef.current.start(assistantId, {
        variableValues: {
          learnerName: learnerLabel,
        },
      })
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Unable to start the voice session.')
      setStatus('error')
    }
  }

  const endSimulation = async () => {
    try {
      await vapiRef.current?.stop()
      setStatus('ended')
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Unable to stop the session cleanly.')
      setStatus('error')
    }
  }

  const toggleMute = () => {
    if (!vapiRef.current) return
    const nextMuted = !isMuted
    vapiRef.current.setMuted(nextMuted)
    setIsMuted(nextMuted)
  }

  const jumpToReference = (item: FeedbackItem) => {
    const target = document.getElementById(item.entryId)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="app-shell">
      <section className="hero-section">
        <div className="eyebrow">Voice-based coaching for high-friction clinical moments</div>
        <div className="hero-grid">
          <div>
            <h1>Train clinicians to de-escalate fast, stay empathic, and land the plan clearly.</h1>
            <p className="hero-copy">
              This standalone coaching UI wraps your Vapi voice agent in something much more useful than a raw
              call button. Learners can launch a realistic scenario, watch the transcript update live, and get
              immediate coaching flags tied to exact turns.
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#simulation-console">
                Open simulation console
              </a>
              <a className="button secondary" href="#product-roadmap">
                View product roadmap
              </a>
            </div>
            <div className="hero-stats">
              <div className="stat-card">
                <span className="stat-value">Live</span>
                <span className="stat-label">Vapi-powered session controls</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">Turn-based</span>
                <span className="stat-label">Transcript references for every coaching flag</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">SPIKES</span>
                <span className="stat-label">Framework tracking built into the review panel</span>
              </div>
            </div>
          </div>

          <div className="spotlight-card">
            <div className="spotlight-label">What the learner sees</div>
            <ul className="spotlight-list">
              <li>Start and stop the voice simulation from a single panel.</li>
              <li>See the conversation unfold in a readable transcript, not a black box.</li>
              <li>Get immediate praise for empathy and warnings for escalation triggers.</li>
              <li>Track progress across Setting, Perception, Invitation, Knowledge, Emotion, and Summary.</li>
            </ul>
            <div className="security-note">
              Public key lives in the browser. Private key stays server-side for future analytics, storage, and
              LLM-backed review. That separation is non-negotiable.
            </div>
          </div>
        </div>
      </section>

      <section className="feature-strip">
        <article className="feature-card">
          <h2>Live coaching with receipts</h2>
          <p>
            Positive and negative feedback items appear as the learner speaks, each linked to the exact transcript
            turn that triggered it.
          </p>
        </article>
        <article className="feature-card">
          <h2>NEVER-word detection</h2>
          <p>
            Escalating phrases like dead-end language or blame-oriented wording are flagged immediately, because
            that is exactly when the damage happens.
          </p>
        </article>
        <article className="feature-card">
          <h2>Future-ready architecture</h2>
          <p>
            The UI is built to grow into a standalone product with server-side transcript storage, webhook handling,
            and an optional LLM appraisal layer.
          </p>
        </article>
      </section>

      <section className="workspace" id="simulation-console">
        <div className="panel control-panel">
          <div className="panel-header">
            <div>
              <div className="section-kicker">Simulation console</div>
              <h2>Connect the voice coach</h2>
            </div>
            <span className={`status-pill status-${status}`}>{statusCopy[status]}</span>
          </div>

          <div className="config-grid">
            <label>
              <span>Public key</span>
              <input
                value={publicKey}
                onChange={(event) => setPublicKey(event.target.value)}
                placeholder="Client-safe Vapi public key"
              />
            </label>
            <label>
              <span>Assistant ID</span>
              <input
                value={assistantId}
                onChange={(event) => setAssistantId(event.target.value)}
                placeholder="Voice coach assistant ID"
              />
            </label>
            <label>
              <span>Learner label</span>
              <input
                value={learnerLabel}
                onChange={(event) => setLearnerLabel(event.target.value)}
                placeholder="Shown in future LMS records"
              />
            </label>
          </div>

          <div className="runtime-strip">
            <div>
              <span className="runtime-label">Call timer</span>
              <strong>{formatDuration(sessionSeconds)}</strong>
            </div>
            <div>
              <span className="runtime-label">Voice activity</span>
              <div className="meter">
                <div className="meter-fill" style={{ width: `${volumeLevel}%` }} />
              </div>
            </div>
            <div>
              <span className="runtime-label">Flags raised</span>
              <strong>{totalFlags}</strong>
            </div>
          </div>

          <div className="button-row">
            <button className="button primary" onClick={startSimulation} disabled={status === 'connecting' || status === 'active'}>
              {status === 'connecting' ? 'Connecting…' : 'Start simulation'}
            </button>
            <button className="button secondary" onClick={endSimulation} disabled={status !== 'active' && status !== 'connecting'}>
              End simulation
            </button>
            <button className="button ghost" onClick={toggleMute} disabled={status !== 'active'}>
              {isMuted ? 'Unmute learner mic' : 'Mute learner mic'}
            </button>
          </div>

          {lastError ? <div className="alert error">{lastError}</div> : null}
          <div className="alert muted">Private/server credentials are intentionally excluded from this frontend.</div>

          <div className="panel transcript-panel">
            <div className="panel-header compact">
              <div>
                <div className="section-kicker">Conversation feed</div>
                <h3>Live transcript</h3>
              </div>
              {startedAt ? <span className="transcript-meta">Started {formatTimestamp(startedAt)}</span> : null}
            </div>

            {!transcript.length && !partialCaptions.user && !partialCaptions.assistant ? (
              <div className="empty-state">
                Start a simulation to see the transcript, coaching flags, and SPIKES tracker update in real time.
              </div>
            ) : null}

            <div className="transcript-list">
              {transcript.map((entry) => (
                <article key={entry.id} id={entry.id} className={`transcript-entry role-${entry.role}`}>
                  <div className="transcript-role">{entry.role === 'user' ? 'Learner' : entry.role === 'assistant' ? 'Voice agent' : 'System'}</div>
                  <p>{entry.text}</p>
                  <span className="transcript-time">{formatTimestamp(entry.timestamp)}</span>
                </article>
              ))}

              {partialCaptions.user ? (
                <article className="transcript-entry role-user partial">
                  <div className="transcript-role">Learner · live</div>
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
              <div className="section-kicker">Immediate appraisal</div>
              <h2>Coaching feedback</h2>
            </div>
            <div className="mini-stat">{spikesCovered}/6 SPIKES steps detected</div>
          </div>

          <div className="score-grid">
            {[
              { label: 'Empathy', value: insight.metrics.empathy },
              { label: 'De-escalation', value: insight.metrics.deEscalation },
              { label: 'Clarity', value: insight.metrics.clarity },
              { label: 'SPIKES coverage', value: insight.metrics.spikes },
            ].map((metric) => (
              <article key={metric.label} className="score-card">
                <span className="score-label">{metric.label}</span>
                <strong>{metric.value}</strong>
                <span className="score-caption">{metricLabel(metric.value)}</span>
              </article>
            ))}
          </div>

          {insight.neverWords.length ? (
            <div className="alert warning">
              <strong>NEVER words detected.</strong> These learner phrases are likely to inflame the scenario and should
              be coached immediately.
            </div>
          ) : null}

          <div className="feedback-columns">
            <div>
              <div className="subsection-header positive">Positive signals</div>
              <div className="feedback-list">
                {insight.positive.length ? (
                  insight.positive.map((item) => (
                    <article key={item.id} className="feedback-card positive">
                      <div className="feedback-title-row">
                        <h3>{item.title}</h3>
                        <button className="link-button" onClick={() => jumpToReference(item)}>
                          {item.reference}
                        </button>
                      </div>
                      <p>{item.detail}</p>
                      <blockquote>{item.evidence}</blockquote>
                    </article>
                  ))
                ) : (
                  <div className="empty-feedback">As empathetic turns show up, they will be praised here with transcript references.</div>
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
                        <button className="link-button" onClick={() => jumpToReference(item)}>
                          {item.reference}
                        </button>
                      </div>
                      <p>{item.detail}</p>
                      <blockquote>{item.evidence}</blockquote>
                    </article>
                  ))
                ) : (
                  <div className="empty-feedback">No negative flags yet. Nice. Let’s keep it that way.</div>
                )}
              </div>
            </div>
          </div>

          <div className="spikes-panel">
            <div className="panel-header compact">
              <div>
                <div className="section-kicker">Structured communication</div>
                <h3>SPIKES tracker</h3>
              </div>
            </div>
            <div className="spikes-grid">
              {spikesSteps.map((step) => {
                const match = insight.spikes[step.key]
                return (
                  <article key={step.key} className={`spikes-card ${match ? 'complete' : ''}`}>
                    <div className="spikes-letter">{step.letter}</div>
                    <div>
                      <h4>{step.label}</h4>
                      <p>{step.description}</p>
                      <span className="spikes-status">{match ? `Detected · ${match.reference}` : 'Not yet demonstrated'}</span>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="panel archive-panel">
        <div className="panel-header">
          <div>
            <div className="section-kicker">Recent simulations</div>
            <h2>Local session archive</h2>
          </div>
          <div className="mini-stat">{archive.length} saved locally in this browser</div>
        </div>

        {archive.length ? (
          <div className="archive-grid">
            {archive.map((session) => (
              <article key={session.id} className="archive-card">
                <div className="archive-time">{formatTimestamp(session.startedAt)}</div>
                <h3>{formatDuration(session.durationSeconds)} simulation</h3>
                <p>
                  {session.transcript.length} turns · {session.insight.positive.length} positive cues ·{' '}
                  {session.insight.negative.length} negative cues
                </p>
                <div className="archive-tags">
                  <span>Empathy {session.insight.metrics.empathy}</span>
                  <span>De-escalation {session.insight.metrics.deEscalation}</span>
                  <span>SPIKES {session.insight.metrics.spikes}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">Completed simulations will be listed here for quick debriefing.</div>
        )}
      </section>

      <section className="roadmap-section" id="product-roadmap">
        <div className="section-kicker">Standalone product roadmap</div>
        <h2>How this becomes a real product instead of a clever demo.</h2>
        <div className="roadmap-grid">
          <article className="roadmap-card">
            <h3>1. Frontend app</h3>
            <p>
              Deploy the React frontend to Vercel, Netlify, or Cloudflare Pages. Keep only the Vapi public key here.
              This layer handles session control, transcript rendering, browser-side feedback, and learner UX.
            </p>
          </article>
          <article className="roadmap-card">
            <h3>2. Secure backend</h3>
            <p>
              Add a server for Vapi webhooks, transcript persistence, user auth, and analytics. This is where the
              Vapi private key belongs, along with your database credentials and webhook secret.
            </p>
          </article>
          <article className="roadmap-card">
            <h3>3. LLM appraisal layer</h3>
            <p>
              Connect a server-side endpoint such as <code>{REVIEW_ENDPOINT}</code> to your chosen LLM provider.
              Store those provider API keys in server-side environment variables only, then generate richer post-call
              coaching summaries, rubric scoring, and personalized improvement plans.
            </p>
          </article>
        </div>
      </section>
    </div>
  )
}

export default App
