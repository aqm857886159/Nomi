import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { CAMERA_MOVE_ATTACHED_URL_KEY, computeAttachCameraMove } from './attachCameraMoveToTarget'

// seedance-2-apimart 有 omni 模式（含 video_ref → referenceVideoUrls，无首 / 尾帧槽）；imagen-4 = 纯文生（无 video_ref 槽 → prompt 地板降级）
function videoNode(overrides: Partial<GenerationCanvasNode> & { meta?: Record<string, unknown> } = {}): GenerationCanvasNode {
  const { meta, ...rest } = overrides
  return { id: 'v', kind: 'video', title: 'v', prompt: '', x: 0, y: 0, width: 100, height: 100, meta: { archetype: { id: 'seedance-2-apimart', modeId: 't2v' }, ...(meta ?? {}) }, ...rest } as GenerationCanvasNode
}

function refUrls(outcome: ReturnType<typeof computeAttachCameraMove>): string[] {
  if (outcome.kind !== 'patch') throw new Error('expected patch')
  const value = outcome.patch.meta.referenceVideoUrls
  return Array.isArray(value) ? (value as string[]) : []
}

describe('computeAttachCameraMove — 运镜小片附到目标镜头（可替换）', () => {
  it('非视频节点 → noop + 诚实提示；目标不存在 → noop', () => {
    const outcome = computeAttachCameraMove(videoNode({ kind: 'image' as GenerationCanvasNode['kind'] }), 'nomi://a.mp4', 'push_in')
    expect(outcome.kind).toBe('noop')
    expect(outcome.toast?.level).toBe('warning')
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

  it('再次附着不同 mp4 → 用新片替换旧片；同槽非运镜参考视频保留', () => {
    const attached = videoNode({
      prompt: 'base\n@Video1 跟随这段参考视频的运镜（只参考镜头运动，画面内容由角色参考与文字决定）。',
      meta: { archetype: { id: 'seedance-2-apimart', modeId: 'omni' }, referenceVideoUrls: ['nomi://user-clip.mp4', 'nomi://a.mp4'], [CAMERA_MOVE_ATTACHED_URL_KEY]: 'nomi://a.mp4' },
    })
    const outcome = computeAttachCameraMove(attached, 'nomi://b.mp4', 'orbit_left')
    expect(refUrls(outcome)).toEqual(['nomi://user-clip.mp4', 'nomi://b.mp4'])
    if (outcome.kind === 'patch') expect(outcome.patch.meta[CAMERA_MOVE_ATTACHED_URL_KEY]).toBe('nomi://b.mp4')
  })

  it('同一个 mp4 再次进来 → noop（幂等）；存量只有旧布尔的节点不被锁死', () => {
    const attached = videoNode({ meta: { archetype: { id: 'seedance-2-apimart', modeId: 'omni' }, referenceVideoUrls: ['nomi://a.mp4'], [CAMERA_MOVE_ATTACHED_URL_KEY]: 'nomi://a.mp4' } })
    expect(computeAttachCameraMove(attached, 'nomi://a.mp4', 'push_in')).toEqual({ kind: 'noop' })
    const legacy = videoNode({ meta: { archetype: { id: 'seedance-2-apimart', modeId: 'omni' }, cameraMoveAttached: true, referenceVideoUrls: [] } })
    expect(refUrls(computeAttachCameraMove(legacy, 'nomi://b.mp4', 'push_in'))).toEqual(['nomi://b.mp4'])
  })

  it('切到 omni 时原有首 / 尾帧会失效 → 留痕 warning', () => {
    const outcome = computeAttachCameraMove(videoNode({ meta: { archetype: { id: 'seedance-2-apimart', modeId: 'firstlast' }, firstFrameUrl: 'nomi://first.png' } }), 'nomi://a.mp4', 'push_in')
    expect(outcome.kind).toBe('patch')
    expect(outcome.toast?.level).toBe('warning')
    expect(outcome.toast?.message).toContain('首/尾帧')
  })

  it('无 video_ref 槽的模型 → 降级只补运镜 prompt 地板 + 记指纹；再换 move 不重复地板', () => {
    const outcome = computeAttachCameraMove(videoNode({ meta: { archetype: { id: 'imagen-4', modeId: '' } } }), 'nomi://a.mp4', 'push_in')
    expect(outcome.kind).toBe('patch')
    if (outcome.kind !== 'patch') return
    expect(outcome.patch.prompt).toContain('镜头运动：')
    expect(outcome.patch.meta[CAMERA_MOVE_ATTACHED_URL_KEY]).toBe('nomi://a.mp4')
    expect(outcome.patch.meta.referenceVideoUrls).toBeUndefined()
    const again = computeAttachCameraMove(videoNode({ prompt: 'base\n镜头运动：推近（…）', meta: { archetype: { id: 'imagen-4', modeId: '' }, [CAMERA_MOVE_ATTACHED_URL_KEY]: 'nomi://a.mp4' } }), 'nomi://b.mp4', 'orbit_left')
    if (again.kind !== 'patch') throw new Error('expected patch')
    expect(again.patch.prompt?.match(/镜头运动：/g)?.length).toBe(1)
    expect(again.patch.meta[CAMERA_MOVE_ATTACHED_URL_KEY]).toBe('nomi://b.mp4')
  })
})
