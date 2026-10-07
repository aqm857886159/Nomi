import { describe, expect, it } from 'vitest'

import {
  ANCHOR_META_KEYS,
  anchorStaticFeatures,
  isAnchorFrozen,
  isVisualAnchorNode,
} from './anchorBible'

describe('anchorBible 纯判据（冻结门 + 身份轴基准的单一真相源）', () => {
  it('键名常量钉死（防漂移：GUI 写这些、headless 读这些，只能有一份）', () => {
    expect(ANCHOR_META_KEYS).toEqual({
      referenceSheet: 'referenceSheet',
      staticFeatures: 'staticFeatures',
      dynamicFeatures: 'dynamicFeatures',
      frozen: 'frozen',
    })
  })

  it('视觉锚判据：referenceSheet===true 且 kind∈character/scene/prop 才算', () => {
    expect(isVisualAnchorNode({ kind: 'character', meta: { referenceSheet: true } })).toBe(true)
    expect(isVisualAnchorNode({ kind: 'scene', meta: { referenceSheet: true } })).toBe(true)
    expect(isVisualAnchorNode({ kind: 'prop', meta: { referenceSheet: true } })).toBe(true)
    // 镜头节点（无 referenceSheet）不是锚。
    expect(isVisualAnchorNode({ kind: 'video', meta: {} })).toBe(false)
    // style 文本锚不走冻结（就算被误标 referenceSheet，kind 也不在集合里）。
    expect(isVisualAnchorNode({ kind: 'text', meta: { referenceSheet: true } })).toBe(false)
    // 缺 meta / 缺 referenceSheet → 不是锚。
    expect(isVisualAnchorNode({ kind: 'character' })).toBe(false)
    expect(isVisualAnchorNode(undefined)).toBe(false)
  })

  it('冻结判据：frozen 是带正时间戳的对象才算已冻结', () => {
    expect(isAnchorFrozen({ meta: { frozen: { at: 1_700_000_000_000, by: 'user' } } })).toBe(true)
    // 未冻结的各种形态都判 false（键缺失/畸形/0/负/非对象）。
    expect(isAnchorFrozen({ meta: {} })).toBe(false)
    expect(isAnchorFrozen({ meta: { frozen: true } })).toBe(false)
    expect(isAnchorFrozen({ meta: { frozen: { at: 0, by: 'user' } } })).toBe(false)
    expect(isAnchorFrozen({ meta: { frozen: { by: 'user' } } })).toBe(false)
    expect(isAnchorFrozen({ meta: { frozen: [] } })).toBe(false)
    expect(isAnchorFrozen(undefined)).toBe(false)
  })

  it('身份轴基准：优先 staticFeatures，退化到 prompt', () => {
    expect(anchorStaticFeatures({ prompt: '整串定妆卡文本', meta: { staticFeatures: '短发圆脸左眉痣' } })).toBe('短发圆脸左眉痣')
    // 无 staticFeatures → 退化到 prompt。
    expect(anchorStaticFeatures({ prompt: '整串定妆卡文本' })).toBe('整串定妆卡文本')
    // staticFeatures 空白 → 退化到 prompt。
    expect(anchorStaticFeatures({ prompt: 'p', meta: { staticFeatures: '   ' } })).toBe('p')
    expect(anchorStaticFeatures(undefined)).toBe('')
  })
})
