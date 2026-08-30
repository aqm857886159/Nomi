// 镜级画面校验(verify)纯函数层 —— MUSE「plan-execute-verify-revise」闭环里的 verify 原语。
// 方案:docs/plan/2026-06-28-storyboard-closed-loop-verify.md（Stage 1）。
//
// 分工铁律(同 reconcile.ts):本文件**只放纯函数**(组 prompt / 解析判决 / 判偏差),同入参恒同结果、可裸测;
// 真正调模型(把首帧图作 attachment 喂 runWorkbenchAgent)的副作用在 runner 层的薄编排里,不进这里。
//
// 三轴(MUSE identity/composition/continuity),每轴 1-5 档带锚点——让模型「对着标准打第几档」,
// 比吐模糊小数稳。低于阈值的轴 → 一条「画面偏差」,喂进现有对账卡(ReconcileDeviationCard)。
// 客观项(连线结构/数量/参数)仍归 reconcile.ts 结构对账,不在这里重复判。

import type { ReconcileDeviation } from './reconcile'

export type ShotVerifyDimensionKey = 'identity' | 'composition' | 'continuity'

export type ShotVerifyDimension = {
  key: ShotVerifyDimensionKey
  /** 对账卡显示用的人话维度名。 */
  name: string
  desc: string
  anchors: { 5: string; 3: string; 1: string }
  /** continuity 仅在有前一镜时才评(首镜没有「上一镜」,不该被扣分)。 */
  requiresPreviousShot?: boolean
}

export const SHOT_VERIFY_DIMENSIONS: readonly ShotVerifyDimension[] = [
  {
    key: 'identity',
    name: '身份',
    desc: '画面主体是否与该镜引用的角色/场景/道具锚一致(脸型/发色/服装/标志物)',
    anchors: { 5: '与锚完全一致', 3: '大体一致但细节偏', 1: '明显对不上(张冠李戴/换人换装)' },
  },
  {
    key: 'composition',
    name: '构图',
    desc: '机位/景别/主体站位是否符合镜头描述',
    anchors: { 5: '完全符合描述', 3: '主体对但机位/景别偏', 1: '与描述明显不符' },
  },
  {
    key: 'continuity',
    name: '连贯',
    desc: '是否接得上前一镜(场景/时间/光线/风格不无故跳变)',
    anchors: { 5: '顺畅衔接', 3: '轻微跳变', 1: '明显断裂(白天跳夜里/换景)' },
    requiresPreviousShot: true,
  },
] as const

/** 任一轴低于此档即判该镜画面有偏差(进对账卡)。 */
export const SHOT_VERIFY_PASS_THRESHOLD = 3

/**
 * 「该镜别根本判不了这一轴」的哨兵档（0）——**不是低分，不算偏差，不触发重试**。
 *
 * 为什么必须有（2026-08-20 L3 真额度实测抓出）：同一个锚喂 5 个不同景别，identity 打分成了
 * 「脸在画面里占多大」的函数而非一致性的函数——中景 5 档（确实同一个人）、远景 3 档（脸几十像素）、
 * **眼部微距 1 档并标红**（画面里根本没有可比对的脸部结构）。原 prompt 的「拿不准给偏低分」把
 * 「看不到」误当成「不像」，于是：① 误报红标；② 触发一轮永远救不回来的定向重试（重滚一张眼睛微距
 * 不会让眼睛变得更可辨认）——白烧额度。故给判分器一条正路：看不到就报 0，我们据此跳过该轴。
 */
export const SHOT_VERIFY_NOT_ASSESSABLE = 0

/** 一镜校验所需的上下文(由 runner 层从节点+锚+前一镜组装,纯数据)。 */
export type ShotVerifyContext = {
  /** 被校验的镜头节点 id(偏差回指用)。 */
  shotNodeId: string
  /** 镜头人话标题(对账卡显示)。 */
  shotTitle: string
  /** 该镜提示词(构图/动作意图来源)。 */
  shotPrompt: string
  /** 该镜引用的视觉锚标准描述(角色/场景/道具),身份轴对照基准。 */
  anchorDescriptions: string[]
  /** 前一镜提示词(连贯轴对照);无前一镜则不传。 */
  previousShotPrompt?: string
  /**
   * 喂进来的图是不是「首帧+尾帧」的横向拼图（视频镜专用）。
   * 影响 rubric 措辞：不告诉判分器它看的是两帧，拼图只会让它更困惑（把右半当成穿帮）。
   */
  framePair?: boolean
  /**
   * 判官写 `reason` 用哪种语言（= 用户界面语言）。缺省 'zh-CN'（旧行为）。
   *
   * 为什么只切 reason 不翻整份 rubric：rubric 是调过的提示词工程（档位锚点、0 哨兵、首尾帧那几条铁律
   * 都是踩坑换来的），翻译它等于换一套判官行为，得重新验分档准确度。而用户在对账卡上**只看得到
   * reason 这一句**——它原样显示、渲染时无从回译，所以让判官直接用界面语言写它。
   *
   * 走 ctx 而不是在函数里读全局 locale：本核两份实现（src / electron capabilityCore）由等价性单测钉死
   * 逐字节相同，必须保持「同入参恒同结果」的纯函数；locale 由各自的编排层注入。
   */
  reasonLanguage?: 'zh-CN' | 'en'
}

function hasPreviousShot(ctx: ShotVerifyContext): boolean {
  return typeof ctx.previousShotPrompt === 'string' && ctx.previousShotPrompt.trim().length > 0
}

/** 本次该评哪几轴(无前一镜则去掉 continuity)。 */
export function activeDimensions(ctx: ShotVerifyContext): ShotVerifyDimension[] {
  const prev = hasPreviousShot(ctx)
  return SHOT_VERIFY_DIMENSIONS.filter((d) => (d.requiresPreviousShot ? prev : true))
}

/**
 * 档位归一。**0 是「无法判定」哨兵**，不是低分——原样保留（见 SHOT_VERIFY_NOT_ASSESSABLE）。
 * 其余夹进 1-5；非数字按最保守的 1 处理（判不出就别放行）。
 */
function clampScore(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  // 「无法判定」只认**判分器真的写了个 0**。不这么卡的话 Number(null)/Number('')/Number(false) 全是 0,
  // 于是判分器漏字段或给 null 会被读成「这题没法答」而静默出均分分母——正是本档最怕的注水路径。
  // 拿不准一律落最保守的 1（判不出别放行），只有明确的数字 0 才是哨兵。
  const explicitlyNumeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
  if (explicitlyNumeric && Math.round(n) === SHOT_VERIFY_NOT_ASSESSABLE) return SHOT_VERIFY_NOT_ASSESSABLE
  return Math.max(1, Math.min(5, Math.round(n)))
}

/** 1-5 档 → 0-1 归一(与 eval judge 同口径:1→0,3→0.5,5→1)。 */
export function normalizeShotScore(score: number): number {
  return +((clampScore(score) - 1) / 4).toFixed(3)
}

/**
 * 组校验 prompt:给模型看「该镜首帧图」(图由 runner 作 attachment 单独喂)+ 镜头意图 + 锚描述 + rubric,
 * 要它逐轴打 1-5 档、出简短理由,只回 JSON。无前一镜则不要求评 continuity。
 */
export function buildShotVerifyPrompt(ctx: ShotVerifyContext): string {
  const dims = activeDimensions(ctx)
  const keys = dims.map((d) => d.key)
  const rubric = dims
    .map((d) => `- ${d.key}「${d.name}」：${d.desc}\n    5档：${d.anchors[5]} ｜ 3档：${d.anchors[3]} ｜ 1档：${d.anchors[1]}`)
    .join('\n')
  const anchorBlock = ctx.anchorDescriptions.map((s) => s.trim()).filter(Boolean)
  return [
    ctx.framePair
      ? '你是资深影视分镜审片。下面这张图是某个镜头的**首帧(左)与尾帧(右)横向拼在一起**，按 Rubric 逐维度对着锚点判它该打第几档(1-5)。'
      : '你是资深影视分镜审片。下面这张图是某个镜头实际生成出来的画面，按 Rubric 逐维度对着锚点判它该打第几档(1-5)。',
    '',
    `镜头：《${ctx.shotTitle.trim()}》`,
    `镜头意图(提示词)：${ctx.shotPrompt.trim() || '(无)'}`,
    anchorBlock.length ? `该镜应当一致的设定锚：\n${anchorBlock.map((s) => `· ${s}`).join('\n')}` : '该镜未声明设定锚(身份轴按提示词里的主体判断)。',
    hasPreviousShot(ctx) ? `上一镜意图(连贯对照)：${ctx.previousShotPrompt!.trim()}` : '这是首镜，没有上一镜，不要评 continuity。',
    '',
    '<Rubric 逐维度 1-5 档>',
    rubric,
    '</Rubric>',
    '',
    `不要调用任何工具，只输出 JSON：{"reason": string, "scores": {${keys.map((k) => `"${k}": 1-5`).join(', ')}}}。`,
    'reason 简短(每轴一句、整体不超过 100 字)。',
    // 用条件展开而不是 `? … : null`：null 经 join 会给中文 prompt 多出一个空行,
    // 那等于顺手改了判官在中文下的输入。展开成空数组 → 中文侧逐字节不变。
    ...(ctx.reasonLanguage === 'en'
      ? ['reason 必须用**英文**写(用户界面是英文,这句会原样显示给用户看);scores 与 JSON 键名保持不变。']
      : []),
    '打分铁律：① 主体对不上/机位错就低分，不要因为图清晰就给高分；② 拿不准（看得见但吃不准像不像）给保守的偏低分；',
    `③ **但如果这个镜别根本看不到可比对的依据**（如眼部或手部微距、极远景主体只有几十像素、纯背影），该轴请给 ${SHOT_VERIFY_NOT_ASSESSABLE} 表示「无法判定」——${SHOT_VERIFY_NOT_ASSESSABLE} 不是低分，我们会跳过该轴；把「看不到」打成低分会触发一轮永远救不回来的重做。`,
    ctx.framePair
      ? '④ **这是首尾两帧，镜头内容随时间展开是正常的**：像「逐渐显出/由暗转亮/缓缓推近」这类设计，'
        + '左边空、右边才出现要的东西——那是**做对了**，按两帧合起来是否兑现镜头意图打分，不要只看左边就判不达标。'
        + '⑤ identity 轴请**同时比较左右两帧是不是同一个人**：中途变脸是视频最常见的崩坏，只看一帧查不出来。'
      : null,
  ].join('\n')
}

/** 容错解析模型判决:剥 ```json 围栏、抓首个 {…}、清裸控制字符与尾逗号。解析不出冒泡 error(不静默当通过)。 */
export function parseShotVerifyVerdict(text: string): { scores: Record<ShotVerifyDimensionKey, number>; reason: string } {
  let s = String(text || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const brace = s.match(/\{[\s\S]*\}/)
  const candidate = brace ? brace[0] : s
  const repaired = candidate.replace(/[\u0000-\u001f]+/g, " ").replace(/,(\s*[}\]])/g, "$1")
  let parsed: unknown = null
  for (const c of [candidate, repaired]) {
    try {
      parsed = JSON.parse(c)
      break
    } catch {
      /* 试下一种 */
    }
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`校验输出非 JSON：${candidate.slice(0, 140)}`)
  const obj = parsed as Record<string, unknown>
  const rawScores = obj.scores && typeof obj.scores === 'object' ? (obj.scores as Record<string, unknown>) : {}
  const scores = {} as Record<ShotVerifyDimensionKey, number>
  for (const d of SHOT_VERIFY_DIMENSIONS) scores[d.key] = clampScore(rawScores[d.key])
  return { scores, reason: typeof obj.reason === 'string' ? obj.reason : '' }
}

/** 一条「画面偏差」(映射进 ReconcileDeviation 前的中间形,带回指 id 供 Stage 2 决定回灌哪几镜)。 */
export type ShotContentDeviation = {
  shotNodeId: string
  shotTitle: string
  dimension: ShotVerifyDimensionKey
  dimensionName: string
  /** 1-5 实得档。 */
  score: number
  /** 人话偏差原因(给对账卡显示)。 */
  reason: string
}

/**
 * 判决 → 偏差列表:只收**本次该评**(activeDimensions)且**低于阈值**的轴。
 * 首镜不评 continuity → 即便模型乱给低分也不报(activeDimensions 已过滤)。
 */
export function deviationsFromVerdict(
  ctx: ShotVerifyContext,
  verdict: { scores: Record<ShotVerifyDimensionKey, number>; reason: string },
): ShotContentDeviation[] {
  const active = new Set(activeDimensions(ctx).map((d) => d.key))
  const out: ShotContentDeviation[] = []
  for (const d of SHOT_VERIFY_DIMENSIONS) {
    if (!active.has(d.key)) continue
    const score = clampScore(verdict.scores[d.key])
    // 0 = 该镜别判不了这一轴（眼部微距/极远景/背影）→ 不算偏差、不红标、不重试（重做也救不回来）。
    if (score === SHOT_VERIFY_NOT_ASSESSABLE) continue
    if (score >= SHOT_VERIFY_PASS_THRESHOLD) continue
    out.push({
      shotNodeId: ctx.shotNodeId,
      shotTitle: ctx.shotTitle,
      dimension: d.key,
      dimensionName: d.name,
      score,
      reason: verdict.reason.trim() || `${d.name}不达标(第 ${score} 档)`,
    })
  }
  return out
}

/**
 * 画面偏差 → 对账偏差(喂进现有 ReconcileDeviationCard,与结构偏差同卡)。kind:'content' 让卡片
 * 走「直接显人话原因」分支(不套结构偏差的「批准 vs 实际」),并带 shotNodeId 供 Stage 2 闭环回指。
 */
export function contentDeviationsToReconcile(content: readonly ShotContentDeviation[]): ReconcileDeviation[] {
  return content.map((d) => ({
    where: d.shotTitle,
    field: d.dimensionName,
    expected: '与设定/描述一致',
    actual: `第 ${d.score} 档`,
    reason: d.reason,
    kind: 'content',
    shotNodeId: d.shotNodeId,
  }))
}
