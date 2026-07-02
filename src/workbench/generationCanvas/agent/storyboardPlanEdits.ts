import type { PlanAnchor, PlanAnchorCarrier, PlanAnchorKind, PlanShot, StoryboardPlan } from './storyboardPlan'

/**
 * 分镜方案的**纯编辑 + 校验**层（S3 字段编辑器的领域逻辑，与渲染解耦、可单测）。
 *
 * 决策 B：字段控件直接绑 StoryboardPlan 对象，改字段就是改对象——这里是那些「改对象」的
 * 不可变操作的唯一真相源（组件只调它、不自己 spread）。删锚**不擦引用它的镜头**，失效引用
 * 由 validatePlan 暴露成红标（plan doc §1.4：标红提示，不去猜）。
 */

export const ANCHOR_KIND_LABELS: Record<PlanAnchorKind, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  style: '风格',
}

export const ANCHOR_KINDS: readonly PlanAnchorKind[] = ['character', 'scene', 'prop', 'style']

/** 时长预设（秒）。落画布时由 S4 钳到所选模型上限——这里只给常用档，不提前解析每模型时长表。 */
export const DURATION_OPTIONS_SEC: readonly number[] = [4, 5, 6, 8, 10, 12, 15]

/** style 默认文本锚（每镜常驻，拼进 prompt）；character/scene/prop 默认视觉锚（生成参考图）。 */
export function defaultCarrierForKind(kind: PlanAnchorKind): PlanAnchorCarrier {
  return kind === 'style' ? 'text' : 'visual'
}

/** style 默认每镜常驻；其余被点名才用。 */
export function defaultScopeForKind(kind: PlanAnchorKind): 'all' | 'selective' {
  return kind === 'style' ? 'all' : 'selective'
}

/** 生成不与现有冲突的锚 id（落画布时直接当 create_canvas_nodes 的 clientId）。 */
export function makeAnchorId(plan: StoryboardPlan): string {
  const existing = new Set(plan.anchors.map((anchor) => anchor.id))
  let n = plan.anchors.length + 1
  while (existing.has(`anchor-${n}`)) n += 1
  return `anchor-${n}`
}

export function updateTitle(plan: StoryboardPlan, title: string): StoryboardPlan {
  return { ...plan, title }
}

export function addAnchor(plan: StoryboardPlan, kind: PlanAnchorKind = 'character'): StoryboardPlan {
  const anchor: PlanAnchor = {
    id: makeAnchorId(plan),
    kind,
    name: '',
    description: '',
    carrier: defaultCarrierForKind(kind),
    scope: defaultScopeForKind(kind),
  }
  return { ...plan, anchors: [...plan.anchors, anchor] }
}

export function updateAnchor(plan: StoryboardPlan, id: string, patch: Partial<PlanAnchor>): StoryboardPlan {
  return { ...plan, anchors: plan.anchors.map((anchor) => (anchor.id === id ? { ...anchor, ...patch } : anchor)) }
}

/** 改锚类型：carrier/scope 跟随新类型的默认（风格→仅提示词+常驻）；用户随后仍可手动覆盖 carrier。 */
export function changeAnchorKind(plan: StoryboardPlan, id: string, kind: PlanAnchorKind): StoryboardPlan {
  return updateAnchor(plan, id, { kind, carrier: defaultCarrierForKind(kind), scope: defaultScopeForKind(kind) })
}

/** 删锚：**不**擦引用它的镜头 anchorIds——失效引用交给 validatePlan 标红（不静默改用户的镜头）。 */
export function removeAnchor(plan: StoryboardPlan, id: string): StoryboardPlan {
  return { ...plan, anchors: plan.anchors.filter((anchor) => anchor.id !== id) }
}

/** 镜号重排成连续 1..N（删除/拖动后调用，保证 shot.index 唯一且连续，转换器据此生成 clientId）。 */
function renumber(shots: PlanShot[]): PlanShot[] {
  return shots.map((shot, i) => (shot.index === i + 1 ? shot : { ...shot, index: i + 1 }))
}

export function addShot(plan: StoryboardPlan): StoryboardPlan {
  // 新镜头继承上一镜的种类（图片分镜方案里手加的镜头别突然变成视频镜头）；空方案默认视频（旧行为）。
  const lastKind = plan.shots[plan.shots.length - 1]?.shotKind
  const shot: PlanShot = {
    index: plan.shots.length + 1,
    ...(lastKind ? { shotKind: lastKind } : {}),
    durationSec: lastKind === 'image' ? 0 : 5,
    anchorIds: [],
    prompt: '',
  }
  return { ...plan, shots: [...plan.shots, shot] }
}

export function updateShotAt(plan: StoryboardPlan, pos: number, patch: Partial<PlanShot>): StoryboardPlan {
  return { ...plan, shots: plan.shots.map((shot, i) => (i === pos ? { ...shot, ...patch } : shot)) }
}

export function removeShotAt(plan: StoryboardPlan, pos: number): StoryboardPlan {
  return { ...plan, shots: renumber(plan.shots.filter((_, i) => i !== pos)) }
}

export function moveShot(plan: StoryboardPlan, from: number, to: number): StoryboardPlan {
  if (from === to || from < 0 || to < 0 || from >= plan.shots.length || to >= plan.shots.length) return plan
  const shots = [...plan.shots]
  const [moved] = shots.splice(from, 1)
  shots.splice(to, 0, moved)
  return { ...plan, shots: renumber(shots) }
}

/** 勾/取消某镜对某锚的引用（参考多选 = 改 shot.anchorIds，从源头杜绝写错名字）。 */
export function toggleShotAnchor(plan: StoryboardPlan, pos: number, anchorId: string): StoryboardPlan {
  const shot = plan.shots[pos]
  if (!shot) return plan
  const has = shot.anchorIds.includes(anchorId)
  const anchorIds = has ? shot.anchorIds.filter((id) => id !== anchorId) : [...shot.anchorIds, anchorId]
  return updateShotAt(plan, pos, { anchorIds })
}

// ── 校验：确认落画布前的拦截项（footer 计数 + 镜卡红标的唯一真相源）──

export type PlanIssue =
  | { kind: 'no-shots' }
  | { kind: 'dangling-ref'; shotIndex: number; anchorId: string }
  | { kind: 'empty-shot-prompt'; shotIndex: number }
  | { kind: 'anchor-no-name'; anchorId: string }

/** 一个方案的全部待处理项；空数组 = 可确认落画布。 */
export function validatePlan(plan: StoryboardPlan): PlanIssue[] {
  const issues: PlanIssue[] = []
  const anchorIds = new Set(plan.anchors.map((anchor) => anchor.id))

  // 视觉锚没名字 = 落画布后卡片没标题，且镜头按名引用不到 → 拦。
  for (const anchor of plan.anchors) {
    if (anchor.carrier === 'visual' && !anchor.name.trim()) {
      issues.push({ kind: 'anchor-no-name', anchorId: anchor.id })
    }
  }

  if (plan.shots.length === 0) {
    issues.push({ kind: 'no-shots' })
  }

  for (const shot of plan.shots) {
    if (!shot.prompt.trim()) issues.push({ kind: 'empty-shot-prompt', shotIndex: shot.index })
    for (const id of shot.anchorIds) {
      if (!anchorIds.has(id)) issues.push({ kind: 'dangling-ref', shotIndex: shot.index, anchorId: id })
    }
  }

  return issues
}

/** 某镜引用的失效锚 id（镜卡渲染红 chip 用；anchorId 已不在 anchors 里）。 */
export function danglingAnchorIdsForShot(plan: StoryboardPlan, shot: PlanShot): string[] {
  const anchorIds = new Set(plan.anchors.map((anchor) => anchor.id))
  return shot.anchorIds.filter((id) => !anchorIds.has(id))
}
