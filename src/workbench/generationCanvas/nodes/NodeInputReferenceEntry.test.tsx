import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import NodeInputReferenceEntry from './NodeInputReferenceEntry'
import AssetReferenceButton from '../../assets/AssetReferenceButton'
import { AssetAddTile } from '../../assets/AssetTile'
import type { GenerationCanvasNode, GenerationCanvasEdge } from '../model/generationCanvasTypes'

const fixture = vi.hoisted(() => ({ nodes: [] as GenerationCanvasNode[], edges: [] as GenerationCanvasEdge[] }))
vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../project/useOpenProjectId', () => ({ useOpenProjectId: () => null }))
vi.mock('../store/generationCanvasStore', () => ({ useGenerationCanvasStore: (select: (state: typeof fixture) => unknown) => select(fixture) }))
vi.mock('../quickActions/nodeInputActions', () => ({ addAssetInput: vi.fn(), addUploadedInput: vi.fn(), pickCanvasInputFor: vi.fn() }))

describe('original library add box is preserved beside the new pointer entry', () => {
  it.each(['empty', 'image', 'video', 'audio'] as const)('reuses the exact original add box with %s references', kind => {
    fixture.nodes = kind === 'empty' ? [] : [{
      id: 'source', kind, title: 'Source', position: { x: 0, y: 0 },
      result: { id: 'result', type: kind, url: `nomi-local://asset/${kind}` },
    } as GenerationCanvasNode]
    fixture.edges = kind === 'empty' ? [] : [{ id: 'edge', source: 'source', target: 'target' } as GenerationCanvasEdge]
    const html = renderToStaticMarkup(<NodeInputReferenceEntry nodeId="target" />)
    const original = renderToStaticMarkup(<AssetAddTile onClick={() => {}} />)
    expect(html).toContain(original)
    expect(html.match(/data-asset-add-tile="true"/g)).toHaveLength(1)
    expect(html.match(/data-reference-entry="true"/g)).toHaveLength(1)
    expect(html).not.toContain('data-reference-add=')
    if (kind !== 'empty') expect(html).toContain(`data-asset-tile="${kind}"`)
  })

  it('node pointer uses the identical original square frame with only its icon', () => {
    const pointer = renderToStaticMarkup(<AssetReferenceButton onClick={() => {}} />)
    const plus = renderToStaticMarkup(<AssetAddTile onClick={() => {}} />)
    const frameClass = (html: string) => html.match(/<button[^>]*class="([^"]+)"/)?.[1]
    expect(frameClass(pointer)).toBe(frameClass(plus))
    expect(pointer.replace(/<[^>]+>/g, '')).toBe('')
    expect(pointer).toContain('tabler-icon-pointer')
    expect(pointer).not.toContain('data-asset-add-tile=')
  })

  it.each([false, true])('pointer entry does not own a second plus (iconOnly=%s)', iconOnly => {
    // An old untyped caller cannot resurrect the deleted plus path.
    const html = renderToStaticMarkup(React.createElement(AssetReferenceButton, {
      onClick: vi.fn(), iconOnly, ...{ onAdd: vi.fn() },
    }))
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).not.toContain('data-reference-add=')
    expect(html).not.toContain('data-asset-add-tile=')
  })
})
