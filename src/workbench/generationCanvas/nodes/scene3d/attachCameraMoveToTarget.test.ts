import { describe, expect, it } from 'vitest'
import { computeAttachCameraMove, CAMERA_MOVE_ATTACHED_URL_KEY } from './attachCameraMoveToTarget'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'

// 目标节点工厂。seedance-2-apimart 有 omni 模式（含 video_ref → referenceVideoUrls，无首/尾帧槽）。
// imagen-4 = 纯文生（无任何 video_ref 槽 → 走 prompt 地板降级）。
function videoNode(
  overrides: Partial<GenerationCanvasNode> & { meta?: Record<string, unknown> } = {},
): GenerationCanvasNode {
  const { meta, ...rest } = overrides
  return {
    id: 'v',
    kind: 'video',
    title: 'v',
    prompt: '',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    meta: { archetype: { id: 'seedance-2-apimart', modeId: 't2v' }, ...(meta ?? {}) },
    ...rest,
  } as GenerationCanvasNode
}

function refUrls(outcome: ReturnType<typeof computeAttachCameraMove>): string[] {
  if (outcome.kind !== 'patch') throw new Error('expected patch')
  const v = outcome.patch.meta.referenceVideoUrls
  return Array.isArray(v) ? (v as string[]) : []
}

describe('computeAttachCameraMove — 运镜小片附到目标镜头（可替换的根治）', () => {
  it('非视频节点 → noop + 诚实提示（不静默把运镜 prompt 喂图片模型）', () => {
    const target = videoNode({ kind: 'image' as GenerationCanvasNode['kind'] })
    const outcome = computeAttachCameraMove(target, 'nomi://a.mp4', 'push_in')
    expect(outcome.kind).toBe('noop')
    expect(outcome.toast?.level).toBe('warning')
  })

  it('目标不存在 → noop（无提示）', () => {
    expect(computeAttachCameraMove(undefined, 'nomi://a.mp4', 'push_in')).toEqual({ kind: 'noop' })
  })

  it('首次附着（有 video_ref 槽）→ 切 omni + 填 referenceVideoUrls + 记指纹 + 追加 @Video1', () => {
    const outcome = computeAttachCameraMove(videoNode(), 'nomi://a.mp4', 'push_in')
    expect(outcome.kind).toBe('patch')
    if (outcome.kind !== 'patch') return
    expect((outcome.patch.meta.archetype as { modeId: string }).modeId).toBe('omni')
    expect(refUrls(outcome)).toEqual(['nomi://a.mp4'])
    expect(outcome.patch.meta[CAMERA_MOVE_ATTACHED_URL_KEY]).toBe('nomi://a.mp4')
    expect(outcome.patch.prompt).toContain('@Video1')
  })

  // 这是 R13 走查抓出的真 bug：换个运镜再应用一次，旧逻辑靠一次性布尔 cameraMoveAttached 早退，
  // 新 mp4 永不替换旧的，却仍报「已接入」。根治后：新片替换旧片，数组里只剩新片。
  it('再次附着不同 mp4（用户换运镜再应用）→ 用新片替换旧片，而非早退/追加', () => {
    // 第一段运镜已附（模拟上一次 apply 的落地状态）。
    const attached = videoNode({
      prompt: 'base\n@Video1 跟随这段参考视频的运镜（只参考镜头运动，画面内容由角色参考与文字决定）。',
      meta: {
        archetype: { id: 'seedance-2-apimart', modeId: 'omni' },
        referenceVideoUrls: ['nomi://a.mp4'],
        [CAMERA_MOVE_ATTACHED_URL_KEY]: 'nomi://a.mp4',
      },
    })
    const outcome = computeAttachCameraMove(attached, 'nomi://b.mp4', 'orbit_left')
    expect(outcome.kind).toBe('patch')
    // 关键断言：旧片被换掉、数组里只有新片（不是 ['a','b']，也不是保留 'a' 早退）。
    expect(refUrls(outcome)).toEqual(['nomi://b.mp4'])
    if (outcome.kind === 'patch') {
      expect(outcome.patch.meta[CAMERA_MOVE_ATTACHED_URL_KEY]).toBe('nomi://b.mp4')
    }
  })

  it('替换时保留同槽里的非运镜参考视频（只换运镜那一条）', () => {
    const attached = videoNode({
      meta: {
        archetype: { id: 'seedance-2-apimart', modeId: 'omni' },
        referenceVideoUrls: ['nomi://user-clip.mp4', 'nomi://a.mp4'],
        [CAMERA_MOVE_ATTACHED_URL_KEY]: 'nomi://a.mp4',
      },
    })
    const outcome = computeAttachCameraMove(attached, 'nomi://b.mp4', 'orbit_left')
    expect(refUrls(outcome)).toEqual(['nomi://user-clip.mp4', 'nomi://b.mp4'])
  })

  it('同一个 mp4 再次进来（Host 对同一节点重入）→ noop（幂等，不重复追加）', () => {
    const attached = videoNode({
      meta: {
        archetype: { id: 'seedance-2-apimart', modeId: 'omni' },
        referenceVideoUrls: ['nomi://a.mp4'],
        [CAMERA_MOVE_ATTACHED_URL_KEY]: 'nomi://a.mp4',
      },
    })
    expect(computeAttachCameraMove(attached, 'nomi://a.mp4', 'push_in')).toEqual({ kind: 'noop' })
  })

  // 存量项目升级：只有旧的一次性布尔 cameraMoveAttached=true、无 cameraMoveAttachedUrl 指纹。
  // 新逻辑读不到指纹 → 视为「无已附」，把新片正常加进去（而非被旧布尔锁死不再工作）。
  it('存量 legacy 节点（有旧布尔、无指纹）→ 不被锁死，新片正常附上', () => {
    const legacy = videoNode({
      meta: {
        archetype: { id: 'seedance-2-apimart', modeId: 'omni' },
        cameraMoveAttached: true,
        referenceVideoUrls: [],
      },
    })
    const outcome = computeAttachCameraMove(legacy, 'nomi://b.mp4', 'push_in')
    expect(outcome.kind).toBe('patch')
    expect(refUrls(outcome)).toEqual(['nomi://b.mp4'])
  })

  it('切到 omni 时原有首/尾帧会失效 → 留痕 warning（不静默丢）', () => {
    const withFirstFrame = videoNode({
      meta: {
        archetype: { id: 'seedance-2-apimart', modeId: 'firstlast' },
        firstFrameUrl: 'nomi://first.png',
      },
    })
    const outcome = computeAttachCameraMove(withFirstFrame, 'nomi://a.mp4', 'push_in')
    expect(outcome.kind).toBe('patch')
    expect(outcome.toast?.level).toBe('warning')
    expect(outcome.toast?.message).toContain('首/尾帧')
  })

  it('无 video_ref 槽的视频模型（imagen-4）→ 降级只补运镜 prompt 地板 + 记指纹', () => {
    const noVideoRef = videoNode({ meta: { archetype: { id: 'imagen-4', modeId: '' } } })
    const outcome = computeAttachCameraMove(noVideoRef, 'nomi://a.mp4', 'push_in')
    expect(outcome.kind).toBe('patch')
    if (outcome.kind !== 'patch') return
    expect(outcome.patch.prompt).toContain('镜头运动：')
    expect(outcome.patch.meta[CAMERA_MOVE_ATTACHED_URL_KEY]).toBe('nomi://a.mp4')
    // 降级路不切模式、不写 referenceVideoUrls。
    expect(outcome.patch.meta.referenceVideoUrls).toBeUndefined()
  })

  it('降级路再次换 move → prompt 地板已含「镜头运动：」则不重复，仍更新指纹', () => {
    const attached = videoNode({
      prompt: 'base\n镜头运动：推近（镜头缓慢推向主体，压缩空间、聚焦细节）',
      meta: { archetype: { id: 'imagen-4', modeId: '' }, [CAMERA_MOVE_ATTACHED_URL_KEY]: 'nomi://a.mp4' },
    })
    const outcome = computeAttachCameraMove(attached, 'nomi://b.mp4', 'orbit_left')
    expect(outcome.kind).toBe('patch')
    if (outcome.kind !== 'patch') return
    // 不重复追加 directive（子串已在）。
    expect(outcome.patch.prompt?.match(/镜头运动：/g)?.length).toBe(1)
    expect(outcome.patch.meta[CAMERA_MOVE_ATTACHED_URL_KEY]).toBe('nomi://b.mp4')
  })
})
