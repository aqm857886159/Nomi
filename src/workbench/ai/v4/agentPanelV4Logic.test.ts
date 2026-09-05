// composer 高度 / 权限映射 / Enter 语义的单测。
//
// 这三条在定稿 Composer 板里是**表**，不是「看起来差不多」——所以它们该被断言，不是被截图。
// 截图只能证明「今天这一格长这样」；断言证明的是「面板换个高度时规则仍然成立」。
import { describe, expect, it } from 'vitest'
import {
  COMPOSER_SIX_LINE_CAP,
  approvalPolicyForTier,
  composerHeight,
  escalatePermission,
  maxComposerHeight,
  shouldSubmitComposer,
} from './agentPanelV4Logic'
import { DEFAULT_PERMISSION_TIER, PERMISSION_TIERS } from './agentPanelV4Types'
import { DEFAULT_PROJECT_AGENT_APPROVAL_POLICY } from '../../../../electron/shared/projectAgentContracts'

describe('composer 高度随面板高度 derive', () => {
  it('上限按定稿的三档走，不写死行数', () => {
    expect(maxComposerHeight(900, 'idle')).toBe(360) // ≥800 → 40%
    expect(maxComposerHeight(800, 'idle')).toBe(320)
    expect(maxComposerHeight(700, 'idle')).toBe(210) // 640–800 → 30%
    expect(maxComposerHeight(640, 'idle')).toBe(192)
    expect(maxComposerHeight(620, 'idle')).toBe(COMPOSER_SIX_LINE_CAP) // <640 → 6 行
  })

  it('收起坞永远 6 行——它压在画面上，不能盖住预览', () => {
    expect(maxComposerHeight(1200, 'dock')).toBe(COMPOSER_SIX_LINE_CAP)
    expect(maxComposerHeight(360, 'dock')).toBe(COMPOSER_SIX_LINE_CAP)
  })

  it('初始一行 ≈ 84px（定稿标注），逐行长高', () => {
    const one = composerHeight(620, 'idle', 1)
    expect(one).toBe(86)
    expect(composerHeight(620, 'idle', 2)).toBeGreaterThan(one)
    expect(composerHeight(620, 'idle', 4)).toBe(composerHeight(620, 'idle', 3) + 20)
  })

  it('封顶后不再长——textarea 转内部滚动', () => {
    const capped = composerHeight(620, 'idle', 40)
    expect(capped).toBe(COMPOSER_SIX_LINE_CAP)
    expect(composerHeight(620, 'idle', 400)).toBe(capped)
    // 面板更高时同一段文本能长得更高，说明上限确实随面板 derive 而不是常量。
    expect(composerHeight(900, 'idle', 40)).toBeGreaterThan(capped)
  })

  it('附件 chip 行占额外一行高，但不吃掉 textarea 的最小高', () => {
    expect(composerHeight(900, 'idle', 1, 1)).toBe(composerHeight(900, 'idle', 1, 0) + 32)
  })
})

describe('权限三档映射仓库合同', () => {
  it('三档 = approvalPolicy 的三种组合，不新造词', () => {
    expect(approvalPolicyForTier('step')).toEqual({ mode: 'step', spend: 'confirm' })
    expect(approvalPolicyForTier('safe-auto')).toEqual({ mode: 'safe-auto', spend: 'confirm' })
    expect(approvalPolicyForTier('project')).toEqual({ mode: 'project', spend: 'within-budget' })
  })

  it('每一档的 mode 就是它自己——档位不是第二份词表', () => {
    for (const tier of PERMISSION_TIERS) expect(approvalPolicyForTier(tier).mode).toBe(tier)
  })

  it('默认档与合同默认值一致（定稿：默认「自动改」）', () => {
    expect(approvalPolicyForTier(DEFAULT_PERMISSION_TIER)).toEqual({
      mode: DEFAULT_PROJECT_AGENT_APPROVAL_POLICY.mode,
      spend: DEFAULT_PROJECT_AGENT_APPROVAL_POLICY.spend,
    })
  })

  it('「不再问 →」抬一档，到顶不再动', () => {
    expect(escalatePermission('step')).toBe('safe-auto')
    expect(escalatePermission('safe-auto')).toBe('project')
    expect(escalatePermission('project')).toBe('project')
  })
})

describe('Enter 语义', () => {
  it('Enter 发送 · Shift+Enter 换行 · IME composition 期间不发送', () => {
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
    // 这一条是真坑：不判 isComposing 的话，中文选字时按 Enter 会把半截拼音发出去。
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
    expect(shouldSubmitComposer({ key: 'a', shiftKey: false, isComposing: false })).toBe(false)
  })
})
