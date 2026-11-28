// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { ModelCatalogModelDto } from '../api/modelCatalogApi'
import type { GenerationModelDefaultMap } from '../generationCanvas/model/generationModelDefaults'
import { DefaultGenerationModelsSection } from './DefaultGenerationModelsSection'

const catalogRow = (
  overrides: Partial<ModelCatalogModelDto> & {
    vendorKey: string
    modelKey: string
    labelZh: string
    kind: 'image' | 'video'
  },
): ModelCatalogModelDto => ({
  enabled: true,
  published: true,
  publishedModes: overrides.kind === 'image' ? ['text_to_image', 'image_edit'] : ['text_to_video', 'image_to_video'],
  availability: { usable: true },
  createdAt: '2026-11-28T00:00:00Z',
  updatedAt: '2026-11-28T00:00:00Z',
  ...overrides,
})

describe('DefaultGenerationModelsSection (AutoModel board parity)', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let initialLanguage: string

  beforeEach(async () => {
    initialLanguage = i18n.language
    await i18n.changeLanguage('zh-CN')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    await i18n.changeLanguage(initialLanguage)
  })

  const renderSection = async (
    models: readonly ModelCatalogModelDto[],
    defaults: GenerationModelDefaultMap = {},
    onChange: (next: GenerationModelDefaultMap) => void = () => {},
  ) => {
    await act(async () => {
      root.render(
        <MantineProvider env="test">
          <DefaultGenerationModelsSection
            models={models}
            vendorNameOf={(v) => (v === 'apimart' ? 'APIMart' : v === 'kie' ? 'Kie' : v)}
            defaults={defaults}
            onChange={onChange}
          />
        </MantineProvider>,
      )
    })
  }

  it('renders 2 rows (Image & Video), explicit Auto model names, caption, and picker top Auto row', async () => {
    const models = [
      catalogRow({ vendorKey: 'apimart', modelKey: 'gpt-image-2.6-sunburst', labelZh: 'GPT Image 2.6 Sunburst', kind: 'image' }),
      catalogRow({ vendorKey: 'apimart', modelKey: 'z-image-turbo', labelZh: 'Z-Image Turbo', kind: 'image', publishedModes: ['text_to_image'] }),
      catalogRow({ vendorKey: 'apimart', modelKey: 'doubao-seedance-2.5', labelZh: 'Seedance 2.5', kind: 'video' }),
    ]
    await renderSection(models)

    const imageRow = container.querySelector('[data-board="policy.default-image-row"]')!
    const videoRow = container.querySelector('[data-board="policy.default-video-row"]')!
    const caption = container.querySelector('[data-board="policy.auto-caption"]')!
    expect(imageRow, 'board:AutoModel/policy.default-image-row').toBeTruthy()
    expect(videoRow, 'board:AutoModel/policy.default-video-row').toBeTruthy()
    expect(caption, 'board:AutoModel/policy.auto-caption').toBeTruthy()

    expect(imageRow.textContent).toContain(i18n.t('settings.ai.defaultModels.image'))
    expect(imageRow.textContent).toContain(i18n.t('settings.ai.defaultModels.imageSubtitle'))
    expect(imageRow.querySelector('button')?.textContent).toBe(
      i18n.t('settings.ai.defaultModels.autoWithModel', { model: 'GPT Image 2.6 Sunburst' }),
    )

    expect(videoRow.textContent).toContain(i18n.t('settings.ai.defaultModels.video'))
    expect(videoRow.textContent).toContain(i18n.t('settings.ai.defaultModels.videoSubtitle'))
    expect(videoRow.querySelector('button')?.textContent).toBe(
      i18n.t('settings.ai.defaultModels.autoWithModel', { model: 'Seedance 2.5' }),
    )
    expect(caption.textContent).toBe(i18n.t('settings.ai.defaultModels.hint'))

    await act(async () => {
      imageRow.querySelector('button')!.click()
    })
    const autoOpt = document.body.querySelector('[data-board="policy.picker-auto-option"]')!
    expect(autoOpt, 'board:AutoModel/policy.picker-auto-option').toBeTruthy()
    expect(autoOpt.textContent).toContain(
      i18n.t('settings.ai.defaultModels.autoWithModel', { model: 'GPT Image 2.6 Sunburst' }),
    )
    expect(autoOpt.textContent).toContain(i18n.t('settings.ai.defaultModels.autoStrongest'))
  })

  it('renders vendor fallback when primary recommended model is unavailable locally', async () => {
    const kieOnly = [
      catalogRow({ vendorKey: 'kie', modelKey: 'gpt-image-2-5-sunburst-text-to-image', labelZh: 'GPT Image 2.5 Sunburst', kind: 'image' }),
      catalogRow({ vendorKey: 'kie', modelKey: 'bytedance/seedance-2-5', labelZh: 'Seedance 2.5', kind: 'video' }),
    ]
    await renderSection(kieOnly)

    const fallbackAnchor = container.querySelector('[data-board="edge.vendor-fallback"]')!
    expect(fallbackAnchor, 'board:AutoModel/edge.vendor-fallback').toBeTruthy()
    expect(fallbackAnchor.textContent).toBe('自动 · GPT Image 2.5 Sunburst')
    expect(container.textContent).not.toContain('2.6')
  })

  it('renders honest single-capability subtitle when a text-only model is manually selected', async () => {
    const models = [
      catalogRow({ vendorKey: 'apimart', modelKey: 'gpt-image-2.6-sunburst', labelZh: 'GPT Image 2.6 Sunburst', kind: 'image' }),
      catalogRow({ vendorKey: 'apimart', modelKey: 'z-image-turbo', labelZh: 'Z-Image Turbo', kind: 'image', publishedModes: ['text_to_image'] }),
      catalogRow({ vendorKey: 'apimart', modelKey: 'doubao-seedance-2.5', labelZh: 'Seedance 2.5', kind: 'video' }),
    ]
    await renderSection(models, { image: { vendorKey: 'apimart', modelKey: 'z-image-turbo' } })

    const singleCap = container.querySelector('[data-board="edge.single-capability-pick"]')!
    expect(singleCap, 'board:AutoModel/edge.single-capability-pick').toBeTruthy()
    expect(singleCap.textContent).toBe(
      i18n.t('settings.ai.defaultModels.singleCapability.text_to_image', { model: 'GPT Image 2.6 Sunburst' }),
    )
    expect(container.querySelector('[data-board="policy.default-image-row"] button')?.textContent).toBe('Z-Image Turbo')

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(container.querySelector('[data-board="edge.single-capability-pick"]')?.textContent).toBe(
      i18n.t('settings.ai.defaultModels.singleCapability.text_to_image', { model: 'GPT Image 2.6 Sunburst' }),
    )
  })

  it('renders none-available state and routes Connect a provider to Models tab', async () => {
    const opened: unknown[] = []
    const listener = (e: Event) => opened.push((e as CustomEvent).detail)
    window.addEventListener('nomi-open-settings', listener)
    try {
      await renderSection([])
      const imageRow = container.querySelector('[data-board="policy.default-image-row"]')!
      const videoRow = container.querySelector('[data-board="policy.default-video-row"]')!
      const noneRow = container.querySelector('[data-board="edge.none-available"]')!
      expect(noneRow, 'board:AutoModel/edge.none-available').toBeTruthy()
      expect(imageRow.querySelector('button')?.textContent).toBe(i18n.t('settings.ai.defaultModels.autoNone'))
      expect(videoRow.querySelector('button')?.textContent).toBe(i18n.t('settings.ai.defaultModels.autoNone'))
      expect(noneRow.textContent).toContain(i18n.t('settings.ai.defaultModels.connectProvider'))

      await act(async () => {
        noneRow.querySelector('button')!.click()
      })
      expect(opened).toEqual([{ tab: 'models' }])
    } finally {
      window.removeEventListener('nomi-open-settings', listener)
    }
  })
})
