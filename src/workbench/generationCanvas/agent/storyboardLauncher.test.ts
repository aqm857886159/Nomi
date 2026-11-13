import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { STORYBOARD_PLANNER_SKILL, buildStoryboardPlanningMessage, storyboardLaunchMessage } from './storyboardLauncher'

describe('storyboard planner language', () => {
  it.each(['日落前的一分钟', 'One Minute Before Sunset'])('preserves the supplied title %s without forcing English', (title) => {
    const prompt = buildStoryboardPlanningMessage({ storyText: `# ${title}`, shotMode: 'video' })
    expect(prompt).toContain(`# ${title}`)
    expect(prompt).toContain('保持原文')
    expect(prompt).not.toContain('produce the entire storyboard plan in English')
  })
})

describe('用户亲手点「拆成镜头」交给 Agent 的那一条', () => {
  const SENTENCE = '雨夜的街头，女孩撑着红伞穿过霓虹闪烁的夜市。'

  it('挂分镜规划技能（不是一句光秃秃的文字），气泡显示选中的那句，方案照常打开', () => {
    const { text, options } = storyboardLaunchMessage('把这段拆成镜头', SENTENCE)
    expect(options.skillKey).toBe(STORYBOARD_PLANNER_SKILL.key)
    expect(options.displayText).toBe(SENTENCE)
    expect(options.openStoryboardResult).toBe(true)
    expect(text).toBe(`把这段拆成镜头\n\n${SENTENCE}`)
  })

  it('「拆成镜头」这条消息只在启动器一处拼：别处不许再自己写 openStoryboardResult / 分镜技能 key（外壳只调 storyboardLaunchMessage）', () => {
    const srcRoot = path.resolve(__dirname, '../../..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue
        if (full.endsWith(path.join('generationCanvas', 'agent', 'storyboardLauncher.ts'))) continue
        const source = fs.readFileSync(full, 'utf8')
        if (/openStoryboardResult:\s*true/.test(source) || source.includes(`'${STORYBOARD_PLANNER_SKILL.key}'`)) offenders.push(path.relative(srcRoot, full))
      }
    }
    walk(srcRoot)
    expect(offenders).toEqual([])
    const shell = fs.readFileSync(path.join(srcRoot, 'workbench/ai/ProjectAgentResidentShell.tsx'), 'utf8')
    expect(shell).toContain('storyboardLaunchMessage(')
    expect(shell).not.toMatch(/skillKey\s*:/)
  })

  it('没有选中文字（从别处点拆分镜）：照样挂技能，不带 displayText', () => {
    const { text, options } = storyboardLaunchMessage('把这段拆成镜头')
    expect(options.skillKey).toBe(STORYBOARD_PLANNER_SKILL.key)
    expect(options).not.toHaveProperty('displayText')
    expect(text).toBe('把这段拆成镜头')
  })
})
