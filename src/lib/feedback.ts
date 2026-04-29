export type CallRole = 'assistant' | 'user' | 'system'

export type TranscriptEntry = {
  id: string
  role: CallRole
  text: string
  timestamp: string
}

export type FeedbackPillar =
  | 'empathy'
  | 'de-escalation'
  | 'clarity'
  | 'setting'
  | 'perception'
  | 'invitation'
  | 'knowledge'
  | 'emotion'
  | 'summarize'

export type FeedbackItem = {
  id: string
  title: string
  detail: string
  polarity: 'positive' | 'negative'
  pillar: FeedbackPillar
  evidence: string
  entryId: string
  reference: string
  tag?: 'never-word' | 'spikes'
}

export type SessionInsight = {
  positive: FeedbackItem[]
  negative: FeedbackItem[]
  metrics: {
    empathy: number
    deEscalation: number
    clarity: number
    spikes: number
  }
  spikes: {
    setting: FeedbackItem | null
    perception: FeedbackItem | null
    invitation: FeedbackItem | null
    knowledge: FeedbackItem | null
    emotion: FeedbackItem | null
    summarize: FeedbackItem | null
  }
  neverWords: FeedbackItem[]
}

type PatternDefinition = {
  title: string
  detail: string
  pillar: FeedbackPillar
  regex: RegExp
  tag?: 'never-word' | 'spikes'
  spikesStep?: keyof SessionInsight['spikes']
}

const positivePatterns: PatternDefinition[] = [
  {
    title: 'Validated emotion',
    detail: 'The learner acknowledged emotion before pivoting to facts or solutions.',
    pillar: 'empathy',
    regex:
      /\b(i hear how|i can hear how|it sounds like you felt|that sounds frustrating|that sounds upsetting|that is very frustrating|i can see this is hard|i'm sorry this happened|i understand why|am i understanding that correctly)\b/i,
  },
  {
    title: 'Empathetic listening',
    detail: 'The learner reflected back the concern and checked understanding.',
    pillar: 'emotion',
    tag: 'spikes',
    spikesStep: 'emotion',
    regex:
      /\b(it sounds like you felt .* am i understanding that correctly|am i understanding that correctly|help me understand what felt most upsetting|i want to make sure i understand)\b/i,
  },
  {
    title: 'De-escalating collaboration',
    detail: 'The learner positioned the conversation as something to solve together.',
    pillar: 'de-escalation',
    regex:
      /\b(let'?s work through this|let's figure this out together|we can work on this together|i'm here to help|let's slow this down|we'll take this one step at a time)\b/i,
  },
  {
    title: 'Plain-language explanation',
    detail: 'The learner used accessible language instead of hiding behind jargon.',
    pillar: 'knowledge',
    tag: 'spikes',
    spikesStep: 'knowledge',
    regex:
      /\b(which is why|that means|in plain terms|in other words|to put it simply|we are using .* to help|the infection has spread)\b/i,
  },
  {
    title: 'Clear next-step summary',
    detail: 'The learner summarized the plan and checked for alignment.',
    pillar: 'summarize',
    tag: 'spikes',
    spikesStep: 'summarize',
    regex:
      /\b(to make sure we are on the same page|to make sure we're on the same page|the plan is|i will meet you .* again|does that sound like a plan|here are the next steps)\b/i,
  },
  {
    title: 'Protected the setting',
    detail: 'The learner created a calmer, more private environment before delivering difficult news.',
    pillar: 'setting',
    tag: 'spikes',
    spikesStep: 'setting',
    regex:
      /\b(private room|sit down and talk without being interrupted|somewhere quieter|talk in private|step into this private room)\b/i,
  },
  {
    title: 'Checked perception',
    detail: 'The learner explored the family member’s understanding before adding new information.',
    pillar: 'perception',
    tag: 'spikes',
    spikesStep: 'perception',
    regex:
      /\b(what is your understanding|what's your understanding|what have you been told so far|tell me what you understand|before i share .* what is your understanding)\b/i,
  },
  {
    title: 'Asked for invitation',
    detail: 'The learner offered choice in how much detail to discuss.',
    pillar: 'invitation',
    tag: 'spikes',
    spikesStep: 'invitation',
    regex:
      /\b(would you like me to go over the technical details|would you prefer a general overview|how much detail would you like|would it help if i explain the details now)\b/i,
  },
  {
    title: 'Professional reassurance',
    detail: 'The learner combined compassion with a clear clinical priority.',
    pillar: 'clarity',
    regex:
      /\b(our priority is making sure .* comfortable|our priority is to keep .* comfortable|we are focused on .* comfort|i want to help and keep you informed)\b/i,
  },
]

const negativePatterns: PatternDefinition[] = [
  {
    title: 'Used a NEVER phrase',
    detail: 'This wording can sharply escalate distress and should be avoided.',
    pillar: 'de-escalation',
    tag: 'never-word',
    regex:
      /\b(there is nothing else we can do|there's nothing else we can do|nothing else we can do|why didn't you come in sooner|why did you wait so long|you should have come in sooner)\b/i,
  },
  {
    title: 'Dismissive language',
    detail: 'The learner minimized the speaker’s emotion instead of acknowledging it.',
    pillar: 'empathy',
    regex:
      /\b(calm down|you're overreacting|it'?s not a big deal|that's not my problem|you need to relax|just listen)\b/i,
  },
  {
    title: 'Policy-first shutdown',
    detail: 'The learner leaned on rules or dead ends before showing empathy.',
    pillar: 'de-escalation',
    regex:
      /\b(that's our policy|those are the rules|there's nothing i can do|that's just how it is|my hands are tied)\b/i,
  },
  {
    title: 'Blame-oriented framing',
    detail: 'The learner sounded accusatory, which raises defensiveness fast.',
    pillar: 'clarity',
    regex:
      /\b(you should have|you need to calm down|you have to listen|you didn't|you failed to|why would you)\b/i,
  },
  {
    title: 'Premature closure',
    detail: 'The conversation was pushed toward an ending before the concern felt heard.',
    pillar: 'de-escalation',
    regex:
      /\b(i already told you|we're done here|end of story|there's nothing else to discuss)\b/i,
  },
]

const clampScore = (value: number) => Math.max(0, Math.min(100, value))

const uniqueById = (items: FeedbackItem[]) => {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

const buildReference = (entries: TranscriptEntry[], entryId: string) => {
  const index = entries.findIndex((entry) => entry.id === entryId)
  return index >= 0 ? `Turn ${index + 1}` : 'Live turn'
}

export const analyzeTranscript = (entries: TranscriptEntry[]): SessionInsight => {
  const learnerLines = entries.filter((entry) => entry.role === 'user')
  const positive: FeedbackItem[] = []
  const negative: FeedbackItem[] = []

  const spikes: SessionInsight['spikes'] = {
    setting: null,
    perception: null,
    invitation: null,
    knowledge: null,
    emotion: null,
    summarize: null,
  }

  for (const entry of learnerLines) {
    const reference = buildReference(entries, entry.id)

    for (const pattern of positivePatterns) {
      if (!pattern.regex.test(entry.text)) continue

      const item: FeedbackItem = {
        id: `${pattern.title}-${entry.id}`,
        title: pattern.title,
        detail: pattern.detail,
        polarity: 'positive',
        pillar: pattern.pillar,
        evidence: entry.text,
        entryId: entry.id,
        reference,
        tag: pattern.tag,
      }

      positive.push(item)

      if (pattern.spikesStep && !spikes[pattern.spikesStep]) {
        spikes[pattern.spikesStep] = item
      }
    }

    for (const pattern of negativePatterns) {
      if (!pattern.regex.test(entry.text)) continue

      negative.push({
        id: `${pattern.title}-${entry.id}`,
        title: pattern.title,
        detail: pattern.detail,
        polarity: 'negative',
        pillar: pattern.pillar,
        evidence: entry.text,
        entryId: entry.id,
        reference,
        tag: pattern.tag,
      })
    }
  }

  const dedupedPositive = uniqueById(positive)
  const dedupedNegative = uniqueById(negative)
  const spikesHits = Object.values(spikes).filter(Boolean).length

  const metrics = {
    empathy: clampScore(
      58 +
        dedupedPositive.filter((item) => ['empathy', 'emotion'].includes(item.pillar)).length * 12 -
        dedupedNegative.filter((item) => item.pillar === 'empathy').length * 15,
    ),
    deEscalation: clampScore(
      56 +
        dedupedPositive.filter((item) => item.pillar === 'de-escalation').length * 13 -
        dedupedNegative.filter((item) => item.pillar === 'de-escalation').length * 18,
    ),
    clarity: clampScore(
      60 +
        dedupedPositive.filter((item) => ['clarity', 'knowledge', 'summarize'].includes(item.pillar)).length * 10 -
        dedupedNegative.filter((item) => item.pillar === 'clarity').length * 14,
    ),
    spikes: clampScore(18 + spikesHits * 13),
  }

  return {
    positive: dedupedPositive,
    negative: dedupedNegative,
    metrics,
    spikes,
    neverWords: dedupedNegative.filter((item) => item.tag === 'never-word'),
  }
}

export const formatTimestamp = (isoString: string) => {
  const date = new Date(isoString)
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export const metricLabel = (value: number) => {
  if (value >= 85) return 'Strong'
  if (value >= 70) return 'Solid'
  if (value >= 55) return 'Developing'
  return 'Needs work'
}
