// DesignSearchInput —— 全仓统一搜索框（设计系统 §3.4）：胶囊描边 + 搜索图标 + accent 聚焦环。
// 收口了项目库/提示词库/素材库/拾取器此前各手写一份的重复结构（高度、圆角、占位曾各不一）。
// 宽度由调用方经 className 给（'w-[280px]' 或 'flex-1'），组件自己不定宽。
// 组合取自真实调用点：项目库顶栏、提示词库筛选条、素材拾取器。
import React from 'react'
import { DesignSearchInput } from 'nomi'

/** 受控壳：卡片里也能真的输入，不是死图。 */
function Demo(
  props: Omit<React.ComponentProps<typeof DesignSearchInput>, 'value' | 'onChange'> & { initial?: string },
): JSX.Element {
  const { initial = '', ...rest } = props
  const [value, setValue] = React.useState(initial)
  return <DesignSearchInput {...rest} value={value} onChange={setValue} />
}

/** 项目库顶栏：有值的常态（空框只是一条细线，看不出东西）。 */
export const InLibraryHeader = (): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      width: 460,
      padding: 10,
      borderRadius: 'var(--nomi-radius-lg)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <span style={{ font: '600 13px var(--nomi-font-sans)', color: 'var(--nomi-ink)' }}>我的项目</span>
    <Demo initial="海边黄昏" placeholder="搜索项目" className="w-[240px]" />
  </div>
)

/** size 轴：sm（30px，紧凑面板）vs md（36px，宽松页面）。 */
export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
    <Demo size="sm" initial="分镜" placeholder="搜索提示词" className="w-[220px]" />
    <Demo size="md" initial="分镜" placeholder="搜索提示词" className="w-[260px]" />
  </div>
)

/** 空态：只有占位文字时的样子（真实首屏）。 */
export const Placeholder = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
    <Demo placeholder="搜索素材，或粘贴一个链接" className="w-[280px]" />
  </div>
)
