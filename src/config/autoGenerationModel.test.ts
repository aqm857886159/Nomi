import { describe, expect, it } from 'vitest'
import {
  IMAGE_AUTO_MODEL_LADDER,
  VIDEO_AUTO_MODEL_LADDER,
  inspectSingleCapabilityPick,
  resolveAutoGenerationModel,
  resolveCatalogAutoGenerationModel,
} from './autoGenerationModel'
import type { ModelOption } from './models'
import type { ModelCatalogModelDto } from '../workbench/api/modelCatalogApi'

const opt = (overrides: Partial<ModelOption> & { modelKey: string; vendor: string; label: string }): ModelOption => ({
  value: overrides.modelKey,
  ...overrides,
})

const dto = (overrides: Partial<ModelCatalogModelDto> & {
  vendorKey: string
  modelKey: string
  labelZh: string
  kind: 'image' | 'video'
}): ModelCatalogModelDto => ({
  enabled: true,
  published: true,
  publishedModes: overrides.kind === 'image' ? ['text_to_image', 'image_edit'] : ['text_to_video', 'image_to_video'],
  availability: { usable: true },
  createdAt: '2026-11-28T00:00:00Z',
  updatedAt: '2026-11-28T00:00:00Z',
  ...overrides,
})

describe('resolveAutoGenerationModel (single source of truth for Auto · <model>)', () => {
  it('picks GPT Image 2.6 Sunburst for image and Seedance 2.5 for video when available (SG-1)', () => {
    expect(IMAGE_AUTO_MODEL_LADDER[0]).toBe('gpt-image-2.6-sunburst')
    expect(VIDEO_AUTO_MODEL_LADDER[0]).toBe('doubao-seedance-2.5')

    const imagePicked = resolveAutoGenerationModel({
      mediaKind: 'image',
      options: [
        opt({ modelKey: 'gpt-image-2.6-flare', vendor: 'apimart', label: 'GPT Image 2.6 Flare' }),
        opt({ modelKey: 'gpt-image-2.6-sunburst', vendor: 'apimart', label: 'GPT Image 2.6 Sunburst' }),
        opt({ modelKey: 'z-image-turbo', vendor: 'apimart', label: 'Z-Image Turbo' }),
      ],
    })
    expect(imagePicked).toMatchObject({
      vendorKey: 'apimart',
      modelKey: 'gpt-image-2.6-sunburst',
      displayName: 'GPT Image 2.6 Sunburst',
      ladderRank: 0,
      isVendorFallback: false,
    })

    const videoPicked = resolveAutoGenerationModel({
      mediaKind: 'video',
      options: [
        opt({ modelKey: 'doubao-seedance-2.5-sample', vendor: 'apimart', label: 'Seedance 2.5（样片模式）' }),
        opt({ modelKey: 'kling-v4', vendor: 'apimart', label: 'Kling 4.0' }),
        opt({ modelKey: 'doubao-seedance-2.5', vendor: 'apimart', label: 'Seedance 2.5' }),
      ],
    })
    expect(videoPicked).toMatchObject({
      vendorKey: 'apimart',
      modelKey: 'doubao-seedance-2.5',
      displayName: 'Seedance 2.5',
      ladderRank: 0,
      isVendorFallback: false,
    })
  })

  it('board:AutoModel/edge.vendor-fallback — resolves Kie 2.5 Sunburst via canonical sibling when 2.6 is absent', () => {
    const kieOnly = resolveAutoGenerationModel({
      mediaKind: 'image',
      options: [
        opt({ modelKey: 'nano-banana-2', vendor: 'kie', label: 'Nano Banana 2' }),
        opt({ modelKey: 'gpt-image-2-5-sunburst-text-to-image', vendor: 'kie', label: 'GPT Image 2.5 Sunburst' }),
      ],
    })
    expect(kieOnly).toMatchObject({
      vendorKey: 'kie',
      modelKey: 'gpt-image-2-5-sunburst-text-to-image',
      displayName: 'GPT Image 2.5 Sunburst',
      isVendorFallback: true,
    })
  })

  it('skips consecutive-failing models so displayed name and dispatched model stay identical (auto.name-is-what-runs)', () => {
    const picked = resolveAutoGenerationModel({
      mediaKind: 'image',
      options: [
        opt({ modelKey: 'gpt-image-2.6-sunburst', vendor: 'apimart', label: 'GPT Image 2.6 Sunburst' }),
        opt({ modelKey: 'gpt-image-2.6-flare', vendor: 'apimart', label: 'GPT Image 2.6 Flare' }),
      ],
      isAiling: ({ modelKey, vendor }) => vendor === 'apimart' && modelKey === 'gpt-image-2.6-sunburst',
    })
    expect(picked).toMatchObject({
      vendorKey: 'apimart',
      modelKey: 'gpt-image-2.6-flare',
      displayName: 'GPT Image 2.6 Flare',
      isVendorFallback: true,
    })
  })

  it('respects orderedVendorKeys when multiple vendors serve the same top-ranked canonical model', () => {
    const picked = resolveAutoGenerationModel({
      mediaKind: 'video',
      options: [
        opt({ modelKey: 'doubao-seedance-2.5', vendor: 'apimart', label: 'Seedance 2.5' }),
        opt({ modelKey: 'bytedance/seedance-2-5', vendor: 'kie', label: 'Seedance 2.5' }),
      ],
      orderedVendorKeys: ['kie', 'apimart'],
    })
    expect(picked?.vendorKey).toBe('kie')
    expect(picked?.modelKey).toBe('bytedance/seedance-2-5')
    expect(picked?.displayName).toBe('Seedance 2.5')
  })

  it('returns null when zero usable models exist (auto.no-name-for-unusable)', () => {
    expect(resolveAutoGenerationModel({ mediaKind: 'image', options: [] })).toBeNull()
    expect(
      resolveCatalogAutoGenerationModel({
        models: [
          dto({
            vendorKey: 'apimart',
            modelKey: 'gpt-image-2.6-sunburst',
            labelZh: 'GPT Image 2.6 Sunburst',
            kind: 'image',
            availability: { usable: false, reason: 'credential_missing' },
          }),
        ],
        vendorNameOf: (k) => k,
        mediaKind: 'image',
      }),
    ).toBeNull()
  })

  it('board:AutoModel/edge.single-capability-pick — detects single-capability picked row and resolves Auto fallback for the missing task', () => {
    const catalog: ModelCatalogModelDto[] = [
      dto({ vendorKey: 'apimart', modelKey: 'gpt-image-2.6-sunburst', labelZh: 'GPT Image 2.6 Sunburst', kind: 'image', publishedModes: ['text_to_image', 'image_edit'] }),
      dto({ vendorKey: 'apimart', modelKey: 'z-image-turbo', labelZh: 'Z-Image Turbo', kind: 'image', publishedModes: ['text_to_image'] }),
      dto({ vendorKey: 'kie', modelKey: 'gpt-image/1.5-image-to-image', labelZh: 'GPT Image 2 · 图生图', kind: 'image', publishedModes: ['image_edit'] }),
    ]

    expect(
      inspectSingleCapabilityPick({
        models: catalog,
        vendorNameOf: (k) => k,
        mediaKind: 'image',
        picked: { vendorKey: 'apimart', modelKey: 'gpt-image-2.6-sunburst' },
      }),
    ).toBeNull()

    const zImage = inspectSingleCapabilityPick({
      models: catalog,
      vendorNameOf: (k) => k,
      mediaKind: 'image',
      picked: { vendorKey: 'apimart', modelKey: 'z-image-turbo' },
    })
    expect(zImage).toEqual({
      supportedTask: 'text_to_image',
      missingTask: 'image_edit',
      fallbackModelName: 'GPT Image 2.6 Sunburst',
    })

    const editOnly = inspectSingleCapabilityPick({
      models: catalog,
      vendorNameOf: (k) => k,
      mediaKind: 'image',
      picked: { vendorKey: 'kie', modelKey: 'gpt-image/1.5-image-to-image' },
    })
    expect(editOnly).toEqual({
      supportedTask: 'image_edit',
      missingTask: 'text_to_image',
      fallbackModelName: 'GPT Image 2.6 Sunburst',
    })
  })
})
