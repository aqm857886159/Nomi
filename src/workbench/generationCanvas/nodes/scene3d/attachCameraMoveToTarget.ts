// 运镜小片 mp4 → 目标镜头视频节点的「附上参考」纯核心（P1/P2 单一真相源）。
//
// 从 CameraMoveCaptureHost 抽出的**纯数据变换**：吃目标节点的 meta/prompt/kind + 新 mp4，
// 算出「要 patch 什么」+「给用户什么提示」，不碰 store（Host 的薄壳负责读写）。抽纯的动机 =
// 这层是根因所在，之前零单测：`cameraMoveAttached` 布尔一次性锁死，用户「换个运镜再应用一次」
// 时 Host 早退，新 mp4 永不替换旧的，却仍报「已接入」（R13 走查抓出的误导性成功）。
//
// 根治：把一次性布尔换成「当前已附的运镜 mp4 指纹」`cameraMoveAttachedUrl`：
//   - 同一个 mp4 再次进来（Host 重复处理同一节点）→ 无操作，保留原幂等意图；
//   - 不同 mp4（用户换了运镜再应用）→ **把 referenceVideoUrls 里那条旧运镜片换成新的**，
//     并更新指纹。参考因此可替换，而非一次性锁死。AI 路与手动路共用此核（不开并行产路）。
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { archetypeForNode, findVideoRefMode } from '../../agent/referenceEdgeCapability'
import { applyArchetypeModeSwitch, readArchetypeArray } from '../controls/archetypeMeta'
import { CAMERA_MOVE_LABEL, CAMERA_MOVE_DESC, type CameraMove } from './cameraMoveVocab'
import { isVideoLikeGenerationNodeKind } from '../../model/generationNodeKinds'

/** 目标节点里记「当前已附的运镜 mp4」的 meta 键（替换判据；替代旧的一次性布尔 cameraMoveAttached）。 */
export const CAMERA_MOVE_ATTACHED_URL_KEY = 'cameraMoveAttachedUrl'

export type AttachCameraMoveOutcome =
  /** 无操作：目标不存在 / 同一 mp4 已附（幂等）。toast 可选（非视频节点等需告知的跳过）。 */
  | { kind: 'noop'; toast?: { message: string; level: 'warning' } }
  /** 要 patch：把 patch.meta（+ 可选 prompt）写回目标节点；toast 可选。 */
  | {
      kind: 'patch'
      patch: { meta: Record<string, unknown>; prompt?: string }
      toast?: { message: string; level: 'warning' }
    }

/** 运镜 prompt 地板（通用，全供应商可用）：人话点出该镜的运镜，作为不吃视频参考时的降级。 */
function cameraMoveDirective(move: CameraMove | undefined): string {
  if (!move) return ''
  return `\n镜头运动：${CAMERA_MOVE_LABEL[move]}（${CAMERA_MOVE_DESC[move]}）`
}

/** 读目标 meta 里「当前已附的运镜 mp4」（无 / 非串 → ''）。 */
function readAttachedUrl(meta: Record<string, unknown>): string {
  const value = meta[CAMERA_MOVE_ATTACHED_URL_KEY]
  return typeof value === 'string' ? value : ''
}

/**
 * 计算把运镜小片 mp4 附到目标镜头视频节点该做什么（纯函数，不碰 store）。
 * - 目标非视频节点 → noop + warning（运镜 prompt 喂图片模型无意义，诚实跳过）。
 * - 目标已附**同一** mp4 → noop（幂等：Host 可能就同一节点重入）。
 * - 目标有 video_ref 槽：切到该模式，**用新 mp4 替换 referenceVideoUrls 里的旧运镜片**（有旧则换、无旧则加），
 *   追加 @Video1 运镜指令（已含则不重复），并记指纹 cameraMoveAttachedUrl=新 mp4。
 * - 无 video_ref 槽 → 降级：只补结构化运镜 prompt 地板（已含「镜头运动：」则不重复），同样记指纹。
 */
export function computeAttachCameraMove(
  target: GenerationCanvasNode | undefined,
  mp4Url: string,
  move: CameraMove | undefined,
): AttachCameraMoveOutcome {
  if (!target) return { kind: 'noop' }
  // P2-A 校验目标节点种类：运镜参考只能喂视频生成节点。指到图片节点没有 video_ref 槽，
  // 旧逻辑会静默把无用的运镜 prompt 追加到图片上（图片模型不懂「镜头运动」）。诚实跳过并提示。
  if (!isVideoLikeGenerationNodeKind(target.kind)) {
    return { kind: 'noop', toast: { message: '运镜参考只能喂给视频镜头节点，已跳过（目标不是视频节点）', level: 'warning' } }
  }
  const meta = { ...(target.meta || {}) } as Record<string, unknown>
  const trimmedNew = mp4Url.trim()
  // 幂等 + 可替换：只有「同一 mp4 已附」才早退；不同 mp4 = 用户换了运镜再应用 → 往下走替换（根治）。
  if (trimmedNew && readAttachedUrl(meta) === trimmedNew) return { kind: 'noop' }
  const prevAttached = readAttachedUrl(meta)

  const archetype = archetypeForNode(target)
  const videoRef = findVideoRefMode(archetype)
  if (archetype && videoRef) {
    // P2-B 切模式前先看旧模式是否设了首/尾帧、而目标(video_ref)模式没有该槽 → 会在投影时被静默丢弃。
    const hadFirstOrLast =
      (typeof meta.firstFrameUrl === 'string' && meta.firstFrameUrl.trim().length > 0) ||
      (typeof meta.lastFrameUrl === 'string' && meta.lastFrameUrl.trim().length > 0)
    let nextMeta = applyArchetypeModeSwitch(meta, archetype, videoRef.modeId)
    const existing = readArchetypeArray(nextMeta, videoRef.metaKey)
    // 替换语义：把上次那条运镜片剔掉（若在），再确保新片在（去重）。旧片不在数组里（用户手删过 / 换过模式）
    // 也无碍——filter 空转，仍把新片加进去。非运镜的其它参考视频原样保留。
    const withoutPrev = prevAttached ? existing.filter((url) => url !== prevAttached) : existing
    const referenceVideoUrls = withoutPrev.includes(trimmedNew) ? withoutPrev : [...withoutPrev, trimmedNew]
    nextMeta = { ...nextMeta, [videoRef.metaKey]: referenceVideoUrls, [CAMERA_MOVE_ATTACHED_URL_KEY]: trimmedNew }
    const targetMode = archetype.modes.find((m) => m.id === videoRef.modeId)
    const targetHasFrameSlot = targetMode?.slots.some((s) => s.kind === 'first_frame' || s.kind === 'last_frame') ?? false
    const directive = `\n@Video1 跟随这段参考视频的运镜（只参考镜头运动，画面内容由角色参考与文字决定）。`
    const basePrompt = typeof target.prompt === 'string' ? target.prompt : ''
    const prompt = basePrompt.includes('@Video1') ? basePrompt : `${basePrompt}${directive}`
    return {
      kind: 'patch',
      patch: { meta: nextMeta, prompt },
      ...(hadFirstOrLast && !targetHasFrameSlot
        ? { toast: { message: '已切换到全能参考模式以注入运镜参考视频（该模式无首/尾帧，原首帧不再生效）', level: 'warning' as const } }
        : {}),
    }
  }
  // 降级：视频节点但模型无视频参考槽 → 只补结构化运镜 prompt 地板（保留模型不变），同样记指纹。
  const directive = cameraMoveDirective(move)
  if (!directive) return { kind: 'noop' }
  const basePrompt = typeof target.prompt === 'string' ? target.prompt : ''
  const prompt = basePrompt.includes('镜头运动：') ? basePrompt : `${basePrompt}${directive}`
  return { kind: 'patch', patch: { meta: { ...meta, [CAMERA_MOVE_ATTACHED_URL_KEY]: trimmedNew }, prompt } }
}
