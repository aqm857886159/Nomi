// ActionCard —— 起始页主入口动作卡片（设计系统 §3.2），280×88。
// 比按钮大一个量级，用尺寸/形态/位置三重区隔承载**页面级**主操作；一页至多一张 primary。
// 组合取自真实调用点：项目库起始页（新建空白项目 / 打开文件夹 / 看 60 秒演示）。
import { IconPlus, IconFolderOpen, IconPlayerPlay } from '@tabler/icons-react'
import { ActionCard } from 'nomi'

/** 项目库起始页的真实三连：一张 primary 领头，其余 default 并列。 */
export const LibraryEntry = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    <ActionCard
      variant="primary"
      icon={<IconPlus size={18} stroke={1.8} />}
      title="新建空白项目"
      description="从一段文字或想法开始"
    />
    <ActionCard
      icon={<IconFolderOpen size={18} stroke={1.6} />}
      title="打开素材文件夹"
      description="把素材文件夹变成项目"
    />
  </div>
)

/** 变体轴：primary（深底反白）vs default（纸底描边）。一页只允许一张 primary。 */
export const Variants = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    <ActionCard
      variant="primary"
      icon={<IconPlus size={18} stroke={1.8} />}
      title="新建空白项目"
      description="从一段文字或想法开始"
    />
    <ActionCard
      variant="default"
      icon={<IconPlayerPlay size={18} stroke={1.6} />}
      title="看 Nomi 怎么做"
      description="60 秒预览，从一句话到成片"
    />
  </div>
)

/** 禁用态：没有可打开的目录时整张卡降到 50% 且不可点。 */
export const Disabled = (): JSX.Element => (
  <ActionCard
    disabled
    icon={<IconFolderOpen size={18} stroke={1.6} />}
    title="打开素材文件夹"
    description="把素材文件夹变成项目"
  />
)
