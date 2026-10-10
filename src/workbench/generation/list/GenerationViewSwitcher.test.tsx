// 顶栏里「画布 ↔ 列表」的唯一切换：一个图标，显示点了会去的那个视图，名字写明动作。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { TooltipProvider } from '../../../design'
import { GenerationViewSwitcher } from './GenerationViewSwitcher'
import { useGenerationViewStore } from './generationViewStore'

vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => i18n.t(key, options) }),
}))

const render = () => renderToStaticMarkup(React.createElement(TooltipProvider, null, React.createElement(GenerationViewSwitcher)))

describe('GenerationViewSwitcher', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useGenerationViewStore.setState({ view: 'canvas', inspectorKey: null })
  })

  it('on the canvas it offers the list; on the list it offers the canvas (the icon is where a click goes)', () => {
    const server = useGenerationViewStore.getInitialState() as unknown as Record<string, unknown>
    const saved = server.view
    expect(render()).toContain('aria-label="切到列表"')
    expect(render()).toContain('data-generation-view-switcher="canvas"')
    server.view = 'list'
    expect(render()).toContain('aria-label="切到画布"')
    expect(render()).toContain('data-generation-view-switcher="list"')
    server.view = saved
  })

  it('English wording is an action too', async () => {
    await i18n.changeLanguage('en')
    expect(render()).toContain('aria-label="Switch to list"')
  })

  it('it is exactly one icon button: no text segments', () => {
    const html = render()
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).not.toContain('画布 | 列表')
  })
})
