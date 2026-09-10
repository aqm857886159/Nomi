/**
 * [INPUT]: 依赖 ../../../model/generationCanvasTypes 的 GenerationCanvasNode、../../../agent/referenceEdgeCapability（archetypeForNode / findVideoRefMode）、
 *          ../../controls/archetypeMeta（applyArchetypeModeSwitch / readArchetypeArray）、../../../model/generationNodeKinds 的 isVideoLikeGenerationNodeKind、
 *          ./cameraMoveVocab（CAMERA_MOVE_LABEL / CAMERA_MOVE_DESC）、../../../../../i18n
 * [OUTPUT]: 对外提供 CAMERA_MOVE_ATTACHED_URL_KEY、AttachCameraMoveOutcome、computeAttachCameraMove
 * [POS]: director/agent 的「运镜小片 mp4 → 目标镜头视频节点」纯核（原 V1 attachCameraMoveToTarget，切换门入籍）：吃目标节点的 meta / prompt / kind + 新 mp4，
 *        算出要 patch 什么 + 给用户什么提示，不碰 store。可替换语义：指纹 cameraMoveAttachedUrl 记当前已附的 mp4，同一 mp4 幂等，不同 mp4 替换旧片；
 *        有 video_ref 槽切模式填参考视频 + @Video1 指令，无槽降级只补运镜 prompt 地板。AI 路与手动运镜控件共用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import i18n from '../../../../../i18n'
import { archetypeForNode, findVideoRefMode } from '../../../agent/referenceEdgeCapability'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { isVideoLikeGenerationNodeKind } from '../../../model/generationNodeKinds'
import { applyArchetypeModeSwitch, readArchetypeArray } from '../../controls/archetypeMeta'
import { CAMERA_MOVE_DESC, CAMERA_MOVE_LABEL, type CameraMove } from './cameraMoveVocab'

/** 目标节点里记「当前已附的运镜 mp4」的 meta 键（替换判据） */
export const CAMERA_MOVE_ATTACHED_URL_KEY = 'cameraMoveAttachedUrl'

export type AttachCameraMoveOutcome =
  | { kind: 'noop'; toast?: { message: string; level: 'warning' } }
  | { kind: 'patch'; patch: { meta: Record<string, unknown>; prompt?: string }; toast?: { message: string; level: 'warning' } }

/** 运镜 prompt 地板（通用，全供应商可用）：人话点出该镜的运镜，作为不吃视频参考时的降级 */
function cameraMoveDirective(move: CameraMove | undefined): string {
  if (!move) return ''
  return `\n镜头运动：${CAMERA_MOVE_LABEL[move]}（${CAMERA_MOVE_DESC[move]}）`
}

function readAttachedUrl(meta: Record<string, unknown>): string {
  const value = meta[CAMERA_MOVE_ATTACHED_URL_KEY]
  return typeof value === 'string' ? value : ''
}

export function computeAttachCameraMove(target: GenerationCanvasNode | undefined, mp4Url: string, move: CameraMove | undefined): AttachCameraMoveOutcome {
  if (!target) return { kind: 'noop' }
  // 运镜参考只能喂视频生成节点：指到图片节点没有 video_ref 槽，诚实跳过并提示
  if (!isVideoLikeGenerationNodeKind(target.kind)) {
    return { kind: 'noop', toast: { message: i18n.t('director.agent.videoTargetRequired'), level: 'warning' } }
  }
  const meta = { ...(target.meta || {}) } as Record<string, unknown>
  const trimmedNew = mp4Url.trim()
  // 幂等 + 可替换：只有「同一 mp4 已附」才早退；不同 mp4 = 用户换了运镜再应用 → 往下走替换
  if (trimmedNew && readAttachedUrl(meta) === trimmedNew) return { kind: 'noop' }
  const prevAttached = readAttachedUrl(meta)

  const archetype = archetypeForNode(target)
  const videoRef = findVideoRefMode(archetype)
  if (archetype && videoRef) {
    // 切模式前先看旧模式是否设了首 / 尾帧、而目标（video_ref）模式没有该槽 → 会在投影时被静默丢弃
    const hadFirstOrLast =
      (typeof meta.firstFrameUrl === 'string' && meta.firstFrameUrl.trim().length > 0) ||
      (typeof meta.lastFrameUrl === 'string' && meta.lastFrameUrl.trim().length > 0)
    let nextMeta = applyArchetypeModeSwitch(meta, archetype, videoRef.modeId)
    const existing = readArchetypeArray(nextMeta, videoRef.metaKey)
    // 替换语义：把上次那条运镜片剔掉（若在），再确保新片在（去重）；非运镜的其它参考视频原样保留
    const withoutPrev = prevAttached ? existing.filter((url) => url !== prevAttached) : existing
    const referenceVideoUrls = withoutPrev.includes(trimmedNew) ? withoutPrev : [...withoutPrev, trimmedNew]
    nextMeta = { ...nextMeta, [videoRef.metaKey]: referenceVideoUrls, [CAMERA_MOVE_ATTACHED_URL_KEY]: trimmedNew }
    const targetMode = archetype.modes.find((mode) => mode.id === videoRef.modeId)
    const targetHasFrameSlot = targetMode?.slots.some((slot) => slot.kind === 'first_frame' || slot.kind === 'last_frame') ?? false
    const directive = `\n@Video1 跟随这段参考视频的运镜（只参考镜头运动，画面内容由角色参考与文字决定）。`
    const basePrompt = typeof target.prompt === 'string' ? target.prompt : ''
    const prompt = basePrompt.includes('@Video1') ? basePrompt : `${basePrompt}${directive}`
    return {
      kind: 'patch',
      patch: { meta: nextMeta, prompt },
      ...(hadFirstOrLast && !targetHasFrameSlot ? { toast: { message: i18n.t('director.agent.switchedToOmni'), level: 'warning' as const } } : {}),
    }
  }
  // 降级：视频节点但模型无视频参考槽 → 只补结构化运镜 prompt 地板（保留模型不变），同样记指纹
  const directive = cameraMoveDirective(move)
  if (!directive) return { kind: 'noop' }
  const basePrompt = typeof target.prompt === 'string' ? target.prompt : ''
  const prompt = basePrompt.includes('镜头运动：') ? basePrompt : `${basePrompt}${directive}`
  return { kind: 'patch', patch: { meta: { ...meta, [CAMERA_MOVE_ATTACHED_URL_KEY]: trimmedNew }, prompt } }
}
