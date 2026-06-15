import React from 'react'
import { cn } from '../../utils/cn'
import CreationAiPanel from './CreationAiPanel'
import WorkbenchEditor from './WorkbenchEditor'
import StoryboardPlanEditor from './storyboard/StoryboardPlanEditor'
import { NomiAILabel, WorkbenchButton } from '../../design'
import { useWorkbenchStore } from '../workbenchStore'

export default function CreationWorkspace(): JSX.Element {
  // 与生成区助手一致：一开始收着（浮起一个 pill），点开才展开成 344px 侧栏。
  const [collapsed, setCollapsed] = React.useState(true)
  // 一次性信号：打开示例/新项目时自动展开助手，让「拆镜头」CTA 一眼可见，消费后清掉。
  const autoOpen = useWorkbenchStore((s) => s.creationAssistantAutoOpen)
  const setAutoOpen = useWorkbenchStore((s) => s.setCreationAssistantAutoOpen)
  // 编辑器「打开」时主列展开分镜方案编辑器，替换文档编辑器；收起则回文档、方案以卡片留在对话流（回看链路）。
  const storyboardEditorOpen = useWorkbenchStore((s) => s.storyboardEditorOpen)
  React.useEffect(() => {
    if (autoOpen) {
      setCollapsed(false)
      setAutoOpen(false)
    }
  }, [autoOpen, setAutoOpen])

  return (
    <section
      className={cn(
        'workbench-creation relative',
        'w-full h-full min-w-0 min-h-0',
        'pt-[22px] px-6 pb-6',
        'bg-workbench-bg',
        collapsed
          ? 'grid grid-cols-[minmax(0,900px)] justify-center'
          : cn(
              'grid grid-cols-[minmax(0,900px)_344px] justify-center gap-5',
              'max-[1120px]:grid-cols-[minmax(0,1fr)] max-[1120px]:grid-rows-[minmax(420px,1fr)_minmax(320px,42vh)]',
            ),
      )}
      aria-label="创作区"
    >
      {storyboardEditorOpen ? <StoryboardPlanEditor /> : <WorkbenchEditor />}
      {collapsed ? (
        <WorkbenchButton
          className={cn(
            'absolute top-[22px] right-6 z-[20]',
            'inline-flex items-center gap-2 h-9 pl-[10px] pr-[14px]',
            'border border-nomi-line rounded-full bg-nomi-paper text-nomi-ink',
            'text-body-sm font-medium shadow-nomi-sm cursor-pointer',
            'hover:shadow-nomi-md hover:-translate-y-px',
          )}
          aria-label="展开创作助手"
          onClick={() => setCollapsed(false)}
        >
          <NomiAILabel markSize={18} wordSize={13} suffix="创作" />
        </WorkbenchButton>
      ) : (
        <CreationAiPanel onCollapse={() => setCollapsed(true)} />
      )}
    </section>
  )
}
