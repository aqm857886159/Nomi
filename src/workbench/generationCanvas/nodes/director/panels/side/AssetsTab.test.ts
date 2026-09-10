import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createDirectorStore } from '../../model/directorStore'
import { DirectorStoreContext } from '../../DirectorEditorContext'
import type { DirectorLinkedAsset } from '../../model/directorTypes'
import { AssetsTab } from './AssetsTab'

const runtime = vi.hoisted(() => ({ linked: [] as DirectorLinkedAsset[] }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../../../../ui/toast', () => ({ toast: vi.fn() }))
vi.mock('../../../../../api/assetUploadApi', () => ({ hostedAssetUrl: vi.fn(), importWorkbenchLocalAssetFile: vi.fn() }))
vi.mock('../../scene/creation/useCharacterPlacement', () => ({ CHARACTER_MODEL_BY_GENDER: {} }))
vi.mock('../LinkedAssetsContext', () => ({ useLinkedAssets: () => runtime.linked }))

type Row = React.ReactElement<{ children?: React.ReactNode; onDoubleClick?: () => void }>
function findRow(node: React.ReactNode, id: string): Row | undefined {
  if (Array.isArray(node)) return node.map((child) => findRow(child, id)).find(Boolean)
  if (!React.isValidElement<Row['props']>(node)) return undefined
  return node.key === id ? node : findRow(node.props.children, id)
}

describe('asset source orientation at the real add-to-scene callback', () => {
  it.each(['linked', 'uploaded'] as const)('applies splat source axes to %s assets and preserves authored transforms', (entry) => {
    let store = createDirectorStore({ defaultSceneName: 'S1' })
    const asset: DirectorLinkedAsset = { id: 'linked', name: 'Scan', kind: 'splat', url: '/scan.spz' }
    runtime.linked = entry === 'linked' ? [asset] : []
    const id = entry === 'uploaded' ? store.getState().addAssetItem({ ...asset, folderId: null }).id : asset.id
    store = createDirectorStore({ defaultSceneName: 'S1', rawProject: store.getState().project })
    let tree!: JSX.Element
    function Host() { tree = AssetsTab(); return null }
    renderToString(React.createElement(DirectorStoreContext.Provider, { value: store }, React.createElement(Host)))
    const row = findRow(tree, id); expect(row?.props.onDoubleClick).toBeTypeOf('function'); row!.props.onDoubleClick!()
    const object = store.getState().activeScene().objects[0]
    expect(object.rotation).toEqual({ x: 180, y: 0, z: 0 })
    store.getState().updateObject(object.id, { rotation: { x: 23, y: 11, z: 7 } })
    store.getState().renameObject(object.id, 'Renamed')
    expect(store.getState().activeScene().objects[0].rotation).toEqual({ x: 23, y: 11, z: 7 })
  })
  it.each(['glb', 'gltf', 'fbx'])('keeps the authored upright axes for ordinary %s models', (extension) => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    runtime.linked = [{ id: 'model', name: 'Model', kind: 'model', url: `/model.${extension}` }]
    let tree!: JSX.Element
    function Host() { tree = AssetsTab(); return null }
    renderToString(React.createElement(DirectorStoreContext.Provider, { value: store }, React.createElement(Host)))
    findRow(tree, 'model')!.props.onDoubleClick!()
    expect(store.getState().activeScene().objects[0].rotation).toEqual({ x: 0, y: 0, z: 0 })
  })
})
