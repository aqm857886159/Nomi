import { z } from 'zod'
import { aiSceneSchema } from './aiSceneSchema'
import { EVAL_SHOT_SIZES, CAMERA_MOVES, DIRECTOR_PLACEMENT_RELATIONS, DIRECTOR_SCENE_TEMPLATES } from './vocab'

const finite = z.number().finite()
const windowSchema = z.tuple([finite.nonnegative(), finite.nonnegative()]).refine(([a, b]) => b > a, 'window end must be greater than start')
const relation = z.enum(DIRECTOR_PLACEMENT_RELATIONS)
const environment = z.enum(['day', 'night', 'studio'])
const template = z.enum(DIRECTOR_SCENE_TEMPLATES)
const actorKind = z.enum(['person', 'vehicle', 'product', 'prop'])
const anchorName = z.string().regex(/^[a-z][a-z0-9_]*$/)
const move = z.enum(CAMERA_MOVES)
const extendedMove = z.union([move, z.enum(['pan', 'tilt', 'whip', 'rack_focus'])])

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
    size: z.enum(EVAL_SHOT_SIZES),
    angle: z.union([z.enum(['front', 'three_quarter', 'side', 'side_rear', 'back']), z.object({ over_shoulder: z.string().min(1) }), z.object({ pov: z.string().min(1) })]),
    height: z.enum(['eye', 'low', 'high', 'overhead']),
    move: z.object({ kind: z.union([extendedMove, z.literal('follow'), z.literal('static')]), direction: z.enum(['left', 'right', 'up', 'down', 'forward', 'backward']).optional(), amount: finite.positive().optional(), speed: z.enum(['slow', 'medium', 'fast']).default('medium'), easing: z.enum(['linear', 'ease_in', 'ease_out', 'ease_in_out']).default('linear') }),
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

/** Model projection derives field constraints from the execution contract. */
const planShape = directorPlanSchema.innerType().shape
const sceneShape = planShape.scene.shape
const actorShape = planShape.actors.element.shape
const blockingShape = planShape.blocking.removeDefault().element.shape
const shotShape = planShape.shots.element.shape
const pieceShape = sceneShape.setPieces.removeDefault().element.shape
const moveShape = shotShape.move.shape
const vectorModel = z.object({
  x: finite.describe('Local horizontal offset in meters.'),
  y: finite.describe('Local vertical offset in meters.'),
  z: finite.describe('Local depth offset in meters.'),
}).strict().describe('Named part offset relative to its actor.')
const dressingElement = aiSceneSchema.shape.groups.element.shape.elements.removeDefault().element
const dressingShape = dressingElement.shape
const dressingModel = aiSceneSchema.extend({
  sceneName: aiSceneSchema.shape.sceneName.describe('User-language name of the setting.'),
  sceneConfig: aiSceneSchema.shape.sceneConfig.unwrap().extend({
    skyColor: aiSceneSchema.shape.sceneConfig.unwrap().shape.skyColor.describe('Sky color as #rrggbb.'),
    groundOpacity: aiSceneSchema.shape.sceneConfig.unwrap().shape.groundOpacity.describe('Ground opacity from 0 to 1.'),
  }).strict().optional().describe('Optional appearance of the setting.'),
  groups: z.array(aiSceneSchema.shape.groups.element.extend({
    name: aiSceneSchema.shape.groups.element.shape.name.describe('Name of this set-piece group.'),
    elements: z.array(dressingElement.extend({
      type: dressingShape.type.describe('Primitive geometry type.'),
      name: dressingShape.name.describe('User noun naming this piece.'),
      position: dressingShape.position.describe('Center [x,y,z] in meters.'),
      rotation: dressingShape.rotation.describe('Euler [x,y,z] in degrees.'),
      scale: dressingShape.scale.describe('Dimensions [x,y,z] in meters.'),
      color: dressingShape.color.describe('Surface color as #rrggbb.'),
      roughness: dressingShape.roughness.describe('Surface roughness from 0 to 1.'),
      metalness: dressingShape.metalness.describe('Metalness from 0 to 1.'),
      opacity: dressingShape.opacity.describe('Opacity from 0 to 1.'),
      wireframe: dressingShape.wireframe.describe('Whether to show wireframe geometry.'),
      flatShading: dressingShape.flatShading.describe('Whether to use flat shading.'),
    }).strict()).default([]).describe('Primitive objects in this group.'),
  }).strict()).min(1).describe('Named groups of scene dressing.'),
}).strict()
const modelMoveKinds = z.enum([...move.options, 'pan', 'tilt', 'whip', 'rack_focus', 'follow', 'static'])

export const directorPlanModelSchema = directorPlanSchema.innerType().extend({
  // A numeric singleton range preserves v2 without emitting unsupported const.
  version: z.number().int().min(2).max(2).default(2).describe('Director plan version; always 2.'),
  scene: planShape.scene.extend({
    tags: sceneShape.tags.describe('Scene nouns and constraints copied from the user wording.'),
    environment: sceneShape.environment.describe('Lighting context: day, night, or studio.'),
    template: sceneShape.template.describe('Closest supported scene template.'),
    dressing: dressingModel.optional().describe('Optional primitive scene dressing.'),
    setPieces: z.array(sceneShape.setPieces.removeDefault().element.extend({
      id: pieceShape.id.describe('Stable id of this named scene piece.'),
      kind: pieceShape.kind.describe('Scene-piece noun copied from the user wording.'),
      relation: pieceShape.relation.unwrap().extend({
        type: pieceShape.relation.unwrap().shape.type.describe('Spatial relation to the reference.'),
        ref: pieceShape.relation.unwrap().shape.ref.describe('Template anchor or earlier set-piece id.'),
      }).strict().optional().describe('Relation to a scene anchor.'),
    }).strict()).default([]).describe('Named scene objects required by the brief.'),
  }).strict().describe('Setting, lighting, and scene objects.'),
  actors: z.array(planShape.actors.element.extend({
    id: actorShape.id.describe('Stable ASCII role id derived from the user noun.'),
    kind: actorShape.kind.describe('Human=person, transport=vehicle, presented item=product, inert item=prop.'),
    desc: actorShape.desc.describe('Actor noun copied verbatim from the user wording.'),
    anchors: z.record(anchorName, vectorModel).optional().describe('Named parts with local offsets; reference as actor.part.'),
    placement: actorShape.placement.extend({
      relation: actorShape.placement.shape.relation.describe('Spatial relation to the reference.'),
      ref: actorShape.placement.shape.ref.describe('Template anchor, set-piece id, or actor id.'),
    }).strict().describe('Initial actor placement.'),
  }).strict()).min(1).describe('All subjects named in the brief.'),
  blocking: z.array(planShape.blocking.removeDefault().element.extend({
    actor: blockingShape.actor.describe('Actor performing this action.'),
    verb: blockingShape.verb.describe('Movement or pose intent.'),
    target: blockingShape.target.describe('Destination or focus actor/set-piece id.'),
    window: blockingShape.window.describe('Increasing [start,end] time window in seconds.'),
    action: blockingShape.action.describe('Optional action-library id; unavailable actions remain explicit gaps.'),
  }).strict()).default([]).describe('Time-coded actor movement and pose.'),
  shots: z.array(planShape.shots.element.extend({
    id: shotShape.id.describe('Stable shot name.'),
    window: shotShape.window.describe('Increasing [start,end] time window in seconds.'),
    transitionIn: shotShape.transitionIn.describe('Cut or continuous transition from the previous shot.'),
    subject: shotShape.subject.describe('Primary actor id or actor.part reference.'),
    subjects: shotShape.subjects.describe('Other actors simultaneously framed in this shot.'),
    size: shotShape.size.describe('Requested shot size, widest "远景" to tightest "大特写".'),
    angle: z.union([
      shotShape.angle.options[0],
      shotShape.angle.options[1].extend({ over_shoulder: shotShape.angle.options[1].shape.over_shoulder.describe('Actor whose shoulder is foreground.') }).strict(),
      shotShape.angle.options[2].extend({ pov: shotShape.angle.options[2].shape.pov.describe('Actor whose viewpoint is used.') }).strict(),
    ]).describe('Camera angle or actor-relative point of view.'),
    height: shotShape.height.describe('Camera height relative to the subject.'),
    move: shotShape.move.extend({
      kind: modelMoveKinds.describe('Camera movement using the supported vocabulary.'),
      direction: moveShape.direction.describe('Direction requested by the user.'),
      amount: moveShape.amount.describe('Orbit/arc/pan degrees, translation meters, zoom degrees of FOV.'),
      speed: moveShape.speed.describe('Camera movement speed.'),
      easing: moveShape.easing.describe('Camera movement easing.'),
    }).strict().describe('Camera movement intent.'),
  }).strict()).min(1).describe('Ordered shots covering the whole brief.'),
}).strict().describe('Director Plan v2 model-facing projection; execution validation still checks references.')

const ENUM_ALIASES: Record<string, string> = {
  // These Chinese day terms are exact synonyms of the single `day` enum.
  白天: 'day', 白昼: 'day', daytime: 'day',
  // These Chinese night terms are exact synonyms of the single `night` enum.
  夜晚: 'night', 夜间: 'night',
  // These studio terms all name the same studio environment.
  摄影棚: 'studio', 棚拍: 'studio',
  // `街道` is the direct Chinese equivalent of the `street` template.
  街道: 'street',
  // These room terms are direct labels for the room template, without shot-direction meaning.
  房间: 'room', 室内: 'room',
  // `庭院` is the direct Chinese equivalent of the `courtyard` template.
  庭院: 'courtyard',
  // These actor-kind terms preserve the schema's four-way kind distinction.
  人: 'person', 人物: 'person', 角色: 'person', 车辆: 'vehicle', 汽车: 'vehicle', 车: 'vehicle', 产品: 'product', 道具: 'prop',
  // Each relation term is a direct bilingual or inflected spelling of one relation enum.
  附近: 'near', 前方: 'in_front_of', 前面: 'in_front_of', 后方: 'behind', 后面: 'behind', 左侧: 'left_of', 右侧: 'right_of',
  位于: 'at', 沿着: 'along',
  // These movement verbs preserve the requested action and do not choose a direction.
  走: 'walk_to', 行走: 'walk_to', walking: 'walk_to', walk: 'walk_to', 跑: 'run_to', 奔跑: 'run_to', run: 'run_to',
  停止: 'stop', 停下: 'stop', 横移: 'sidestep', 侧步: 'sidestep', 驾驶: 'drive_along', 开车: 'drive_along', 追逐: 'chase', 追赶: 'chase', 保持姿势: 'hold_pose',
  // `medium` is the only English size synonym with a one-to-one Chinese enum here.
  medium: '中景',
  // Push/pull spellings preserve direction; separators are removed by `alias`.
  push: 'push_in', pushin: 'push_in', pull: 'pull_out', pullout: 'pull_out',
  // These names are exact canonical spellings or separator/case variants.
  follow: 'follow', whip: 'whip', rackfocus: 'rack_focus',
  cut: 'cut', continuous: 'continuous',
}

function alias(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim(), key = trimmed.toLowerCase().replace(/[\s_-]+/g, '')
  return ENUM_ALIASES[trimmed] ?? ENUM_ALIASES[key] ?? trimmed
}

function normalizeMove(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const move = { ...(value as Record<string, unknown>) }
  move.kind = alias(move.kind)
  // `in`/`out` are unambiguous direction shorthands; no camera kind is inferred.
  if (move.direction === 'in') move.direction = 'forward'
  if (move.direction === 'out') move.direction = 'backward'
  return move
}

export function normalizeDirectorPlan(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const input = value as Record<string, unknown>
  const scene = input.scene && typeof input.scene === 'object' ? { ...(input.scene as Record<string, unknown>) } : input.scene
  const sceneRecord = scene && typeof scene === 'object' && !Array.isArray(scene) ? scene as Record<string, unknown> : undefined
  if (sceneRecord) {
    sceneRecord.environment = alias(sceneRecord.environment)
    sceneRecord.template = alias(sceneRecord.template)
    if (Array.isArray(sceneRecord.setPieces)) sceneRecord.setPieces = sceneRecord.setPieces.map((piece: unknown) => {
      if (!piece || typeof piece !== 'object') return piece
      const next = { ...(piece as Record<string, unknown>) }
      next.relation = next.relation && typeof next.relation === 'object' ? { ...(next.relation as Record<string, unknown>), type: alias((next.relation as Record<string, unknown>).type) } : next.relation
      return next
    })
  }
  const actors = Array.isArray(input.actors) ? input.actors.map((actor) => {
    if (!actor || typeof actor !== 'object') return actor
    const next = { ...(actor as Record<string, unknown>) }
    next.kind = alias(next.kind)
    if (next.placement && typeof next.placement === 'object') next.placement = { ...(next.placement as Record<string, unknown>), relation: alias((next.placement as Record<string, unknown>).relation) }
    return next
  }) : input.actors
  const blocking = Array.isArray(input.blocking) ? input.blocking.map((action) => {
    if (!action || typeof action !== 'object') return action
    const next: Record<string, unknown> = { ...(action as Record<string, unknown>), verb: alias((action as Record<string, unknown>).verb) }
    if (typeof next.action === 'string') next.action = next.action.trim().toLowerCase().replace(/[\s-]+/g, '_')
    return next
  }) : input.blocking
  const shots = Array.isArray(input.shots) ? input.shots.map((shot) => {
    if (!shot || typeof shot !== 'object') return shot
    const next = { ...(shot as Record<string, unknown>) }
    next.size = alias(next.size)
    next.transitionIn = alias(next.transitionIn)
    if (typeof next.angle === 'string') {
      const angle = next.angle.trim().toLowerCase().replace(/[\s-]+/g, '_')
      const over = angle.match(/^(?:over_shoulder|overshoulder)[(:]([^)]*)\)?$/)
      const pov = angle.match(/^pov[(:]([^)]*)\)?$/)
      next.angle = over ? { over_shoulder: over[1] } : pov ? { pov: pov[1] } : alias(angle)
    }
    next.move = normalizeMove(next.move)
    return next
  }) : input.shots
  return { ...input, scene, actors, blocking, shots }
}

export function parseDirectorPlan(value: unknown): { success: true; data: DirectorPlan } | { success: false; error: z.ZodError } {
  const result = directorPlanSchema.safeParse(normalizeDirectorPlan(value))
  return result.success ? result : { success: false, error: result.error }
}
