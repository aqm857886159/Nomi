// 「N 层」住在节点上方的标签行（裁定 C-D12）：它和「已备好 · 未生成」是同一处状态的前后两态，
// 不能同时出现；它自己不定位、不读缩放（缩放 < 40% 随标签行一起隐藏），所以不会再被钉在节点正下方的生成框盖住。
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { DerivedReadyBadge } from '../quickActions/DerivedReadyBadge'
import { QUICK_ACTION_META_KEY } from '../quickActions/deriveFromNode'
import { NodeLayerSplitStatus } from './NodeLayerSplitStatus'
import { LAYER_SPLIT_RAW_KEY } from './whiteboard/whiteboardState'

type BadgeNode = Pick<GenerationCanvasNode, 'meta' | 'status' | 'runs' | 'result'>

const derivedMeta = { [QUICK_ACTION_META_KEY]: { id: 'layer-split', sourceNodeId: 'src-1', promptReady: true } } as GenerationCanvasNode['meta']
const splitResult = (layers: number) => ({ type: 'image', url: 'nomi-asset://x.png', raw: { [LAYER_SPLIT_RAW_KEY]: { layers } } }) as unknown as GenerationCanvasNode['result']

const states: Array<[string, BadgeNode]> = [
  ['派生好、还没生成', { meta: derivedMeta, status: 'idle', runs: [], result: undefined }],
  ['派生节点拆完（结果带图层标记）', { meta: derivedMeta, status: 'idle', runs: [], result: splitResult(3) }],
  ['派生节点拆完、还留着运行记录', { meta: derivedMeta, status: 'success', runs: [{ id: 'r1' }] as unknown as GenerationCanvasNode['runs'], result: splitResult(20) }],
  ['普通图片结果（没有图层标记）', { meta: derivedMeta, status: 'idle', runs: [], result: { type: 'image', url: 'nomi-asset://y.png' } as GenerationCanvasNode['result'] }],
]

const render = (node: BadgeNode) => ({
  ready: renderToStaticMarkup(<DerivedReadyBadge node={node} />).includes('data-derived-ready-badge'),
  layers: renderToStaticMarkup(<NodeLayerSplitStatus node={node} />).includes('data-node-layer-split-status'),
})

describe('NodeLayerSplitStatus：标签行里的「N 层」', () => {
  it.each(states)('%s：「已备好 · 未生成」和「N 层」最多出现一枚', (_label, node) => {
    const { ready, layers } = render(node)
    expect(ready && layers).toBe(false)
  })

  it('前后两态各自出现在该出现的时候', () => {
    expect(render(states[0][1])).toEqual({ ready: true, layers: false })
    expect(render(states[1][1])).toEqual({ ready: false, layers: true })
  })

  it('角标自己不定位：没有 absolute / top 偏移，不读缩放（隐藏交给标签行）', () => {
    const markup = renderToStaticMarkup(<NodeLayerSplitStatus node={{ result: splitResult(100) }} />)
    expect(markup).toContain('data-node-layer-split-status="100"')
    expect(markup).not.toMatch(/\babsolute\b|top-\[|visibility/)
    expect(markup).toMatch(/\bshrink-0\b/)
  })
})
