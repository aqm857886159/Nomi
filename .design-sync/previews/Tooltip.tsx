// Tooltip —— 提示气泡的根（= Radix Tooltip.Root 的再导出）。
// 它自己不渲染任何东西，只提供开合状态；真正看得见的是 TooltipContent。
//
// 四件套的分工：
//   TooltipProvider  —— App 级挂一次，管全局延迟/跳过延迟
//   Tooltip (Root)   —— 一个提示的开合状态容器（就是这个组件）
//   TooltipTrigger   —— 触发元素（用 asChild 把行为挂到你自己的按钮上）
//   TooltipContent   —— 看得见的气泡（Nomi 皮肤在这层）
//
// 卡里用受控 open 常开，因为 hover 态截图截不到。
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent, WorkbenchIconButton } from 'nomi'
import { IconPlayerPlay, IconVolume, IconScissors } from '@tabler/icons-react'

/** 真实用法：工具条上每个图标按钮各带一个 Tooltip（这是它在 Nomi 里最常见的形态）。 */
export const ToolbarWithTooltips = (): JSX.Element => (
  <TooltipProvider>
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 52 }}>
      <div
        style={{
          display: 'inline-flex',
          gap: 2,
          padding: 4,
          borderRadius: 'var(--nomi-radius-sm)',
          border: '1px solid var(--nomi-line)',
          background: 'var(--nomi-paper)',
        }}
      >
        <Tooltip open>
          <TooltipTrigger asChild>
            <WorkbenchIconButton label="播放预览" icon={<IconPlayerPlay size={16} />} />
          </TooltipTrigger>
          <TooltipContent side="top">播放预览</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkbenchIconButton label="静音" icon={<IconVolume size={16} />} />
          </TooltipTrigger>
          <TooltipContent side="top">静音</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkbenchIconButton label="在这里拆分" icon={<IconScissors size={16} />} />
          </TooltipTrigger>
          <TooltipContent side="top">在这里拆分</TooltipContent>
        </Tooltip>
      </div>
    </div>
  </TooltipProvider>
)
