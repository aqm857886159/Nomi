// WorkbenchIconButton —— 工作区里的纯图标按钮（32×32 方格，透明底、hover 才起底色）。
// 全仓最常用的工具条元件之一：时间轴播放/静音、片段节点的关闭/导出/拆分、悬浮工具条。
// label 是必填的：它同时喂给 aria-label 和 title，所以图标按钮永远有可读名字。
// 组合取自真实调用点：TimelinePreview 播放条、ClipNode 悬浮动作、素材卡角标。
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconVolume,
  IconVolumeOff,
  IconDownload,
  IconScissors,
  IconX,
  IconPlus,
} from '@tabler/icons-react'
import { WorkbenchIconButton } from 'nomi'

/** 时间轴播放条的真实一排（播放 / 静音 / 拆分 / 导出）。 */
export const TimelineToolbar = (): JSX.Element => (
  <div
    style={{
      display: 'inline-flex',
      gap: 2,
      alignItems: 'center',
      padding: 4,
      borderRadius: 'var(--nomi-radius-sm)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <WorkbenchIconButton label="播放预览" icon={<IconPlayerPlay size={16} />} />
    <WorkbenchIconButton label="暂停预览" icon={<IconPlayerPause size={16} />} />
    <WorkbenchIconButton label="静音" icon={<IconVolume size={16} />} />
    <WorkbenchIconButton label="取消静音" icon={<IconVolumeOff size={16} />} />
    <WorkbenchIconButton label="在这里拆分" icon={<IconScissors size={16} />} />
    <WorkbenchIconButton label="导出这段" icon={<IconDownload size={15} />} />
  </div>
)

/** 禁用态：还没有片段可导出时降到 40% 且不可点。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <WorkbenchIconButton label="导出这段" icon={<IconDownload size={15} />} />
    <WorkbenchIconButton label="导出这段（暂无片段）" icon={<IconDownload size={15} />} disabled />
  </div>
)

/** 调用处用 className 改形/改色是既定用法：素材卡右上角的关闭、左下角的加素材。 */
export const OnMediaOverlay = (): JSX.Element => (
  <div
    style={{
      position: 'relative',
      width: 220,
      height: 124,
      borderRadius: 'var(--nomi-radius-sm)',
      border: '1px solid var(--nomi-line)',
      background:
        'linear-gradient(135deg, var(--nomi-ink-10), var(--nomi-ink-05))',
      overflow: 'hidden',
    }}
  >
    <WorkbenchIconButton
      label="关闭预览"
      icon={<IconX size={16} />}
      className="absolute right-2 top-2 bg-nomi-paper/85 text-nomi-ink hover:bg-nomi-paper"
    />
    <WorkbenchIconButton
      label="添加素材"
      icon={<IconPlus size={20} />}
      className="absolute bottom-2 left-2 size-10 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink"
    />
  </div>
)
