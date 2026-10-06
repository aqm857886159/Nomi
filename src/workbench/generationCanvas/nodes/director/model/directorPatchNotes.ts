/**
 * [INPUT]: 依赖 ./directorNodeMeta 的 DIRECTOR_NODE_KIND / DIRECTOR_PLAN_META_KEY、../../../model/generationCanvasTypes
 * [OUTPUT]: 对外提供 DirectorPatchNotes、readDirectorPatchNotes、recordDirectorPatchNote（唯一写法：记一笔、只留最近 20 笔）、directorPatchNoteTargets（被覆盖的手调 → 用户认得的对象：镜头 N / 角色名）、
 *           findDirectorPatchNote（按提议 id 在画布上找那一笔补丁覆盖了什么）
 * [POS]: 「这次改动覆盖了你在镜头 2 的手调，可撤销」的数据：stage_shot 补丁（applyDirectorWrite）把每一笔覆盖掉的手调按提议 id
 *        记在导演节点的计划 meta 上（patchNotes），Agent 面板在那一笔的工具行下面确定性地说出来——不靠模型复述（真实测试 ④ 里 DeepSeek 一句没提）。
 *        撤销那一笔 = 整份计划 meta 放回去，这条记录随之消失，面板上那句也就不再出现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { DIRECTOR_NODE_KIND, DIRECTOR_PLAN_META_KEY } from './directorNodeMeta'

/** 提议 id → 那一笔补丁丢弃的手调（`<实体 id>.<属性>` / `<实体 id>`，planOverrides 的写法）。 */
export type DirectorPatchNotes = Readonly<Record<string, readonly string[]>>

export function readDirectorPatchNotes(planMeta: unknown): DirectorPatchNotes {
  const raw = (planMeta as { patchNotes?: unknown } | null | undefined)?.patchNotes
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).flatMap(([proposalId, items]) =>
    Array.isArray(items) ? [[proposalId, items.filter((item): item is string => typeof item === 'string')]] : []))
}

/** 只留最近几笔：撤销栈之外的旧记录没人再看（面板只给转录里还在的那几行配字）。 */
const PATCH_NOTES_KEEP = 20

/** 唯一写法：这一笔补丁丢弃了手调才记；没丢 / 没有提议 id（不在 Agent 事务里）就原样返回。 */
export function recordDirectorPatchNote(previous: DirectorPatchNotes, proposalId: string | undefined, reordered: readonly string[]): DirectorPatchNotes {
  if (!proposalId || reordered.length === 0) return previous
  const kept = Object.entries(previous).filter(([id]) => id !== proposalId).slice(-(PATCH_NOTES_KEEP - 1))
  return Object.fromEntries([...kept, [proposalId, [...reordered]]])
}

export type DirectorPatchNoteTarget = Readonly<{ kind: 'shot'; index: number }> | Readonly<{ kind: 'named'; name: string }>

type PlanShape = { shots?: { id?: unknown }[]; actors?: { id?: unknown; desc?: unknown }[]; scene?: { setPieces?: { id?: unknown; kind?: unknown }[] } }

/**
 * 被覆盖的手调 → 用户认得的对象，去重、按镜头在前：机位 `shot:<名>/camera.*` = 「镜头 N」（计划里的镜头顺序，就是镜头条的顺序）；
 * 角色 `actor:<名>` / 携带分组 `carry:actor:<名>` = 角色描述；场景件 = 它的种类；认不出的（模板件、用户自建的东西）按 id 原样。
 */
export function directorPatchNoteTargets(plan: unknown, reordered: readonly string[]): DirectorPatchNoteTarget[] {
  const shape = (plan ?? {}) as PlanShape
  const shots = (shape.shots ?? []).map((shot) => String(shot.id ?? ''))
  const actors = new Map((shape.actors ?? []).map((actor) => [String(actor.id ?? ''), String(actor.desc ?? actor.id ?? '')]))
  const pieces = new Map((shape.scene?.setPieces ?? []).map((piece) => [String(piece.id ?? ''), String(piece.kind ?? piece.id ?? '')]))
  const shotIndices = new Set<number>()
  const names = new Set<string>()
  for (const item of reordered) {
    const entity = item.replace(/\.[^./]+$/, '')
    const shot = /^shot:(.+)\/camera$/.exec(entity)?.[1]
    if (shot !== undefined && shots.includes(shot)) { shotIndices.add(shots.indexOf(shot) + 1); continue }
    const actor = /^(?:carry:)?actor:(.+)$/.exec(entity)?.[1]
    if (actor !== undefined) { names.add(actors.get(actor) ?? actor); continue }
    const piece = /^setPiece:(.+)$/.exec(entity)?.[1]
    names.add(piece !== undefined ? pieces.get(piece) ?? piece : entity)
  }
  return [...[...shotIndices].sort((a, b) => a - b).map((index) => ({ kind: 'shot' as const, index })), ...[...names].map((name) => ({ kind: 'named' as const, name }))]
}

/** 画布上哪个导演节点记着这一笔提议覆盖的手调；没有 = 这一笔没覆盖任何手调（或已经撤销）。 */
export function findDirectorPatchNote(nodes: readonly Pick<GenerationCanvasNode, 'kind' | 'meta'>[], proposalId: string): DirectorPatchNoteTarget[] | null {
  for (const node of nodes) {
    if (node.kind !== DIRECTOR_NODE_KIND) continue
    const planMeta = node.meta?.[DIRECTOR_PLAN_META_KEY] as { plan?: unknown } | undefined
    const reordered = readDirectorPatchNotes(planMeta)[proposalId]
    if (reordered?.length) {
      const targets = directorPatchNoteTargets(planMeta?.plan, reordered)
      return targets.length ? targets : null
    }
  }
  return null
}
