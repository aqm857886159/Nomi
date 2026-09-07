import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  VIDEO_DEPTH_DERIVED_GAP,
  videoDepthDerivedPosition,
  videoDepthDerivedTitle,
  videoDepthSourceFromNode,
} from './videoDepthDerivation'

function node(partial: Partial<GenerationCanvasNode>): GenerationCanvasNode {
  return { id: 'n1', kind: 'video', position: { x: 0, y: 0 }, status: 'idle', ...partial } as GenerationCanvasNode
}

function videoNode(partial: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return node({ result: { id: 'r', type: 'video', url: 'nomi-local://asset/a.mp4', createdAt: 1 }, ...partial })
}

describe('videoDepthSourceFromNode', () => {
  it('accepts any node whose result is a video, not a fixed list of kinds', () => {
    // 一个「素材」节点、一个生成视频节点、一个上一次深度处理的产物，对这条管线是同一件东西。
    expect(videoDepthSourceFromNode(videoNode({ kind: 'asset' }))?.sourceUrl).toBe('nomi-local://asset/a.mp4')
    expect(videoDepthSourceFromNode(videoNode())?.sourceUrl).toBe('nomi-local://asset/a.mp4')
  })

  it('refuses a node with no video result, so the action can be disabled honestly', () => {
    expect(videoDepthSourceFromNode(node({}))).toBeNull()
    expect(
      videoDepthSourceFromNode(node({ result: { id: 'r', type: 'image', url: 'a.png', createdAt: 1 } })),
    ).toBeNull()
  })

  it('falls back through title then prompt then result id rather than producing an empty name', () => {
    expect(videoDepthSourceFromNode(videoNode({ title: '  打斗镜头 ' }))?.title).toBe('打斗镜头')
    expect(videoDepthSourceFromNode(videoNode({ title: '   ', prompt: '一段舞蹈' }))?.title).toBe('一段舞蹈')
    expect(videoDepthSourceFromNode(videoNode())?.title).toBe('r')
  })

  it('carries the duration through only when the source actually has one', () => {
    const measured = videoNode({ result: { id: 'r', type: 'video', url: 'u', createdAt: 1, durationSeconds: 4 } })
    expect(videoDepthSourceFromNode(measured)?.durationSeconds).toBe(4)
    expect(videoDepthSourceFromNode(videoNode())).not.toHaveProperty('durationSeconds')
  })
})

describe('videoDepthDerivedPosition', () => {
  it('puts the product one body-width to the right, on the same line as its source', () => {
    // 与「抽首/尾帧」同一条落位规则。两个动作把产物放在不同距离，用户看到的是随机不是规则。
    expect(videoDepthDerivedPosition({ x: 100, y: 40 }, { width: 340, height: 200 })).toEqual({
      x: 100 + 340 + VIDEO_DEPTH_DERIVED_GAP,
      y: 40,
    })
  })
})

describe('videoDepthDerivedTitle', () => {
  it('leads with the source so a column of titles is still readable', () => {
    expect(videoDepthDerivedTitle('镜头 1', '深度')).toBe('镜头 1 · 深度')
  })

  it('degrades to just the output name when the source has none, never to a dangling separator', () => {
    expect(videoDepthDerivedTitle('   ', '深度')).toBe('深度')
  })
})
