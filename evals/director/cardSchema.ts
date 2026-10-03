import { z } from 'zod'

export const toleranceSchema = z
  .object({
    seconds: z.number().nonnegative().optional(),
    degrees: z.number().nonnegative().optional(),
    meters: z.number().nonnegative().optional(),
  })
  .default({})
export const directionSchema = z.enum(['left', 'right', 'up', 'down', 'in', 'out'])
export type Direction = z.infer<typeof directionSchema>
const durationSchema = z.object({
  total: z.number().nonnegative().optional(),
  tol: z.number().nonnegative().default(0.5),
})
const sceneSchema = z
  .object({
    tags: z.array(z.string()).default([]),
    required: z.array(z.string()).default([]),
    aliases: z.record(z.array(z.string())).default({}),
    relations: z.array(z.string()).default([]),
    style: z.string().optional(),
  })
  .default({})
const actorSchema = z.object({
  id: z.string(),
  aliases: z.array(z.string()).default([]),
  category: z.string(),
  desc: z.string().optional(),
  props: z.array(z.string()).default([]),
  static: z.boolean().optional(),
})
const blockingSchema = z.object({
  actor: z.string(),
  verb: z.string(),
  target: z.string().optional(),
  between: z.array(z.string()).optional(),
  object: z.string().optional(),
  path: z.string().optional(),
  speed: z.string().optional(),
  window: z.tuple([z.number(), z.number()]).optional(),
})
const shotSchema = z.object({
  t: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).optional(),
  size: z.string().optional(),
  subject: z.string().optional(),
  subjects: z.array(z.string()).optional(),
  angle: z.string().optional(),
  move: z.string().optional(),
  direction: directionSchema.optional(),
  sweepDeg: z.number().optional(),
  tolDeg: z.number().nonnegative().optional(),
  speed: z.string().optional(),
  endSubject: z.string().optional(),
  endSize: z.string().optional(),
  transitionIn: z.string().optional(),
})
export const directorCardSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  tier: z.enum(['T1', 'T2', 'T3', 'benchmark']).default('T1'),
  duration: durationSchema.optional(),
  scene: sceneSchema,
  actors: z.array(actorSchema).default([]),
  blocking: z.array(blockingSchema).default([]),
  shots: z.array(shotSchema).default([]),
  coverageRequired: z.array(z.string()).default([]),
  minCount: z.number().int().positive().optional(),
  move: z.string().optional(),
  moveAnyOf: z.array(z.string()).optional(),
  continuity: z.array(z.string()).default([]),
  tolerances: toleranceSchema,
  reviewNote: z.string().optional(),
})
export type DirectorCard = z.infer<typeof directorCardSchema>
export const parseDirectorCard = (value: unknown): DirectorCard => directorCardSchema.parse(value)
