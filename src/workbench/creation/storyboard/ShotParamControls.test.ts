import { describe, expect, it } from 'vitest'
import { drawerShotParams } from './ShotParamControls'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'

const sel = (key: string, label: string): ModelParameterControl => ({ key, label, type: 'select', options: [{ value: 'a', label: 'a' }] })
const num = (key: string, label: string): ModelParameterControl => ({ key, label, type: 'number', options: [] })
const text = (key: string, label: string): ModelParameterControl => ({ key, label, type: 'text', options: [] })

describe('drawerShotParams（展开态抽屉参数）', () => {
  it('排除 duration 与 aspect_ratio（行内胶囊已有一等位，避免双份真相源），其余全进抽屉', () => {
    const params = [sel('resolution', '清晰度'), sel('aspect_ratio', '比例'), num('duration', '时长'), text('negative_prompt', '负向提示')]
    expect(drawerShotParams(params).map((p) => p.key)).toEqual(['resolution', 'negative_prompt'])
  })

  it('只有被排除项 → 空抽屉', () => {
    expect(drawerShotParams([num('duration', '时长'), sel('aspect_ratio', '比例')])).toHaveLength(0)
  })
})
