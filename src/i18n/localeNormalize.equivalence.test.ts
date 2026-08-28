import { describe, expect, it } from 'vitest'
import { normalizeSystemLocale } from './index'
import { normalizeDesktopLocale } from '../../electron/desktopLocale'

// 反漂移守恒：locale 归一有两份实现——渲染层 `normalizeSystemLocale`（决定界面语言）与主进程
// `normalizeDesktopLocale`（决定 Agent 提示词、MCP 结果文案的语言）。electron 反向 import 不了 src，
// 故沿用本仓既定的「重复 + 等价测试守恒」模式（同 shotVerify.equivalence / nodeKindDomain.equivalence）。
//
// 为什么必须钉死（2026-08-28 用户在土耳其语 Windows 上实测）：两侧曾是**互为反面**的判据——
// 渲染层「非 zh → en」，主进程「非 en → zh-CN」。于是 tr-TR / de-DE 这类系统上，界面是英文而主进程
// 以为是中文，Agent 收到「用中文回复」的指令，回答中英混杂。任一侧再改判据、另一侧没跟 → 立刻红。

const OS_LOCALES = [
  // 中文家族：两侧都必须判成中文
  'zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant-HK', 'ZH-cn',
  // 英文家族
  'en', 'en-US', 'en-GB', 'EN-us',
  // 既不是中文也不是英文——正是出事的那一类，两侧都必须判成英文
  'tr-TR', 'de-DE', 'fr-FR', 'ja-JP', 'ko-KR', 'es-ES', 'ru-RU', 'ar-SA', 'pt-BR',
  // 形状怪但非空的串
  'garbage-locale', 'x', 'zzz',
]

describe('locale 归一：渲染层与主进程逐项一致', () => {
  it('每个 OS locale 串在两侧得到同一个结果', () => {
    for (const raw of OS_LOCALES) {
      expect(normalizeSystemLocale(raw), `mismatch for ${raw}`).toBe(normalizeDesktopLocale(raw))
    }
  })

  it('中文系统留中文', () => {
    for (const raw of ['zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'ZH-cn']) {
      expect(normalizeSystemLocale(raw)).toBe('zh-CN')
      expect(normalizeDesktopLocale(raw)).toBe('zh-CN')
    }
  })

  // 这就是这次修的病：非中文非英文的系统必须落英文,不能落中文。
  it('既非中文也非英文的系统落英文，不落中文', () => {
    for (const raw of ['tr-TR', 'de-DE', 'fr-FR', 'ja-JP', 'ko-KR', 'ru-RU']) {
      expect(normalizeSystemLocale(raw), `renderer ${raw}`).toBe('en')
      expect(normalizeDesktopLocale(raw), `main ${raw}`).toBe('en')
    }
  })

  // 「没有信号」与「有信号但不是中文」是两回事:前者回落 App 默认(zh-CN),后者才是英文。
  // 渲染层对无信号返回 null 并由调用方回落 DEFAULT_LOCALE,故这条只考主进程。
  it('读不到 locale → 回落 App 默认 zh-CN（不强行英文）', () => {
    for (const bad of [undefined, null, '', '   ', 42, {}]) {
      expect(normalizeDesktopLocale(bad)).toBe('zh-CN')
    }
  })
})
