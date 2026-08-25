// TooltipTrigger —— 提示气泡的触发元素（= Radix Tooltip.Trigger 的再导出）。
// 关键用法是 **asChild**：不要让它自己渲染一个 button，而是把触发行为「贴」到你自己的
// 组件上（WorkbenchIconButton / DesignButton …）。不加 asChild 会多套一层 button，
// 嵌套按钮既不合法、样式也会打架。
//
// 它必须在 Tooltip(Root) 里，Root 必须在 TooltipProvider 里——所以这张卡是完整组合。
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent, WorkbenchIconButton, DesignButton } from 'nomi'
import { IconDownload } from '@tabler/icons-react'

/** asChild 贴到图标按钮上（Nomi 里最常见的写法）。 */
export const AsChildIconButton = (): JSX.Element => (
  <TooltipProvider>
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 52 }}>
      <Tooltip open>
        <TooltipTrigger asChild>
          <WorkbenchIconButton label="导出这段" icon={<IconDownload size={16} />} />
        </TooltipTrigger>
        <TooltipContent side="top">导出这段 · MP4</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
)

/** asChild 贴到文字按钮上：解释一个「为什么现在不能点」。 */
export const AsChildTextButton = (): JSX.Element => (
  <TooltipProvider>
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 52 }}>
      <Tooltip open>
        <TooltipTrigger asChild>
          <DesignButton variant="light">开始生成</DesignButton>
        </TooltipTrigger>
        <TooltipContent side="top">这一批 6 个镜头，预计 ¥1.68</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
)
