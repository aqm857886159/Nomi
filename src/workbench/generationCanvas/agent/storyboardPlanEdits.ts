import { effectiveShotDurationSec, type PlanAnchor, type PlanAnchorCarrier, type PlanAnchorKind, type PlanShot, type StoryboardPlan } from './storyboardPlan'
import { hasMentions, mentionUrlsInOrder } from '../../assets/promptMentions'

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

/**
 * 画幅预设（批量条「画幅」，v5）。行级画幅由该镜模型档案的 aspect_ratio 控件给全集；
 * 批量条跨模型，只列各档案交集里的通用档（与时长预设同理，不提前解析每模型画幅表）。
 */
export const BULK_ASPECT_OPTIONS: readonly string[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']

/** 切到视频档/空方案首镜的兜底时长（秒）。 */
const DEFAULT_VIDEO_DURATION_SEC = 5

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

/** 记录 @ token 对应的 URL，绑定关系仍由镜头的 anchorIds 唯一持有。 */
export function rememberAnchorReferenceUrl(plan: StoryboardPlan, anchorId: string, url: string): StoryboardPlan {
  const normalized = url.trim()
  if (!normalized || !plan.anchors.some((anchor) => anchor.id === anchorId)) return plan
  return updateAnchor(plan, anchorId, { referenceUrl: normalized })
}

/** 将画布结果/素材库/上传提升为现有 PlanAnchor，避免新增第二份镜头绑定结构。 */
export function addExternalReferenceAnchor(
  plan: StoryboardPlan,
  input: { id: string; name: string; url: string; kind: 'image' | 'video' | 'audio'; sourceNodeId?: string },
): { plan: StoryboardPlan; anchorId: string } {
  const existing = plan.anchors.find((anchor) => anchor.referenceUrl === input.url && anchor.referenceSourceNodeId === input.sourceNodeId)
  if (existing) return { plan, anchorId: existing.id }
  const anchorId = makeAnchorId(plan)
  const anchor: PlanAnchor = {
    id: anchorId,
    kind: 'prop',
    name: input.name.trim() || `参考 ${plan.anchors.length + 1}`,
    description: '',
    carrier: 'visual',
    scope: 'selective',
    referenceUrl: input.url,
    referenceKind: input.kind,
    ...(input.sourceNodeId ? { referenceSourceNodeId: input.sourceNodeId } : {}),
  }
  return { plan: { ...plan, anchors: [...plan.anchors, anchor] }, anchorId }
}

/** 文本中已有 @ 时，镜头绑定按 URL 重建；没有 @ 的旧纯文本仍保留旧绑定。 */
export function updateShotPrompt(plan: StoryboardPlan, pos: number, prompt: string): StoryboardPlan {
  const shot = plan.shots[pos]
  if (!shot) return plan
  const nextUrls = mentionUrlsInOrder(prompt)
  const previousHadMentions = hasMentions(shot.prompt)
  if (!previousHadMentions && nextUrls.length === 0) return updateShotAt(plan, pos, { prompt })
  const idsByUrl = new Map(plan.anchors.flatMap((anchor) => anchor.referenceUrl ? [[anchor.referenceUrl, anchor.id] as const] : []))
  const mentioned = new Set(nextUrls.flatMap((url) => idsByUrl.get(url) ? [idsByUrl.get(url)!] : []))
  const textAnchorIds = shot.anchorIds.filter((id) => plan.anchors.find((anchor) => anchor.id === id)?.carrier === 'text')
  return updateShotAt(plan, pos, { prompt, anchorIds: [...textAnchorIds, ...mentioned] })
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
  // 新镜头继承上一镜的种类/模型/模式/画幅/时长/所属场（v5：手加的镜头别突然换血统）；空方案默认视频 5s（旧行为）。
  const last = plan.shots[plan.shots.length - 1]
  const lastKind = last?.shotKind
  const lastKeyframeEnabled = last?.keyframe?.enabled === true
  const lastAspect = last?.params?.aspect_ratio
  const shot: PlanShot = {
    index: plan.shots.length + 1,
    ...(lastKind ? { shotKind: lastKind } : {}),
    ...(last?.sceneId ? { sceneId: last.sceneId } : {}),
    ...(lastKind === 'video' && lastKeyframeEnabled ? { keyframe: { enabled: true, prompt: '' } } : {}),
    ...(last?.modelKey ? { modelKey: last.modelKey } : {}),
    ...(last?.modeId ? { modeId: last.modeId } : {}),
    // 画幅继承但不拷整份 params——其余参数（负向词/清晰度…）是那一镜的创作选择，新镜从默认起。
    ...(lastAspect !== undefined ? { params: { aspect_ratio: lastAspect } } : {}),
    // 时长继承（图片镜=停留时长语义，经 effectiveShotDurationSec 吃掉旧数据的 0）。
    durationSec: last ? effectiveShotDurationSec(last) || DEFAULT_VIDEO_DURATION_SEC : DEFAULT_VIDEO_DURATION_SEC,
    anchorIds: [],
    prompt: '',
  }
  return { ...plan, shots: [...plan.shots, shot] }
}

/** D3 行间插镜：只继承上一镜的生成血统，内容保持空白，避免复制出用户未要求的 prompt/引用。 */
export function insertShotAt(plan: StoryboardPlan, pos: number): StoryboardPlan {
  const previous = plan.shots[pos - 1] ?? plan.shots[pos]
  const next: PlanShot = previous
    ? {
        index: pos + 1,
        ...(previous.shotKind ? { shotKind: previous.shotKind } : {}),
        ...(previous.sceneId ? { sceneId: previous.sceneId } : {}),
        ...(previous.modelKey ? { modelKey: previous.modelKey } : {}),
        ...(previous.modeId ? { modeId: previous.modeId } : {}),
        ...(previous.params?.aspect_ratio !== undefined ? { params: { aspect_ratio: previous.params.aspect_ratio } } : {}),
        durationSec: effectiveShotDurationSec(previous) || DEFAULT_VIDEO_DURATION_SEC,
        anchorIds: [],
        prompt: '',
      }
    : { index: 1, durationSec: DEFAULT_VIDEO_DURATION_SEC, anchorIds: [], prompt: '' }
  const shots = [...plan.shots]
  shots.splice(Math.max(0, Math.min(pos, shots.length)), 0, next)
  return { ...plan, shots: renumber(shots) }
}

/** D3 复制镜头：复制可见内容但不给新行复用稳定身份。 */
export function duplicateShotAt(plan: StoryboardPlan, pos: number): StoryboardPlan {
  const source = plan.shots[pos]
  if (!source) return plan
  const copy: PlanShot = { ...source, shotId: undefined, index: source.index + 1, anchorIds: [...source.anchorIds], ...(source.params ? { params: { ...source.params } } : {}), ...(source.keyframe ? { keyframe: { ...source.keyframe, ...(source.keyframe.params ? { params: { ...source.keyframe.params } } : {}) } } : {}) }
  const shots = [...plan.shots]
  shots.splice(pos + 1, 0, copy)
  return { ...plan, shots: renumber(shots) }
}

export function updateShotAt(plan: StoryboardPlan, pos: number, patch: Partial<PlanShot>): StoryboardPlan {
  return { ...plan, shots: plan.shots.map((shot, i) => (i === pos ? { ...shot, ...patch } : shot)) }
}

export function removeShotAt(plan: StoryboardPlan, pos: number): StoryboardPlan {
  return { ...plan, shots: renumber(plan.shots.filter((_, i) => i !== pos)) }
}

/**
 * 场感知移动（v5）：拖到镜 X 的位置 = 加入镜 X 的场——组内移动 sceneId 不变，
 * 跨过场界则移动镜改挂目标位置原镜的 sceneId（目标无 sceneId → 摘掉，回隐式场）。
 * 镜号照旧重排成跨场连续 1..N（单人工具走 Boords 档，不锁号）。
 */
export function moveShot(plan: StoryboardPlan, from: number, to: number): StoryboardPlan {
  if (from === to || from < 0 || to < 0 || from >= plan.shots.length || to >= plan.shots.length) return plan
  const targetSceneId = plan.shots[to].sceneId
  const shots = [...plan.shots]
  const [moved] = shots.splice(from, 1)
  const adopted = moved.sceneId === targetSceneId
    ? moved
    : (() => {
        const { sceneId: _dropped, ...rest } = moved
        return targetSceneId === undefined ? (rest as PlanShot) : { ...rest, sceneId: targetSceneId }
      })()
  shots.splice(to, 0, adopted)
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

// ── 场（v5 场分组）：增删改名 + 表层分组 derive（组头/小结/折叠都吃这份）──

/** 生成不与现有冲突的场 id（与 makeAnchorId 同法）。 */
export function makeSceneId(plan: StoryboardPlan): string {
  const existing = new Set((plan.scenes ?? []).map((scene) => scene.id))
  let n = (plan.scenes ?? []).length + 1
  while (existing.has(`scene-${n}`)) n += 1
  return `scene-${n}`
}

/** 加一个场（追加到场序末尾）。不动镜头——镜头经 updateShotAt/moveShot 改挂 sceneId。 */
export function addScene(plan: StoryboardPlan, title: string): StoryboardPlan {
  return { ...plan, scenes: [...(plan.scenes ?? []), { id: makeSceneId(plan), title }] }
}

export function renameScene(plan: StoryboardPlan, sceneId: string, title: string): StoryboardPlan {
  if (!plan.scenes?.some((scene) => scene.id === sceneId)) return plan
  return { ...plan, scenes: plan.scenes.map((scene) => (scene.id === sceneId ? { ...scene, title } : scene)) }
}

/**
 * 删场：**不删镜头**——该场镜头并入前一个场（首场删除并入后一个；没有别的场 → 摘 sceneId 回隐式场）。
 * 与 removeAnchor「删锚不擦镜头」同一条纪律：结构操作不静默吞用户内容。
 */
export function removeScene(plan: StoryboardPlan, sceneId: string): StoryboardPlan {
  const scenes = plan.scenes ?? []
  const pos = scenes.findIndex((scene) => scene.id === sceneId)
  if (pos < 0) return plan
  const fallback = scenes[pos - 1]?.id ?? scenes[pos + 1]?.id
  const shots = plan.shots.map((shot) => {
    if (shot.sceneId !== sceneId) return shot
    if (fallback === undefined) {
      const { sceneId: _dropped, ...rest } = shot
      return rest as PlanShot
    }
    return { ...shot, sceneId: fallback }
  })
  return { ...plan, scenes: scenes.filter((scene) => scene.id !== sceneId), shots }
}

/** 表层的一个场组：scene=null 是隐式场（无 sceneId 的镜头 / 整个无分场旧 plan，不显组头）。 */
export type SceneGroup = {
  /** null = 隐式场；title 为空串的登记场由表层显示兜底名（场 N）。 */
  scene: { id: string; title: string } | null
  /** 组内镜头（引用 plan.shots 的原对象）。 */
  shots: PlanShot[]
  /** 组首镜在 plan.shots 里的下标（拖拽/更新按位置寻址用）。 */
  startPos: number
}

/**
 * 把 shots[] 按 sceneId 的**连续段**切成场组（数组序=视觉真相，不重排镜头）。
 * 只有一个组且是隐式场 → 表不渲染组头（行为等同今天）。sceneId 引用不到登记场时
 * 补 `{id, title:''}` 隐式组头，不丢镜头。
 */
export function sceneGroupsOf(plan: StoryboardPlan): SceneGroup[] {
  const titleById = new Map((plan.scenes ?? []).map((scene) => [scene.id, scene.title]))
  const groups: SceneGroup[] = []
  plan.shots.forEach((shot, pos) => {
    const last = groups[groups.length - 1]
    const sceneId = shot.sceneId
    if (last && (last.scene?.id ?? undefined) === (sceneId ?? undefined)) {
      last.shots.push(shot)
      return
    }
    groups.push({
      scene: sceneId === undefined ? null : { id: sceneId, title: titleById.get(sceneId) ?? '' },
      shots: [shot],
      startPos: pos,
    })
  })
  return groups
}

/** 一组镜头的合计时长（秒，图片镜按停留时长计入）——场组头小结与方案卡合计共用口径。 */
export function totalDurationSec(shots: readonly PlanShot[]): number {
  return Math.round(shots.reduce((sum, shot) => sum + effectiveShotDurationSec(shot), 0))
}

// ── 校验：生成前的拦截项（footer 计数 + 行红标的唯一真相源；v5 行内/批量生成共用）──

export type PlanIssue =
  | { kind: 'no-shots' }
  | { kind: 'dangling-ref'; shotIndex: number; anchorId: string }
  | { kind: 'empty-shot-prompt'; shotIndex: number }
  | { kind: 'anchor-no-name'; anchorId: string }

/** 一个方案的全部待处理项；空数组 = 可生成。 */
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

// ── 镜头类型 + 批量作用域（「全部镜头」批量条与单镜卡共用的唯一真相源）──
//
// 底层 shotKind 仍是二值（image/video），UI 上的三档「图片 / 视频 / 图片+视频」由
// shotKind + keyframe.enabled 组合表达（见 PlanShot.keyframe 注释，避免历史方案变形）。
// 这里把「UI 档 ↔ 镜头字段」的换算收成纯函数：镜卡逐镜改、批量条整片改，走同一套（P1 无并行版）。

/** UI 上的镜头类型三档。 */
export type ShotTypeValue = 'image' | 'video' | 'image-video'

/** 多镜取值不一致时的哨兵值（批量条把它当成一个「混合」临时选项显示，选真值才应用）。 */
export const MIXED_VALUE = '__mixed__'

/** 某镜当前落在哪一档（shotKind 缺省按 video 兜底，与 PlanShot 注释一致）。 */
export function shotTypeOf(shot: PlanShot): ShotTypeValue {
  const kind = shot.shotKind ?? 'video'
  if (kind === 'image') return 'image'
  return shot.keyframe?.enabled === true ? 'image-video' : 'video'
}

/**
 * 改镜头类型要写的字段补丁（镜卡 onKindChange 与批量条 applyShotKindToAll 共用）。
 *
 * 切类型清掉模型/模式/参数——两种类的模型目录不通用，留着会张冠李戴（落画布按种类取默认兜底）；
 * 切到视频档时时长兜底 5s；image-video 档置 keyframe.enabled 并保留已写的首帧提示词。
 */
export function shotKindPatch(shot: PlanShot, next: ShotTypeValue): Partial<PlanShot> {
  const cleared = { modelKey: undefined, modeId: undefined, params: undefined } as const
  if (next === 'image') return { shotKind: 'image', keyframe: undefined, ...cleared }
  const durationSec = shot.durationSec > 0 ? shot.durationSec : DEFAULT_VIDEO_DURATION_SEC
  if (next === 'image-video') {
    return {
      shotKind: 'video',
      durationSec,
      keyframe: { ...(shot.keyframe || {}), enabled: true, prompt: shot.keyframe?.prompt || '' },
      ...cleared,
    }
  }
  return { shotKind: 'video', keyframe: undefined, durationSec, ...cleared }
}

/** 整片改镜头类型（每镜走 shotKindPatch，与逐镜改完全同构）。已是该档的镜头原样返回。 */
export function applyShotKindToAll(plan: StoryboardPlan, next: ShotTypeValue): StoryboardPlan {
  return {
    ...plan,
    shots: plan.shots.map((shot) => (shotTypeOf(shot) === next ? shot : { ...shot, ...shotKindPatch(shot, next) })),
  }
}

/**
 * 整片改模型。清 modeId/params——模式/参数属于具体模型，换模型后由 buildPlannedNodeMeta
 * 按新模型取默认模式（与镜卡 onShotModelChange 同口径）。空串 = 回「默认模型」。
 */
export function applyModelToAll(plan: StoryboardPlan, modelKey: string): StoryboardPlan {
  return {
    ...plan,
    shots: plan.shots.map((shot) => ({ ...shot, modelKey: modelKey || undefined, modeId: undefined, params: undefined })),
  }
}

/** 整片改时长（只影响视频档；图片镜的停留时长是逐镜创作选择，批量档位也是视频秒数，不动它）。 */
export function applyDurationToAll(plan: StoryboardPlan, sec: number): StoryboardPlan {
  if (!Number.isFinite(sec) || sec <= 0) return plan
  return {
    ...plan,
    shots: plan.shots.map((shot) => (shotTypeOf(shot) === 'image' ? shot : { ...shot, durationSec: sec })),
  }
}

/**
 * 整片改画幅（批量条「画幅」，v5）：写 params.aspect_ratio、其余参数保留。
 * 落画布时 params 铺进节点 meta，模型档案没有该参数的照常忽略（声明式映射只取声明键）。
 */
export function applyAspectToAll(plan: StoryboardPlan, aspect: string): StoryboardPlan {
  if (!aspect) return plan
  return {
    ...plan,
    shots: plan.shots.map((shot) => ({ ...shot, params: { ...(shot.params || {}), aspect_ratio: aspect } })),
  }
}

/** 全镜共同的画幅（params.aspect_ratio，没写=空串「按模型默认」）；不一致 → null（批量条显「混合」）。 */
export function deriveBulkAspect(plan: StoryboardPlan): string | null {
  return commonValue(plan.shots.map((shot) => {
    const aspect = shot.params?.aspect_ratio
    return typeof aspect === 'string' ? aspect : ''
  }))
}

/** 全镜共同值，否则 null（无镜头也是 null）。批量条据此显「混合」。 */
function commonValue<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null
  const [first] = values
  return values.every((v) => v === first) ? first : null
}

/** 全镜共同的类型；不一致 → null（批量条显「混合」）。 */
export function deriveBulkShotKind(plan: StoryboardPlan): ShotTypeValue | null {
  return commonValue(plan.shots.map(shotTypeOf))
}

/** 全镜共同的模型 key（都没选 → 空串=默认模型）；不一致 → null。 */
export function deriveBulkModelKey(plan: StoryboardPlan): string | null {
  return commonValue(plan.shots.map((shot) => shot.modelKey ?? ''))
}

/** 全视频镜共同的时长；不一致 → null。全是图片镜（无时长可言）也是 null。 */
export function deriveBulkDuration(plan: StoryboardPlan): number | null {
  return commonValue(plan.shots.filter((shot) => shotTypeOf(shot) !== 'image').map((shot) => shot.durationSec))
}
