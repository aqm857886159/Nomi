import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import i18n, { DEFAULT_LOCALE } from '../../i18n'
import { CREATION_AI_MODES, defaultCreationAiPrompt, getCreationAiMode, listCreationAiModes } from './creationAiModes'
import { resetSystemPromptOverridesForTest } from './systemPromptOverrides'
import { SYSTEM_PROMPT_MAX_LENGTH } from '../../../electron/settings/systemPromptsContract'

// 英文版系统提示词的语言解析（2026-09-02，见 docs/plan/2026-09-02-english-system-prompts.md）。
//
// 钉三件事，每件都对应一种「看起来没事、实际坏了」：
//  ① 英文界面真的拿到英文正文——否则这次改动等于没做；
//  ② **中文正文逐字节没变**——中文用户的生成行为必须零变化，这是本次最该防的回归
//     （改英文时顺手动了中文，中文用户的画面会跟着变，而没有任何测试会告诉你）；
//  ③ 用户显式写下的覆盖**压过**语言解析——他写的东西不该被系统按语言换掉。

describe('系统提示词的语言解析', () => {
  afterEach(() => {
    resetSystemPromptOverridesForTest()
  })

  describe('中文界面（默认）', () => {
    it('7 个内置模式拿到的正文 === 档案里的中文源值（逐字节）', () => {
      for (const mode of CREATION_AI_MODES) {
        expect(defaultCreationAiPrompt(mode.id), mode.id).toBe(mode.prompt)
        expect(getCreationAiMode(mode.id).prompt, mode.id).toBe(mode.prompt)
      }
    })
  })

  describe('英文界面', () => {
    beforeAll(async () => {
      await i18n.changeLanguage('en')
    })
    afterAll(async () => {
      await i18n.changeLanguage(DEFAULT_LOCALE)
    })

    it('7 个内置模式全部有英文正文（缺一条就说明这个模式还没出英文版）', () => {
      for (const mode of CREATION_AI_MODES) {
        expect(mode.promptEn, `${mode.id} 缺 promptEn`).toBeTruthy()
      }
    })

    it('拿到的是英文正文，不是中文源值', () => {
      for (const mode of CREATION_AI_MODES) {
        expect(defaultCreationAiPrompt(mode.id), mode.id).toBe(mode.promptEn)
        expect(getCreationAiMode(mode.id).prompt, mode.id).toBe(mode.promptEn)
      }
    })

    it('列表出口与单取出口一致（不会一个发英文另一个还发中文）', () => {
      const listed = listCreationAiModes()
      for (const mode of CREATION_AI_MODES) {
        expect(listed.find((item) => item.id === mode.id)?.prompt, mode.id).toBe(mode.promptEn)
      }
    })

    it('英文正文里不残留汉字', () => {
      for (const mode of CREATION_AI_MODES) {
        expect(mode.promptEn ?? '', mode.id).not.toMatch(/[一-鿿]/)
      }
    })

    it('保存上限装得下最长的内置提示词，并留出用户扩写的余量', () => {
      // 本次真踩到的坑：英文版 assets 提示词 33,031 字符，旧上限 32,768——**超 263**。
      // sanitizeSystemPrompt 是直接 slice 的静默截断：英文用户只要动一下这条再保存，
      // 末尾「交付前全面自检」整节就无声消失，之后生成缺自检且极难查因。
      //
      // 判据写成「上限 ≥ 最长内置提示词 × 1.5」而不是某个魔法分数：上限的定法本来就是
      // 「装得下最长的那条 + 留余量给用户扩写」，这里就照它本来的意思断言。
      // 参考：中文版时代是 32768/14343 ≈ 2.3 倍；现在英文版 65536/33031 ≈ 2.0 倍。
      const longest = CREATION_AI_MODES.reduce(
        (max, mode) => Math.max(max, (mode.promptEn ?? '').length, mode.prompt.length),
        0,
      )
      expect(SYSTEM_PROMPT_MAX_LENGTH, `最长内置提示词 ${longest} 字符，上限只剩不到 1.5 倍余量`)
        .toBeGreaterThanOrEqual(Math.ceil(longest * 1.5))
    })

    it('用户覆盖压过语言解析——他写下的正文不被按语言换掉', () => {
      resetSystemPromptOverridesForTest({ overrides: { story: '我自己写的故事提示词' } })
      expect(getCreationAiMode('story').prompt).toBe('我自己写的故事提示词')
      // 没被覆盖的模式仍走英文。
      expect(getCreationAiMode('script').prompt).toBe(CREATION_AI_MODES.find((m) => m.id === 'script')?.promptEn)
    })
  })
})
