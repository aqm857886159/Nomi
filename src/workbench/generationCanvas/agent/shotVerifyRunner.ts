// 镜级 verify 实时编排(impure,但靠 DI 可裸测)—— 把纯原语 shotVerify 接到真实生成产物。
// 方案:docs/plan/2026-06-28-storyboard-closed-loop-verify.md（Stage 1 实时编排）+ 三态诚实审片升级。
//
// 副作用全收在注入的 deps 里(取帧 IPC + 调多模态模型 + 视觉可用性),本函数只编排:
//   逐镜 → 取首帧图(图片镜=result.url;视频镜=extractFrame 抽首帧)→ 喂模型判 → 输出三态结果。
// 诚实铁律:verify 不阻断「生成已完成」,但绝不把失败/跳过伪装成「通过」——
// 视觉不可用 / 缺帧 / 抽帧失败 / 判决抛错 / 非 JSON 一律记为 unverified 并带结构化原因。

import type { QaShotUnverifiedReason } from '../../../../electron/productionRun/productionRunTypes'
import { getAppLocale } from '../../../i18n'
import type { ReconcileDeviation } from './reconcile'
import {
  buildShotVerifyPrompt,
  parseShotVerifyVerdict,
  deviationsFromVerdict,
  contentDeviationsToReconcile,
  type ShotVerifyContext,
} from './shotVerify'

/** 一镜校验入参(由调用方从画布节点+锚+前一镜组装,纯数据)。 */
export type ShotVerifyInput = {
  shotNodeId: string
  shotTitle: string
  shotPrompt: string
  /** 该镜引用的视觉锚标准描述(身份轴对照基准)。 */
  anchorDescriptions: string[]
  /** 前一镜提示词(连贯轴对照);首镜不传。 */
  previousShotPrompt?: string
  /** 已生成产物地址:图片镜=result.url(nomi-local,直接当帧);视频镜=视频 url(待抽帧)。 */
  frameSourceUrl: string
  /** 视频镜需先抽帧;图片镜直接用 frameSourceUrl。 */
  isVideo: boolean
}

export type ShotVerifyDeps = {
  /** 视频取帧 → 首帧 image url(nomi-local)。仅视频镜调。 */
  extractFrame: (videoUrl: string) => Promise<string>
  /** 把首帧图 + 校验 prompt 喂多模态模型,返回原始判决文本(JSON 或带围栏)。 */
  judge: (prompt: string, frameImageUrl: string) => Promise<string>
  /** 多模态/视觉模型是否可用;false → 所有镜头记 unverified(vision_unavailable)。 */
  visionAvailable: () => boolean | Promise<boolean>
}

export type ShotVerifyUnverifiedEntry = {
  shotNodeId: string
  shotTitle: string
  reason: QaShotUnverifiedReason
}

export type ShotVerifyShotOutcome =
  | { shotNodeId: string; shotTitle: string; status: 'passed' }
  | { shotNodeId: string; shotTitle: string; status: 'flagged'; deviations: ReconcileDeviation[] }
  | { shotNodeId: string; shotTitle: string; status: 'unverified'; reason: QaShotUnverifiedReason }

export type ShotVerifyReport = {
  deviations: ReconcileDeviation[]
  shotOutcomes: ShotVerifyShotOutcome[]
  unverified: ShotVerifyUnverifiedEntry[]
}

function toContext(shot: ShotVerifyInput): ShotVerifyContext {
  return {
    shotNodeId: shot.shotNodeId,
    shotTitle: shot.shotTitle,
    shotPrompt: shot.shotPrompt,
    anchorDescriptions: shot.anchorDescriptions,
    ...(shot.previousShotPrompt ? { previousShotPrompt: shot.previousShotPrompt } : {}),
    // 判官的 reason 直接显示在对账卡上 → 让它按当前界面语言写(纯核保持无全局态,locale 由这层注入)。
    reasonLanguage: getAppLocale(),
  }
}

/**
 * 逐镜校验已生成产物 → 三态报告（deviations + shotOutcomes + unverified）。
 * 顺序串行(逐镜调模型;镜数通常 ≤ 十几,且后镜的连贯轴依赖前镜上下文——并行无收益且更费)。
 */
export async function verifyGeneratedShots(
  shots: readonly ShotVerifyInput[],
  deps: ShotVerifyDeps,
): Promise<ShotVerifyReport> {
  let visionReady: boolean
  try {
    visionReady = Boolean(await deps.visionAvailable())
  } catch {
    visionReady = false
  }
  if (!visionReady) {
    const unverified: ShotVerifyUnverifiedEntry[] = shots.map((shot) => ({
      shotNodeId: shot.shotNodeId,
      shotTitle: shot.shotTitle,
      reason: 'vision_unavailable',
    }))
    return {
      deviations: [],
      unverified,
      shotOutcomes: unverified.map((entry) => ({
        shotNodeId: entry.shotNodeId,
        shotTitle: entry.shotTitle,
        status: 'unverified',
        reason: entry.reason,
      })),
    }
  }

  const deviations: ReconcileDeviation[] = []
  const shotOutcomes: ShotVerifyShotOutcome[] = []
  const unverified: ShotVerifyUnverifiedEntry[] = []
  const recordUnverified = (shot: ShotVerifyInput, reason: QaShotUnverifiedReason): void => {
    unverified.push({ shotNodeId: shot.shotNodeId, shotTitle: shot.shotTitle, reason })
    shotOutcomes.push({ shotNodeId: shot.shotNodeId, shotTitle: shot.shotTitle, status: 'unverified', reason })
  }

  for (const shot of shots) {
    if (!shot.frameSourceUrl) {
      recordUnverified(shot, 'missing_frame_source')
      continue
    }
    let frameUrl: string
    try {
      frameUrl = shot.isVideo ? await deps.extractFrame(shot.frameSourceUrl) : shot.frameSourceUrl
    } catch {
      recordUnverified(shot, 'frame_extract_failed')
      continue
    }
    if (!frameUrl) {
      recordUnverified(shot, 'missing_frame_source')
      continue
    }
    const ctx = toContext(shot)
    let raw: string
    try {
      raw = await deps.judge(buildShotVerifyPrompt(ctx), frameUrl)
    } catch {
      recordUnverified(shot, 'judge_failed')
      continue
    }
    let verdict: ReturnType<typeof parseShotVerifyVerdict>
    try {
      verdict = parseShotVerifyVerdict(raw)
    } catch {
      recordUnverified(shot, 'invalid_verdict_json')
      continue
    }
    const shotDeviations = contentDeviationsToReconcile(deviationsFromVerdict(ctx, verdict))
    if (shotDeviations.length > 0) {
      deviations.push(...shotDeviations)
      shotOutcomes.push({
        shotNodeId: shot.shotNodeId,
        shotTitle: shot.shotTitle,
        status: 'flagged',
        deviations: shotDeviations,
      })
    } else {
      shotOutcomes.push({
        shotNodeId: shot.shotNodeId,
        shotTitle: shot.shotTitle,
        status: 'passed',
      })
    }
  }
  return { deviations, shotOutcomes, unverified }
}

/** 唯一共享的未校验原因展示翻译：静态键字面量供 check-i18n-key-refs 校验，TS 穷举检查全部原因码。 */
export function formatQaUnverifiedReason(
  reason: QaShotUnverifiedReason,
  t: (key: string) => string,
): string {
  switch (reason) {
    case 'vision_unavailable':
      return t('generationCommon.reconcile.unverifiedReasons.vision_unavailable')
    case 'missing_frame_source':
      return t('generationCommon.reconcile.unverifiedReasons.missing_frame_source')
    case 'frame_extract_failed':
      return t('generationCommon.reconcile.unverifiedReasons.frame_extract_failed')
    case 'judge_failed':
      return t('generationCommon.reconcile.unverifiedReasons.judge_failed')
    case 'invalid_verdict_json':
      return t('generationCommon.reconcile.unverifiedReasons.invalid_verdict_json')
  }
}
