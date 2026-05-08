export type CallRole = 'assistant' | 'user' | 'system'

export type TranscriptEntry = {
  id: string
  role: CallRole
  text: string
  timestamp: string
}

export type FeedbackPillar = 'empathy' | 'de-escalation' | 'clarity' | 'ownership' | 'language'

export type FeedbackItem = {
  id: string
  title: string
  detail: string
  polarity: 'positive' | 'negative'
  pillar: FeedbackPillar
  evidence: string
  entryId: string
  reference: string
  tag?: 'never-word'
}

export type SessionInsight = {
  positive: FeedbackItem[]
  negative: FeedbackItem[]
  metrics: { empathy: number; deEscalation: number; clarity: number }
  neverWords: FeedbackItem[]
}

type PatternDef = {
  title: string; detail: string; pillar: FeedbackPillar
  regex: RegExp; tag?: 'never-word'
}

const positivePatterns: PatternDef[] = [
  { title: 'Validated emotion', detail: 'Acknowledged how the person felt before offering facts.', pillar: 'empathy',
    regex: /\b(i hear you|i understand|that must be|i can see this is|i'm sorry you feel|i appreciate|sounds frustrating|i get it)\b/i },
  { title: 'De-escalating language', detail: 'Used collaborative phrasing to lower tension.', pillar: 'de-escalation',
    regex: /\b(let('?s| us) (work|figure|sort|look)|together|i('?m| am) here to help|we can|one step at a time)\b/i },
  { title: 'Took ownership', detail: 'Accepted responsibility without deflecting.', pillar: 'ownership',
    regex: /\b(i('?m| am) sorry (for|about|that)|my apolog|that('?s| is) on us|we (should|could) have|i take responsibility)\b/i },
  { title: 'Plain language explanation', detail: 'Translated clinical information into accessible terms.', pillar: 'clarity',
    regex: /\b(what that means is|in (plain|simple|other) (terms|words)|to (put it simply|explain)|essentially|basically)\b/i },
  { title: 'Clear next-step summary', detail: 'Ended with a concrete plan the other person could follow.', pillar: 'clarity',
    regex: /\b(here('?s| is) what (happens|we('?ll| will))|the next step|what i('?ll| will) do|you can expect|by [a-z]+ (morning|afternoon|tomorrow))\b/i },
]

const negativePatterns: PatternDef[] = [
  { title: 'Used a NEVER phrase', detail: 'This phrasing sharply escalates distress and should be avoided.',
    pillar: 'de-escalation', tag: 'never-word',
    regex: /\b(calm down|there('?s| is) nothing (we|i) can do|why didn('?t| not) you|you should have|it('?s| is) not my (fault|problem)|those are the rules|my hands are tied)\b/i },
  { title: 'Dismissive response', detail: 'Minimised or brushed off the person\'s concern.',
    pillar: 'empathy', regex: /\b(you('?re| are) overreacting|it('?s| is) not a big deal|just (wait|be patient|relax)|not my department)\b/i },
  { title: 'Deflected blame', detail: 'Passed responsibility elsewhere before acknowledging the issue.',
    pillar: 'ownership', regex: /\b(that('?s| is) (the system|policy|protocol)|talk to (someone else|another|the manager)|not my (job|responsibility)|i just work here)\b/i },
]

const clamp = (v: number) => Math.max(0, Math.min(100, v))

export const analyzeTranscript = (entries: TranscriptEntry[]): SessionInsight => {
  const learnerLines = entries.filter(e => e.role === 'user')
  const positive: FeedbackItem[] = []
  const negative: FeedbackItem[] = []
  const seen = new Set<string>()

  for (const entry of learnerLines) {
    const ref = `Turn ${entries.findIndex(e => e.id === entry.id) + 1}`
    for (const p of positivePatterns) {
      if (!p.regex.test(entry.text)) continue
      const id = `${p.title}-${entry.id}`
      if (seen.has(id)) continue
      seen.add(id)
      positive.push({ id, title: p.title, detail: p.detail, polarity: 'positive', pillar: p.pillar, evidence: entry.text, entryId: entry.id, reference: ref })
    }
    for (const p of negativePatterns) {
      if (!p.regex.test(entry.text)) continue
      const id = `${p.title}-${entry.id}`
      if (seen.has(id)) continue
      seen.add(id)
      negative.push({ id, title: p.title, detail: p.detail, polarity: 'negative', pillar: p.pillar, evidence: entry.text, entryId: entry.id, reference: ref, tag: p.tag })
    }
  }

  const metrics = {
    empathy:       clamp(58 + positive.filter(i => i.pillar === 'empathy').length * 12 - negative.filter(i => i.pillar === 'empathy').length * 15),
    deEscalation:  clamp(56 + positive.filter(i => i.pillar === 'de-escalation').length * 13 - negative.filter(i => i.pillar === 'de-escalation').length * 18),
    clarity:       clamp(60 + positive.filter(i => ['clarity', 'language'].includes(i.pillar)).length * 10 - negative.filter(i => i.pillar === 'clarity').length * 12),
  }

  return { positive, negative, metrics, neverWords: negative.filter(i => i.tag === 'never-word') }
}

export const formatTimestamp = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

export const metricLabel = (v: number) =>
  v >= 85 ? 'Excellent' : v >= 70 ? 'Strong' : v >= 55 ? 'Developing' : 'Needs work'
