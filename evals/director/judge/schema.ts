import { z } from 'zod'

export const segmentJudgementSchema = z.object({
  timecode: z.string().min(1),
  expectation: z.string().min(1),
  judgement: z.enum(['seen', 'partial', 'not_seen', 'unclear']),
  evidence: z.string().min(1),
})

export const visualReviewSchema = z.object({
  segments: z.array(segmentJudgementSchema),
  userScore: z.number().int().min(1).max(5),
  leastLike: z.array(z.object({ timecode: z.string().min(1), problem: z.string().min(1) })).min(1).max(3),
  measurableClaims: z.array(z.object({
    kind: z.enum(['direction', 'shot_size', 'cut_count', 'other']),
    value: z.string().min(1),
    timecode: z.string().min(1),
  })).default([]),
  rationale: z.string().min(1),
})

const preregistrationFields = {
  cardId: z.string().min(1),
  prompt: z.string().min(1),
  expectedSegments: z.array(z.object({
    timecode: z.string().min(1),
    whoWhere: z.string().min(1),
    action: z.string().min(1),
    framing: z.string().min(1),
    camera: z.string().min(1),
    cut: z.string().min(1),
  })).min(1),
  // The timestamp is owned by the runner so a model cannot invalidate a card
  // by emitting a non-ISO value. The final schema is canonicalized below.
  frozenAt: z.string().min(1),
}
export const preregistrationDraftSchema = z.object({ ...preregistrationFields, sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() })
export const preregistrationSchema = z.object({ ...preregistrationFields, sha256: z.string().regex(/^[a-f0-9]{64}$/) })

export const pairwiseSchema = z.object({
  cardId: z.string().min(1),
  leftLabel: z.string().min(1),
  rightLabel: z.string().min(1),
  winner: z.enum(['left', 'right', 'tie', 'unclear']),
  why: z.string().min(1),
})

export const judgeOutputSchema = z.object({
  review: visualReviewSchema,
  pairwise: pairwiseSchema.optional(),
})

export type Preregistration = z.infer<typeof preregistrationSchema>
export type VisualReview = z.infer<typeof visualReviewSchema>
export type JudgeOutput = z.infer<typeof judgeOutputSchema>

export function parseJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
  const candidate = fenced ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  if (!candidate || !candidate.trim()) throw new Error('judge returned no JSON object')
  return JSON.parse(candidate)
}
