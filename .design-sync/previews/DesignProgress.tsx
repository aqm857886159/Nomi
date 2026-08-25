// DesignProgress —— 进度条（Mantine Progress 的 Nomi 封装，radius 默认 sm）。
// 用于**有明确百分比**的等待（导出编码、批量生成）；进度未知的等待用 NomiLoadingMark。
// 组合取自真实调用点：导出面板的编码进度、批量生成的整体进度。
import { DesignProgress } from 'nomi'

/** 真实用法：导出面板的编码进度 + 一行说明。 */
export const ExportProgress = (): JSX.Element => (
  <div
    style={{
      width: 400,
      padding: 14,
      borderRadius: 'var(--nomi-radius-lg)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ font: '500 13px var(--nomi-font-sans)', color: 'var(--nomi-ink)' }}>正在导出 MP4</span>
      <span style={{ font: '400 12px var(--nomi-font-mono)', color: 'var(--nomi-ink-60)' }}>68%</span>
    </div>
    <DesignProgress value={68} />
    <div style={{ marginTop: 8, font: '400 12px var(--nomi-font-sans)', color: 'var(--nomi-ink-60)' }}>
      第 5 / 6 镜 · 预计还要 40 秒
    </div>
  </div>
)

/** 进度轴 + 语义色：不同完成度和状态。 */
export const ValuesAndColors = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 380 }}>
    <DesignProgress value={12} />
    <DesignProgress value={45} color="blue" />
    <DesignProgress value={78} color="yellow" />
    <DesignProgress value={100} color="green" />
    <DesignProgress value={34} color="red" />
  </div>
)

/** size 轴 + 条纹动画（长任务里表示「还在动」）。 */
export const SizesAndStriped = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 380 }}>
    <DesignProgress value={60} size="xs" />
    <DesignProgress value={60} size="sm" />
    <DesignProgress value={60} size="md" />
    <DesignProgress value={60} size="lg" striped animated />
  </div>
)
