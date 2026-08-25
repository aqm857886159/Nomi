// TooltipContent —— 提示气泡的内容层（Radix Tooltip.Content 的 Nomi 皮肤：
// ink 底 + paper 字 + caption 字号 + 圆角 + 阴影 + 不换行）。
//
// 它**不能单独渲染**：Radix 要求 Content 必须在 Tooltip(Root) 里、且 Root 在 TooltipProvider 里，
// 内容还要经 Portal 挂到 body。所以这张卡写的是**完整四件套组合**——那也是它唯一为真的渲染形态。
//
// 静态卡里让气泡可见的办法：给 Root 传 open（受控常开），而不是靠 hover（截图截不到 hover）。
// 卡配了 cardMode:"single" + viewport 520x260，让 portal 出来的浮层留在卡里。
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent, WorkbenchIconButton } from 'nomi'
import { IconScissors, IconDownload } from '@tabler/icons-react'

/** 完整四件套：Provider → Root(open) → Trigger → Content。 */
export const OnIconButton = (): JSX.Element => (
  <TooltipProvider>
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 56 }}>
      <Tooltip open>
        <TooltipTrigger asChild>
          <WorkbenchIconButton label="在这里拆分" icon={<IconScissors size={16} />} />
        </TooltipTrigger>
        <TooltipContent side="top">在这里拆分</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
)

/** side 轴：气泡可以挂在触发器的四个方向。 */
export const Sides = (): JSX.Element => (
  <TooltipProvider>
    <div style={{ display: 'flex', gap: 64, justifyContent: 'center', alignItems: 'center', padding: '56px 24px' }}>
      <Tooltip open>
        <TooltipTrigger asChild>
          <WorkbenchIconButton label="上" icon={<IconDownload size={16} />} />
        </TooltipTrigger>
        <TooltipContent side="top">导出这段</TooltipContent>
      </Tooltip>
      <Tooltip open>
        <TooltipTrigger asChild>
          <WorkbenchIconButton label="右" icon={<IconDownload size={16} />} />
        </TooltipTrigger>
        <TooltipContent side="right">导出这段</TooltipContent>
      </Tooltip>
      <Tooltip open>
        <TooltipTrigger asChild>
          <WorkbenchIconButton label="下" icon={<IconDownload size={16} />} />
        </TooltipTrigger>
        <TooltipContent side="bottom">导出这段</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
)
