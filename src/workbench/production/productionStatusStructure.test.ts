import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 制作任务的家 = 任务中心（plan 2026-08-11-nomi-side-viewer-and-fallback）。
// 这些断言锁的是「归位」本身：两套操作不许再挤回助手面板，以及卡内的结构不变量。
const card = fs.readFileSync(path.join(process.cwd(), 'src/workbench/production/ProductionRunTaskCard.tsx'), 'utf8')
const assistant = fs.readFileSync(path.join(process.cwd(), 'src/workbench/ai/ProjectAgentResidentShell.tsx'), 'utf8')
const taskCenter = fs.readFileSync(path.join(process.cwd(), 'src/workbench/taskCenter/TaskCenterPanel.tsx'), 'utf8')

describe('production run task card structure', () => {
  it('one status, one preview, one details disclosure', () => {
    expect((card.match(/data-production-status-title/g) ?? []).length).toBe(1)
    expect((card.match(/data-production-preview(?![-\w])/g) ?? []).length).toBe(1)
    expect(card).toContain('<ProductionDetails')
    expect(card).toContain('data-production-focused-artifact')
  })

  it('主动作与兜底键互斥：指路态走次级键，非指路态走主按钮（同一时刻只有一个）', () => {
    expect((card.match(/data-production-primary-action/g) ?? []).length).toBe(2)
    expect(card).toContain('const routedGate = Boolean(view.gateKind && view.decisionHome === \'origin\')')
    expect(card).toContain('{routedGate ? (')
    expect(card).toContain('{!routedGate && action ? (')
  })

  it('N4：不造假进度、无产物不渲染预览、加载动画用品牌标、取消不与暂停等权', () => {
    expect(card).toContain("typeof view.percent === 'number'")
    expect(card).not.toContain('?? 0')
    // 无产物不出空框（旧实现用 220px 空 figure + 三处「没有产物」文案）
    expect(card).toContain('{previewUrl || videoUrl ? (')
    // §3.9.1 全仓唯一加载动画
    expect(card).toContain('<NomiLoadingMark')
    expect(card).not.toContain('IconLoader2')
    // 取消 = 弱化文字键（不是与暂停等宽的按钮）
    expect(card).toContain('hover:text-workbench-danger')
  })

  it('归位：助手面板不再挂制作任务；任务中心才是它的家', () => {
    expect(assistant).not.toContain('ProductionStatusPanel')
    expect(assistant).not.toContain('useProductionStatus')
    expect(taskCenter).toContain('<ProductionRunTaskCard')
    // 面板关着不轮询全量 run（徽标走 TaskCenterButton 自己的 summary 轮询）
    expect(taskCenter).toContain('useProductionStatus({ enabled: opened })')
  })
})
