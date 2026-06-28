// 镜级 verify 实时编排(impure,但靠 DI 可裸测)—— 把纯原语 shotVerify 接到真实生成产物。
// 方案:docs/plan/2026-06-28-storyboard-closed-loop-verify.md（Stage 1 实时编排）。
//
// 副作用全收在注入的 deps 里(取帧 IPC + 调多模态模型 + 视觉可用性),本函数只编排:
//   逐镜 → 取首帧图(图片镜=result.url;视频镜=extractFrame 抽首帧)→ 喂模型判 → 映射偏差。
// 容错铁律:verify 是**增益**,不该阻断「生成已完成」——任一镜取帧/判决失败 → 跳过该镜(不误报、不抛)。
// 视觉模型不可用 → 整体跳过(降级仅结构对账,plan §4 Stage 1「没连视觉→仅结构校验」)。

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
  }
}

/**
 * 逐镜校验已生成产物 → 内容偏差(ReconcileDeviation[],kind:'content',喂对账卡)。
 * 顺序串行(逐镜调模型;镜数通常 ≤ 十几,且后镜的连贯轴依赖前镜上下文——并行无收益且更费)。
 */
export async function verifyGeneratedShots(
  shots: readonly ShotVerifyInput[],
  deps: ShotVerifyDeps,
): Promise<ReconcileDeviation[]> {
  if (!deps.visionAvailable()) return []
  const out: ReconcileDeviation[] = []
  for (const shot of shots) {
    let frameUrl: string
    try {
      frameUrl = shot.isVideo ? await deps.extractFrame(shot.frameSourceUrl) : shot.frameSourceUrl
    } catch {
      continue // 取帧失败 → 跳过该镜(不阻断生成完成、不误报)
    }
    if (!frameUrl) continue
    const ctx = toContext(shot)
    let verdict: ReturnType<typeof parseShotVerifyVerdict>
    try {
      const raw = await deps.judge(buildShotVerifyPrompt(ctx), frameUrl)
      verdict = parseShotVerifyVerdict(raw)
    } catch {
      continue // 判决/解析失败 → 跳过该镜(校验是增益,不该把生成完成拖红)
    }
    out.push(...contentDeviationsToReconcile(deviationsFromVerdict(ctx, verdict)))
  }
  return out
}
