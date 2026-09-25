import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { isRemoteExampleMediaBroken, markRemoteExampleMediaBroken } from './remoteExampleMedia'
import { PromptCard } from '../workbench/promptLibrary/PromptCard'
import { SkillMedia } from '../workbench/skillLibrary/SkillMedia'
import { TooltipProvider } from '../design'
import type { LibraryPrompt } from '../workbench/api/promptLibraryApi'

vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('第三方示例媒体的会话失效记账', () => {
  it('失败一次就记下，同一地址本次会话都算失效', () => {
    const url = 'https://video.twimg.com/amplify_video/1/vid/avc1/480x270/a.mp4'
    expect(isRemoteExampleMediaBroken(url)).toBe(false)
    markRemoteExampleMediaBroken(url)
    expect(isRemoteExampleMediaBroken(url)).toBe(true)
    expect(isRemoteExampleMediaBroken('https://video.twimg.com/other.mp4')).toBe(false)
    expect(isRemoteExampleMediaBroken(undefined)).toBe(false)
  })

  it('已失效的示例：提示词卡不再挂 <video> 去请求，显示「示例已失效」', () => {
    const mediaUrl = 'https://video.twimg.com/amplify_video/2/vid/avc1/480x270/b.mp4'
    const prompt = { id: 'p1', title: 'Sora 2 示例', prompt: 'a cat', mediaType: 'video', mediaUrl, source: 'sora2-viral' } as unknown as LibraryPrompt
    const render = () => renderToStaticMarkup(React.createElement(TooltipProvider, null, React.createElement(PromptCard, { prompt, onSelect: () => undefined })))
    expect(render()).toContain(`src="${mediaUrl}"`)
    markRemoteExampleMediaBroken(mediaUrl)
    const html = render()
    expect(html).not.toContain(`src="${mediaUrl}"`)
    expect(html).toContain('libraries.prompt.card.expired')
  })

  it('技能库示例媒体读同一份记账：已失效的地址直接给占位，不再请求', () => {
    const url = 'https://cdn.openai.com/sora/videos/gone.mp4'
    markRemoteExampleMediaBroken(url)
    const html = renderToStaticMarkup(React.createElement(SkillMedia, { preview: { url, type: 'video' } }))
    expect(html).toContain('data-skill-media="placeholder"')
    expect(html).not.toContain(url)
  })
})
