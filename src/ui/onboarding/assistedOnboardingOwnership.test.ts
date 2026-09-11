import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「用 AI 帮我接入」这张卡的**边界**——它和「AI 助手连接（MCP）」是两件事、两个家：
 *   · 把 Nomi 接进助手（写各家 MCP 配置）→ 自动化与权限 → AI 助手连接（ConnectAssistantCard）
 *   · 让助手替你接模型（给提示词 + 技能文件）→ 设置「模型」页顶部这张卡
 * 门在这里：新卡不许长出第二颗「一键接入 / 撤销接入」，旧页只留一条指路、不留第二份指引（P1）。
 */
const read = (relativePath: string): string => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('assisted onboarding entry ownership', () => {
  it('lives at the top of the models page, above the connection lists', () => {
    const home = read('src/ui/onboarding/ModelSettingsHome.tsx')
    expect(home).toContain("import { AiAssistedOnboardingSection } from './AiAssistedOnboardingSection'")
    expect(home).toContain('data-model-home-assisted')
    // 顺序要在**渲染那一段**里判：区块变量都在文件上半段定义，源码顺序不是屏上顺序。
    const rendered = home.slice(home.indexOf('data-model-settings-page="home"'))
    expect(rendered.indexOf('data-model-home-assisted')).toBeGreaterThan(-1)
    expect(rendered.indexOf('data-model-home-assisted')).toBeLessThan(rendered.indexOf('{connectedSection}'))
    expect(rendered.indexOf('data-model-home-assisted')).toBeLessThan(rendered.indexOf('{adaptedSection}'))
  })

  it('never grows a second one-click MCP connect action', () => {
    for (const file of [
      'src/ui/onboarding/AiAssistedOnboardingCard.tsx',
      'src/ui/onboarding/AiAssistedOnboardingSection.tsx',
    ]) {
      const source = read(file)
      expect(source, file).not.toContain('installMcp')
      expect(source, file).not.toContain('uninstallMcp')
      expect(source, file).not.toContain('verifyMcp')
    }
  })

  // 卡是给设计实验室用真实 props 陈列的，所以它一行桥都不许读——桥住在容器里。
  it('keeps the card bridge-free so the design lab can render the real component', () => {
    const card = read('src/ui/onboarding/AiAssistedOnboardingCard.tsx')
    expect(card).not.toContain('getDesktopBridge')
    expect(card).not.toContain('localStorage')
    expect(read('src/ui/onboarding/AiAssistedOnboardingSection.tsx')).toContain('getDesktopBridge')
  })

  it('leaves exactly one pointer on the old second-level page and no duplicated guide', () => {
    const card = read('src/ui/onboarding/ConnectAssistantCard.tsx')
    expect(card.match(/data-assistant-add-model-pointer/g) ?? []).toHaveLength(1)
    expect(card).toContain("detail: { tab: 'models' }")
    // 指引正文（提示词 / 技能文件）只有一份，住在模型页那张卡的内容模块里。
    expect(card).not.toContain('nomi-add-model')
    expect(card).not.toContain('SKILL.md')
  })

  // 宿主显示名只有一个 owner：两张卡念同一份，否则同一个宿主在两屏上会叫不同的名字。
  it('shares one owner for assistant display names', () => {
    const state = read('src/ui/onboarding/assistantActivationState.ts')
    expect(state).toContain('export const ASSISTANT_CLIENT_LABEL')
    for (const file of ['src/ui/onboarding/ConnectAssistantCard.tsx', 'src/ui/onboarding/AiAssistedOnboardingCard.tsx']) {
      expect(read(file), file).toContain('ASSISTANT_CLIENT_LABEL')
      expect(read(file), file).not.toContain("'Claude Code'")
    }
  })

  // 进度是投影不是状态机：卡与容器都不许自己定义一套阶段词。
  it('projects the real integration stages instead of inventing a state machine', () => {
    const projection = read('src/ui/onboarding/assistedProgressProjection.ts')
    expect(projection).toContain("from '../../../electron/shared/integrationContract'")
    expect(read('src/ui/onboarding/AssistedIntegrationProgress.tsx')).not.toContain('useState')
  })
})
