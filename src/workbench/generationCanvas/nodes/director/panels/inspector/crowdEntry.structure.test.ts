import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const DIRECTOR = path.resolve(__dirname, '../..')
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (relative: string): string => stripComments(fs.readFileSync(path.join(DIRECTOR, relative), 'utf8'))

// 2026-10-07 用户反馈：「批量生成群众队列」独立面板不在加人那里。群众并进「＋→角色→群众」，旧面板删除，不许复活。
describe('crowd lives in the add menu only (no second entry)', () => {
  it('the old crowd matrix card file is gone and nothing imports it', () => {
    expect(fs.existsSync(path.join(DIRECTOR, 'panels/inspector/CrowdMatrixCard.tsx'))).toBe(false)
    expect(read('panels/inspector/CharacterInspector.tsx')).not.toMatch(/CrowdMatrix/)
  })

  it('no inspector panel calls batchCreateCrowd; the only UI caller is the placement hook', () => {
    const inspectorDir = path.join(DIRECTOR, 'panels/inspector')
    for (const file of fs.readdirSync(inspectorDir).filter((name) => name.endsWith('.tsx'))) {
      expect(stripComments(fs.readFileSync(path.join(inspectorDir, file), 'utf8')), file).not.toMatch(/batchCreateCrowd/)
    }
    expect(read('scene/creation/useCharacterPlacement.ts')).toMatch(/batchCreateCrowd/)
  })

  it('the add menu offers the crowd under the character submenu and reuses the shared slider and action picker', () => {
    const menu = read('panels/topbar/AddObjectMenu.tsx')
    expect(menu).toMatch(/setSub\('crowd'\)/)
    expect(menu).toMatch(/SliderNumberField/)
    expect(menu).toMatch(/ActionSelectModal/)
    expect(menu).toMatch(/placement\.start\('female', \{/)
  })

  it('the old standalone-panel i18n keys are removed in both locales', () => {
    const locale = stripComments(fs.readFileSync(path.resolve(DIRECTOR, '../../../../i18n/locales/director.ts'), 'utf8'))
    expect(locale).not.toMatch(/crowdTitle|crowdConfirm/)
    expect(locale).not.toMatch(/\{\{name\}\}（群众组）|\{\{name\}\} \(crowd\)/)
  })
})
