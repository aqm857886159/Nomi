// 镜级 verify 实时编排(impure,但靠 DI 可裸测)—— 把纯原语 shotVerify 接到真实生成产物。
// 方案:docs/plan/2026-06-28-storyboard-closed-loop-verify.md（Stage 1 实时编排）。
//
// 副作用全收在注入的 deps 里(取帧 IPC + 调多模态模型 + 视觉可用性),本函数只编排:
//   逐镜 → 取首帧图(图片镜=result.url;视频镜=extractFrame 抽首帧)→ 喂模型判 → 映射偏差。
// 容错铁律:verify 是**增益**,不该阻断「生成已完成」——任一镜取帧/判决失败 → 跳过该镜(不误报、不抛)。
// 视觉模型不可用 → 整体跳过(降级仅结构对账,plan §4 Stage 1「没连视觉→仅结构校验」)。

import { getAppLocale } from '../../../i18n'
import type { ReconcileDeviation } from './reconcile'
import { unreviewedShot, type ShotReviewAssessment } from '../../../../electron/shared/shotReviewEvidence'
import {
  activeDimensions,
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
  /** 多模态/视觉模型是否可用;false → 整体跳过(降级仅结构校验)。 */
  visionAvailable: () => boolean
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

/** Coverage and deviations belong to the same request, never inferred from an empty list. */
export type ShotVerifyReport = { deviations: ReconcileDeviation[]; assessments: ShotReviewAssessment[] }

export async function verifyGeneratedShots(shots: readonly ShotVerifyInput[], deps: ShotVerifyDeps): Promise<ShotVerifyReport> {
  const report: ShotVerifyReport = { deviations: [], assessments: [] }
  for (const shot of shots) {
    if (!deps.visionAvailable()) {
      report.assessments.push(unreviewedShot(shot.shotNodeId, 'vision-unavailable'))
      continue
    }
    let frameUrl: string
    try {
      frameUrl = shot.isVideo ? await deps.extractFrame(shot.frameSourceUrl) : shot.frameSourceUrl
    } catch {
      report.assessments.push(unreviewedShot(shot.shotNodeId, 'frame-extraction-failed'))
      continue
    }
    if (!frameUrl) {
      report.assessments.push(unreviewedShot(shot.shotNodeId, 'frame-unavailable'))
      continue
    }
    const ctx = toContext(shot)
    let verdict: ReturnType<typeof parseShotVerifyVerdict>
    try {
      verdict = parseShotVerifyVerdict(await deps.judge(buildShotVerifyPrompt(ctx), frameUrl))
    } catch {
      report.assessments.push(unreviewedShot(shot.shotNodeId, 'judge-or-parse-failed'))
      continue
    }
    const active = activeDimensions(ctx).map(d => d.key)
    const dimensions = verdict.assessedDimensions.filter(key => active.includes(key))
    if (dimensions.length === 0) {
      report.assessments.push(unreviewedShot(shot.shotNodeId, 'no-assessable-dimensions'))
      continue
    }
    report.assessments.push({ shotNodeId: shot.shotNodeId, assessed: true, dimensions,
      unassessedDimensions: active.filter(key => !dimensions.includes(key)), scope: 'single-frame' })
    const deviations = deviationsFromVerdict(ctx, verdict).filter(item => dimensions.includes(item.dimension))
    report.deviations.push(...contentDeviationsToReconcile(deviations))
  }
  return report
}
