// 浏览器素材子系统的**文案必须真的走 i18n**,且**只有一个命名空间 owner**。
//
// 为什么单独立这道:2026-09-02 反向死键门岗扫出 25 条零引用词条,查下来不是遗留,而是
// 「译文 zh+en 都对,代码却把中文写死」——英文界面下浏览器素材/对话框整片显示中文。
// 同一批文案当时还**存了两份**:browserAssets.* 与 runtime.browser.*(webImage/webVideo/
// sourceSessionExpired 逐字重复),runtime.browser 整棵 10 个叶子全是死键。
// 已定 browserAssets.* 为唯一 owner、runtime.browser 整棵删除(P1/R14.1)。
//
// 这道从数据层钉住两件事:① 每个键解析得出译文、英文侧无汉字;② 重复命名空间不许回来。
// 面板本身要真机看,见 tests/ux/browser-asset-i18n.walk.mjs。

import { afterAll, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { zhCN } from '../../i18n/resources'
import { BROWSER_PROMPT_EXTRACTION_MODE_LABEL_KEYS } from './prompt/browserPromptExtraction'

const HAN = /[一-鿿]/

/** 本次从写死中文接回 i18n 的全部键。漏掉任何一个都会让它悄悄退回硬编码。 */
const WIRED_KEYS = [
  'browserAssets.renameBookmark',
  'browserAssets.promptEntryFailed',
  'browserAssets.promptImageMissing',
  'browserAssets.promptModelEmpty',
  'browserAssets.promptModelInvalid',
  'browserAssets.promptReferenceMissing',
  'browserAssets.promptVisionModelMissing',
  'browserAssets.screenshotFailed',
  'browserAssets.screenshotUnsupported',
  'browserAssets.selectedPrompt',
  'browserAssets.selectedStyle',
  'browserAssets.sourceSessionExpired',
  'browserAssets.webImage',
  'browserAssets.webVideo',
  'browserAssets.extraction.replicate',
  'browserAssets.extraction.style',
  // 从 runtime.browser.* 归位过来的
  'browserAssets.webCapture',
  'browserAssets.webDrop',
  'browserAssets.projectImage',
  'browserAssets.projectVideo',
  'browserAssets.hoverBeforeCapture',
  'browserAssets.captureFailed',
  'browserAssets.localImport',
  'browserAssets.webExtraction',
] as const

afterAll(async () => {
  await i18n.changeLanguage('zh-CN') // 别把语言状态漏给同进程里的其它用例
})

describe('浏览器素材文案走 i18n', () => {
  it('每个键在中文词典里都解析得出译文(不是把 key 原样吐回来)', async () => {
    await i18n.changeLanguage('zh-CN')
    const unresolved = WIRED_KEYS.filter((key) => i18n.t(key) === key)
    expect(unresolved, `这些键在 zh-CN 词典里查不到:\n${unresolved.join('\n')}`).toEqual([])
  })

  it('英文界面下不残留汉字(这正是当年那个 bug)', async () => {
    await i18n.changeLanguage('en')
    const chinese = WIRED_KEYS.map((key) => ({ key, value: i18n.t(key) })).filter(
      (entry) => entry.value === entry.key || HAN.test(entry.value),
    )
    expect(
      chinese,
      `英文侧仍是中文/未解析:\n${chinese.map((e) => `${e.key} = ${e.value}`).join('\n')}`,
    ).toEqual([])
  })

  it('提取模式名只存键、不存写死文案(存文案会把 import 那刻的语言冻死)', async () => {
    for (const value of Object.values(BROWSER_PROMPT_EXTRACTION_MODE_LABEL_KEYS)) {
      expect(value, `${value} 应该是 i18n 键而不是文案`).toMatch(/^browserAssets\./)
      expect(HAN.test(value), `${value} 里不该有汉字`).toBe(false)
    }
    // 同一个常量在两种语言下取出不同文案 = 确实是每次取值才翻译,没有被冻在模块顶层。
    await i18n.changeLanguage('zh-CN')
    const zh = i18n.t(BROWSER_PROMPT_EXTRACTION_MODE_LABEL_KEYS.replicate)
    await i18n.changeLanguage('en')
    const en = i18n.t(BROWSER_PROMPT_EXTRACTION_MODE_LABEL_KEYS.replicate)
    expect(zh).not.toBe(en)
  })

  it('runtime.browser 这棵重复命名空间不许回来(唯一 owner 是 browserAssets)', () => {
    // 它曾与 browserAssets.* 逐字重复且 10 个叶子全无人引用。再出现就是又抄了一份。
    expect((zhCN as { runtime: Record<string, unknown> }).runtime).not.toHaveProperty('browser')
  })
})
