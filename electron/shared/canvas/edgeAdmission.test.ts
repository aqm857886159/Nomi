import { describe, expect, it } from 'vitest'
import { admitNewEdges, NODE_KIND_CONNECTS, validateReferenceEdge } from './edgeAdmission'

const end = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, ...extra })

describe('validateReferenceEdge（主进程与渲染层同一份规则）', () => {
  it.each([
    ['video', 'text', 'target_takes_no_input'],
    ['audio', 'text', 'target_takes_no_input'],
    ['image', 'text', 'target_takes_no_input'],
    ['clip', 'image', 'source_not_referenceable'],
    ['clip', 'video', 'source_not_referenceable'],
    ['text', 'clip', 'source_not_referenceable'],
    ['audio', 'clip', 'unsupported_reference'],
    ['video', 'asset', 'target_takes_no_input'],
  ])('%s -> %s 拒：%s', (source, target, reason) => {
    expect(validateReferenceEdge(end(source), end(target), 'reference')).toEqual({ ok: false, reason })
  })

  it.each([
    ['image', 'video'],
    ['image', 'image'],
    ['text', 'image'], // 文本 -> 吃提示词的生成节点：提示词上下文
    ['text', 'video'],
    ['video', 'clip'],
    ['image', 'clip'],
    ['asset', 'video'],
  ])('%s -> %s 过', (source, target) => {
    expect(validateReferenceEdge(end(source), end(target), 'reference')).toEqual({ ok: true })
  })

  it('不认识的种类一律拒（不当成「什么都收」）', () => {
    expect(validateReferenceEdge(end('image'), end('martian'), 'reference').ok).toBe(false)
    expect(validateReferenceEdge(end('martian'), end('image'), 'reference').ok).toBe(false)
  })

  it('素材卡按产物类型：视频素材 -> 剪辑过，视频素材 -> 文本拒', () => {
    const videoAsset = end('asset', { result: { type: 'video' } })
    expect(validateReferenceEdge(videoAsset, end('clip'), 'reference').ok).toBe(true)
    expect(validateReferenceEdge(videoAsset, end('text'), 'reference').ok).toBe(false)
  })

  it('每个种类都在 connects 表里（新种类不登记 = 这里红）', () => {
    expect(Object.keys(NODE_KIND_CONNECTS).sort()).toEqual([
      'agent-artifact', 'asset', 'audio', 'character', 'clip', 'director', 'image', 'keyframe', 'model3d',
      'output', 'panorama', 'scene', 'shot', 'shot_table', 'text', 'video', 'whiteboard',
    ])
  })
})

describe('admitNewEdges', () => {
  const nodes = [{ id: 'v', kind: 'video' }, { id: 't', kind: 'text' }, { id: 'i', kind: 'image' }, { id: 'w', kind: 'video' }]
  const e = (id: string, source: string, target: string) => ({ id, source, target, mode: 'reference' })

  it('新边过闸、被拒的带原因；旧边（known）原样保留，不删用户数据', () => {
    const next = [e('old', 'v', 't'), e('bad', 'v', 't'), e('ok', 'i', 'w'), e('ghost', 'i', 'nope')]
    const out = admitNewEdges({ nodes, known: new Set(['old']), next })
    expect(out.edges.map((edge) => edge.id)).toEqual(['old', 'ok'])
    expect(out.rejected.map((item) => [item.edge.id, item.reason])).toEqual([['bad', 'target_takes_no_input'], ['ghost', 'dangling']])
  })

  it('没有被拒的边时返回同一个数组引用', () => {
    const next = [e('ok', 'i', 'w')]
    expect(admitNewEdges({ nodes, known: new Set(), next }).edges).toBe(next)
  })
})
