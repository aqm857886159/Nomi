// TooltipProvider —— 提示气泡的全局 provider（= Radix Tooltip.Provider 的再导出）。
// **App 根部挂一次**，管的是全局行为：delayDuration（悬停多久才弹）、
// skipDelayDuration（刚看过一个提示后，再看下一个可以立刻弹）。
//
// 它自己不渲染任何可见内容——所以这张卡展示的是「它管的那件事」：
// 同一组按钮在不同 delayDuration 下的行为差别，用常开的气泡把结构画出来。
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent, WorkbenchIconButton } from 'nomi'
import { IconPlayerPlay, IconScissors } from '@tabler/icons-react'

/** 默认延迟：provider 包住一整片区域，里面所有 Tooltip 共用这套时序。 */
export const WrapsATree = (): JSX.Element => (
  <TooltipProvider delayDuration={300} skipDelayDuration={300}>
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
            <WorkbenchIconButton label="在这里拆分" icon={<IconScissors size={16} />} />
          </TooltipTrigger>
          <TooltipContent side="top">在这里拆分</TooltipContent>
        </Tooltip>
      </div>
    </div>
  </TooltipProvider>
)
