// 4 个弹窗的读屏名字（普查存量清零的配套断言）：弹窗标题元素（Mantine aria-labelledby 指向的那个）的 aria-label
// 必须是「只有名字」，中英文各核一遍。名字取自各弹窗标题本来就用的那条词条，这里不写死文案。
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
const titleLabel = (markup: string): string => {
  const tag = markup.match(/<[a-z0-9]+[^>]*mantine-Modal-title[^>]*>/)?.[0] ?? ''
  expect(tag, '找不到标题元素').not.toBe('')
  return tag.match(/aria-label="([^"]*)"/)?.[1]?.replace(/&amp;/g, '&').replace(/&#x27;/g, "'") ?? ''
}

const LOCALES = ['zh-CN', 'en'] as const
afterEach(async () => { await i18n.changeLanguage('zh-CN') })

describe.each(LOCALES)('弹窗读屏名字（%s）', (locale) => {
  it('更新弹窗：名字就是标题，不带副标', async () => {
    await i18n.changeLanguage(locale)
    const digest = { title: '一段不该进名字的副标', groups: [], hiddenGroups: 0 }
    const markup = html(<UpdateDialogCard view="ready" version="0.24.0" digest={digest} releaseUrl={null} canAutoInstall />)
    const name = titleLabel(markup)
    expect(name).toBe(i18n.t('updateReminder.dialog.readyTitle', { version: '0.24.0' }))
    expect(name).not.toContain(digest.title)
  })

  it('自定义调用编辑：名字是标题加目标名', async () => {
    await i18n.changeLanguage(locale)
    const target = { vendorKey: 'v', modelKey: 'm', label: '目标模型名', script: '' }
    const markup = html(<CustomCallEditor target={target} onClose={() => undefined} onSaved={() => undefined} />)
    expect(titleLabel(markup)).toBe(`${i18n.t('onboardingProviders.customCall.title')} 目标模型名`)
  })

  it('花钱确认：名字就是待确认卡的标题（副标不进名字）', async () => {
    await i18n.changeLanguage(locale)
    const title = '在画布落一套方案（测试标题）'
    const decision = useSpendConfirmStore.getState().requestConfirm({ title, message: '测试正文', source: 'agent', kind: 'plan' })
    const server = useSpendConfirmStore.getInitialState()
    const saved = server.pending
    server.pending = useSpendConfirmStore.getState().pending
    try {
      expect(titleLabel(html(<SpendConfirmDialog />))).toBe(title)
    } finally {
      server.pending = saved
      useSpendConfirmStore.getState().resolvePending(false)
      await decision
    }
  })
})

describe('选区提示词保存弹窗', () => {
  // 这个弹窗要真实的文本选区才会打开（node 下没有 document），所以核源码：accessibleName 用的就是标题那条词条。
  it('accessibleName 与标题文字用同一条词条', () => {
    const source = fs.readFileSync(new URL('../workbench/generationCanvas/components/SelectionPromptSaveController.tsx', import.meta.url), 'utf8')
    expect(source).toContain("accessibleName={t('generationCommon.savePrompt.title')}")
    expect(source).toContain("<NomiLogoMark size={22} />{t('generationCommon.savePrompt.title')}")
    for (const locale of LOCALES) expect(i18n.getFixedT(locale)('generationCommon.savePrompt.title')).not.toBe('generationCommon.savePrompt.title')
  })
})
