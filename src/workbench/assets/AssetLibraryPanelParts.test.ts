import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { isAssetGridActivationKey } from './assetLibraryUsage'
import { AssetGridCell } from './AssetLibraryPanelParts'
import { TooltipProvider } from '../../design'
import type { AssetRef } from './assetTypes'

vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key,
  }),
}))

describe('AssetGridCell keyboard contract', () => {
  it('activates on Enter or Space and ignores navigation keys', () => {
    expect(isAssetGridActivationKey('Enter')).toBe(true)
    expect(isAssetGridActivationKey(' ')).toBe(true)
    expect(isAssetGridActivationKey('ArrowDown')).toBe(false)
  })
})

describe('AssetGridCell compact presentation', () => {
  it('shows one filename line and uses known intrinsic ratio for the media frame', () => {
    const asset: AssetRef = {
      id: 'portrait',
      kind: 'image',
      name: 'portrait-2x3.png',
      renderUrl: 'https://example.test/portrait.png',
      source: 'project',
      dimensions: { width: 2, height: 3 },
      origin: { source: 'project', projectId: 'p', relativePath: 'portrait-2x3.png' },
    }
    const html = renderToStaticMarkup(
      React.createElement(TooltipProvider, null,
        React.createElement(AssetGridCell, { asset, compact: true, draggable: false })),
    )
    expect(html).toContain('portrait-2x3.png')
    expect(html).toContain('aspect-ratio:0.6666666666666666')
  })
})
