// StatusBadge —— 状态徽标。相对 DesignBadge 的区别：它把颜色收进语义化的 tone
// （neutral/info/success/warning/danger → gray/blue/green/yellow/red），
// 调用处只说「这是什么状态」，不说「用什么颜色」。表示状态一律用它。
// 组合取自真实调用点：任务行的运行状态、模型接入状态。
import { StatusBadge } from 'nomi'

/** 主变体轴：五个 tone。这是它存在的理由，必须一眼看出区别。 */
export const Tones = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <StatusBadge tone="neutral">未开始</StatusBadge>
    <StatusBadge tone="info">排队中</StatusBadge>
    <StatusBadge tone="success">已完成</StatusBadge>
    <StatusBadge tone="warning">需要确认</StatusBadge>
    <StatusBadge tone="danger">已失败</StatusBadge>
  </div>
)

/** variant 轴：light（默认）/ filled / outline / dot。 */
export const Variants = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <StatusBadge tone="success" variant="light">已完成</StatusBadge>
    <StatusBadge tone="success" variant="filled">已完成</StatusBadge>
    <StatusBadge tone="success" variant="outline">已完成</StatusBadge>
    <StatusBadge tone="success" variant="dot">已完成</StatusBadge>
  </div>
)

/** 真实用法：任务列表每行右侧的状态。 */
export const InTaskList = (): JSX.Element => (
  <div
    style={{
      width: 400,
      borderRadius: 'var(--nomi-radius-lg)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
      overflow: 'hidden',
    }}
  >
    {[
      { name: '第 1 镜 · 海边远景', tone: 'success' as const, label: '已完成' },
      { name: '第 2 镜 · 推近侧脸', tone: 'info' as const, label: '生成中' },
      { name: '第 3 镜 · 礁石特写', tone: 'neutral' as const, label: '排队中' },
      { name: '第 4 镜 · 逆光剪影', tone: 'danger' as const, label: '已失败' },
    ].map((row, i) => (
      <div
        key={row.name}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '9px 12px',
          borderTop: i === 0 ? 'none' : '1px solid var(--nomi-line-soft)',
        }}
      >
        <span style={{ font: '400 13px var(--nomi-font-sans)', color: 'var(--nomi-ink)' }}>{row.name}</span>
        <StatusBadge tone={row.tone}>{row.label}</StatusBadge>
      </div>
    ))}
  </div>
)
