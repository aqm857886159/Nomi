import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const read = (file: string): string => fs.readFileSync(path.join(dir, file), 'utf8')

describe('模型设置颜色职责', () => {
  // D-1117-delete-verification：没有「验证成功」这一档了，「可使用」在每个出口都是同一个绿点；
  // 点色只有 ModelStatusMark 一个出处，设置首页不再自带一张色表。能力与启用态仍用 Nomi accent。
  it('状态点色只有一个出处（可使用 = 成功绿），能力与启用态使用 Nomi accent', () => {
    const home = read('ModelSettingsHome.tsx')
    const mark = read('ModelStatusMark.tsx')
    expect(mark).toContain("success: 'bg-workbench-success'")
    expect(mark).toContain("active: 'bg-nomi-accent'")
    expect(home).not.toContain("verified: 'bg-workbench-success'")
    expect(home).not.toContain("working: 'bg-nomi-accent'")
    expect(read('ModelChipGroups.tsx')).toContain("connected && m.enabled ? 'bg-nomi-accent'")
    expect(read('ModelChipGroups.tsx')).toContain('border-transparent bg-nomi-accent-soft')
    expect(read('CodexLocalImageCard.tsx')).toContain('bg-nomi-accent-soft')
    expect(read('ComfyuiTemplateLibrary.tsx')).toContain('text-micro text-nomi-accent bg-nomi-accent-soft')
    expect(read('ComfyuiPresetSection.tsx')).toContain('text-micro text-nomi-accent bg-nomi-accent-soft')
  })

  it('已连接摘要使用中性表面，只保留小号成功证据', () => {
    const foldable = read('FoldableModelCard.tsx')
    expect(foldable).toContain('bg-nomi-ink-10')
    expect(foldable).toContain("status === 'ok' ? 'bg-workbench-success'")
    expect(foldable).not.toContain('workbench-success-soft')

    const network = read('NetworkSection.tsx')
    expect(network).toContain("pill.ok ? 'bg-workbench-success'")
    expect(network).not.toContain("pill.ok\n              ? 'bg-[var(--workbench-success-soft)]")

    for (const file of ['ConnectAssistantCard.tsx', 'ComfyuiLocalCard.tsx', 'DreaminaMemberCard.tsx']) {
      expect(read(file)).toContain('rounded-nomi-sm bg-nomi-ink-05')
    }
  })

  it('文件就绪结果继续使用 success green（「测试连接」随 D-1117-delete-verification 删了）', () => {
    expect(read('OnboardingWizard.tsx')).not.toContain('testState')
    expect(read('ComfyuiPresetSection.tsx')).toContain('text-workbench-success bg-[var(--workbench-success-soft)]')
    expect(read('ComfyuiPresetSection.tsx')).toContain('text-workbench-success shrink-0')
  })
})
