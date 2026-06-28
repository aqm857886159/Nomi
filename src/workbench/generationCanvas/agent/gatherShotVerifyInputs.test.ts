import { describe, it, expect } from 'vitest'
import { gatherShotVerifyInputs } from './gatherShotVerifyInputs'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

const node = (over: Partial<GenerationCanvasNode> & { id: string }): GenerationCanvasNode =>
  ({ kind: 'video', title: '', position: { x: 0, y: 0 }, ...over }) as GenerationCanvasNode

const withResult = (id: string, kind: GenerationCanvasNode['kind'], url: string, over: Partial<GenerationCanvasNode> = {}) =>
  node({ id, kind, ...over, result: { id: `${id}-r`, type: kind === 'video' ? 'video' : 'image', url, createdAt: 1 } })

describe('gatherShotVerifyInputs', () => {
  it('视频镜 isVideo=true，取 result.url 作帧源', () => {
    const shot = withResult('shot-5', 'video', 'nomi-local://v.mp4', { title: '镜头 5', prompt: '追逐', shotIndex: 5 })
    const out = gatherShotVerifyInputs(['shot-5'], [shot], [])
    expect(out).toHaveLength(1)
    expect(out[0].isVideo).toBe(true)
    expect(out[0].frameSourceUrl).toBe('nomi-local://v.mp4')
    expect(out[0].shotTitle).toBe('镜头 5')
  })

  it('图片镜 isVideo=false', () => {
    const shot = withResult('img-1', 'image', 'nomi-local://i.png')
    expect(gatherShotVerifyInputs(['img-1'], [shot], [])[0].isVideo).toBe(false)
  })

  it('无产物的镜被跳过(失败镜不算偏差)', () => {
    const shot = node({ id: 'shot-x', kind: 'video', title: '没生成' })
    expect(gatherShotVerifyInputs(['shot-x'], [shot], [])).toEqual([])
  })

  it('入边的锚节点 → 身份对照描述(排除视频源)', () => {
    const shot = withResult('shot-1', 'video', 'nomi-local://v.mp4')
    const anchor = node({ id: 'char-1', kind: 'character', title: '林小满', prompt: '黑长直、圆脸、白衬衫' })
    const otherVideo = withResult('shot-0', 'video', 'nomi-local://v0.mp4') // 视频源不当锚
    const edges: GenerationCanvasEdge[] = [
      { id: 'e1', source: 'char-1', target: 'shot-1', mode: 'character_ref' },
      { id: 'e2', source: 'shot-0', target: 'shot-1', mode: 'reference' },
    ] as GenerationCanvasEdge[]
    const out = gatherShotVerifyInputs(['shot-1'], [shot, anchor, otherVideo], edges)
    expect(out[0].anchorDescriptions).toHaveLength(1)
    expect(out[0].anchorDescriptions[0]).toContain('林小满')
    expect(out[0].anchorDescriptions[0]).toContain('黑长直')
  })

  it('前一镜(shotIndex-1)提示词作连贯对照；首镜无 previousShotPrompt', () => {
    const prev = withResult('shot-1', 'video', 'nomi-local://1.mp4', { prompt: '空镜：门口白天', shotIndex: 1 })
    const cur = withResult('shot-2', 'video', 'nomi-local://2.mp4', { prompt: '主角进门', shotIndex: 2 })
    const out = gatherShotVerifyInputs(['shot-1', 'shot-2'], [prev, cur], [])
    const first = out.find((s) => s.shotNodeId === 'shot-1')!
    const second = out.find((s) => s.shotNodeId === 'shot-2')!
    expect(first.previousShotPrompt).toBeUndefined()
    expect(second.previousShotPrompt).toContain('空镜')
  })

  it('未知 id 跳过', () => {
    expect(gatherShotVerifyInputs(['nope'], [], [])).toEqual([])
  })
})
