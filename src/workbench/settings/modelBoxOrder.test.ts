// 设置区行数据的直测。重点是三件**用户会当场发现错了**的事：
// 行序、chip 顺序与高亮、以及「排完图片再去排视频，图片的顺序还在不在」。
import { describe, expect, it } from 'vitest'
import { dedupeModelOptions } from '../../config/modelIdentity'
import { modelProviderLabel } from '../common/useDedupedModelSelect'
import { buildModelBoxRows, mergeModelOrderForKind, moveModelRow } from './modelBoxOrder'
import type { ModelOption } from '../../config/models'
import type { ModelBoxPreferenceSettings } from '../../../electron/shared/contracts/modelBoxPreference'

function option(canonicalId: string, vendor: string, label: string): ModelOption {
  return { value: `${vendor}:${canonicalId}`, label, modelKey: `${vendor}:${canonicalId}`, vendor, kind: 'image', meta: { canonicalModelId: canonicalId } } as ModelOption
}
const deduped = dedupeModelOptions([
  option('gpt-image-2', 'apimart', 'GPT Image 2'),
  option('gpt-image-2', 'kie', 'GPT Image 2'),
  option('nano-banana-2', 'apimart', 'Nano Banana 2'),
  option('nano-banana-2', 'kie', 'Nano Banana 2'),
  option('z-image-turbo', 'apimart', 'Z-Image Turbo'),
])
const preference = (patch: Partial<ModelBoxPreferenceSettings>): ModelBoxPreferenceSettings => ({
  schemaVersion: 1, modelOrder: [], hiddenModelIds: [], preferredVendorByModel: {}, ...patch,
})

describe('buildModelBoxRows', () => {
  it('orders provider tags by the global vendor list and highlights the first one by default', () => {
    const rows = buildModelBoxRows(deduped, null, ['kie', 'apimart'], modelProviderLabel)
    expect(rows.visible[0].chips.map((chip) => chip.vendorKey)).toEqual(['kie', 'apimart'])
    expect(rows.visible[0].chips.map((chip) => chip.active)).toEqual([true, false])
    expect(rows.visible[0].chips.map((chip) => chip.label)).toEqual(['Kie', 'APIMart'])
  })

  // 样张原话「你手点过的，永远听你的」：手点过那家高亮，**顺序不动**（顺序永远是上面那张表）。
  it('highlights the hand-picked provider without reordering the tags', () => {
    const rows = buildModelBoxRows(deduped, preference({ preferredVendorByModel: { 'nano-banana-2': 'kie' } }), ['apimart', 'kie'], modelProviderLabel)
    const nanoBanana = rows.visible.find((row) => row.canonicalId === 'nano-banana-2')!
    expect(nanoBanana.chips.map((chip) => chip.vendorKey)).toEqual(['apimart', 'kie'])
    expect(nanoBanana.chips.find((chip) => chip.active)?.vendorKey).toBe('kie')
    const gptImage = rows.visible.find((row) => row.canonicalId === 'gpt-image-2')!
    expect(gptImage.chips.find((chip) => chip.active)?.vendorKey).toBe('apimart')
  })

  it('splits hidden models into their own group, keeping their tags', () => {
    const rows = buildModelBoxRows(deduped, preference({ hiddenModelIds: ['z-image-turbo'] }), ['apimart', 'kie'], modelProviderLabel)
    expect(rows.visible.map((row) => row.canonicalId)).toEqual(['gpt-image-2', 'nano-banana-2'])
    expect(rows.hidden.map((row) => row.canonicalId)).toEqual(['z-image-turbo'])
    expect(rows.hidden[0].chips.map((chip) => chip.vendorKey)).toEqual(['apimart'])
  })

  it('renders rows in the hand-sorted order', () => {
    const rows = buildModelBoxRows(deduped, preference({ modelOrder: ['z-image-turbo', 'nano-banana-2'] }), [], modelProviderLabel)
    expect(rows.visible.map((row) => row.canonicalId)).toEqual(['z-image-turbo', 'nano-banana-2', 'gpt-image-2'])
  })
})

describe('mergeModelOrderForKind', () => {
  // 分段开关一次只显示一类；直接覆盖会把另外两类排过的顺序悄悄抹掉。
  it('keeps other kinds’ order intact while replacing this kind’s', () => {
    expect(mergeModelOrderForKind(
      ['img-a', 'vid-a', 'img-b', 'vid-b'],
      ['img-b', 'img-a'],
      new Set(['img-a', 'img-b']),
    )).toEqual(['img-b', 'img-a', 'vid-a', 'vid-b'])
  })

  it('deduplicates and tolerates an empty previous order', () => {
    expect(mergeModelOrderForKind([], ['a', 'a', 'b'], new Set(['a', 'b']))).toEqual(['a', 'b'])
  })
})

describe('moveModelRow', () => {
  it('swaps neighbours and refuses to walk off either end', () => {
    expect(moveModelRow(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveModelRow(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveModelRow(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveModelRow(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })
})
