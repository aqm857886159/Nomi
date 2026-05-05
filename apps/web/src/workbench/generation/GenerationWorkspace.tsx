import React from 'react'
import TimelinePanel from '../timeline/TimelinePanel'

type GenerationWorkspaceProps = {
  canvas: React.ReactNode
  aiSidebar?: React.ReactNode
  aiLayout?: 'sidebar' | 'overlay'
}

export default function GenerationWorkspace({
  canvas,
  aiSidebar,
  aiLayout = 'sidebar',
}: GenerationWorkspaceProps): JSX.Element {
  return (
    <section
      className="workbench-generation"
      data-has-ai={aiSidebar ? 'true' : 'false'}
      data-ai-layout={aiSidebar ? aiLayout : 'none'}
      aria-label="生成区"
    >
      <div className="workbench-generation__canvas">
        {canvas}
      </div>
      {aiSidebar ? (
        <aside className="workbench-generation__ai" aria-label="生成区 AI 侧栏">
          {aiSidebar}
        </aside>
      ) : null}
      <TimelinePanel density="compact" regionLabel="生成时间轴" actionLabelPrefix="生成时间轴-" />
    </section>
  )
}
