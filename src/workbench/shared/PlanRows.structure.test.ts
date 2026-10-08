import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 先剥整行 `//` 再剥块注释：行注释里写着 `/**加粗**` 时，反过来会从那里一路吞到下一个 `*/`，把 import 一起吃掉。
const stripComments = (text: string): string => text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const source = (path: string): string => stripComments(readFileSync(resolve(process.cwd(), path), 'utf8'))

describe('PlanRows is the single plan-list renderer', () => {
  it('keeps Agent panel and paid confirmation on the shared component', () => {
    const agent = source('src/workbench/ai/v4/AgentPanelV4Cards.tsx')
    const spend = source('src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx')
    expect(agent).toContain("import { PlanRows } from '../../shared/PlanRows'")
    expect(agent).toMatch(/<PlanRows\s+rows=\{data\.plan\}/)
    expect(agent).not.toContain('data.plan.map(')
    expect(spend).toContain("import { PlanRows } from '../../shared/PlanRows'")
    expect(spend).toContain('<PlanRows rows={pending.planRows}')
  })
})
