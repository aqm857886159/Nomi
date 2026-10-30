import { describe, expect, it } from 'vitest'
import type { ModelCatalogModelDto } from '../api/modelCatalogApi'
import { buildDefaultModelOptions } from './defaultGenerationModelOptions'

const row = (vendorKey: string, modelKey: string, kind: 'image' | 'video', publishedModes: ModelCatalogModelDto['publishedModes'], usable = true): ModelCatalogModelDto => ({
  id: vendorKey + '/' + modelKey, vendorKey, modelKey, kind, labelZh: modelKey, enabled: true,
  published: publishedModes.length > 0, publishedModes, availability: { usable },
  createdAt: '2026-10-30', updatedAt: '2026-10-30',
}) as ModelCatalogModelDto
const rows = [
  row('local', 'image-only', 'image', ['text_to_image']),
  row('local', 'edit-only', 'image', ['image_edit']),
  row('instance-a', 'imported-video', 'video', ['image_to_video']),
  row('instance-b', 'imported-video', 'video', ['text_to_video']),
  row('offline', 'unavailable', 'video', ['text_to_video', 'image_to_video'], false),
]
const options = () => buildDefaultModelOptions(rows, key => key, 'Automatic')

describe('generation defaults use the published mode, not the image/video billing kind', () => {
  it.each([
    ['text_to_image', 'image-only', 'local'], ['image_edit', 'edit-only', 'local'],
    ['text_to_video', 'imported-video', 'instance-b'], ['image_to_video', 'imported-video', 'instance-a'],
  ] as const)('%s offers only compatible published rows', (task, modelKey, vendorKey) => {
    const set = options()
    expect(set.optionsByKind[task].slice(1).map(option => set.decode(option.value, task))).toEqual([{ modelKey, vendorKey }])
  })
  it.each([
    ['image_edit', { vendorKey: 'local', modelKey: 'image-only' }],
    ['text_to_video', { vendorKey: 'instance-a', modelKey: 'imported-video' }],
  ] as const)('%s cannot encode a saved preference for another mode', (task, identity) => {
    expect(options().encode(identity, task)).toBeNull()
  })
  it('does not decode another task picker value into a supported preference', () => {
    const set = options()
    const i2v = set.optionsByKind.image_to_video[1]!.value
    expect(set.decode(i2v, 'text_to_video')).toBeNull()
  })
  it('fails closed when published mode evidence is missing', () => {
    const missing = { ...rows[0], publishedModes: undefined } as unknown as ModelCatalogModelDto
    const set = buildDefaultModelOptions([missing], key => key, 'Automatic')
    expect(Object.values(set.optionsByKind).every(list => list.length === 1)).toBe(true)
  })
  it('preserves exact vendor/model identity including separators', () => {
    const identity = { vendorKey: 'http://local:8188/a', modelKey: 'folder/model:v2' }
    const set = buildDefaultModelOptions([row(identity.vendorKey, identity.modelKey, 'video', ['image_to_video'])], key => key, 'Automatic')
    expect(set.decode(set.encode(identity, 'image_to_video')!, 'image_to_video')).toEqual(identity)
  })
})
