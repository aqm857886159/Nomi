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
  // 原稿与分镜是同一创作阶段的两个工作面；方案存在后始终给出明确入口，避免“内容被替换”的错觉。
  const storyboardPlan = useWorkbenchStore((s) => s.storyboardPlan)
  const storyboardPlanCommitted = useWorkbenchStore((s) => s.storyboardPlanCommitted)
  const storyboardEditorOpen = useWorkbenchStore((s) => s.storyboardEditorOpen)
  const setStoryboardEditorOpen = useWorkbenchStore((s) => s.setStoryboardEditorOpen)
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
          ? 'grid max-w-[900px] mx-auto'
          : cn(
              'grid grid-cols-[minmax(0,1fr)_344px] max-w-[1264px] mx-auto gap-5',
              'max-[1120px]:grid-cols-[minmax(0,1fr)] max-[1120px]:grid-rows-[minmax(420px,1fr)_minmax(320px,42vh)]',
            ),
      )}
      aria-label="创作区"
    >
      <div className="min-w-0 min-h-0 flex flex-col gap-2">
        {storyboardPlan ? (
          <div
            className="h-9 shrink-0 flex items-center justify-between gap-3 p-0.5 border border-nomi-line rounded-nomi bg-nomi-paper"
            role="tablist"
            aria-label="创作工作面"
          >
            <div className="flex items-center gap-0.5">
              {([
                { label: '原稿', active: !storyboardEditorOpen, open: false },
                { label: '分镜方案', active: storyboardEditorOpen, open: true },
              ] as const).map((tab) => (
                <button
                  key={tab.label}
                  type="button"
                  role="tab"
                  aria-selected={tab.active}
                  onClick={() => setStoryboardEditorOpen(tab.open)}
                  className={cn(
                    'h-7 px-3 rounded-nomi-sm text-caption font-semibold cursor-pointer',
                    'transition-[background,color,box-shadow] duration-[var(--nomi-transition-fast)]',
                    tab.active
                      ? 'bg-nomi-ink-10 text-nomi-ink shadow-nomi-sm'
                      : 'bg-transparent text-nomi-ink-40 hover:text-nomi-ink-60',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <span className={cn(
              'mr-2 text-micro',
              storyboardPlanCommitted ? 'text-workbench-success' : 'text-nomi-accent',
            )}>
              {storyboardPlanCommitted ? '已落画布' : '草稿 · 尚未落画布'}
            </span>
          </div>
        ) : null}
        <div className="min-h-0 flex-1" data-creation-surface={storyboardEditorOpen ? 'storyboard' : 'source'}>
          {storyboardEditorOpen ? <StoryboardPlanEditor /> : <WorkbenchEditor />}
        </div>
      </div>
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
