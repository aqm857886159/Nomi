import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { enDirector, zhDirector } from '../../../../../i18n/locales/director'
import { DirectorStoreContext } from '../DirectorEditorContext'
import { createDirectorStore } from '../model/directorStore'
import type { CharacterPlacementApi } from '../scene/creation/useCharacterPlacement'
import { SceneObjectsTab } from './side/SceneObjectsTab'
import { PlacementHud } from './viewport/ViewportOverlays'

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

describe('crowd placement HUD names what is being placed (zh / en)', () => {
  it.each([['zh', zhDirector, '群众', '女人'], ['en', enDirector, 'Crowd', 'Woman']] as const)('%s: crowd says the crowd, a single character still says the person', (_name, dict, crowdWord, womanWord) => {
    locale.dict = dict as unknown as Record<string, unknown>
    const crowdHtml = renderToStaticMarkup(<PlacementHud placement={placing(true)} boxDraw={boxDraw} />)
    expect(crowdHtml).toContain(crowdWord)
    expect(crowdHtml).not.toContain(womanWord)
    expect(renderToStaticMarkup(<PlacementHud placement={placing(false)} boxDraw={boxDraw} />)).toContain(womanWord)
  })
})

describe('outliner shows a crowd group as one folded row', () => {
  it('lists the group only, members stay hidden until the arrow opens them', () => {
    locale.dict = zhDirector as unknown as Record<string, unknown>
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    store.getState().batchCreateCrowd(crowdSpec)
    expect(store.getState().activeScene().objects).toHaveLength(7)
    const html = renderToStaticMarkup(<DirectorStoreContext.Provider value={store}><SceneObjectsTab /></DirectorStoreContext.Provider>)
    expect(html.match(/data-testid="director-outliner-row"/g)).toHaveLength(1)
    expect(html).toContain('>G<')
    expect(html).not.toContain('>M 1<')
  })
})
