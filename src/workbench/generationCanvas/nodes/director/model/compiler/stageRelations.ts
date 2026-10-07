/**
 * [INPUT]: directorStage 的 Stage / StageThing（舞台：种类、角色、站位、可站区域）、vocab 的 DIRECTOR_RELATION_SPACE（关系词的空间含义）、
 *          directorSpace（包围盒、「底 / 中心 → 原点」换算）
 * [OUTPUT]: 对外提供 resolvePlacement（一个东西按关系词落到哪、朝哪）、destinationFor（走位终点：走到站位 / 走到某人跟前）、
 *          clearOfSolids（落脚点不进实心物体）、carryGroups（拿在手里 = 人和东西挂在同一个携带分组下）、yawToward / yawVector（朝向换算）
 * [POS]: 舞台模型的关系解析：关系词按参照物的舞台角色一次性解析成站位与朝向。全部规则按「一类东西」写（地面 / 结构 / 家具 / 演员 / 手持物），
 *        不按「谁和谁」写特例；新组合（人-门、人-桌、车-车）走同一条公式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorObject, Vec3 } from '../directorTypes'
import { originYForBottom, originYForCenter, scaledBounds } from '../directorSpace'
import { DIRECTOR_RELATION_SPACE, type DirectorPlacementRelation } from '../../../../../../../electron/shared/director/vocab'
import type { Stage, StageRole, StageThing } from './directorStage'

const DEG = Math.PI / 180
const GAP = 0.3 // 两个东西之间留的落脚间隙（米）
const HELD_CENTER_HEIGHT = 1 // 手里拿着的东西：几何中心离地的高度（米）
const OCCUPIED = 0.6 // 站位上已有人（中心距离小于它）就算被占
const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

export const yawVector = (yaw: number) => ({ x: Math.sin(yaw * DEG), z: Math.cos(yaw * DEG) })
export const yawToward = (from: { x: number; z: number }, to: { x: number; z: number }, fallback = 0) =>
  Math.hypot(to.x - from.x, to.z - from.z) < 1e-6 ? fallback : Math.atan2(to.x - from.x, to.z - from.z) / DEG

/** 物体沿水平方向 dir 从中心到边缘有多远（轴对齐包围盒的支撑函数）。 */
function halfAlong(object: Pick<DirectorObject, 'type' | 'scale'>, dir: { x: number; z: number }): number {
  const size = scaledBounds(object).size
  return (Math.abs(dir.x) * size.x) / 2 + (Math.abs(dir.z) * size.z) / 2
}
const centerOf = (object: DirectorObject, position = object.position) => {
  const box = scaledBounds(object)
  return { x: position.x + box.center.x, z: position.z + box.center.z }
}
const topOf = (object: DirectorObject, position = object.position) => position.y + scaledBounds(object).max.y
const isPerson = (thing: Pick<StageThing, 'kind'>) => thing.kind === 'person'

function interiorCenter(stage: Stage) {
  const area = stage.interior
  return area ? { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 } : { x: 0, z: 0 }
}

/** 站位用途：家具 / 结构靠里放（set），演员与手持物站在演员站位（stand）。 */
const markUse = (role: StageRole) => (role === 'furniture' || role === 'structure' ? 'set' : 'stand')

/** 参照物的站位；没有手标站位的件，按同一条规则派生「朝场景内侧那一面外」的站位。 */
function marksFor(stage: Stage, ref: StageThing, body: DirectorObject, role: StageRole): { at: { x: number; z: number }; facing: number }[] {
  const own = stage.marks.filter((mark) => mark.thingId === ref.objectId)
  const wanted = own.filter((mark) => mark.use === markUse(role))
  const chosen = wanted.length ? wanted : own.filter((mark) => mark.use === 'stand')
  if (chosen.length) return chosen
  const c = centerOf(ref.object)
  if (ref.role === 'surface') return [{ at: c, facing: 0 }]
  const inward = interiorCenter(stage)
  const length = Math.hypot(inward.x - c.x, inward.z - c.z)
  const dir = length > 1e-3 ? { x: (inward.x - c.x) / length, z: (inward.z - c.z) / length } : yawVector(ref.facing)
  const distance = halfAlong(ref.object, dir) + halfAlong(body, dir) + GAP
  return [{ at: { x: c.x + dir.x * distance, z: c.z + dir.z * distance }, facing: yawToward({ x: 0, z: 0 }, dir) }]
}

export type Placed = { object: DirectorObject; position: Vec3 }
export type Placement = { position: Vec3; facing: number; heldBy?: string; adjusted: boolean }

/**
 * 一个东西（body：渲染图元 + scale）按关系词落到参照 ref 的哪里、朝哪。
 * slot = 已经有几个东西用同一个参照摆过（near 左右交替、along 依次排开）；placed = 已经摆好的东西（站位占用、互相不进）。
 */
export function resolvePlacement(stage: Stage, body: DirectorObject, role: StageRole, relation: DirectorPlacementRelation, ref: StageThing, slot: number, placed: Placed[]): Placement {
  const space = DIRECTOR_RELATION_SPACE[relation]
  const refPosition = placed.find((item) => item.object.id === ref.objectId)?.position ?? ref.object.position
  const c = centerOf(ref.object, refPosition)
  // 手持物和人「在一起」（on / at / near 一个人）= 拿在他手里；任何东西 on 一个人也一样
  if (isPerson(ref) && (space.frame === 'support' || (role === 'handheld' && space.frame === 'mark')))
    return { position: v(refPosition.x, originYForCenter(body, HELD_CENTER_HEIGHT), refPosition.z), facing: ref.facing, heldBy: ref.objectId, adjusted: false }
  if (space.frame === 'support')
    return { position: v(c.x, originYForBottom(body, topOf(ref.object, refPosition)), c.z), facing: ref.facing, adjusted: false }
  let at: { x: number; z: number }
  let facing = ref.facing
  if (space.frame === 'mark' && ref.role !== 'performer') {
    const marks = marksFor(stage, ref, body, role)
    const free = marks.find((mark) => !placed.some((item) => Math.hypot(item.position.x - mark.at.x, item.position.z - mark.at.z) < OCCUPIED))
    const mark = free ?? marks[0]
    at = { ...mark.at }
    facing = mark.facing
    // near / 站位已被占：在站位左右横向错开（第 k 个：+1、-1、+2、-2 … 个间距）
    const k = space.lateral || !free ? slot + 1 : 0
    if (k) {
      const side = yawVector(facing + 90)
      const step = Math.max(DIRECTOR_RELATION_SPACE.near.spacing, halfAlong(body, side) * 2 + GAP)
      const offset = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step
      at = { x: at.x + side.x * offset, z: at.z + side.z * offset }
    }
  } else {
    const angle = space.frame === 'facing' ? ref.facing + (space.direction ?? 0) : space.frame === 'screen' ? (space.direction ?? 90) : space.frame === 'axis'
      ? (scaledBounds(ref.object).size.x >= scaledBounds(ref.object).size.z ? 90 : 0)
      : (slot % 2 ? -90 : 90) // mark 关系但参照是演员：在他左右（画面左右）
    const dir = yawVector(angle)
    const distance = space.frame === 'axis' ? space.spacing * (slot + 1) : Math.max(space.spacing, halfAlong(ref.object, dir) + halfAlong(body, dir) + GAP)
    at = { x: c.x + dir.x * distance, z: c.z + dir.z * distance }
    if (space.faceRef && isPerson(ref)) facing = yawToward(at, c, ref.facing)
  }
  const position = v(at.x, originYForBottom(body, 0), at.z)
  const settled = settle(stage, body, position, placed, interiorCenter(stage))
  return { position: settled, facing, adjusted: settled.x !== position.x || settled.z !== position.z }
}

/** 落到可站区域里（扣掉自己的半宽），再退出所有实心物体。 */
function settle(stage: Stage, body: DirectorObject, position: Vec3, placed: Placed[], retreatTo: { x: number; z: number }): Vec3 {
  const p = { ...position }
  const area = stage.interior
  if (area) {
    const half = scaledBounds(body).size
    p.x = Math.min(area.maxX - half.x / 2, Math.max(area.minX + half.x / 2, p.x))
    p.z = Math.min(area.maxZ - half.z / 2, Math.max(area.minZ + half.z / 2, p.z))
  }
  const solids = [...stage.things.filter((thing) => !placed.some((item) => item.object.id === thing.objectId)).map((thing) => ({ object: thing.object, position: thing.object.position })), ...placed]
  return clearOfSolids(p, body, solids, () => ({ x: retreatTo.x - p.x, y: 0, z: retreatTo.z - p.z }))
}

const blocks = (object: DirectorObject) => object.visible && !object.isAuxiliary && object.type !== 'plane' && object.type !== 'group'
/**
 * 站位不进实心物体：把落脚点沿 retreat（水平方向）推到所有挡路实心物体（外扩自己半宽）之外。
 * 只看和自己身高有竖直交集、且不是地面 / 路面这类薄板的东西。全场只有这一条规则（用 directorSpace 的包围盒）。
 */
export function clearOfSolids(point: Vec3, body: DirectorObject, obstacles: Placed[], retreat: (box: { min: Vec3; max: Vec3 }) => Vec3): Vec3 {
  const bounds = scaledBounds(body)
  const half = { x: bounds.size.x / 2, z: bounds.size.z / 2 }
  const p = { ...point }
  for (let pass = 0; pass < 8; pass += 1) {
    const hit = obstacles
      .filter(({ object }) => object.id !== body.id && blocks(object))
      .map(({ object, position }) => {
        const box = scaledBounds(object)
        return { min: v(position.x + box.min.x, position.y + box.min.y, position.z + box.min.z), max: v(position.x + box.max.x, position.y + box.max.y, position.z + box.max.z) }
      })
      .find((box) =>
        box.max.y - box.min.y > 0.3 &&
        box.min.y < p.y + bounds.max.y - 0.02 && box.max.y > p.y + bounds.min.y + 0.02 &&
        p.x > box.min.x - half.x && p.x < box.max.x + half.x && p.z > box.min.z - half.z && p.z < box.max.z + half.z)
    if (!hit) break
    const direction = retreat(hit)
    const length = Math.hypot(direction.x, direction.z)
    // 没有明确的退路方向（在场景中心）就朝 +z（面向观众那一侧）退
    const d = length > 1e-6 ? { x: direction.x / length, z: direction.z / length } : { x: 0, z: 1 }
    const exits = [
      d.x > 1e-6 ? (hit.max.x + half.x - p.x) / d.x : d.x < -1e-6 ? (hit.min.x - half.x - p.x) / d.x : Infinity,
      d.z > 1e-6 ? (hit.max.z + half.z - p.z) / d.z : d.z < -1e-6 ? (hit.min.z - half.z - p.z) / d.z : Infinity,
    ]
    const t = Math.min(...exits)
    if (!Number.isFinite(t)) break
    // 留出落脚间隙：人 30cm，车按车身半长（跟车距离），机位才有地方进去
    const gap = Math.max(GAP, half.z)
    p.x += d.x * (t + gap)
    p.z += d.z * (t + gap)
  }
  return p
}

/**
 * 走位终点：走到参照的站位；站位上已经有人，就停在那人跟前（人际距离，面对他）；参照本身是演员也一样。
 * 「走到院门」= 走到院门里侧的站位，守门人站在那里 = 走到守门人面前。
 */
export function destinationFor(stage: Stage, mover: DirectorObject, from: Vec3, target: StageThing, targetPosition: Vec3, others: Placed[]): { position: Vec3; facing: number } {
  let goal: { thing: StageThing; position: Vec3 } = { thing: target, position: targetPosition }
  if (target.role !== 'performer') {
    const mark = marksFor(stage, target, mover, 'performer')[0]
    const holder = others.find((item) => item.object.id !== mover.id && item.object.type === 'character' && Math.hypot(item.position.x - mark.at.x, item.position.z - mark.at.z) < OCCUPIED * 2)
    if (!holder) {
      const position = settle(stage, mover, v(mark.at.x, from.y, mark.at.z), others, { x: from.x, z: from.z })
      return { position, facing: yawToward(from, position, mark.facing) }
    }
    goal = { thing: { ...target, kind: 'person', role: 'performer', object: holder.object }, position: holder.position }
  }
  const c = centerOf(goal.thing.object, goal.position)
  const away = { x: from.x - c.x, z: from.z - c.z }
  const length = Math.hypot(away.x, away.z)
  const dir = length > 1e-3 ? { x: away.x / length, z: away.z / length } : { x: 0, z: 1 }
  // 跟到人 / 车跟前：中心距离 = max(人际 1.2m, 两者沿来向的半宽之和 + 间隙)——人和车同一条公式
  const distance = Math.max(DIRECTOR_RELATION_SPACE.near.spacing, halfAlong(goal.thing.object, dir) + halfAlong(mover, dir) + GAP)
  const point = v(c.x + dir.x * distance, from.y, c.z + dir.z * distance)
  const position = settle(stage, mover, point, others, { x: from.x, z: from.z })
  return { position, facing: yawToward(position, c) }
}

// 手的位置（持有者局部坐标，米）：身前偏右、离地 1m——和计划里常写的 hand 锚点同一处
const HAND = { x: 0.3, z: 0.25 }
/**
 * 拿在手里：用编辑器现成的父子关系。编辑器的不变量是「父级只能是分组」（normalizeDirectorProject 会剥掉非分组父级），
 * 所以人和东西一起挂到一个携带分组下：分组承载人的落点、朝向与走位轨迹，人在分组原点，东西在手的位置——东西跟着人走，不另写跟随轨迹。
 * holds：携带物对象 id → 持有者对象 id。返回新建的分组（调用方放进工程）。
 */
export function carryGroups(objects: DirectorObject[], holds: ReadonlyMap<string, string>): DirectorObject[] {
  const groups: DirectorObject[] = []
  for (const holderId of new Set(holds.values())) {
    const holder = objects.find((object) => object.id === holderId)
    if (!holder || holder.parentId) continue
    const group: DirectorObject = {
      id: `carry:${holder.id}`, name: holder.name, type: 'group', position: { ...holder.position }, rotation: { ...holder.rotation }, scale: v(1, 1, 1),
      visible: true, locked: false, isAuxiliary: false, motionTrajectory: holder.motionTrajectory, trajectoryClips: holder.trajectoryClips,
    }
    holder.parentId = group.id
    holder.position = v(0, holder.position.y, 0)
    holder.rotation = v()
    delete holder.motionTrajectory
    delete holder.trajectoryClips
    for (const [itemId, owner] of holds) {
      const item = objects.find((object) => object.id === itemId)
      if (!item || owner !== holderId) continue
      item.parentId = group.id
      item.position = v(HAND.x, originYForCenter(item, HELD_CENTER_HEIGHT), HAND.z)
      item.rotation = v()
      delete item.motionTrajectory
      delete item.trajectoryClips
    }
    groups.push(group)
  }
  return groups
}
