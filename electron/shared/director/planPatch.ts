/**
 * 导演计划的**补丁应用与修订号**（方案 §3「计划补丁与差异」的唯一 owner）。
 *
 * 语义参照 RFC 6902（add / remove / replace），但路径按计划里的**名字**寻址，不按数组下标：
 * Agent 说「第二镜改成特写」时手里只有镜头名，下标会随增删漂。路径语法（收窄后的全集）：
 *
 *   /scene/<field>[/…]                     场景字段（environment / template / tags / dressing）
 *   /scene/setPieces/<id>[/<field>/…]      场景件：整件 add / remove / replace，或改其中一个字段
 *   /actors/<id>[/<field>/…]               角色：同上
 *   /shots/<id>[/<field>/…]                镜头：同上（新增镜头按 window 起点插入时间序）
 *   /blocking/<actorId>                    某个角色的全部走位：add / replace（值是动作数组）/ remove
 *
 * 应用完再走导演计划自己的无损归一与校验（引用存在、窗口递增…）；任何一条不过 → 整份补丁拒绝，
 * 不落半截。补丁不改变规范化计划 → `unchanged: true`，调用方不写画布、不重编译。
 *
 * `touched` 列出补丁**直接改到**的计划实体（`shot:<id>` / `actor:<id>` / `setPiece:<id>` / `scene` /
 * `blocking:<actorId>`），3c 的覆盖层用它判断哪条手改让位于新指令。
 */
import { stableProjectAgentJson } from '../legacyAgentJson'
import { synchronousSha256 } from '../synchronousSha256'
import { parseDirectorPlan, type DirectorPlan } from './directorPlanSchema'

export const DIRECTOR_PLAN_EDIT_OPS = ['add', 'remove', 'replace'] as const
export type DirectorPlanEditOp = (typeof DIRECTOR_PLAN_EDIT_OPS)[number]
export type DirectorPlanEdit = Readonly<{ op: DirectorPlanEditOp; path: string; value?: unknown }>

export type DirectorPlanPatchResult =
  | Readonly<{ ok: true; plan: DirectorPlan; unchanged: boolean; touched: readonly string[] }>
  | Readonly<{ ok: false; errors: readonly string[] }>

type Json = Record<string, unknown>

/** 修订号 = 规范化计划的内容哈希：同一份计划同一个号，撤销回去号也回去（ABA 无害——内容相同）。 */
export function directorPlanRevision(plan: DirectorPlan): string {
  return `dplan-${synchronousSha256(`nomi-director-plan:v1\0${stableProjectAgentJson(plan)}`).slice(0, 16)}`
}

/** 把一份（已校验的）计划规范化成 JSON 纯值：默认值补齐、键序无关。 */
export function canonicalDirectorPlan(plan: DirectorPlan): DirectorPlan {
  return JSON.parse(JSON.stringify(plan)) as DirectorPlan
}

function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function decodeSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

function splitPath(path: string): string[] | null {
  if (typeof path !== 'string' || !path.startsWith('/')) return null
  const segments = path.slice(1).split('/').map(decodeSegment)
  return segments.every((segment) => segment.length > 0) ? segments : null
}

/** 实体内部的字段级 add / remove / replace（RFC 6902 对象成员语义；数组只认整值替换或数字下标替换）。 */
function applyInside(entity: Json, rest: string[], edit: DirectorPlanEdit, where: string, errors: string[]): void {
  let parent: unknown = entity
  for (const key of rest.slice(0, -1)) {
    const next: unknown = Array.isArray(parent) ? parent[Number(key)] : isRecord(parent) ? parent[key] : undefined
    if (next === undefined || next === null || typeof next !== 'object') {
      errors.push(`${edit.path}: ${where} has no field ${key}`)
      return
    }
    parent = next
  }
  const last = rest[rest.length - 1]
  if (Array.isArray(parent)) {
    const index = Number(last)
    if (!Number.isInteger(index) || index < 0 || index >= parent.length || edit.op !== 'replace') {
      errors.push(`${edit.path}: array items can only be replaced by an existing index`)
      return
    }
    parent[index] = clone(edit.value)
    return
  }
  if (!isRecord(parent)) {
    errors.push(`${edit.path}: ${where} has no field ${last}`)
    return
  }
  const exists = Object.prototype.hasOwnProperty.call(parent, last)
  if (edit.op === 'remove') {
    if (!exists) errors.push(`${edit.path}: nothing to remove`)
    else delete parent[last]
    return
  }
  if (edit.value === undefined) {
    errors.push(`${edit.path}: ${edit.op} needs a value`)
    return
  }
  if (edit.op === 'replace' && !exists) {
    errors.push(`${edit.path}: ${where} has no field ${last} to replace; use add`)
    return
  }
  parent[last] = clone(edit.value)
}

type NamedCollection = Readonly<{ list: Json[]; label: string; touched: (id: string) => string }>

function applyNamed(collection: NamedCollection, id: string, rest: string[], edit: DirectorPlanEdit, errors: string[], ordered?: (list: Json[]) => void): string | null {
  const index = collection.list.findIndex((item) => item.id === id)
  if (rest.length > 0) {
    if (index < 0) {
      errors.push(`${edit.path}: no ${collection.label} named ${id}`)
      return null
    }
    if (rest[0] === 'id') {
      errors.push(`${edit.path}: a ${collection.label} id is its name; remove it and add a new one instead`)
      return null
    }
    applyInside(collection.list[index], rest, edit, `${collection.label} ${id}`, errors)
    return collection.touched(id)
  }
  if (edit.op === 'remove') {
    if (index < 0) errors.push(`${edit.path}: no ${collection.label} named ${id}`)
    else collection.list.splice(index, 1)
    return collection.touched(id)
  }
  if (!isRecord(edit.value)) {
    errors.push(`${edit.path}: ${edit.op} needs the whole ${collection.label} object as value`)
    return null
  }
  if (edit.value.id !== undefined && edit.value.id !== id) {
    errors.push(`${edit.path}: value.id ${String(edit.value.id)} does not match the path name ${id}`)
    return null
  }
  const value = { ...clone(edit.value), id }
  if (edit.op === 'add') {
    if (index >= 0) {
      errors.push(`${edit.path}: ${collection.label} ${id} already exists; use replace`)
      return null
    }
    collection.list.push(value)
    ordered?.(collection.list)
  } else {
    if (index < 0) {
      errors.push(`${edit.path}: no ${collection.label} named ${id}; use add`)
      return null
    }
    collection.list[index] = value
  }
  return collection.touched(id)
}

function windowStart(item: Json): number {
  return Array.isArray(item.window) && typeof item.window[0] === 'number' ? item.window[0] : Number.POSITIVE_INFINITY
}

/** 新增镜头落在时间序里（稳定排序，同起点保持原相对次序）：编译器按数组顺序接「连续镜头」。 */
function orderShotsByStart(list: Json[]): void {
  const sorted = list.map((item, index) => ({ item, index })).sort((a, b) => windowStart(a.item) - windowStart(b.item) || a.index - b.index)
  sorted.forEach((entry, index) => { list[index] = entry.item })
}

export function applyDirectorPlanEdits(base: DirectorPlan, edits: readonly DirectorPlanEdit[]): DirectorPlanPatchResult {
  const source = clone(base) as unknown as Json & { scene: Json & { setPieces?: Json[] }; actors: Json[]; shots: Json[]; blocking?: Json[] }
  const draft = { ...source, scene: { ...source.scene, setPieces: source.scene.setPieces ?? [] }, blocking: source.blocking ?? [] }
  const errors: string[] = []
  const touched = new Set<string>()
  if (edits.length === 0) errors.push('edits: give at least one edit')
  for (const edit of edits) {
    if (!DIRECTOR_PLAN_EDIT_OPS.includes(edit.op)) {
      errors.push(`${edit.path}: unsupported op ${String(edit.op)} (add, remove, replace)`)
      continue
    }
    const segments = splitPath(edit.path)
    if (!segments) {
      errors.push(`${String(edit.path)}: path must look like /shots/<name>/size`)
      continue
    }
    const [head, ...rest] = segments
    let hit: string | null = null
    if (head === 'scene' && rest[0] === 'setPieces' && rest.length >= 2) {
      hit = applyNamed({ list: draft.scene.setPieces, label: 'set piece', touched: (id) => `setPiece:${id}` }, rest[1], rest.slice(2), edit, errors)
    } else if (head === 'scene' && rest.length >= 1 && rest[0] !== 'setPieces') {
      applyInside(draft.scene, rest, edit, 'scene', errors)
      hit = 'scene'
    } else if (head === 'actors' && rest.length >= 1) {
      hit = applyNamed({ list: draft.actors, label: 'actor', touched: (id) => `actor:${id}` }, rest[0], rest.slice(1), edit, errors)
    } else if (head === 'shots' && rest.length >= 1) {
      hit = applyNamed({ list: draft.shots, label: 'shot', touched: (id) => `shot:${id}` }, rest[0], rest.slice(1), edit, errors, orderShotsByStart)
    } else if (head === 'blocking' && rest.length === 1) {
      const actor = rest[0]
      const others: Json[] = draft.blocking.filter((item) => item.actor !== actor)
      const had = others.length !== draft.blocking.length
      if (edit.op === 'remove') {
        if (!had) errors.push(`${edit.path}: actor ${actor} has no blocking`)
        draft.blocking = others
      } else if (!Array.isArray(edit.value) || !edit.value.every(isRecord)) {
        errors.push(`${edit.path}: value must be the list of ${actor}'s actions`)
      } else if (edit.op === 'add' && had) {
        errors.push(`${edit.path}: actor ${actor} already has blocking; use replace`)
      } else if (edit.op === 'replace' && !had) {
        errors.push(`${edit.path}: actor ${actor} has no blocking to replace; use add`)
      } else {
        const actions = (edit.value as Json[]).map((item) => ({ ...clone(item), actor }))
        draft.blocking = [...others, ...actions]
      }
      hit = `blocking:${actor}`
    } else {
      errors.push(`${edit.path}: unsupported path (use /scene/…, /scene/setPieces/<name>, /actors/<name>, /shots/<name>, /blocking/<actorName>)`)
    }
    if (hit) touched.add(hit)
  }
  if (errors.length) return { ok: false, errors }
  const parsed = parseDirectorPlan(draft)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(plan)'}: ${issue.message}`) }
  }
  const plan = canonicalDirectorPlan(parsed.data)
  const unchanged = stableProjectAgentJson(plan) === stableProjectAgentJson(canonicalDirectorPlan(base))
  return { ok: true, plan, unchanged, touched: unchanged ? [] : [...touched] }
}
