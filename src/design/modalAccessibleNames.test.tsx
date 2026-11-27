// 4 个带插槽的弹窗的读屏名字：弹窗标题元素（Mantine aria-labelledby 固定指向的那个 Modal.Title）里只有名字那一句，
// 不带 aria-label；副标、模型名、图标摆在插槽里、名字元素外。中英文各核一遍。名字取自各弹窗本来就用的那条词条，这里不写死文案。
// 挂载后 aria-labelledby 真的指向这个元素、axe aria-dialog-name 过不过，由 dialogName.browser.test.ts 在真浏览器里核。
import fs from 'node:fs'
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { UpdateDialogCard } from '../ui/app-shell/UpdateDialog'
import { CustomCallEditor } from '../ui/onboarding/CustomCallEditor'
import { SpendConfirmDialog } from '../workbench/generationCanvas/spend/SpendConfirmDialog'
import { useSpendConfirmStore } from '../workbench/generationCanvas/spend/spendConfirm'

const html = (node: React.ReactElement): string => renderToStaticMarkup(<MantineProvider env="test">{node}</MantineProvider>)
const decode = (text: string): string => text.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
/** 标题元素：它的开标签不许带 aria-label，里面只许是一句文字（没有子元素）。返回那句文字。 */
const titleName = (markup: string): string => {
  const element = markup.match(/<h2[^>]*mantine-Modal-title[^>]*>([\s\S]*?)<\/h2>/)
  expect(element, '找不到标题元素').not.toBeNull()
  expect(element![0], '名字元素不靠 aria-label 顶替').not.toMatch(/^<h2[^>]*aria-label=/)
  expect(element![1], '名字元素里不放别的元素').not.toMatch(/</)
  return decode(element![1])
}
/** 标题栏（Modal.Header）里、名字元素之外的文字。 */
const headerOutsideName = (markup: string): string => {
  const header = markup.match(/<header[^>]*mantine-Modal-header[^>]*>[\s\S]*?<\/header>/)?.[0] ?? ''
  expect(header, '找不到标题栏').not.toBe('')
  return decode(header.replace(/<h2[^>]*mantine-Modal-title[\s\S]*?<\/h2>/, '').replace(/<[^>]+>/g, ''))
}

const LOCALES = ['zh-CN', 'en'] as const
afterEach(async () => { await i18n.changeLanguage('zh-CN') })

describe.each(LOCALES)('弹窗读屏名字（%s）', (locale) => {
  it('更新弹窗：名字就是标题，副标摆在插槽里', async () => {
    await i18n.changeLanguage(locale)
    const digest = { title: '一段不该进名字的副标', groups: [], hiddenGroups: 0 }
    const markup = html(<UpdateDialogCard view="ready" version="0.24.0" digest={digest} releaseUrl={null} canAutoInstall />)
    expect(titleName(markup)).toBe(i18n.t('updateReminder.dialog.readyTitle', { version: '0.24.0' }))
    expect(headerOutsideName(markup)).toContain(digest.title)
  })

  it('自定义调用编辑：名字只是「自定义调用」，模型名摆在它旁边（插槽里）', async () => {
    await i18n.changeLanguage(locale)
    const target = { vendorKey: 'v', modelKey: 'm', label: '目标模型名', script: '' }
    const markup = html(<CustomCallEditor target={target} onClose={() => undefined} onSaved={() => undefined} />)
    expect(titleName(markup)).toBe(i18n.t('onboardingProviders.customCall.title'))
    expect(headerOutsideName(markup)).toContain('目标模型名')
  })

  it('花钱确认：名字就是待确认卡的标题（副标摆在插槽里、紧跟名字）', async () => {
    await i18n.changeLanguage(locale)
    const title = '在画布落一套方案（测试标题）'
    const decision = useSpendConfirmStore.getState().requestConfirm({ title, message: '测试正文', source: 'agent', kind: 'plan' })
    const server = useSpendConfirmStore.getInitialState()
    const saved = server.pending
    server.pending = useSpendConfirmStore.getState().pending
    try {
      const markup = html(<SpendConfirmDialog />)
      expect(titleName(markup)).toBe(title)
      expect(headerOutsideName(markup)).not.toBe('')
    } finally {
      server.pending = saved
      useSpendConfirmStore.getState().resolvePending(false)
      await decision
    }
  })
})

describe('选区提示词保存弹窗', () => {
  // 这个弹窗要真实的文本选区才会打开（node 下没有 document），所以核源码：title 就是标题那条词条，标志走插槽摆在名字前面。
  it('title 用标题那条词条，标志在插槽里', () => {
    const source = fs.readFileSync(new URL('../workbench/generationCanvas/components/SelectionPromptSaveController.tsx', import.meta.url), 'utf8')
    expect(source).toContain("title={t('generationCommon.savePrompt.title')}")
    expect(source).toMatch(/header=\{\(name(?:,\s*\w+)?\) => <span[^>]*>\s*<NomiLogoMark size=\{22\} \/>\{name\}/)
    for (const locale of LOCALES) expect(i18n.getFixedT(locale)('generationCommon.savePrompt.title')).not.toBe('generationCommon.savePrompt.title')
  })
})
