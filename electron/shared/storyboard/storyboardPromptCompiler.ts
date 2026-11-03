import type { PlanAnchor, PlanAnchorKind, PlanReferenceBinding, PlanShot } from './storyboardPlan'

/**
 * 分镜方案的**提示词编译层**：把 `StoryboardPlan` 的锚/镜头结构编译成真正下发给模型的文字
 * （定妆卡 prompt、镜头 prompt、首帧 prompt），外加同样由 prompt 派生的视觉参考顺序。
 *
 * 为什么单独一层：这些全是**纯函数**——只读 plan、只吐字符串，不碰节点/边/落画布参数。
 * 它们和 `storyboardPlan.ts` 里的「结构 → create_canvas_nodes 参数」是两件事，混住会让
 * 「改一句提示词措辞」和「改落画布结构」挤在同一个文件里（R9 分层）。
 *
 * 依赖方向：本文件只**按类型**回引 `storyboardPlan.ts`（`import type`，无运行期环）；
 * `storyboardPlan.ts` 反过来按值 import 这里的编译函数。
 */

const VISUAL_KINDS: ReadonlySet<PlanAnchorKind> = new Set(['character', 'scene', 'prop'])

/**
 * 「这把锚会生成参考图卡」的唯一谓词（materialize / 连边 / 分镜表卡面与等待判定共用）：
 * carrier=visual 且 kind 在可出图集合（style 恒文本语义，即使 carrier 被手动翻成 visual
 * 也不建节点——materialize 同一判定，卡面「生成」按钮与等待判定不得与它分裂）。
 */
export function isVisualAnchor(anchor: Pick<PlanAnchor, 'carrier' | 'kind'>): boolean {
  return anchor.carrier === 'visual' && VISUAL_KINDS.has(anchor.kind)
}

/**
 * 「这把锚**自带素材**」的唯一谓词：自己带 URL（@ 引用素材库 / 上传的文件），
 * 或指着画布上一个已经出了图的节点（结果即收：用作… → 设为首帧 / 存为参考）。
 *
 * 自带素材的锚**不需要再生成一张参考卡**，所以 materialize 从不给它建节点
 * （`storyboardPlan.ts` 的建卡两处 + 连边一处），执行时素材要么随 params 走 URL、
 * 要么随边从源节点走。
 *
 * 为什么必须只有一份（2026-09-18 根因）：行状态层曾另写一份判据——「这张锚的 URL 有没有
 * 落进本行模式某个吃图槽的 `referenceBindings`」——去决定要不要等它。@ 引用与结果即收
 * 两条路都不写 `referenceBindings`，没钉模型的行更连槽都没有，于是同一张锚在执行层
 * 「素材已就位」、在状态层「等参考图」：批量把该行排除、页脚照着报数、参考卡带写「N 镜在等它」。
 * 两份判据回答同一个问题就必然漂，这里收成一份。
 */
export function anchorCarriesOwnMaterial(anchor: Pick<PlanAnchor, 'referenceUrl' | 'referenceSourceNodeId'>): boolean {
  return Boolean(anchor.referenceUrl || anchor.referenceSourceNodeId)
}

/**
 * 定妆卡/场景卡提示词构造（R6 调研落地：把图当「版面/网格」描述，先锁身份再列视图，
 * 中性背景+平光+小标签，多视图+多变体集中一张图，整张喂参考视频）。GPT Image 2 尤擅此类多面板版面。
 * 视觉锚（character/scene/prop）→ 卡片大图；变体（成年/童年、白天/夜晚…）拼进「变体行」。
 */
/**
 * 锚的「身份描述段」：W2 圣经优先用 static（身份 DNA）+ dynamic（服装/状态）分区拼——身份 DNA 先锁、
 * 服装状态另起一行，让身份与可变层在卡片 prompt 里就分开（对齐 ViMax：身份只看 static）。二者都空时
 * 退化到旧 description（旧草稿无新字段时向后兼容）。
 */
function anchorIdentityBody(anchor: PlanAnchor): string {
  const staticFeatures = (anchor.staticFeatures || '').trim()
  const dynamicFeatures = (anchor.dynamicFeatures || '').trim()
  if (staticFeatures || dynamicFeatures) {
    return [
      staticFeatures ? `身份特征（跨镜保持一致）：${staticFeatures}` : '',
      dynamicFeatures ? `服装与状态：${dynamicFeatures}` : '',
    ].filter(Boolean).join('\n')
  }
  return anchor.description.trim()
}

export function buildAnchorSheetPrompt(anchor: PlanAnchor): string {
  const name = anchor.name.trim()
  const desc = anchorIdentityBody(anchor)
  const variantLine =
    anchor.variants && anchor.variants.length
      ? `\nVariants: ${anchor.variants.map((v) => v.trim()).filter(Boolean).join(', ')} (show each variant in its own labeled panel).`
      : ''
  if (anchor.kind === 'scene') {
    return [
      'Environment reference sheet. Landscape layout, clearly separated panels, small labels below each panel, consistent color palette and lighting.',
      `The same location "${name}": ${desc}`,
      'Views: 1) distant establishing view 2) close-up detail 3) overhead view 4) three-quarter view.' + variantLine,
      'Requirements: keep the same location and visual style consistent across panels; avoid people, style drift, and merged panels.',
    ].join('\n')
  }
  if (anchor.kind === 'prop') {
    return [
      'Prop reference sheet. White neutral background, flat lighting, clearly separated panels, small labels below each panel.',
      `The same object "${name}": ${desc}`,
      'Views: 1) front 2) side 3) close-up detail.' + variantLine,
      'Requirements: keep the same object consistent across panels; avoid scene backgrounds, style drift, and merged panels.',
    ].join('\n')
  }
  // character（默认）
  return [
    'Character reference sheet. White neutral background, flat lighting, landscape layout, clearly separated panels, small labels below each panel.',
    `The same character "${name}" must keep the same face shape, hairstyle, clothing, and identifying features across all panels: ${desc}`,
    'Views: 1) full-body front A-pose 2) side 3) back 4) three-quarter side 5) expression row (neutral / smiling / angry).' + variantLine,
    'Requirements: keep facial features and clothing consistent across panels; avoid merged panels, cross-panel drift, and scene backgrounds.',
  ].join('\n')
}

/**
 * **一镜发出去什么：全仓唯一的一个函数**（2026-09-30，「巨龙」变成人物那次的根因合同 storyboard-outbound-owner）。
 *
 * 规则只有一句：一镜发出去的 = 这一行写的提示词 + 这一行上看得见的参考图。别的什么都不加。
 *   · 提示词 = 行上那个提示词框里的字（首帧图节点 = 首帧提示词框里的字，框空了才退到这一镜的提示词框）；
 *   · 参考图 = 这一行参考列里画着的绑定（referenceBindings），不多不少。
 * 以前这里还会把「引用锚」的身份特征、文本锚的整段描述追加进提示词，并按 anchorIds 把定妆卡连成参考边——
 * 行上既看不到追加的字，也看不到那张图，用户写「巨龙」，供应商收到「巨龙 + 一个黑发女人的描述 + 她的照片」。
 * 追加与自动连图已整段删除；anchorIds 留在旧方案里只是一个不再产生任何作用的字段。
 *
 * 所有入口（行内生成 / 生成剩余 / Agent 确认框 / 放到画布 / production.materialize-storyboard）都从这里取，
 * 不许各自再拼；对等测试 shotOutbound.parity.test.ts 逐字节比它们。
 */
export type ShotOutbound = Readonly<{
  prompt: string
  /** 按槽种类分桶的有序绑定；只留有地址的。投影进节点 meta 由行的参考槽层（shotReferenceMetaPatch）按当前模式做。 */
  referenceBindings: Record<string, PlanReferenceBinding[]>
}>

export function compileShotOutbound(shot: PlanShot, part: 'shot' | 'keyframe'): ShotOutbound {
  if (part === 'keyframe') {
    const keyframePrompt = shot.keyframe?.enabled === true && typeof shot.keyframe.prompt === 'string' ? shot.keyframe.prompt.trim() : ''
    return { prompt: keyframePrompt || shot.prompt.trim(), referenceBindings: {} }
  }
  const referenceBindings = Object.fromEntries(
    Object.entries(shot.referenceBindings ?? {}).map(([slot, bindings]) => [slot, (Array.isArray(bindings) ? bindings : []).filter((binding) => Boolean(binding?.url))]),
  )
  return { prompt: shot.prompt.trim(), referenceBindings }
}
