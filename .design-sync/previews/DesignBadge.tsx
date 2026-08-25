// DesignBadge —— 通用徽标（Mantine Badge 的 Nomi 封装，radius 默认 sm、variant 默认 light）。
// 与 StatusBadge 的分工：**表示状态用 StatusBadge**（它把颜色收进语义 tone）；
// DesignBadge 用于非状态的标注——计数、标签、能力名、价签。
// 仓库内目前尚无调用点，这里按 Nomi 真实需要的标注场景组合。
import { DesignBadge } from 'nomi'

/** 真实标注：模型能力标签 + 价签 + 计数。 */
export const AsLabels = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <DesignBadge>文生图</DesignBadge>
    <DesignBadge>图生视频</DesignBadge>
    <DesignBadge color="gray">本地</DesignBadge>
    <DesignBadge color="blue">¥0.28 / 张</DesignBadge>
    <DesignBadge circle>6</DesignBadge>
  </div>
)

/** variant 轴。 */
export const Variants = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <DesignBadge variant="light">light</DesignBadge>
    <DesignBadge variant="filled">filled</DesignBadge>
    <DesignBadge variant="outline">outline</DesignBadge>
    <DesignBadge variant="dot">dot</DesignBadge>
    <DesignBadge variant="transparent">transparent</DesignBadge>
  </div>
)

/** size 轴：xs 用于卡片角标，md 用于独立标签。 */
export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <DesignBadge size="xs">xs</DesignBadge>
    <DesignBadge size="sm">sm</DesignBadge>
    <DesignBadge size="md">md</DesignBadge>
    <DesignBadge size="lg">lg</DesignBadge>
  </div>
)

/** 真实用法：素材卡右上角的类型角标。 */
export const OnCard = (): JSX.Element => (
  <div
    style={{
      position: 'relative',
      width: 200,
      height: 112,
      borderRadius: 'var(--nomi-radius-sm)',
      border: '1px solid var(--nomi-line)',
      background: 'linear-gradient(135deg, var(--nomi-ink-10), var(--nomi-ink-05))',
    }}
  >
    <div style={{ position: 'absolute', top: 8, right: 8 }}>
      <DesignBadge size="xs" variant="filled" color="dark">MP4 · 5s</DesignBadge>
    </div>
  </div>
)
