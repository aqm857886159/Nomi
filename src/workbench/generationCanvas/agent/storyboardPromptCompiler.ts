import { parsePromptSegments } from '../../assets/promptMentions'
import type { PlanAnchor, PlanAnchorKind, PlanShot } from './storyboardPlan'

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
 * 引用锚要拼进镜头 prompt 的那几段。两类锚、两种拼法，**唯一一处**（两个 build*Prompt 共用，别再各抄一份）：
 *
 *  · 文本锚（style 等，carrier='text'）：整段 description。它本来就不建节点，只能靠 prompt 说清。
 *  · 视觉锚（角色/场景/道具 = 定妆卡）：只拼 `staticFeatures`（身份 DNA），**绝不拼 dynamicFeatures**。
 *    档案本来就把这两层分开了：static 是「同一个人」的定义（脸/眼/疤/年龄性别），跨镜不变；
 *    dynamic 是服装与状态，跨镜本来就该变——拼进去会跟这一镜的画面打架（这一镜她刚从水里爬出来，
 *    卡上却写着「穿黄油布外套」）。
 *
 * 为什么视觉锚除了连参考图还要**再给一段字**（2026-09-02 实测才敢加，不是拍脑袋）：
 * Seedream 4.5 i2i、同一张参考图、同一段镜头文字，只有「拼不拼 static」一个变量，shot3 各跑 4 次——
 *   · 只给图：**0/4** 拿到要求的「脸部特写」（都退回全身/中景站位）
 *   · 图 + static：**3/4** 拿到特写
 * 身份本身两臂都没崩（参考图 i2i 已经锁得住），所以这段字的收益在**构图遵循度**：
 * 只给图时模型不知道这一镜的重点是谁，就退回最安全的全身；给了身份文字它才照着「特写谁的脸」去构图。
 *
 * 顺带解决黑盒：拼在这里 = 这段字进 `node.prompt`，用户在提示词框里**看得见也改得动**，
 * 而不是躺在 meta 里没人知道它存不存在。
 */
function anchorPromptBits(shot: PlanShot, anchorById: Map<string, PlanAnchor>): string[] {
  return shot.anchorIds
    .map((id) => anchorById.get(id))
    .filter((anchor): anchor is PlanAnchor => Boolean(anchor))
    .map((anchor) => {
      if (anchor.carrier === 'text') return `${anchor.name}：${anchor.description}`.trim()
      const staticFeatures = (anchor.staticFeatures || '').trim()
      return staticFeatures ? `${anchor.name}·身份特征（跨镜保持一致）：${staticFeatures}` : ''
    })
    .filter(Boolean)
}

/** 视觉参考的边顺序：先按提示词 @ 的出现顺序，再接没有 @ 的旧绑定，保持兼容。 */
export function referenceOrderForShot(shot: PlanShot, anchorById: Map<string, PlanAnchor>): Map<string, number> {
  const byUrl = new Map<string, string>()
  for (const anchor of anchorById.values()) {
    if (anchor.referenceUrl) byUrl.set(anchor.referenceUrl, anchor.id)
  }
  const ordered = new Set<string>()
  for (const segment of parsePromptSegments(shot.prompt)) {
    if (segment.type !== 'mention') continue
    const anchorId = byUrl.get(segment.url)
    if (anchorId && shot.anchorIds.includes(anchorId)) ordered.add(anchorId)
  }
  for (const anchorId of shot.anchorIds) {
    const anchor = anchorById.get(anchorId)
    if (anchor && isVisualAnchor(anchor)) ordered.add(anchorId)
  }
  return new Map([...ordered].map((anchorId, index) => [anchorId, index]))
}

/** 镜头 prompt = 镜头本体 + 引用锚的描述段（文本锚整段 / 视觉锚只给身份 DNA）。 */
export function buildShotPrompt(shot: PlanShot, anchorById: Map<string, PlanAnchor>): string {
  const bits = anchorPromptBits(shot, anchorById)
  const base = shot.prompt.trim()
  return bits.length ? [base, ...bits].filter(Boolean).join('\n') : base
}

export function buildKeyframePrompt(shot: PlanShot, anchorById: Map<string, PlanAnchor>): string {
  // 优先级：用户在编辑器手改的 keyframe.prompt > planner 的静态首帧分解 ffDesc > 镜头 prompt（今天的兜底）。
  // 为什么 ffDesc 排在 shot.prompt 前：shot.prompt 写的是「运动」（推进/摇移/动作演进），拿它当首帧图
  // 提示词会让静态首帧被运动词污染（director-shot-translation 的污染词铁律）；ffDesc 才是那一帧的快照。
  const keyframePrompt = typeof shot.keyframe?.prompt === 'string' && shot.keyframe.prompt.trim()
    ? shot.keyframe.prompt.trim()
    : (typeof shot.ffDesc === 'string' && shot.ffDesc.trim() ? shot.ffDesc.trim() : shot.prompt.trim())
  const bits = anchorPromptBits(shot, anchorById)
  return bits.length ? [keyframePrompt, ...bits].filter(Boolean).join('\n') : keyframePrompt
}
