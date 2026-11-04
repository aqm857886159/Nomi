import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { projectDeleteChoice } from './projectDeleteChoice'

// 删除确认框的文案与交给主进程的意图出自同一个判断（V-plibrary2 T1：意图一处被改成一律 delete-files 时测试全绿）。
describe('删除确认：卡片状态 → 文案 + 意图', () => {
  it.each([
    ['打开文件夹绑定的项目', { source: 'folder' }],
    ['本地项目但数据越界（灰卡）', { source: 'native', unreadableReason: 'outside-workspace' }],
    ['本地项目但读不出（灰卡）', { source: 'native', unreadableReason: 'unreadable' }],
    ['外部文件夹且读不出', { source: 'folder', unreadableReason: 'unreadable' }],
    ['本地项目但文件夹找不到', { source: 'native', missing: true }],
    ['老项目（没有来源字段）且文件夹找不到', { missing: true }],
    ['外部文件夹且文件夹找不到', { source: 'folder', missing: true }],
  ])('%s：说「从项目库移除」，意图只解绑', (_label, project) => {
    expect(projectDeleteChoice(project)).toEqual({
      intent: 'unbind',
      titleKey: 'studio.removeProjectTitle',
      messageKey: 'studio.removeProjectMessage',
      confirmLabelKey: 'studio.removeProject',
    })
  })

  it.each([
    ['本地项目', { source: 'native' }],
    ['本地项目，文件夹在', { source: 'native', missing: false }],
    ['老项目（没有来源字段）', {}],
  ])('%s：说「删除」，意图删文件', (_label, project) => {
    expect(projectDeleteChoice(project)).toEqual({
      intent: 'delete-files',
      titleKey: 'studio.deleteProjectTitle',
      messageKey: 'studio.deleteProjectMessage',
      confirmLabelKey: 'common.delete',
    })
  })

  it('文案和意图永远同向：说「移除」的一定只解绑，说「删除」的一定删文件', () => {
    const states = [{}, { source: 'native' }, { source: 'folder' }, { source: 'native', unreadableReason: 'unreadable' }, { source: 'folder', unreadableReason: 'outside-workspace' }, { source: 'native', missing: true }, { missing: true }]
    for (const state of states) {
      const choice = projectDeleteChoice(state)
      expect(choice.intent === 'unbind').toBe(choice.messageKey === 'studio.removeProjectMessage')
    }
  })

  // 调用点不许自己再算一遍意图：确认框和删除调用都只从 projectDeleteChoice 取（否则又是两处各算各的）。
  // 删除流程在 projectDeleteFlow.ts（行为测试见 projectDeleteFlow.test.ts），NomiStudioApp 只注入依赖。
  it('项目库删除入口只用 projectDeleteChoice 的意图，不在调用点写死', () => {
    const flow = readFileSync(resolve(process.cwd(), 'src/workbench/library/projectDeleteFlow.ts'), 'utf8')
    const app = readFileSync(resolve(process.cwd(), 'src/workbench/NomiStudioApp.tsx'), 'utf8')
    expect(flow).toContain('deps.deleteLocalProject(project.id, choice.intent)')
    expect(app).toContain('runProjectDeleteFlow(project, {')
    for (const source of [flow, app]) expect(source).not.toMatch(/deleteLocalProject\([^)]*'(unbind|delete-files)'/)
  })
})
