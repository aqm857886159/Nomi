/**
 * [INPUT]: 依赖 electron/shared 的 synchronousSha256 / stableProjectAgentJson（与计划修订号同一套哈希）、./directorProject 的 normalizeDirectorProject、./directorTypes
 * [OUTPUT]: 对外提供 DirectorCompiledBase、DirectorOverride、DIRECTOR_COMPILED_SCENE_ID、fingerprintDirectorProject（编译结果 → 逐实体逐属性指纹）、
 *           deriveDirectorOverrides（指纹 + 当前工程 → 手改覆盖层）、overlayDirectorProject（新编译 + 覆盖层 → 最终工程 + 被重排的手改 + 连带变化）、
 *           readDirectorCompiledBase
 * [POS]: 3D-BOX「手改覆盖层」的唯一 owner（方案 §3 / §6）。覆盖层不单独存：它就是「当前工程」相对「上一次编译结果」的差，
 *        按编译器的稳定 id（`actor:<名>` / `shot:<名>/camera` / `setPiece:<名>` / 模板件 / `carry:actor:<名>`）逐顶层属性比哈希得出，
 *        所以编辑器的任何改法（拖 gizmo、改检查器、撤销重做）都不用另外记账。上一次编译只存指纹（`directorPlan.compiledBase`），
 *        编译器升级后旧手改照样认得出、编译器的修复照样传下来。编译器不知道这里（结构守卫：planOverrides.guard.test.ts）。
 *        规则（方案 §6）：补丁**直接改到**的实体、且新编译真的改了那个属性 → 以新指令为准、丢弃该条并列出；其余照常重放；
 *        没被直接改到却变了的实体 → 列为连带变化。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { stableProjectAgentJson } from '../../../../../../electron/shared/legacyAgentJson'
import { synchronousSha256 } from '../../../../../../electron/shared/synchronousSha256'
import { normalizeDirectorProject } from './directorProject'
import type { DirectorCamera, DirectorLight, DirectorObject, DirectorProject, DirectorScene } from './directorTypes'

/** 编译器产出的那一个场景（`compileDirectorPlan` 写死的 id）；用户自己加的图层不归编译器，整层原样保留。 */
export const DIRECTOR_COMPILED_SCENE_ID = 'scene:director'
const VERSION = 1
const ABSENT = '-'
/** 场景自身的属性里，实体数组另算；轨道顺序单独合并（见 mergeTrackOrder）。 */
const SCENE_SKIP = new Set(['id', 'objects', 'cameras', 'lights'])
/** 走位类属性：人被拿东西挂进携带分组后，这几样住在分组上（compiler/stageRelations.ts#carryGroups）。 */
const MOTION_PROPS = new Set(['position', 'rotation', 'motionTrajectory', 'trajectoryClips'])
const CARRY_PREFIX = 'carry:'

type Entity = DirectorObject | DirectorCamera | DirectorLight
type EntityFingerprint = Readonly<Record<string, string>>
export type DirectorCompiledBase = Readonly<{ v: typeof VERSION; entities: Readonly<Record<string, EntityFingerprint>> }>

/** 一条手改：实体 key = `object:<id>` / `camera:<id>` / `light:<id>` / `scene`。 */
export type DirectorOverride =
  | Readonly<{ kind: 'set'; entity: string; prop: string; present: boolean; value?: unknown }>
  | Readonly<{ kind: 'added'; entity: string; value: Entity }>
  | Readonly<{ kind: 'removed'; entity: string }>

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const hashOf = (value: unknown): string => value === undefined ? ABSENT : synchronousSha256(stableProjectAgentJson(clone(value))).slice(0, 16)
const idOf = (key: string): string => key === 'scene' ? 'scene' : key.slice(key.indexOf(':') + 1)
const collectionOf = (key: string): 'objects' | 'cameras' | 'lights' => key.startsWith('camera:') ? 'cameras' : key.startsWith('light:') ? 'lights' : 'objects'

function normalized(project: DirectorProject): DirectorProject {
  return normalizeDirectorProject(clone(project))
}

function compiledScene(project: DirectorProject): DirectorScene | undefined {
  return project.scenes.find((scene) => scene.id === DIRECTOR_COMPILED_SCENE_ID)
}

/** 编译场景里的每个实体（含场景自身）→ 它的顶层属性表。两边都先过 normalizeDirectorProject：编辑器往返不产生假手改。 */
function entitiesOf(project: DirectorProject): Map<string, Record<string, unknown>> {
  const scene = compiledScene(normalized(project))
  const entities = new Map<string, Record<string, unknown>>()
  if (!scene) return entities
  entities.set('scene', Object.fromEntries(Object.entries(scene).filter(([key]) => !SCENE_SKIP.has(key))))
  for (const object of scene.objects) entities.set(`object:${object.id}`, object as unknown as Record<string, unknown>)
  for (const camera of scene.cameras) entities.set(`camera:${camera.id}`, camera as unknown as Record<string, unknown>)
  for (const light of scene.lights) entities.set(`light:${light.id}`, light as unknown as Record<string, unknown>)
  return entities
}

export function fingerprintDirectorProject(project: DirectorProject): DirectorCompiledBase {
  const entities: Record<string, EntityFingerprint> = {}
  for (const [key, entity] of entitiesOf(project))
    entities[key] = Object.fromEntries(Object.entries(entity).filter(([prop]) => prop !== 'id').map(([prop, value]) => [prop, hashOf(value)]))
  return { v: VERSION, entities }
}

export function readDirectorCompiledBase(value: unknown): DirectorCompiledBase | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { v?: unknown; entities?: unknown }
  return raw.v === VERSION && raw.entities && typeof raw.entities === 'object' && !Array.isArray(raw.entities) ? (raw as DirectorCompiledBase) : null
}

/** 当前工程相对上一次编译的差：改了的属性（含被删掉的属性）、用户新加的实体、用户删掉的实体。 */
export function deriveDirectorOverrides(base: DirectorCompiledBase, current: DirectorProject): DirectorOverride[] {
  const overrides: DirectorOverride[] = []
  const entities = entitiesOf(current)
  for (const [key, fingerprint] of Object.entries(base.entities)) {
    const entity = entities.get(key)
    if (!entity) {
      overrides.push({ kind: 'removed', entity: key })
      continue
    }
    for (const prop of new Set([...Object.keys(fingerprint), ...Object.keys(entity)])) {
      if (prop === 'id') continue
      const value = entity[prop]
      if (hashOf(value) === (fingerprint[prop] ?? ABSENT)) continue
      overrides.push(value === undefined ? { kind: 'set', entity: key, prop, present: false } : { kind: 'set', entity: key, prop, present: true, value: clone(value) })
    }
  }
  for (const [key, entity] of entities) if (key !== 'scene' && !base.entities[key]) overrides.push({ kind: 'added', entity: key, value: clone(entity) as unknown as Entity })
  return overrides
}

/**
 * 补丁直接改到的计划实体（planPatch 的 `touched`）→ 它们在工程里的实体 key。
 * 角色连带它的携带分组（人被拿东西挂进分组后，走位住在分组上）；`scene` = 模板件、dressing 与场景自身。
 */
function directlyOwned(touched: readonly string[], keys: Iterable<string>): Set<string> {
  const owned = new Set<string>()
  const all = [...keys]
  for (const item of touched) {
    const [kind, ...rest] = item.split(':')
    const name = rest.join(':')
    if (kind === 'shot') owned.add(`camera:shot:${name}/camera`)
    else if (kind === 'actor' || kind === 'blocking') owned.add(`object:actor:${name}`).add(`object:${CARRY_PREFIX}actor:${name}`)
    else if (kind === 'setPiece') owned.add(`object:setPiece:${name}`)
    else if (kind === 'scene') {
      owned.add('scene')
      for (const key of all) if (key.startsWith('object:s1-') || key.startsWith('object:dressing:')) owned.add(key)
    }
  }
  return owned
}

function changedProps(before: EntityFingerprint | undefined, after: EntityFingerprint | undefined): Set<string> {
  const props = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  return new Set([...props].filter((prop) => (before?.[prop] ?? ABSENT) !== (after?.[prop] ?? ABSENT)))
}

/** 用户调过的轨道顺序：按他的先后排，已不存在的去掉，新编译多出来的接在后面。 */
function mergeTrackOrder(preferred: unknown, compiled: readonly string[]): string[] {
  const known = new Set(compiled)
  const kept = (Array.isArray(preferred) ? preferred : []).filter((id): id is string => typeof id === 'string' && known.has(id))
  return [...kept, ...compiled.filter((id) => !kept.includes(id))]
}

type Retarget = { key: string } | { lost: true }

/**
 * 「拿 / 不拿东西」被补丁翻转时，走位类属性在人和携带分组之间转写（不携带时人的走位与携带时分组的走位语义相同）；
 * 人在分组里的局部偏移没有等价写法 → lost（丢弃并列出）。结构没翻转 → 原地。
 */
function retarget(override: Extract<DirectorOverride, { kind: 'set' }>, current: Map<string, Record<string, unknown>>, next: Map<string, Record<string, unknown>>): Retarget {
  if (!MOTION_PROPS.has(override.prop) || !override.entity.startsWith('object:')) return { key: override.entity }
  const id = idOf(override.entity)
  if (id.startsWith(CARRY_PREFIX) && !next.has(override.entity)) {
    const actorKey = `object:${id.slice(CARRY_PREFIX.length)}`
    return next.has(actorKey) && !next.get(actorKey)?.parentId ? { key: actorKey } : { key: override.entity }
  }
  const carrier = `${CARRY_PREFIX}${id}`
  const wasCarried = current.get(override.entity)?.parentId === carrier
  const isCarried = next.get(override.entity)?.parentId === carrier
  if (wasCarried && !isCarried) return { lost: true }
  if (!wasCarried && isCarried) return { key: `object:${carrier}` }
  return { key: override.entity }
}

export type DirectorOverlayResult = Readonly<{
  project: DirectorProject
  /** 被新指令覆盖、因而丢弃的手改：`<实体 id>.<属性>`，整实体的增删写 `<实体 id>`。 */
  reorderedOverrides: string[]
  /** 没被补丁直接改到、但重编译后变了的实体 id。 */
  changedEntities: string[]
  /** 重放了手改的实体 id（编译期几何问题对它们已不成立）。 */
  replayedEntities: string[]
}>

/**
 * 新编译 + 覆盖层 → 最终工程。工程级状态（出片记录、素材库、导出比例）与用户自建图层不是编译产物，取当前工程原样。
 */
export function overlayDirectorProject(input: Readonly<{
  compiled: DirectorProject
  current: DirectorProject
  base: DirectorCompiledBase
  touched: readonly string[]
}>): DirectorOverlayResult {
  const overrides = deriveDirectorOverrides(input.base, input.current)
  const nextFingerprint = fingerprintDirectorProject(input.compiled)
  const currentEntities = entitiesOf(input.current)
  const project = normalized(input.compiled)
  const scene = compiledScene(project)!
  const nextEntities = entitiesOf(project)
  const owned = directlyOwned(input.touched, [...Object.keys(input.base.entities), ...nextEntities.keys()])
  const reordered: string[] = []
  const replayed = new Set<string>()
  const findIn = (key: string) => (scene[collectionOf(key)] as Entity[]).find((item) => item.id === idOf(key))

  for (const override of overrides) {
    if (override.kind === 'removed') {
      if (!nextEntities.has(override.entity)) continue
      if (owned.has(override.entity)) { reordered.push(idOf(override.entity)); continue }
      const list = scene[collectionOf(override.entity)] as Entity[]
      list.splice(list.findIndex((item) => item.id === idOf(override.entity)), 1)
      replayed.add(idOf(override.entity))
      continue
    }
    if (override.kind === 'added') {
      if (nextEntities.has(override.entity)) { reordered.push(idOf(override.entity)); continue }
      ;(scene[collectionOf(override.entity)] as Entity[]).push(clone(override.value))
      replayed.add(idOf(override.entity))
      continue
    }
    const label = `${idOf(override.entity)}.${override.prop}`
    const target = retarget(override, currentEntities, nextEntities)
    if ('lost' in target || !nextEntities.has(target.key)) { reordered.push(label); continue }
    const direct = owned.has(override.entity) || owned.has(target.key)
    if (direct && changedProps(input.base.entities[override.entity], nextFingerprint.entities[target.key]).has(override.prop)) { reordered.push(label); continue }
    const holder = (target.key === 'scene' ? scene : findIn(target.key)) as unknown as Record<string, unknown>
    if (target.key === 'scene' && override.prop === 'timelineTrackOrder') holder.timelineTrackOrder = mergeTrackOrder(override.value, scene.timelineTrackOrder)
    else if (override.present) holder[override.prop] = clone(override.value)
    else delete holder[override.prop]
    replayed.add(idOf(target.key))
  }

  const changedEntities: string[] = []
  for (const key of new Set([...Object.keys(input.base.entities), ...Object.keys(nextFingerprint.entities)])) {
    if (owned.has(key)) continue
    if (changedProps(input.base.entities[key], nextFingerprint.entities[key]).size) changedEntities.push(idOf(key))
  }
  const current = normalized(input.current)
  const userLayers = current.scenes.filter((item) => item.id !== DIRECTOR_COMPILED_SCENE_ID)
  const merged: DirectorProject = {
    ...project,
    scenes: [scene, ...userLayers],
    activeSceneId: current.scenes.some((item) => item.id === current.activeSceneId) ? current.activeSceneId : scene.id,
    exportRatio: current.exportRatio,
    exportResolution: current.exportResolution,
    outputs: current.outputs,
    assets: current.assets,
  }
  return { project: normalizeDirectorProject(merged), reorderedOverrides: reordered, changedEntities, replayedEntities: [...replayed] }
}
