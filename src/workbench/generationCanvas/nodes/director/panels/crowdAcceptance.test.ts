import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { enDirector, zhDirector } from '../../../../../i18n/locales/director'
import { DirectorStoreContext } from '../DirectorEditorContext'
import { createDirectorStore } from '../model/directorStore'
import type { CharacterPlacementApi } from '../scene/creation/useCharacterPlacement'
import { SceneObjectsTab } from './side/SceneObjectsTab'
import { PlacementHud } from './viewport/ViewportOverlays'

// 服务端渲染只读 store 的初始快照；这里让订阅直接读现值，才能在同一个 store 上先选中、再渲染
vi.mock('zustand', () => ({ useStore: (api: { getState: () => unknown }, selector: (state: unknown) => unknown) => selector(api.getState()) }))
const locale = vi.hoisted(() => ({ dict: {} as Record<string, unknown> }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key.replace(/^director\./, '').split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale.dict) ?? key,
  }),
}))

const IDENTITY = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
const crowdSpec = { transform: IDENTITY, rows: 2, cols: 3, spacing: 2, actionId: 'standing_idle', groupName: 'G', memberName: 'M' }
const placing = (crowd: boolean): CharacterPlacementApi => ({ active: true, gender: 'female', headingDeg: 0, crowd: crowd ? { rows: 2, cols: 3, spacing: 2, actionId: 'standing_idle' } : null } as unknown as CharacterPlacementApi)
const boxDraw = { active: false } as never
const h = (placement: CharacterPlacementApi) => React.createElement(PlacementHud, { placement, boxDraw })
const tab = (store: ReturnType<typeof createDirectorStore>) => React.createElement(DirectorStoreContext.Provider, { value: store }, React.createElement(SceneObjectsTab))

describe('crowd placement HUD names what is being placed (zh / en)', () => {
  it.each([['zh', zhDirector, '群众', '女人'], ['en', enDirector, 'Crowd', 'Woman']] as const)('%s: crowd says the crowd, a single character still says the person', (_name, dict, crowdWord, womanWord) => {
    locale.dict = dict as unknown as Record<string, unknown>
    const crowdHtml = renderToStaticMarkup(h(placing(true)))
    expect(crowdHtml).toContain(crowdWord)
    expect(crowdHtml).not.toContain(womanWord)
    expect(renderToStaticMarkup(h(placing(false)))).toContain(womanWord)
  })
})

describe('outliner shows a crowd group as one folded row', () => {
  it('lists the group only, members stay hidden until the arrow opens them', () => {
    locale.dict = zhDirector as unknown as Record<string, unknown>
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    store.getState().batchCreateCrowd(crowdSpec)
    expect(store.getState().activeScene().objects).toHaveLength(7)
    const html = renderToStaticMarkup(tab(store))
    expect(html.match(/data-testid="director-outliner-row"/g)).toHaveLength(1)
    expect(html).toContain('>G<')
    expect(html).not.toContain('>M 1<')
  })
})

describe('outliner keeps the selection visible (every fold state)', () => {
  const html = (store: ReturnType<typeof createDirectorStore>) => renderToStaticMarkup(tab(store))
  // 行的 class 写在 data-testid 之前：取「含名字的块」的前一块尾部（该行开标签）加本块
  const rowOf = (markup: string, name: string) => {
    const chunks = markup.split('data-testid="director-outliner-row"')
    const at = chunks.findIndex((chunk) => chunk.includes(`>${name}<`))
    return at < 1 ? '' : chunks[at - 1].slice(chunks[at - 1].lastIndexOf('<div')) + chunks[at].slice(0, 40)
  }

  it.each([['zh', zhDirector], ['en', enDirector]] as const)('%s: picking a member in the viewport opens its group and highlights the row', (_name, dict) => {
    locale.dict = dict as unknown as Record<string, unknown>
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const groupId = store.getState().batchCreateCrowd(crowdSpec)!
    const member = store.getState().activeScene().objects.find((item) => item.parentId === groupId)!
    expect(html(store).match(/director-outliner-row/g)).toHaveLength(1)
    store.getState().select({ objectId: member.id, multiObjectIds: [], cameraId: null, lightId: null })
    const markup = html(store)
    expect(markup.match(/director-outliner-row/g)).toHaveLength(1 + 6)
    expect(rowOf(markup, member.name)).toContain('bg-nomi-accent-soft')
  })

  it('selecting something outside a group leaves that group folded', () => {
    locale.dict = zhDirector as unknown as Record<string, unknown>
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    store.getState().batchCreateCrowd(crowdSpec)
    const loose = store.getState().addObject({ type: 'cube', name: 'Loose' } as never)
    store.getState().select({ objectId: loose, multiObjectIds: [], cameraId: null, lightId: null })
    const markup = html(store)
    expect(markup.match(/director-outliner-row/g)).toHaveLength(2)
    expect(rowOf(markup, 'Loose')).toContain('bg-nomi-accent-soft')
  })
})
