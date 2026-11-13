import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInstance, type TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { resources } from '../../i18n/resources'
import { projectQuarantineNoticeText, type QuarantineNoticeInput } from './projectOperationFailureText'

/**
 * 有项被隔离时创作者读到的那一句话（2026-11-13 独立验收 C3）：说清哪份分镜、第几镜（从 1 数）、哪一项（界面叫法）、
 * 其余是否已存好、项目里是上一版还是没有、没存上的去了哪里；绝不露代码路径；多项合成「有 N 处」。
 */
async function translator(lng: 'zh-CN' | 'en'): Promise<TFunction> {
  const i18n = createInstance()
  await i18n.init({ lng, resources, interpolation: { escapeValue: false } })
  return i18n.t.bind(i18n) as TFunction
}
const TITLE = '雨夜追逐：主角在霓虹街巷里第一次看见那辆没有车牌的黑色轿车之后他决定一路跟到城市最北端的旧码头去' // 48 字：标题最长的情形
const item = (field: string, keptPreviousVersion: boolean, origin: 'open' | 'save' = 'save'): QuarantineNoticeInput => ({
  origin, item: { container: 'storyboardDesign', field, title: TITLE, keptPreviousVersion },
})
const CODE_PATH = /plan\.|shots\[|\[\d+\]|sourceNodeId|referenceBindings|durationSec/

describe('quarantine notice sentence', () => {
  it.each(['zh-CN', 'en'] as const)('%s: names the storyboard, counts shots from 1, maps the field, never shows a code path', async (lng) => {
    const t = await translator(lng)
    const text = projectQuarantineNoticeText(t, [item('plan.shots[12].referenceBindings.character[3].sourceNodeId', true)])
    expect(text).toContain(TITLE)
    expect(text).toContain('13')
    expect(text).not.toContain('12')
    expect(text).not.toMatch(CODE_PATH)
    expect(text).toContain(lng === 'en' ? 'references' : '参考')
  })

  it('zh: one item, saved — says the project still has the previous version / does not have it yet, the rest is saved, and a copy is kept', async () => {
    const t = await translator('zh-CN')
    const kept = projectQuarantineNoticeText(t, [item('plan.shots[0].durationSec', true)])
    expect(kept).toBe(`分镜《${TITLE}》第 1 镜的时长格式不对，这次没能存进项目，项目里还是它的上一版；其余改动都已保存。这次的内容另存了一份，可在文件夹里找回。`)
    const missing = projectQuarantineNoticeText(t, [item('plan.shots[0].durationSec', false)])
    expect(missing).toContain('项目里还没有它')
  })

  it('an unmapped shot field only says which shot; a top-level field only says which storyboard', async () => {
    const t = await translator('zh-CN')
    expect(projectQuarantineNoticeText(t, [item('plan.shots[4].camIdx', true)])).toContain(`分镜《${TITLE}》第 5 镜格式不对`)
    expect(projectQuarantineNoticeText(t, [item('status', true)])).toContain(`分镜《${TITLE}》格式不对`)
  })

  it('opening: says it was left out when the project opened and will not be in the project from now on', async () => {
    const t = await translator('zh-CN')
    const text = projectQuarantineNoticeText(t, [item('status', false, 'open')])
    expect(text).toContain('打开时没能放进项目')
    expect(text).toContain('另存了一份')
  })

  it.each([2, 25])('%i items merge into one sentence with the count, not one sentence each', async (count) => {
    const t = await translator('zh-CN')
    const items = Array.from({ length: count }, (_, i) => item(`plan.shots[${i}].durationSec`, i % 2 === 0))
    const text = projectQuarantineNoticeText(t, items)
    expect(text.startsWith(`有 ${count} 处内容格式不对`)).toBe(true)
    expect(text.split('格式不对')).toHaveLength(2)
    expect(text).not.toMatch(CODE_PATH)
  })
})

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const service = stripComments(readFileSync(resolve(process.cwd(), 'src/workbench/project/projectPersistenceService.ts'), 'utf8'))

describe('the notice is wired where the creator will see it', () => {
  it('announced after an autosave succeeds and after a project opens', () => {
    const bind = service.slice(service.indexOf('const bindProjectPersistence'), service.indexOf('const hydrateProject'))
    const fromOnSaved = bind.slice(bind.indexOf('onSaved: (record) =>'))
    const onSaved = fromOnSaved.slice(0, fromOnSaved.indexOf('onSaveError:'))
    expect(onSaved).toContain('input.onSaved(record)')
    expect(onSaved).toContain('announceQuarantine(record.id)')
    const hydrate = service.slice(service.indexOf('const hydrateProject'))
    const end = hydrate.slice(hydrate.indexOf('writeLastActiveProjectId(upgraded.id)'), hydrate.indexOf('return upgraded'))
    expect(end).toContain('announceQuarantine(upgraded.id)')
  })
})
