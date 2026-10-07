import type { PlanAnchor, PlanShot, StoryboardPlan } from './storyboardPlan'

/**
 * 分镜方案里**一行是谁、排第几**的唯一 owner：锚（参考卡）的 id、镜头的 id 与镜号都只在这里发、只在这里认。
 *
 * ── 为什么要有它（2026-10-05，用户「分镜方案经常做错」）──
 *
 * 手建方案从来是两条号：锚 `anchor-N`（`storyboardPlanEdits.makeAnchorId`），镜号只数镜头、删拖后重排成
 * 1..N（`renumber`）。Agent 起草那条路却把锚和镜头排进**同一个**序号：建镜头的兜底 id 是
 * 「在锚和镜混排数组里的位置」（`shot-${index+1}`），落方案时镜号也是同一个位置（`index+1`）。于是
 * 2 张参考卡 + 2 镜的方案，镜头行号是 03、04；参考卡的 id 是 `shot-1`、`shot-2`；模型说「改第 1 镜」
 * 自然写 `shot-1`，改到的是角色参考卡。三处各自「顺手」编号，没有一处说了算。
 *
 * 现在：主进程首建、渲染层补镜头 / 改一镜，全部调这里的同一组函数。
 *   · `nextStoryboardSubjectIds`：发号。锚 `anchor-N`（N 只数锚），镜头 `shot-N`（N 只数镜头），跳过已占用的。
 *     调用方自带的 id 照收，但不许跨号段：锚不许叫 `shot-N`，镜头不许叫 `anchor-N`。
 *   · `appendStoryboardSubjects`：把一批主体接到方案后面，镜号 = 已有镜头数 + 序号。
 *   · `storyboardSubjectAt`：按 id 找主体。镜号段的 id（`shot-N`）只在镜头里找，永远不会落到锚上。
 */

const SHOT_NUMBERED = /^shot-\d+$/
const ANCHOR_NUMBERED = /^anchor-\d+$/
const STABLE_ID = /^[A-Za-z0-9._-]{1,160}$/

/** 主体在方案里的角色：参考卡（锚）或镜头。 */
export type StoryboardSubjectRole = 'anchor' | 'shot'

/** 号段越界、id 重复：调用方给的身份不成立。码稳定，消息给人读。 */
export class StoryboardSubjectIdentityError extends Error {
  constructor(readonly code: 'storyboard_subject_id_out_of_range' | 'storyboard_subject_id_duplicate', message: string) {
    super(message)
    this.name = 'StoryboardSubjectIdentityError'
  }
}

/**
 * 按 id 没找到要改的那一行。带上方案里真实的镜头（id + 用户看到的行号），让模型改用对的 id；
 * `anchorHoldsShotNumber` = 这个 `shot-N` 在旧方案里被一张参考卡占着（本 owner 之前 Agent 建的方案）。
 */
export class StoryboardSubjectNotFoundError extends Error {
  readonly code = 'storyboard_shot_not_found'
  constructor(readonly shotId: string, readonly shots: ReadonlyArray<Readonly<{ id: string; row: number }>>, readonly anchorHoldsShotNumber: boolean) {
    super('Storyboard shot not found')
    this.name = 'StoryboardSubjectNotFoundError'
  }
}

/**
 * 一镜的稳定绑定 id（落画布写进 `node.meta.shotId`；分镜表按它把行绑回画布节点）。
 * 旧方案里手建的镜头可能没有 `shotId`，按镜号派生——那正是它们一直以来的身份。
 */
export function stableShotId(shot: Pick<PlanShot, 'shotId' | 'index'>): string {
  const candidate = typeof shot.shotId === 'string' ? shot.shotId.trim() : ''
  return STABLE_ID.test(candidate) ? candidate : `shot-${shot.index}`
}

type PlanSubjects = Pick<StoryboardPlan, 'anchors' | 'shots'>

function takenIds(plan: PlanSubjects): Set<string> {
  return new Set([...plan.anchors.map(anchor => anchor.id), ...plan.shots.map(stableShotId)])
}

function assertInRange(role: StoryboardSubjectRole, id: string): void {
  if (role === 'anchor' && SHOT_NUMBERED.test(id)) {
    throw new StoryboardSubjectIdentityError('storyboard_subject_id_out_of_range',
      `A reference card cannot be named ${id}: shot-N ids are shot numbers. Leave shotId out and the host assigns anchor-N.`)
  }
  if (role === 'shot' && ANCHOR_NUMBERED.test(id)) {
    throw new StoryboardSubjectIdentityError('storyboard_subject_id_out_of_range',
      `A shot cannot be named ${id}: anchor-N ids belong to reference cards. Leave shotId out and the host assigns shot-N.`)
  }
}

/**
 * 给一批要接到 `plan` 后面的主体发 id。顺序与 `incoming` 一一对应。
 * 调用方自带的 id（外部宿主、夹具）照收：只核号段与重复，不改写。
 */
export function nextStoryboardSubjectIds(plan: PlanSubjects,
  incoming: ReadonlyArray<Readonly<{ role?: StoryboardSubjectRole; shotId?: string }>>): string[] {
  const taken = takenIds(plan)
  const explicit = incoming.map(subject => subject.shotId?.trim() || undefined)
  for (const [position, id] of explicit.entries()) {
    if (!id) continue
    assertInRange(incoming[position].role ?? 'shot', id)
    if (taken.has(id)) throw new StoryboardSubjectIdentityError('storyboard_subject_id_duplicate', `镜头 id 重复：${id}（shot id ${id} is already used in this plan）`)
    taken.add(id)
  }
  let anchorNumber = plan.anchors.length
  let shotNumber = plan.shots.length
  return incoming.map((subject, position) => {
    const given = explicit[position]
    if (given) return given
    const anchor = (subject.role ?? 'shot') === 'anchor'
    let id: string
    do {
      id = anchor ? `anchor-${++anchorNumber}` : `shot-${++shotNumber}`
    } while (taken.has(id))
    taken.add(id)
    return id
  })
}

/** 镜号重排成连续 1..N（手建方案删 / 拖 / 插之后、Agent 方案补镜头之后都过这一处）。 */
export function renumberStoryboardShots<TShot extends Pick<PlanShot, 'index'>>(shots: readonly TShot[]): TShot[] {
  return shots.map((shot, position) => (shot.index === position + 1 ? shot : { ...shot, index: position + 1 }))
}

function isAnchor(subject: PlanAnchor | PlanShot): subject is PlanAnchor {
  return 'description' in subject
}

/** 接到方案后面的那一行：它的 id、角色，镜头再带镜号（= 用户在表上看到的行号）。 */
export type AppendedStoryboardSubject = Readonly<{ role: StoryboardSubjectRole; id: string; row?: number; title?: string }>

/**
 * 把一批已适配的主体接到 `plan` 后面。镜头的镜号 = 它在镜头里的位置（锚不占号；整份重排成 1..N，
 * 本 owner 之前 Agent 建的方案里从 3 起的镜号在这里一并归位——镜头身份是 shotId，镜号只是位置）。
 * `assignIds`：true = 这批主体的 id 由这里重新发（渲染层补镜头：主进程不知道方案现在有哪些 id）；
 * false = 主体已带 id（主进程首建时已经用 `nextStoryboardSubjectIds` 发过，草稿与方案要同一套 id），这里只核。
 */
export function appendStoryboardSubjects<TPlan extends StoryboardPlan>(plan: TPlan, subjects: ReadonlyArray<PlanAnchor | PlanShot>,
  options: Readonly<{ assignIds: boolean }>): { plan: TPlan; added: AppendedStoryboardSubject[] } {
  const roles = subjects.map(subject => (isAnchor(subject) ? 'anchor' as const : 'shot' as const))
  const ids = nextStoryboardSubjectIds(plan, subjects.map((subject, position) => ({
    role: roles[position],
    ...(options.assignIds ? {} : { shotId: isAnchor(subject) ? subject.id : subject.shotId }),
  })))
  const anchors = [...plan.anchors]
  const shots = renumberStoryboardShots(plan.shots)
  const added: AppendedStoryboardSubject[] = []
  subjects.forEach((subject, position) => {
    const id = ids[position]
    if (isAnchor(subject)) {
      anchors.push({ ...subject, id })
      added.push({ role: 'anchor', id, title: subject.name })
      return
    }
    const row = shots.length + 1
    shots.push({ ...subject, shotId: id, index: row })
    added.push({ role: 'shot', id, row })
  })
  return { plan: { ...plan, anchors, shots }, added }
}

/**
 * 「改第 N 镜」寻址：按 id 找主体。镜号段的 id 只在镜头里找。
 * 旧方案（本 owner 之前 Agent 建的）里锚可能占着 `shot-N`——那样的 id 不当作锚的地址，而是如实拒绝并列出
 * 真实镜头，让模型改用对的 id；锚本身在编辑器里照常可改。
 */
export function storyboardSubjectAt(plan: PlanSubjects, id: string):
  | Readonly<{ kind: 'anchor'; anchor: PlanAnchor }>
  | Readonly<{ kind: 'shot'; shot: PlanShot }>
  | Readonly<{ kind: 'missing'; shots: ReadonlyArray<Readonly<{ id: string; row: number }>>; anchorHoldsShotNumber: boolean }> {
  const shot = plan.shots.find(value => stableShotId(value) === id)
  if (shot) return { kind: 'shot', shot }
  const anchor = plan.anchors.find(value => value.id === id)
  if (anchor && !SHOT_NUMBERED.test(id)) return { kind: 'anchor', anchor }
  return { kind: 'missing', anchorHoldsShotNumber: Boolean(anchor),
    shots: plan.shots.map(value => ({ id: stableShotId(value), row: value.index })) }
}
