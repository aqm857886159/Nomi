/**
 * [INPUT]: 计划（DirectorPlan）、s1SceneTemplates（模板件 + 命名站位 + 可站区域）、vocab 的 stageKindOf / isEnvironmentWord（名词 → 舞台种类）、
 *          directorSpace（包围盒与「底 → 原点」换算）、aiScene 的 normalizeAiScene（dressing 物化）
 * [OUTPUT]: 对外提供 Stage / StageThing / StageRole、buildStage（计划 → 舞台：每个东西带种类、角色、真尺寸来源、朝向；布景件按关系词落到站位）、
 *          actorBody（演员的渲染图元与尺寸）、resolveRef（计划里的引用名 → 舞台上的东西）
 * [POS]: 编译器的「舞台模型」层：计划进、舞台出，编译器后面的摆位 / 走位 / 机位只读舞台，不再从名字、scale、坐标里反推「这是什么、多大」。
 *        不改计划契约：稳定 id 仍是 s1-* / setPiece:* / actor:*；同名合并的布景件留一个辅助分组保住它的 id。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorObject, DirectorObjectType, Vec3 } from '../directorTypes'
import { boundsSource, originYForBottom } from '../directorSpace'
import { normalizeAiScene } from '../aiScene'
import { isEnvironmentWord, stageKindOf, type DirectorStageKind } from '../../../../../../../electron/shared/director/vocab'
import type { DirectorPlan, DirectorPlanActor } from '../../../../../../../electron/shared/director/directorPlanSchema'
import { buildS1Template, type StageArea, type TemplateMark } from './s1SceneTemplates'
import { resolvePlacement, yawToward } from './stageRelations'

/** 舞台角色：关系词的空间含义按它解释（站在地面上 / 站到结构前 / 家具靠里放 / 演员 / 拿在手里）。 */
export type StageRole = 'surface' | 'structure' | 'furniture' | 'performer' | 'handheld'
/** 尺寸从哪来：render = 模板作者按渲染真值摆的 / 角色骨骼；typical = 认得种类、取典型尺寸；measured = 模型实量；unknown = 认不出，兜底方盒（报问题）。 */
export type SizeSource = 'render' | 'typical' | 'measured' | 'unknown'
export type StageThing = {
  objectId: string
  planId?: string
  kind: DirectorStageKind | DirectorPlanActor['kind']
  role: StageRole
  object: DirectorObject
  sizeSource: SizeSource
  /** 朝向（yaw 度，0 = +Z 朝观众）：结构朝场景内侧，演员由关系解析定。 */
  facing: number
}
export type StageMark = TemplateMark
export type StageIssue = { kind: 'nominal-size'; objectId: string; message: string }
export type Stage = {
  things: StageThing[]
  marks: StageMark[]
  interior?: StageArea
  /** 计划里的引用名（模板件 id、布景件 id、演员 id）→ 舞台上的东西。 */
  refs: Map<string, StageThing>
  /** 要进工程的对象（含同名合并留下的辅助分组），顺序即工程顺序。 */
  objects: DirectorObject[]
  issues: StageIssue[]
}

type Body = { type: DirectorObjectType; scale: Vec3; role: StageRole }
// 典型尺寸（米）：认得种类就按真实世界的典型大小摆，不再一律 1.4 米灰盒。只服务计划里没有尺寸的名词。
const KIND_BODY: Record<DirectorStageKind, Body> = {
  ground: { type: 'cube', scale: { x: 10, y: 0.05, z: 10 }, role: 'surface' },
  road: { type: 'cube', scale: { x: 3, y: 0.2, z: 10 }, role: 'surface' },
  wall: { type: 'cube', scale: { x: 4, y: 3, z: 0.3 }, role: 'structure' },
  gate: { type: 'cube', scale: { x: 2.5, y: 2.4, z: 0.35 }, role: 'structure' },
  tree: { type: 'cylinder', scale: { x: 1.2, y: 3, z: 1.2 }, role: 'structure' },
  building: { type: 'cube', scale: { x: 6, y: 6, z: 6 }, role: 'structure' },
  backdrop: { type: 'cube', scale: { x: 6, y: 4, z: 0.2 }, role: 'structure' },
  pedestal: { type: 'cylinder', scale: { x: 0.8, y: 1, z: 0.8 }, role: 'furniture' },
  table: { type: 'cube', scale: { x: 1.2, y: 0.75, z: 0.8 }, role: 'furniture' },
  seat: { type: 'cube', scale: { x: 0.6, y: 0.45, z: 0.6 }, role: 'furniture' },
  counter: { type: 'cube', scale: { x: 2, y: 1.05, z: 0.6 }, role: 'furniture' },
  paper: { type: 'cube', scale: { x: 0.22, y: 0.3, z: 0.02 }, role: 'handheld' },
  small_item: { type: 'cube', scale: { x: 0.15, y: 0.15, z: 0.15 }, role: 'handheld' },
}
const UNKNOWN_PIECE: Body = { type: 'cube', scale: { x: 1.4, y: 1, z: 1.4 }, role: 'furniture' }
const UNKNOWN_PROP: Body = { type: 'cube', scale: { x: 1, y: 1, z: 1 }, role: 'furniture' }
const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

// 模型偶尔会把模板件写成人话标签；在舞台边界做无损别名，不让一个拼写把整个演员丢掉
const TEMPLATE_ALIASES: Record<string, string> = {
  's1-product_stage-floor': 's1-product-ground',
  's1-product-stage-floor': 's1-product-ground',
  's1-product-floor': 's1-product-ground',
  's1-courtyard-floor': 's1-courtyard-ground',
  's1-room-ground': 's1-room-floor',
  's1-street-floor': 's1-street-ground',
}

const personRefs = (plan: DirectorPlan) => new Set(plan.actors.filter((actor) => actor.kind === 'person').map((actor) => actor.id))

/** 演员的渲染图元与尺寸：人 = 角色骨骼；车 / 产品 = 典型尺寸；道具按名词认种类，挂在人身上 / 人旁边的认不出也按手持小件。 */
export function actorBody(actor: DirectorPlanActor, plan: DirectorPlan): Body & { kind: StageThing['kind']; sizeSource: SizeSource } {
  if (actor.kind === 'person') return { type: 'character', scale: v(1, 1, 1), role: 'performer', kind: 'person', sizeSource: 'render' }
  if (actor.kind === 'vehicle') return { type: 'cube', scale: v(1.8, 1, 4), role: 'performer', kind: 'vehicle', sizeSource: 'typical' }
  if (actor.kind === 'product') return { type: 'cylinder', scale: v(1.3, 1.3, 1.3), role: 'performer', kind: 'product', sizeSource: 'typical' }
  const kind = stageKindOf(actor.desc) ?? stageKindOf(actor.id)
  if (kind) return { ...KIND_BODY[kind], kind, sizeSource: 'typical' }
  if (personRefs(plan).has(actor.placement.ref)) return { ...KIND_BODY.small_item, kind: 'small_item', sizeSource: 'typical' }
  return { ...UNKNOWN_PROP, kind: 'prop', sizeSource: 'unknown' }
}

/** 计划里的引用名 → 舞台上的东西：先认名字（模板件 id、布景件 id、演员 id、别名），认不到再按名词的舞台种类认（「gate」= 场上唯一的门）。 */
export function resolveRef(stage: Stage, ref: string | undefined): StageThing | undefined {
  if (!ref) return undefined
  const named = stage.refs.get(ref)
  if (named) return named
  const kind = stageKindOf(ref)
  const sameKind = kind ? stage.things.filter((thing) => thing.kind === kind) : []
  return sameKind.length === 1 ? sameKind[0] : undefined
}

/** 计划 → 舞台（模板件、布景件、dressing；演员的位置由关系解析决定，这里只登记他们的身体）。 */
export function buildStage(plan: DirectorPlan): Stage {
  const template = plan.scene.template ? buildS1Template(plan.scene.template) : undefined
  const inward = template ? { x: (template.interior.minX + template.interior.maxX) / 2, z: (template.interior.minZ + template.interior.maxZ) / 2 } : { x: 0, z: 0 }
  const things: StageThing[] = (template?.parts ?? []).map((item) => {
    const role = KIND_BODY[item.kind].role
    // 结构朝场景内侧（「院门前」= 院门朝院里那一面的前方）；地面与家具朝观众
    const facing = role === 'structure' ? yawToward(item.object.position, inward) : 0
    return { objectId: item.object.id, planId: item.object.id, kind: item.kind, role, object: item.object, sizeSource: 'render' as const, facing }
  })
  const refs = new Map<string, StageThing>(things.map((thing) => [thing.objectId, thing]))
  for (const [alias, id] of Object.entries(TEMPLATE_ALIASES)) if (refs.has(id)) refs.set(alias, refs.get(id)!)
  const objects = things.map((thing) => thing.object)
  const issues: StageIssue[] = []
  const ground = things.find((thing) => thing.role === 'surface' && thing.kind === 'ground')
  const auxiliary = (id: string, name: string, at: Vec3): DirectorObject => ({ id, name, type: 'group', position: v(at.x, 0, at.z), rotation: v(), scale: v(1, 1, 1), visible: true, locked: true, isAuxiliary: true })

  for (const [index, piece] of plan.scene.setPieces.entries()) {
    const id = `setPiece:${piece.id}`
    const anchor = piece.relation?.ref ? refs.get(piece.relation.ref) : undefined
    // 环境词（room / interior / 街道……）由场景模板承担，不是舞台上的一件东西：留一个不渲染的辅助分组做名字对应，引用它落到模板地面
    if (isEnvironmentWord(piece.kind)) {
      const aux = auxiliary(id, piece.kind, ground?.object.position ?? v())
      objects.push(aux)
      refs.set(piece.id, ground ?? { objectId: id, planId: piece.id, kind: 'ground', role: 'surface', object: aux, sizeSource: 'render', facing: 0 })
      continue
    }
    const kind = stageKindOf(piece.kind)
    // 同名合并：计划里的布景件与模板里同种类的件是同一个东西（「院门 at s1-courtyard-gate」= 模板院门），不造第二个盒子。
    // 辅助分组保住 setPiece:<id> 这个稳定 id。
    const sameKind = kind ? things.filter((thing) => thing.kind === kind && thing.sizeSource === 'render') : []
    const merged = anchor && anchor.kind === kind ? anchor : sameKind.length === 1 ? sameKind[0] : undefined
    if (merged) {
      objects.push(auxiliary(id, piece.kind, merged.object.position))
      refs.set(piece.id, merged)
      continue
    }
    const body = kind ? KIND_BODY[kind] : UNKNOWN_PIECE
    const object: DirectorObject = { id, name: piece.kind, type: body.type, scale: body.scale, position: v(), rotation: v(), visible: true, locked: true, isAuxiliary: false }
    // 布景件和演员走同一套关系解析：家具 at 地面 = 地面的布景站位（靠里，不挡镜头一侧）；没写关系的按 at 地面
    const ref = anchor ?? ground
    const stage: Stage = { things, marks: template?.marks ?? [], interior: template?.interior, refs, objects, issues }
    const slot = things.filter((thing) => thing.objectId.startsWith('setPiece:')).length
    // 上面放着演员（主体放在柜台 / 展台上）的家具就是表演区：站到演员站位，不靠里放
    const carriesPerformer = plan.actors.some((actor) => actor.placement.relation === 'on' && actor.placement.ref === piece.id)
    const placement = ref
      ? resolvePlacement(stage, object, carriesPerformer ? 'performer' : body.role, ref === anchor ? piece.relation!.type : 'at', ref, slot, [])
      : { position: v(((index % 3) - 1) * 2.5, originYForBottom(body, 0), Math.floor(index / 3) * 2), facing: 0 }
    object.position = placement.position
    const thing: StageThing = { objectId: id, planId: piece.id, kind: kind ?? 'prop', role: body.role, object, sizeSource: kind ? 'typical' : 'unknown', facing: placement.facing }
    if (!kind) issues.push({ kind: 'nominal-size', objectId: id, message: `set piece ${piece.id} (${piece.kind}) has no known stage kind; placed as a nominal block` })
    things.push(thing)
    refs.set(piece.id, thing)
    objects.push(object)
  }

  for (const object of materializeDressing(plan)) {
    const kind = stageKindOf(object.name)
    things.push({ objectId: object.id, kind: kind ?? 'prop', role: kind ? KIND_BODY[kind].role : 'furniture', object, sizeSource: 'render', facing: 0 })
    objects.push(object)
  }
  // 尺寸是兜底值的东西（模型没量过包围盒）明着报出来：摆位、视线都按 1 米方盒算，不可信
  for (const thing of things)
    if (boundsSource(thing.object) === 'nominal' && thing.object.type === 'model')
      issues.push({ kind: 'nominal-size', objectId: thing.objectId, message: `model ${thing.objectId} has no measured bounds yet; using a nominal 1m box` })
  return { things, marks: template?.marks ?? [], interior: template?.interior, refs, objects, issues }
}

function materializeDressing(plan: DirectorPlan): DirectorObject[] {
  if (!plan.scene.dressing) return []
  const normalized = normalizeAiScene(plan.scene.dressing, `${plan.scene.tags.join('-') || 's1'} dressing`)
  return normalized.groups.flatMap((group, gi) =>
    group.elements.map((element, ei) => ({
      id: `dressing:${gi}:${ei}`,
      name: element.name,
      type: element.type,
      position: element.position,
      rotation: element.rotation,
      scale: element.scale,
      color: element.color,
      roughness: element.roughness,
      metalness: element.metalness,
      opacity: element.opacity,
      wireframe: element.wireframe,
      flatShading: element.flatShading,
      visible: true,
      locked: true,
      isAuxiliary: false,
    })),
  )
}
