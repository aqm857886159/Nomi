import { describe, expect, it } from 'vitest'

import { codeFenceTypeface, looksLikeCode } from './codeFenceTypeface'

// 用高亮器的真实回答当桩：它认得的就是编程语言（markdown 也认得，但那是文字）。
const highlightable = (language: string): boolean => ['json', 'ts', 'typescript', 'python', 'bash', 'markdown', 'md'].includes(language)

describe('codeFenceTypeface', () => {
  it('用户截图那一段：没标语言的英文提示词按文字排', () => {
    const prompt = 'A cozy vintage camera shop at dawn, warm golden light slanting through the display window, dust motes floating in the air, cinematic composition, 35mm film grain, shallow depth of field, photorealistic, 16:9'
    expect(codeFenceTypeface('', prompt, highlightable)).toBe('prose')
  })

  it('中文提示词、以大写动词开头的英文提示词也是文字', () => {
    expect(codeFenceTypeface('', '清晨的老相机店，暖金色的光从橱窗斜照进来，电影感构图，35mm 胶片颗粒。', highlightable)).toBe('prose')
    expect(codeFenceTypeface('', 'Create a portrait of an old man.\nReturn to a warm palette; keep it soft', highlightable)).toBe('prose')
  })

  it('标了高亮器认得的编程语言 → 代码，不管内容多像文字', () => {
    expect(codeFenceTypeface('json', '{ "aspect_ratio": "16:9" }', highlightable)).toBe('code')
    expect(codeFenceTypeface('Python', 'print("hi")', highlightable)).toBe('code')
    expect(codeFenceTypeface('bash', 'pnpm install', highlightable)).toBe('code')
  })

  it('标了文字类语言或高亮器不认得的词 → 看内容', () => {
    expect(codeFenceTypeface('markdown', '一段要粘去用的提示词，逗号分隔的关键词', highlightable)).toBe('prose')
    expect(codeFenceTypeface('text', 'soft light, film grain', highlightable)).toBe('prose')
    expect(codeFenceTypeface('prompt', 'soft light, film grain', highlightable)).toBe('prose')
    expect(codeFenceTypeface('english', 'const scene = "mountain";', highlightable)).toBe('code')
  })

  it('没标语言但内容是代码 → 仍等宽', () => {
    expect(codeFenceTypeface('', '{\n  "style": "cinematic"\n}', highlightable)).toBe('code')
    expect(codeFenceTypeface('', 'const scene = "山"\nconsole.log(scene)', highlightable)).toBe('code')
    expect(codeFenceTypeface('', '$ pnpm run gates', highlightable)).toBe('code')
    expect(codeFenceTypeface('', '<div class="hero">Nomi</div>', highlightable)).toBe('code')
  })
})

describe('looksLikeCode', () => {
  it('空内容不是代码', () => {
    expect(looksLikeCode('   ')).toBe(false)
  })

  it('括号等号密度高的一行是代码，普通逗号句号不是', () => {
    expect(looksLikeCode('f(a[i]) = g(b[j]) + h(c)')).toBe(true)
    expect(looksLikeCode('warm light, soft shadows, 16:9, film grain, shallow depth of field.')).toBe(false)
  })
})
