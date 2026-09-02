import { describe, expect, it } from 'vitest'
import {
  GENERATION_NODE_KINDS,
  getGenerationNodeExecutionKind,
  isAudioLikeGenerationNodeKind,
  isImageLikeGenerationNodeKind,
  isModel3dLikeGenerationNodeKind,
  isVideoLikeGenerationNodeKind,
} from './generationNodeKinds'

// The composer's `isGenerationNode` gate is the union of these predicates. A kind
// that no predicate claims renders no parameter bar → no model selector at all.
// This locks in that every executable kind (incl. model3d) is claimed by exactly
// one predicate, so the 3D node keeps its selector.
describe('generation node kind classification', () => {
  it('classifies the 3D model kind as a 3D-like generation node', () => {
    expect(getGenerationNodeExecutionKind('model3d')).toBe('model3d')
    expect(isModel3dLikeGenerationNodeKind('model3d')).toBe(true)
  })

  it('does not misclassify the 3D model kind as image/video/audio', () => {
    expect(isImageLikeGenerationNodeKind('model3d')).toBe(false)
    expect(isVideoLikeGenerationNodeKind('model3d')).toBe(false)
    expect(isAudioLikeGenerationNodeKind('model3d')).toBe(false)
  })

  it('keeps the 3D predicate scoped to 3D (image/video are not 3D-like)', () => {
    expect(isModel3dLikeGenerationNodeKind('image')).toBe(false)
    expect(isModel3dLikeGenerationNodeKind('video')).toBe(false)
    expect(isModel3dLikeGenerationNodeKind('text')).toBe(false)
  })
})

// 穷举矩阵（2026-09-02，#320 缺口② = #286 的第二次同族发作）：kind 分类边界的消费方
// （NodeParameterControls 的 isGenerationNode、composer 的参考区、canRunGenerationNode…）都是
// 这几个谓词/executionKind 的并集。registry 每加一个新 executionKind，如果谓词族没同步认领，
// 下游整片 UI/派发就静默漏掉它——本矩阵让漏认领当场红，不必等用户撞到。
describe('exhaustive kind × capability matrix (registry-driven)', () => {
  it('registry declares exactly the five capability planes', () => {
    const execKinds = new Set(GENERATION_NODE_KINDS.map((k) => getGenerationNodeExecutionKind(k)).filter(Boolean))
    expect([...execKinds].sort()).toEqual(['audio', 'image', 'model3d', 'text', 'video'])
  })
  for (const kind of GENERATION_NODE_KINDS) {
    const exec = getGenerationNodeExecutionKind(kind)
    it(`${kind}: executionKind=${exec ?? 'none'} is claimed consistently by the like-predicates`, () => {
      // 专属谓词与 executionKind 一一对应（image-like 因 providesImageReference 故意更宽，单独断言方向）。
      expect(isVideoLikeGenerationNodeKind(kind)).toBe(exec === 'video')
      expect(isAudioLikeGenerationNodeKind(kind)).toBe(exec === 'audio')
      expect(isModel3dLikeGenerationNodeKind(kind)).toBe(exec === 'model3d')
      if (exec === 'image') expect(isImageLikeGenerationNodeKind(kind)).toBe(true)
      // 每个可执行 kind 必须被谓词族认领（text 由 isTextKind/executionKind 直判，不设 like 谓词）：
      if (exec && exec !== 'text') {
        expect(
          isImageLikeGenerationNodeKind(kind) ||
            isVideoLikeGenerationNodeKind(kind) ||
            isAudioLikeGenerationNodeKind(kind) ||
            isModel3dLikeGenerationNodeKind(kind),
        ).toBe(true)
      }
    })
  }
})
