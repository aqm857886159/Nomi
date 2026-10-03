import { z } from 'zod'
import { aiSceneSchema } from '../aiScene'
import { EVAL_SHOT_SIZES, type EvalShotSize } from '../directorEvalMeasurement'
import { CAMERA_MOVES, type CameraMove } from '../../agent/cameraMoveVocab'

const finite = z.number().finite()
const windowSchema = z.tuple([finite.nonnegative(), finite.nonnegative()]).refine(([a, b]) => b > a, 'window end must be greater than start')
const relation = z.enum(['near', 'in_front_of', 'behind', 'left_of', 'right_of', 'on', 'between', 'along', 'at'])
const environment = z.enum(['day', 'night', 'studio'])
const template = z.enum(['street', 'room', 'courtyard', 'product_stage'])
const actorKind = z.enum(['person', 'vehicle', 'product', 'prop'])
const anchorName = z.string().regex(/^[a-z][a-z0-9_]*$/)
const move = z.enum(CAMERA_MOVES as [CameraMove, ...CameraMove[]])

export const directorPlanSchema = z.object({
  version: z.literal(2).default(2),
  scene: z.object({
    tags: z.array(z.string().min(1)).default([]),
    environment,
    template: template.optional(),
    dressing: aiSceneSchema.optional(),
    setPieces: z.array(z.object({ id: z.string().min(1), kind: z.string().min(1), relation: z.object({ type: relation, ref: z.string().min(1) }).optional() })).default([]),
  }),
  actors: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
    kind: actorKind,
    desc: z.string().min(1),
    anchors: z.record(anchorName, z.object({ x: finite, y: finite, z: finite }).optional()).optional(),
    placement: z.object({ relation, ref: z.string().min(1) }),
  })).min(1),
  blocking: z.array(z.object({
    actor: z.string().min(1),
    verb: z.enum(['walk_to', 'run_to', 'stop', 'sidestep', 'turn_to', 'hold_pose', 'drive_along', 'chase', 'static']),
    target: z.string().min(1).optional(),
    window: windowSchema,
    // Keep semantic intent open. The compiler resolves the small real asset
    // library and reports missing_asset for an unavailable pose instead of
    // manufacturing a clip name that cannot render.
    action: z.string().min(1).optional(),
  })).default([]),
  shots: z.array(z.object({
    id: z.string().min(1),
    window: windowSchema,
    transitionIn: z.enum(['cut', 'continuous']),
    subject: z.string().min(1),
    subjects: z.array(z.string().min(1)).optional(),
    size: z.enum(EVAL_SHOT_SIZES as [EvalShotSize, ...EvalShotSize[]]),
    angle: z.union([z.enum(['front', 'three_quarter', 'side', 'side_rear', 'back']), z.object({ over_shoulder: z.string().min(1) }), z.object({ pov: z.string().min(1) })]),
    height: z.enum(['eye', 'low', 'high', 'overhead']),
    move: z.object({ kind: z.union([move, z.literal('follow'), z.literal('static')]), direction: z.enum(['left', 'right', 'up', 'down', 'forward', 'backward']).optional(), amount: finite.positive().optional(), speed: z.enum(['slow', 'medium', 'fast']).default('medium'), easing: z.enum(['linear', 'ease_in', 'ease_out', 'ease_in_out']).default('linear') }),
  }).strict()).min(1),
}).strict().superRefine((plan, ctx) => {
  const actorIds = new Set(plan.actors.map(a => a.id))
  const refs = new Set([...actorIds, ...plan.scene.setPieces.map(p => p.id)])
  for (const actor of plan.actors) if (!refs.has(actor.placement.ref) && !actor.placement.ref.startsWith('s1-')) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['actors', actor.id, 'placement', 'ref'], message: `unknown placement ref ${actor.placement.ref}` })
  for (const shot of plan.shots) {
    const root = shot.subject.split('.')[0]
    if (!actorIds.has(root)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shots', shot.id, 'subject'], message: `unknown subject ${root}` })
  }
})

export type DirectorPlan = z.infer<typeof directorPlanSchema>
export type DirectorPlanShot = DirectorPlan['shots'][number]
export type DirectorPlanActor = DirectorPlan['actors'][number]

export function parseDirectorPlan(value: unknown): { success: true; data: DirectorPlan } | { success: false; error: z.ZodError } {
  const result = directorPlanSchema.safeParse(value)
  return result.success ? result : { success: false, error: result.error }
}
