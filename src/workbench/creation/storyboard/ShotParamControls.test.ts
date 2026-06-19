import { describe, expect, it } from 'vitest'
import { splitShotParams } from './ShotParamControls'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'

const sel = (key: string, label: string): ModelParameterControl => ({ key, label, type: 'select', options: [{ value: 'a', label: 'a' }] })
const num = (key: string, label: string): ModelParameterControl => ({ key, label, type: 'number', options: [] })
const text = (key: string, label: string): ModelParameterControl => ({ key, label, type: 'text', options: [] })
const bool = (key: string, label: string): ModelParameterControl => ({ key, label, type: 'boolean', options: [] })

describe('splitShotParams（常用 inline / 其余抽屉）', () => {
  it('视频：清晰度+比例进 inline，时长被排除，其余进抽屉', () => {
    const params = [sel('resolution', '清晰度'), sel('aspect_ratio', '比例'), num('duration', '时长'), bool('generate_audio', '生成音频')]
    const { inline, drawer } = splitShotParams(params)
    expect(inline.map((p) => p.key)).toEqual(['resolution', 'aspect_ratio'])
    expect(drawer.map((p) => p.key)).toEqual(['generate_audio']) // duration 被排除、不进任何一档
  })

  it('图片：尺寸进 inline，负向提示进抽屉', () => {
    const params = [sel('size', '尺寸'), text('negative_prompt', '负向提示')]
    const { inline, drawer } = splitShotParams(params)
    expect(inline.map((p) => p.key)).toEqual(['size'])
    expect(drawer.map((p) => p.key)).toEqual(['negative_prompt'])
  })

  it('inline 最多 2 个 select，多的落抽屉', () => {
    const params = [sel('a', 'A'), sel('b', 'B'), sel('c', 'C')]
    const { inline, drawer } = splitShotParams(params)
    expect(inline.map((p) => p.key)).toEqual(['a', 'b'])
    expect(drawer.map((p) => p.key)).toEqual(['c'])
  })

  it('duration 永不进 inline 也不进 drawer（卡有独立时长选择器）', () => {
    const params = [num('duration', '时长')]
    const { inline, drawer } = splitShotParams(params)
    expect(inline).toHaveLength(0)
    expect(drawer).toHaveLength(0)
  })
})
