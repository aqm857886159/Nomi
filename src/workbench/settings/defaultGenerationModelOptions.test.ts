import { expect, it } from 'vitest'
import type { ModelCatalogModelDto } from '../api/modelCatalogApi'
import { buildDefaultModelOptions } from './defaultGenerationModelOptions'

it('disambiguates the visible label only across usable vendors offering the same task', () => {
  const image = (vendorKey: string, modelKey: string, labelZh: string, usable = true) => ({
    vendorKey, modelKey, labelZh, kind: 'image', availability: { usable },
  }) as ModelCatalogModelDto
  const rows = [
    image('first', 'one', 'Solo'), image('offline', 'one', 'Solo', false),
    image('first', 'two', 'Shared'), image('second', 'alias', 'Shared'),
    { ...image('edit', 'one', 'Solo'), publishedModes: ['image_edit' as const] },
  ]
  const options = buildDefaultModelOptions(rows, key => key, 'Auto')
  expect(options.optionsByKind.text_to_image.map(o => o.label)).toEqual(['Auto', 'Solo', 'Shared · first', 'Shared · second'])
  expect(options.optionsByKind.image_edit.map(o => o.label)).toContain('Solo · edit')
  expect(options.decode(options.optionsByKind.text_to_image[3].value)).toEqual({ vendorKey: 'second', modelKey: 'alias' })
})
