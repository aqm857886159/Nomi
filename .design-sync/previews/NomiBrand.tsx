// NomiBrand —— 图形标 + 文字标的组合锁（品牌出现的标准形态）。
// markSize / wordSize 分别控制两半；圆角 rx 会跟着 markSize 等比缩放（源码里按 markSize/28*7 算）。
// 要单独用其中一半时用 NomiLogoMark 或 NomiWordmark。
// 组合取自真实调用点：窗口标题栏、启动页、关于弹层。
import { NomiBrand } from 'nomi'

/** 尺寸轴：标题栏用小号，启动页用大号，两半始终等比。 */
export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
    <NomiBrand markSize={20} wordSize={13} />
    <NomiBrand markSize={26} wordSize={17} />
    <NomiBrand markSize={36} wordSize={24} />
  </div>
)

/** 真实用法：应用标题栏左上角。 */
export const InTitleBar = (): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: 460,
      padding: '10px 14px',
      borderRadius: 'var(--nomi-radius-lg)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <NomiBrand markSize={22} wordSize={15} />
    <span style={{ font: '400 11px var(--nomi-font-mono)', color: 'var(--nomi-ink-40)' }}>v0.17.2</span>
  </div>
)

/** 启动页的居中大标。 */
export const OnSplash = (): JSX.Element => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 10,
      width: 420,
      padding: '36px 20px',
      borderRadius: 'var(--nomi-radius-lg)',
      background: 'var(--nomi-bg)',
      border: '1px solid var(--nomi-line-soft)',
    }}
  >
    <NomiBrand markSize={44} wordSize={30} />
    <span style={{ font: '400 12px var(--nomi-font-sans)', color: 'var(--nomi-ink-60)' }}>
      本地优先的 AI 视频创作工作台
    </span>
  </div>
)
