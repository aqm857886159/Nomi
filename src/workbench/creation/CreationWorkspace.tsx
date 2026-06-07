import React from 'react'
import { cn } from '../../utils/cn'
import WorkbenchEditor from './WorkbenchEditor'

// C-2: the assistant is no longer embedded here — it lives in the single
// app-level dock (WorkbenchAssistantDock) that follows the active workspace.
// The editor takes the full width (centered), the dock overlays on the right.
export default function CreationWorkspace(): JSX.Element {
  return (
    <section
      className={cn(
        'workbench-creation',
        'grid grid-cols-[minmax(0,900px)] justify-center',
        'w-full h-full min-w-0 min-h-0',
        'pt-[22px] px-6 pb-6',
        'bg-workbench-bg',
      )}
      aria-label="创作区"
    >
      <WorkbenchEditor />
    </section>
  )
}
