// WorkbenchButton — 工作区原生按钮（密集、紧凑），canvas / timeline / 节点上用。
// 组合取自真实调用点：更新提示（AboutNomiPopover「稍后 / 下载更新」）、
// 确认卡页脚（confirmDialog.tsx「取消 / 确认」）、时间线卡片紧凑动作。
import { WorkbenchButton } from 'nomi'

export const Variants = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <WorkbenchButton variant="default">稍后</WorkbenchButton>
    <WorkbenchButton variant="primary">下载更新</WorkbenchButton>
    <WorkbenchButton variant="accent">让 AI 修一下</WorkbenchButton>
  </div>
)

export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <WorkbenchButton size="md" variant="primary">确认生成</WorkbenchButton>
    <WorkbenchButton size="sm" variant="default">撤销这次改动</WorkbenchButton>
  </div>
)

export const States = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <WorkbenchButton variant="primary" loading>正在生成</WorkbenchButton>
    <WorkbenchButton variant="default" disabled>整笔撤销</WorkbenchButton>
  </div>
)

// 真实页脚组合：确认卡右下角「取消 / 确认」成对出现（confirmDialog.tsx）。
export const DialogFooter = (): JSX.Element => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      width: 360,
      padding: 12,
      borderRadius: 'var(--nomi-radius-lg)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <WorkbenchButton variant="default">取消</WorkbenchButton>
    <WorkbenchButton variant="primary">删除这个项目</WorkbenchButton>
  </div>
)
