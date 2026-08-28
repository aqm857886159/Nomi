// 能力核 · 审片环编排（W1 · 方案 docs/plan/2026-08-19-w1-shot-verify-wiring.md §3/§6）。
//
// 单镜生成成功后跑一次「审片环」：判分 → 不过 → 定向重试（复用首发 grantId + 同 nodeId，K≤2）→
// 仍不过 → 红标交付。**纯编排、DI 可裸测**——judge / extractFrame / regenerate / visionAvailable 全注入，
// 本模块不碰 electron、不认识 runTask/grant 的真身（那是 shotVerifyDeps 的活）。
//
// 与渲染层 shotVerifyRunner 的关系：共用同一纯核（shotVerifyCore 的 buildShotVerifyPrompt/parse/deviations），
// 差别只在「谁调 judge/谁抽帧/怎么重试」这层接线——渲染层 runner 只判不重试（喂对账卡），本编排在 MCP
// 单镜路上判 + 定向重试 + 红标（W1 的审片环）。核收敛为一份，接线按路径各接一处（方案 §10，不是并行版）。
//
// 容错铁律（同 runner）：审片是**增益**，任一步失败绝不阻断「生成已完成」——取帧/判决失败 → 跳过判分
// （返回 skipped 的 outcome，不抛、不误报）；视觉不可用 → 整体跳过。重试仅在「判分真的低于阈值」时发生。

import type { DesktopLocale } from '../desktopLocale'
import {
  buildShotVerifyPrompt,
  parseShotVerifyVerdict,
  deviationsFromVerdict,
  activeDimensions,
  SHOT_VERIFY_DIMENSIONS,
  type ShotVerifyContext,
  type ShotVerifyDimensionKey,
  type ShotContentDeviation,
} from './shotVerifyCore'

/** 被审的单镜快照（由 core 从生成结果 + 节点 + 锚 + 前镜组装，纯数据）。 */
export type ShotVerifyShot = {
  shotNodeId: string
  shotTitle: string
  shotPrompt: string
  /** 该镜引用的视觉锚标准描述（身份轴对照基准）。 */
  anchorDescriptions: string[]
  /** 前一镜提示词（连贯轴对照）；首镜不传。 */
  previousShotPrompt?: string
  /** 已生成产物地址：图片镜=result.url（nomi-local，直接当帧）；视频镜=视频 url（待抽帧）。 */
  frameSourceUrl: string
  /** 视频镜需先抽帧；图片镜直接用 frameSourceUrl。 */
  isVideo: boolean
}

export type ShotVerifyOrchestrateInput = {
  shot: ShotVerifyShot
  /** 定向重试上限（K）。默认 2——配 spendGrant 的 maxAttemptsPerNode=3（1 首发 + 2 重试）。 */
  maxRetries?: number
  /**
   * 判分总时长硬界（毫秒，默认 ~60s）。判分（含底层 HTTP 重试 + 定向重试全过程）超界/抛错 →
   * 立即返回 skipped(reason)、生成结果照常交付。L3 实跑抓出的韧性铁律：判分**绝不**拖垮生成
   * （现场：判分模型端点连续 500 把整个 tools/call 拖到 300s 客户端超时，生成结果被丢给超时错误）。
   */
  deadlineMs?: number
}

/** 重生一镜：由接线层复用**首发 grantId + 同 nodeId** 直发 runTask（不第二次 confirmSpend）。 */
export type RegenerateResult = {
  /** 重生后的新产物地址（图片镜=图 url；视频镜=视频 url）。 */
  frameSourceUrl: string
  isVideo: boolean
}

export type ShotVerifyDeps = {
  /** 视频取帧 → 首帧 image url（nomi-local）。仅视频镜调。 */
  extractFrame: (videoUrl: string) => Promise<string>
  /** 把首帧图 + 校验 prompt 喂多模态模型，返回原始判决文本（JSON 或带围栏）。 */
  judge: (prompt: string, frameImageUrl: string) => Promise<string>
  /**
   * 定向重生该镜：接线层用首发 grantId + 同 nodeId 直发 runTask，把 retryDirective 拼进 prompt。
   * 返回新产物地址；抛错 = 这次重试没成，编排层按「取当前最好判决 + 红标」收尾（不阻断）。
   */
  regenerate: (nodeId: string, retryDirective: string) => Promise<RegenerateResult>
  /** 多模态/视觉模型是否可用；false → 整体跳过判分（降级仅生成，不报错）。 */
  visionAvailable: () => boolean
  /**
   * 判官写 reason 用哪种语言（= 用户界面语言）。缺省 'zh-CN'（旧行为）。
   * 由接线层注入而不是本层去 import electron/i18n：capabilityCore 必须保持 electron-free
   * （裸 Node launcher 与 vitest 都要能载它）。
   */
  reasonLanguage?: DesktopLocale
}

/** 交付标注（方案 §7）：供 core 透传、mcpToolResults 读它填结构化 + 文本审片行。 */
export type ShotVerifyOutcome = {
  /** 判分是否真跑了（视觉不可用 / 取帧失败 / 判分超时/失败 → false，此时其余字段为空态）。 */
  evaluated: boolean
  /**
   * 判分被跳过（视觉不可用 / 取帧失败 / **判分超时或连续失败**）。true 时 reason 给人话原因，
   * 交付显「审片：跳过（原因）」并把 skipped/reason 进结构化字段（诚实标缺口，D4）。
   */
  skipped: boolean
  /** 跳过原因（人话，供交付文案与结构化字段）；未跳过时 null。 */
  reason: string | null
  /** 三轴均达标（无低于阈值的**该评**轴）。evaluated=false 时为 true（无偏差可报）。 */
  passed: boolean
  /** 实际定向重试次数（0 = 首发即过 / 未评）。 */
  retries: number
  /** 最终判决三轴档位（1-5）；未评时为空对象。 */
  scores: Partial<Record<ShotVerifyDimensionKey, number>>
  /** 红标：最终仍低于阈值的轴（重试用尽仍不达标）。passed=true 时为空。 */
  flagged: Array<{ dimension: ShotVerifyDimensionKey; dimensionName: string; score: number; reason: string }>
  /** 一句人话建议（仍有红标时给「建议重滚」类），无则 null。 */
  suggestion: string | null
}

function toContext(shot: ShotVerifyShot, reasonLanguage: DesktopLocale = 'zh-CN'): ShotVerifyContext {
  return {
    shotNodeId: shot.shotNodeId,
    shotTitle: shot.shotTitle,
    shotPrompt: shot.shotPrompt,
    anchorDescriptions: shot.anchorDescriptions,
    reasonLanguage,
    ...(shot.previousShotPrompt ? { previousShotPrompt: shot.previousShotPrompt } : {}),
    // 视频镜喂的是首尾拼图 → 告诉 rubric，否则判分器会把「右半才出现的东西」当成穿帮
    // （而那恰恰是「逐渐显出」类镜头做对了的样子）。
    ...(shot.isVideo ? { framePair: true } : {}),
  }
}

/**
 * 定向重试指令（方案 §6，源 ViMax「保背景换角色」§3.5）：读判分出的偏差轴 → 拼
 * 「保持背景/构图/光线不变，仅修正 <身份/构图/连贯> 到与锚一致」的 directive，供接线层拼进重发 prompt。
 * 纯函数、可单测。**不含角色名**（对齐 W4 污染词铁律：directive 只约束「保持什么/修正哪一轴」，不复述具体设定值）。
 */
export function buildRetryDirective(deviations: readonly ShotContentDeviation[]): string {
  const dims = new Set(deviations.map((d) => d.dimension))
  // 要修正的轴 → 人话短语（按固定顺序，稳定输出）。
  const fixLabels: string[] = []
  if (dims.has('identity')) fixLabels.push('主体身份（脸型/发色/服装/标志物与设定锚一致）')
  if (dims.has('composition')) fixLabels.push('机位与景别（贴合镜头描述）')
  if (dims.has('continuity')) fixLabels.push('与上一镜的衔接（场景/时间/光线不跳变）')
  const fixPart = fixLabels.length ? fixLabels.join('、') : '与设定锚不一致之处'
  // 保持不变的项：没被判低的轴对应的东西（尽量保背景/构图/光线，降低重滚幅度）。
  const keepParts: string[] = []
  if (!dims.has('composition')) keepParts.push('构图与机位')
  if (!dims.has('continuity')) keepParts.push('场景光线氛围')
  keepParts.push('背景')
  const keepPart = Array.from(new Set(keepParts)).join('、')
  return `【定向重滚】保持${keepPart}尽量不变，只修正：${fixPart}。不要引入新的人物或场景元素。`
}

/** 跑一遍判分：抽帧(视频镜) → judge → parse → 该评轴的低分偏差。失败(取帧/判决)返回 null(跳过,不阻断)。 */
async function judgeOnce(
  shot: ShotVerifyShot,
  deps: ShotVerifyDeps,
): Promise<{ scores: Record<ShotVerifyDimensionKey, number>; deviations: ShotContentDeviation[]; reason: string } | null> {
  let frameUrl: string
  try {
    frameUrl = shot.isVideo ? await deps.extractFrame(shot.frameSourceUrl) : shot.frameSourceUrl
  } catch {
    return null // 取帧失败 → 跳过判分（生成已完成，不误报）
  }
  if (!frameUrl) return null
  const ctx = toContext(shot, deps.reasonLanguage)
  try {
    const raw = await deps.judge(buildShotVerifyPrompt(ctx), frameUrl)
    const verdict = parseShotVerifyVerdict(raw)
    return { scores: verdict.scores, deviations: deviationsFromVerdict(ctx, verdict), reason: verdict.reason }
  } catch {
    return null // 判决/解析失败 → 跳过判分
  }
}

/** 该评轴的最终档位（只含 activeDimensions；首镜不含 continuity）。 */
function activeScores(shot: ShotVerifyShot, scores: Record<ShotVerifyDimensionKey, number>): Partial<Record<ShotVerifyDimensionKey, number>> {
  const active = new Set(activeDimensions(toContext(shot)).map((d) => d.key))
  const out: Partial<Record<ShotVerifyDimensionKey, number>> = {}
  for (const d of SHOT_VERIFY_DIMENSIONS) if (active.has(d.key)) out[d.key] = scores[d.key]
  return out
}

/** 跳过态 outcome（视觉不可用 / 取帧失败 / 判分超时或连续失败）——生成照常交付，reason 给人话缺口。 */
function skippedOutcome(reason: string | null): ShotVerifyOutcome {
  // skipped ≠ passed：没判过就不许自称「通过」（L3 实跑抓出 skipped:true 与 passed:true 并存的语义瑕疵）。
  return { evaluated: false, skipped: true, reason, passed: false, retries: 0, scores: {}, flagged: [], suggestion: null }
}

/** 判分总时长硬界默认值（毫秒）。判分含底层 HTTP 重试可能慢，但绝不该拖垮生成——超此即 skipped。 */
const DEFAULT_VERIFY_DEADLINE_MS = 60_000

/** 哨兵：judge/retry 全过程超界时由 deadline 竞速抛出，verifyAndMaybeRetry 捕获后收成 skipped。 */
class VerifyDeadlineError extends Error {
  constructor() {
    super('shot-verify deadline exceeded')
    this.name = 'VerifyDeadlineError'
  }
}

/**
 * 审片环：判分 → 不过 → 定向重试（K≤2，接线层复用首发 grantId 直发）→ 仍不过 → 红标。
 * - 视觉不可用 / 首次判分就跳过（取帧/判决失败）→ 返回 skipped(reason)（交付显「跳过（原因）」，仅生成）。
 * - 每次重试后重新判分；一旦达标即 passed 收尾；用尽 K 仍有低分轴 → flagged + suggestion。
 * - 重试自身失败（regenerate 抛错）→ 用「当前这轮的判决」收尾（红标基于最后一次成功判分），不阻断。
 * - **总时长硬界**（deadlineMs，默认 ~60s）：判分（含底层 HTTP 重试 + 全部定向重试）超界或抛错 →
 *   立即返回 skipped(reason)、生成结果照常交付。L3 铁律：判分**绝不**把 tools/call 拖到客户端超时。
 *   判分失败**绝不**触发 regenerate（重试只对「真拿到低分判决」的镜头，判分失败≠低分）。
 */
export async function verifyAndMaybeRetry(input: ShotVerifyOrchestrateInput, deps: ShotVerifyDeps): Promise<ShotVerifyOutcome> {
  if (!deps.visionAvailable()) return skippedOutcome('无可用判分模型（未配置 text 模型），本镜仅生成、未审片')
  const deadlineMs = Math.max(1, input.deadlineMs ?? DEFAULT_VERIFY_DEADLINE_MS)

  // 把整段判分+重试工作与「硬界超时」竞速：任一先到即收尾。判分挂死/连续 500 时，deadline 先到 → skipped，
  // 生成结果不被拖到 300s 客户端超时（L3 现场根因）。judge 内部若已挂起，我们不苦等它 settle——竞速即返回。
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new VerifyDeadlineError()), deadlineMs)
    // node 环境：别让这颗定时器吊住进程退出（judge 已过就赢，这颗只是保险丝）。
    if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
  })
  try {
    return await Promise.race([runVerifyLoop(input, deps), deadline])
  } catch (err) {
    if (err instanceof VerifyDeadlineError) {
      return skippedOutcome('判分未能在时限内完成（判分模型无响应/持续失败，已跳过审片，不影响本次生成）')
    }
    // 判分/重试过程里意外抛错（非低分，非 deadline）→ 同样跳过、绝不拖垮生成。
    return skippedOutcome('审片过程出错，已跳过（不影响本次生成）')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 判分+定向重试主循环（被 deadline 竞速包裹）。判分失败只跳过、绝不触发 regenerate。 */
async function runVerifyLoop(input: ShotVerifyOrchestrateInput, deps: ShotVerifyDeps): Promise<ShotVerifyOutcome> {
  const maxRetries = Math.max(0, Math.min(2, input.maxRetries ?? 2)) // 硬封顶 2：配 grant 的 maxAttemptsPerNode=3

  let shot = input.shot
  let judged = await judgeOnce(shot, deps)
  if (!judged) return skippedOutcome('判分未成功（取帧或判决失败），本镜仅生成、未审片') // 连首次判分都没跑成 → 跳过（不误报为「过」也不重试）

  let retries = 0
  while (judged.deviations.length > 0 && retries < maxRetries) {
    const directive = buildRetryDirective(judged.deviations)
    let regen: RegenerateResult
    try {
      regen = await deps.regenerate(shot.shotNodeId, directive)
    } catch {
      break // 重试没发成 → 用当前判决收尾（红标基于最后一次成功判分），不阻断交付
    }
    retries += 1
    shot = { ...shot, frameSourceUrl: regen.frameSourceUrl, isVideo: regen.isVideo }
    const next = await judgeOnce(shot, deps)
    if (!next) break // 重生后判分跳过（取帧/判决失败）→ 用上一轮判决收尾
    judged = next
  }

  const scores = activeScores(shot, judged.scores)
  const flagged = judged.deviations.map((d) => ({ dimension: d.dimension, dimensionName: d.dimensionName, score: d.score, reason: d.reason }))
  const passed = flagged.length === 0
  const suggestion = passed
    ? null
    : `${flagged.length} 个维度仍未达标（${flagged.map((f) => f.dimensionName).join('、')}），建议在 Nomi 里重滚这一镜或调整提示词`
  return { evaluated: true, skipped: false, reason: null, passed, retries, scores, flagged, suggestion }
}
